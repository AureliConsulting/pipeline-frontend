import { z } from "zod";
import { stageCompleteSchema, redactSecrets } from "@aureli/shared";
import { ApiError, handled, json, parseBody } from "@/lib/api";
import { requireRunner, requireRunnerRun } from "@/lib/runnerAuth";
import { runStatusOf, transitionRun, expectedRunningStatuses, failedStatusFor, stageCompletionPlan } from "@/lib/runsService";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/runner/runs/[id]/stage-complete — stage outcome from the runner.
 * completed -> pauses at the corresponding human approval checkpoint.
 * failed    -> pauses in stage_*_failed with a failure_decision approval.
 * The browser can never call this: it requires a runner token for the
 * run's owner AND the run to be claimed by that exact device.
 */
export const POST = handled(async (request: Request, { params }: Params) => {
  const { runner, admin } = await requireRunner(request);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, "Invalid run id");
  const run = await requireRunnerRun(admin, runner, id);
  if (run.claimed_by !== runner.id) {
    throw new ApiError(409, "Run is not claimed by this runner", "not_claimed");
  }
  const input = await parseBody(request, stageCompleteSchema);
  const status = runStatusOf(run);
  const now = new Date().toISOString();

  // Idempotency: if the run already advanced past this stage, acknowledge.
  const expectedRunning = expectedRunningStatuses(input.stage);
  if (!expectedRunning.includes(status)) {
    return json({ ok: true, deduplicated: true, status });
  }

  const warnings = [
    ...(((run.warnings as string[] | null) ?? []) as string[]),
    ...(input.warnings ?? []).map((w) => redactSecrets(w)),
  ].slice(0, 50);

  if (input.outcome === "cancelled") {
    await transitionRun(admin, id, status, "cancelled", { completed_at: now, warnings });
    await admin
      .from("run_stages")
      .update({ status: "failed", ended_at: now, error: "Cancelled by user", counts: input.counts })
      .eq("run_id", id)
      .eq("stage", input.stage);
    return json({ ok: true });
  }

  if (input.outcome === "failed") {
    const target = failedStatusFor(input.stage);
    const message = redactSecrets(input.error ?? "Stage failed");
    await transitionRun(admin, id, status, target, { error: message, warnings });
    await admin
      .from("run_stages")
      .update({ status: "failed", ended_at: now, error: message, counts: input.counts })
      .eq("run_id", id)
      .eq("stage", input.stage);
    await admin.from("approval_requests").insert({
      run_id: id,
      user_id: runner.user_id,
      kind: "failure_decision",
      payload: { stage: input.stage, error: message, error_class: input.error_class ?? "transient", counts: input.counts },
    });
    return json({ ok: true });
  }

  // completed
  // NOTE: deliberately does NOT reset `progress` here. It caches the last
  // stage_progress event (current_item/total_items/exa_query_count) purely
  // for the Leads/Exa-queries tiles on the progress page. A run can sit in
  // an approval-wait status for a long time, and clearing this on every
  // stage completion (including the final one) blanked those tiles right
  // when they're most useful — they'd fall back to 0 while the per-stage
  // counts (which come from run_stages.counts, unaffected by this) kept
  // showing correct totals. Leaving the last value in place is correct: it
  // reflects the stage's final progress, and the next stage's first
  // stage_progress event naturally supersedes it within moments of starting.
  await admin
    .from("run_stages")
    .update({ status: "completed", ended_at: now, counts: input.counts, error: null })
    .eq("run_id", id)
    .eq("stage", input.stage);

  const plan = stageCompletionPlan(input.stage);
  if (plan.kind === "auto_continue") {
    // Mandatory auto-continue: the fallback resolver always runs next, with
    // no human gate in between — never an approval_requests row here.
    await transitionRun(admin, id, status, plan.status, { next_stage: plan.nextStage, warnings, directive: {} });
    return json({ ok: true });
  }

  await transitionRun(admin, id, status, plan.status, { warnings });
  await admin.from("approval_requests").insert({
    run_id: id,
    user_id: runner.user_id,
    kind: plan.approvalKind,
    payload: { stage: input.stage, counts: input.counts },
  });
  return json({ ok: true });
});
