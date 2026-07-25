import { z } from "zod";
import { instantlyProgressSchema, redactSecrets } from "@aureli/shared";
import { ApiError, handled, json, parseBody } from "@/lib/api";
import { requireRunner, requireRunnerRun } from "@/lib/runnerAuth";
import { runStatusOf, transitionRun } from "@/lib/runsService";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/runner/runs/[id]/instantly — Instantly upload progress from the
 * runner. Idempotent: transitions are keyed on the stored idempotency_key and
 * current status, so replays are acknowledged without double-completing.
 * Completion is a trusted execution field — only this runner-authenticated
 * route can set it, never the browser.
 */
export const POST = handled(async (request: Request, { params }: Params) => {
  const { runner, admin } = await requireRunner(request);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, "Invalid run id");
  const run = await requireRunnerRun(admin, runner, id);
  if (run.claimed_by !== runner.id) {
    throw new ApiError(409, "Run is not claimed by this runner", "not_claimed");
  }
  const input = await parseBody(request, instantlyProgressSchema);

  const { data: upload } = await admin
    .from("instantly_uploads")
    .select("*")
    .eq("run_id", id)
    .maybeSingle();
  if (!upload) throw new ApiError(409, "No approved Instantly upload for this run", "no_upload");
  if (upload.idempotency_key !== input.idempotency_key) {
    throw new ApiError(409, "Idempotency key mismatch", "idempotency_mismatch");
  }

  const status = runStatusOf(run);

  if (input.state === "started") {
    if (upload.status === "completed") return json({ ok: true, deduplicated: true });
    await admin.from("instantly_uploads").update({ status: "uploading" }).eq("id", upload.id)
      .in("status", ["approved", "failed", "uploading"]);
    return json({ ok: true });
  }

  if (input.state === "completed") {
    if (upload.status === "completed") return json({ ok: true, deduplicated: true });
    await admin
      .from("instantly_uploads")
      .update({ status: "completed", uploaded_count: input.uploaded_count ?? upload.lead_count, error: null })
      .eq("id", upload.id);
    if (status === "uploading_to_instantly") {
      const warnings = ((run.warnings as string[] | null) ?? []) as string[];
      await transitionRun(
        admin, id, status,
        warnings.length > 0 ? "completed_with_warnings" : "completed",
        { completed_at: new Date().toISOString() },
      );
    }
    return json({ ok: true });
  }

  // failed — back to awaiting_final_approval so the user can retry or finish.
  const message = redactSecrets(input.error ?? "Instantly upload failed");
  await admin
    .from("instantly_uploads")
    .update({ status: "failed", error: message })
    .eq("id", upload.id);
  if (status === "uploading_to_instantly") {
    await transitionRun(admin, id, status, "awaiting_final_approval", { error: message });
  }
  return json({ ok: true });
});
