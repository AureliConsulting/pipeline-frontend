import { z } from "zod";
import { isCancellable } from "@aureli/shared";
import { ApiError, handled, json, requireUser } from "@/lib/api";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOwnedRun, runStatusOf, transitionRun } from "@/lib/runsService";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** POST /api/runs/[id]/cancel — user cancels a non-terminal run. */
export const POST = handled(async (_request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, "Invalid run id");
  const admin = createSupabaseAdminClient();
  const run = await getOwnedRun(admin, user.id, id);
  const status = runStatusOf(run);
  if (!isCancellable(status)) {
    throw new ApiError(409, `Run cannot be cancelled in status '${status}'`);
  }
  await transitionRun(admin, id, status, "cancelled", {
    completed_at: new Date().toISOString(),
  });
  // Cancel any pending approvals.
  await admin
    .from("approval_requests")
    .update({ status: "cancelled", decided_at: new Date().toISOString() })
    .eq("run_id", id)
    .eq("status", "pending");
  return json({ ok: true });
});
