import { z } from "zod";
import { stageOneApprovalSchema } from "@aureli/shared";
import { ApiError, handled, json, parseBody, requireUser } from "@/lib/api";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOwnedRun, runStatusOf, transitionRun } from "@/lib/runsService";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/runs/[id]/approve-stage-one
 * Explicit human checkpoint between the pipelines. Stage two can never start
 * without this endpoint recording an approval.
 */
export const POST = handled(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, "Invalid run id");
  const { action } = await parseBody(request, stageOneApprovalSchema);
  const admin = createSupabaseAdminClient();
  const run = await getOwnedRun(admin, user.id, id);
  const status = runStatusOf(run);
  if (status !== "awaiting_stage_one_approval") {
    throw new ApiError(409, `Run is not awaiting stage-one approval (status: ${status})`);
  }

  if (action === "approve") {
    await transitionRun(admin, id, status, "queued", {
      next_stage: "stage_two",
      directive: {},
    });
  } else if (action === "retry_failed") {
    await transitionRun(admin, id, status, "queued", {
      next_stage: "stage_one",
      directive: { mode: "retry_failed" },
    });
  } else {
    await transitionRun(admin, id, status, "cancelled", {
      completed_at: new Date().toISOString(),
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
    .eq("kind", "stage_one")
    .eq("status", "pending");

  return json({ ok: true, action });
});
