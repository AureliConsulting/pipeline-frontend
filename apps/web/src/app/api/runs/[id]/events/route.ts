import { z } from "zod";
import { ApiError, handled, json, requireUser } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET /api/runs/[id]/events?after_seq=N&limit=M — paginated live log window. */
export const GET = handled(async (request: Request, { params }: Params) => {
  await requireUser();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, "Invalid run id");
  const url = new URL(request.url);
  const afterSeq = Number(url.searchParams.get("after_seq") ?? -1);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 200) || 200, 500);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("run_events")
    .select("seq, stage, ts, severity, event_type, message, current_item, total_items, exa_query_count, retry_count, cost_usd, metadata")
    .eq("run_id", id)
    .gt("seq", Number.isFinite(afterSeq) ? afterSeq : -1)
    .order("seq", { ascending: true })
    .limit(limit);
  if (error) return json({ error: "Query failed" }, 500);
  return json({ events: data ?? [] });
});
