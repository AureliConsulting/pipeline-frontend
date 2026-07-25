import Link from "next/link";
import { PROTOCOL, isRunStatus, isTerminal, type RunStatus, STATUS_LABELS } from "@aureli/shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatTile, EmptyState } from "@/components/ui/misc";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { DashboardSearch } from "@/components/DashboardSearch";

export const dynamic = "force-dynamic";

interface RunRow {
  id: string;
  status: string;
  current_stage: string | null;
  lead_count: number | null;
  mock: boolean;
  created_at: string;
  updated_at: string;
}

interface CampaignRow {
  id: string;
  title: string;
  input_type: string;
  max_leads: number;
  created_at: string;
  updated_at: string;
  pipeline_runs: RunRow[];
}

function latestRun(campaign: CampaignRow): RunRow | null {
  return (
    [...campaign.pipeline_runs].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string }>;
}) {
  const { search = "", status: statusFilter = "" } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let query = supabase
    .from("campaigns")
    .select(
      "id, title, input_type, max_leads, created_at, updated_at, pipeline_runs(id, status, current_stage, lead_count, mock, created_at, updated_at)",
    )
    .order("updated_at", { ascending: false })
    .limit(100);
  if (search.trim()) {
    const escaped = search.trim().replace(/[%_\\]/g, (c) => `\\${c}`);
    query = query.ilike("title", `%${escaped}%`);
  }
  const { data: campaignsRaw } = await query;
  let campaigns = (campaignsRaw ?? []) as unknown as CampaignRow[];
  if (statusFilter && isRunStatus(statusFilter)) {
    campaigns = campaigns.filter((c) => latestRun(c)?.status === statusFilter);
  }

  const allRuns = campaigns.flatMap((c) =>
    c.pipeline_runs.map((r) => ({ ...r, campaignTitle: c.title })),
  );
  const activeRuns = allRuns.filter(
    (r) => isRunStatus(r.status) && !isTerminal(r.status as RunStatus) && r.status !== "draft",
  );
  const awaitingApproval = allRuns.filter((r) =>
    ["awaiting_stage_one_approval", "awaiting_final_approval", "stage_one_failed", "stage_two_failed"].includes(r.status),
  );

  const cutoff = new Date(Date.now() - PROTOCOL.limits.runner_offline_after_seconds * 1000).toISOString();
  const { data: runners } = await supabase
    .from("runner_devices")
    .select("id, name, status, last_seen_at")
    .eq("status", "active");
  const online = (runners ?? []).filter((r) => r.last_seen_at && r.last_seen_at >= cutoff);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-evergreen-deep">Dashboard</h1>
        <Link href="/campaigns/new">
          <Button data-testid="new-campaign">New Campaign</Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Campaigns" value={campaigns.length} />
        <StatTile label="Active runs" value={activeRuns.length} />
        <StatTile label="Awaiting approval" value={awaitingApproval.length} />
        <StatTile
          label="Runners online"
          value={`${online.length}/${(runners ?? []).length}`}
          hint={online.length === 0 ? "Start your local runner" : undefined}
        />
      </div>

      {awaitingApproval.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Needs your decision</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {awaitingApproval.slice(0, 5).map((run) => (
              <div key={run.id} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{run.campaignTitle}</span>
                  <StatusBadge status={run.status as RunStatus} mock={run.mock} />
                </div>
                <Link
                  href={
                    run.status === "awaiting_final_approval"
                      ? `/runs/${run.id}/results`
                      : `/runs/${run.id}/review`
                  }
                >
                  <Button size="sm" variant="secondary">
                    Review
                  </Button>
                </Link>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Campaigns</CardTitle>
          <DashboardSearch initialSearch={search} initialStatus={statusFilter} />
        </CardHeader>
        <CardBody className="p-0">
          {campaigns.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={search ? `No campaigns match “${search}”` : "No campaigns yet"}
                hint="Create a campaign to start a pipeline run."
              />
            </div>
          ) : (
            <Table data-testid="campaign-table">
              <THead>
                <TR>
                  <TH>Title</TH>
                  <TH>Input</TH>
                  <TH>Leads</TH>
                  <TH>Status</TH>
                  <TH>Stage</TH>
                  <TH>Owner</TH>
                  <TH>Created</TH>
                  <TH>Updated</TH>
                  <TH>Actions</TH>
                </TR>
              </THead>
              <TBody>
                {campaigns.map((campaign) => {
                  const run = latestRun(campaign);
                  return (
                    <TR key={campaign.id}>
                      <TD>
                        <Link
                          href={`/campaigns/${campaign.id}`}
                          className="font-medium text-evergreen hover:underline"
                        >
                          {campaign.title}
                        </Link>
                      </TD>
                      <TD>
                        <Badge tone="neutral">
                          {campaign.input_type === "csv" ? "CSV" : "Sales Nav"}
                        </Badge>
                      </TD>
                      <TD>{run?.lead_count ?? campaign.max_leads}</TD>
                      <TD>
                        {run && isRunStatus(run.status) ? (
                          <StatusBadge status={run.status as RunStatus} mock={run.mock} />
                        ) : (
                          <Badge tone="neutral">No runs</Badge>
                        )}
                      </TD>
                      <TD className="text-xs text-charcoal/70">
                        {run?.current_stage === "stage_two"
                          ? "GTM scoring"
                          : run?.current_stage === "stage_one"
                            ? "Sourcing"
                            : run?.current_stage === "instantly_upload"
                              ? "Instantly"
                              : "—"}
                      </TD>
                      <TD className="text-xs text-charcoal/70">{user?.email ?? ""}</TD>
                      <TD className="text-xs text-charcoal/70">
                        {new Date(campaign.created_at).toLocaleDateString()}
                      </TD>
                      <TD className="text-xs text-charcoal/70">
                        {new Date(campaign.updated_at).toLocaleDateString()}
                      </TD>
                      <TD>
                        {run && !["draft"].includes(run.status) ? (
                          <Link
                            href={`/runs/${run.id}/progress`}
                            className="text-xs text-evergreen hover:underline"
                          >
                            View run
                          </Link>
                        ) : (
                          <Link
                            href={`/campaigns/${campaign.id}`}
                            className="text-xs text-evergreen hover:underline"
                          >
                            Open
                          </Link>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <p className="text-[11px] text-charcoal/45">
        Statuses: {PROTOCOL.run_statuses.map((s) => STATUS_LABELS[s]).join(" · ")}
      </p>
    </div>
  );
}
