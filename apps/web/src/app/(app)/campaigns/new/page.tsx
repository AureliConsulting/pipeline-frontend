import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CampaignWizard, type RunnerSummary } from "@/components/wizard/CampaignWizard";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("runner_devices")
    .select("id, name, status, last_seen_at, runner_version, protocol_version, credential_report")
    .eq("status", "active")
    .order("last_seen_at", { ascending: false });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-evergreen-deep">New campaign</h1>
      <CampaignWizard runners={(data ?? []) as unknown as RunnerSummary[]} />
    </div>
  );
}
