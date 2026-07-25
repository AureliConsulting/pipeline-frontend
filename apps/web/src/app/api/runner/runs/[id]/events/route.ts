import { z } from "zod";
import { eventBatchSchema, redactSecrets, isRunStatus, canTransition, PROTOCOL } from "@aureli/shared";
import { ApiError, handled, json, parseBody } from "@/lib/api";
import { requireRunner, requireRunnerRun } from "@/lib/runnerAuth";
import { enforceRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/runner/runs/[id]/events — idempotent batched event ingestion.
 * (run_id, seq) is unique, so re-sent batches after a network blip insert
 * nothing twice. Messages are secret-redacted server-side as a backstop.
 * stage_started / stage_retrying events also flip the run's running/retrying
 * status so the UI reflects retry state without a separate endpoint.
 */
export const POST = handled(async (request: Request, { params }: Params) => {
  const { runner, admin } = await requireRunner(request);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, "Invalid run id");
  await enforceRateLimit(admin, `events:${runner.id}`, 120, 60);
  const run = await requireRunnerRun(admin, runner, id);
  if (run.claimed_by !== runner.id) {
    throw new ApiError(409, "Run is not claimed by this runner", "not_claimed");
  }
  const { events } = await parseBody(request, eventBatchSchema);

  const sanitized = events.map((event) => ({
    ...event,
    message: redactSecrets(event.message),
    metadata: event.metadata ?? null,
  }));

  const { data: inserted, error } = await admin.rpc("append_run_events", {
    p_run_id: id,
    p_events: sanitized,
    p_retain: PROTOCOL.limits.live_events_retained_per_run,
  });
  if (error) throw new ApiError(500, "Event ingestion failed", "internal");

  // Status side-effects: running <-> retrying flips.
  const current = String(run.status);
  const last = [...sanitized].reverse().find(
    (e) => e.event_type === "stage_retrying" || e.event_type === "stage_started",
  );
  if (last && isRunStatus(current)) {
    const stagePrefix = last.stage === "stage_two" ? "stage_two" : "stage_one";
    const target =
      last.event_type === "stage_retrying"
        ? (`${stagePrefix}_retrying` as const)
        : (`${stagePrefix}_running` as const);
    if (isRunStatus(target) && current !== target && canTransition(current, target)) {
      await admin.from("pipeline_runs").update({ status: target }).eq("id", id).eq("status", current);
      await admin
        .from("run_stages")
        .update({ status: last.event_type === "stage_retrying" ? "retrying" : "running" })
        .eq("run_id", id)
        .eq("stage", stagePrefix);
    }
  }

  return json({ ok: true, inserted: inserted ?? 0 });
});
