import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RunLive, type EventRow, type RunDetail } from "@/components/run/RunLive";

export const dynamic = "force-dynamic";

export default async function RunProgressPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: run } = await supabase
    .from("pipeline_runs")
    .select(
      "*, campaigns(id, title), run_stages(*), runner_devices:claimed_by(id, name, last_seen_at, runner_version, status)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!run) notFound();

  const { data: events } = await supabase
    .from("run_events")
    .select("seq, stage, ts, severity, event_type, message, current_item, total_items, exa_query_count, retry_count, cost_usd")
    .eq("run_id", id)
    .order("seq", { ascending: true })
    .limit(500);

  return (
    <RunLive
      initialRun={run as unknown as RunDetail}
      initialEvents={(events ?? []) as unknown as EventRow[]}
    />
  );
}
