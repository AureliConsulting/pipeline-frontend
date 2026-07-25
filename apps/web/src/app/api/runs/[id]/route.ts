import { z } from "zod";
import { ApiError, handled, json, requireUser } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET /api/runs/[id] — run detail (polling fallback for realtime). RLS-scoped. */
export const GET = handled(async (_request: Request, { params }: Params) => {
  await requireUser();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, "Invalid run id");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("pipeline_runs")
    .select(
      "*, campaigns(id, title, input_type, max_leads), campaign_configs(id, name), run_stages(*), artifacts(*), approval_requests(*), instantly_uploads(*), runner_devices:claimed_by(id, name, last_seen_at, runner_version, protocol_version, status)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) return json({ error: "Query failed" }, 500);
  if (!data) throw new ApiError(404, "Run not found");
  return json({ run: data });
});
