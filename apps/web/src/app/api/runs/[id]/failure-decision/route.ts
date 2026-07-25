import { z } from "zod";
import { failureDecisionSchema } from "@aureli/shared";
import { ApiError, handled, json, parseBody, requireUser } from "@/lib/api";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOwnedRun, runStatusOf, transitionRun } from "@/lib/runsService";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/runs/[id]/failure-decision
 * After automatic retries are exhausted the run pauses in stage_*_failed and
 * the user chooses: retry failed rows, skip failed rows and continue, or
 * cancel. (Downloading partial output needs no state change — artifacts of
 * successful rows are already registered.)
 */
export const POST = handled(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, "Invalid run id");
  const { action } = await parseBody(request, failureDecisionSchema);
  const admin = createSupabaseAdminClient();
  const run = await getOwnedRun(admin, user.id, id);
  const status = runStatusOf(run);
  if (status !== "stage_one_failed" && status !== "stage_two_failed") {
    throw new ApiError(409, `Run is not paused on a failure (status: ${status})`);
  }
  const failedStage = status === "stage_one_failed" ? "stage_one" : "stage_two";

  if (action === "cancel") {
    await transitionRun(admin, id, status, "cancelled", {
      completed_at: new Date().toISOString(),
    });
  } else {
    await transitionRun(admin, id, status, "queued", {
      next_stage: failedStage,
      directive: { mode: action }, // retry_failed | skip_failed
      error: null,
    });
  }

  await admin
    .from("approval_requests")
    .update({
      status: "decided",
      decision: { action, decided_by: user.id },
      decided_at: new Date().toISOString(),
    })
    .eq("run_id", id)
    .eq("kind", "failure_decision")
    .eq("status", "pending");

  return json({ ok: true, action });
});
