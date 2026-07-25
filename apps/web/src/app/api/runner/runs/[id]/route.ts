import { z } from "zod";
import { ApiError, handled, json } from "@/lib/api";
import { requireRunner, requireRunnerRun } from "@/lib/runnerAuth";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/runner/runs/[id] — run status for the runner's watcher loop
 * (approval outcomes, Instantly approval, cancellation).
 */
export const GET = handled(async (request: Request, { params }: Params) => {
  const { runner, admin } = await requireRunner(request);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, "Invalid run id");
  const run = await requireRunnerRun(admin, runner, id);
  const { data: upload } = await admin
    .from("instantly_uploads")
    .select("id, status, idempotency_key, list_id, lead_count, uploaded_count")
    .eq("run_id", id)
    .maybeSingle();
  return json({
    run: {
      id: run.id,
      status: run.status,
      next_stage: run.next_stage,
      current_stage: run.current_stage,
      directive: run.directive,
      claimed_by: run.claimed_by,
      mock: run.mock,
    },
    instantly_upload: upload ?? null,
  });
});
