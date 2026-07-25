import Link from "next/link";
import { notFound } from "next/navigation";
import { isRunStatus, type RunStatus } from "@aureli/shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*, pipeline_runs(*), campaign_configs(id, name, updated_at)")
    .eq("id", id)
    .maybeSingle();
  if (!campaign) notFound();

  const runs = (campaign.pipeline_runs as Array<Record<string, unknown>>).sort((a, b) =>
    String(a.created_at) < String(b.created_at) ? 1 : -1,
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-evergreen-deep">{String(campaign.title)}</h1>
          {campaign.description ? (
            <p className="mt-0.5 text-sm text-charcoal/60">{String(campaign.description)}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="neutral">
            {campaign.input_type === "csv" ? "CSV input" : "Sales Navigator input"}
          </Badge>
          <Badge tone="neutral">max {String(campaign.max_leads)} leads</Badge>
          <Link href={`/campaigns/${id}/configure`}>
            <Button variant="outline" size="sm">Configure</Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Runs</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {runs.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="No runs yet"
                hint="Use the New Campaign wizard to upload input and start the pipeline."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Started</TH>
                  <TH>Status</TH>
                  <TH>Leads</TH>
                  <TH>Updated</TH>
                  <TH>Actions</TH>
                </TR>
              </THead>
              <TBody>
                {runs.map((run) => (
                  <TR key={String(run.id)}>
                    <TD className="text-xs">{new Date(String(run.created_at)).toLocaleString()}</TD>
                    <TD>
                      {isRunStatus(String(run.status)) ? (
                        <StatusBadge status={run.status as RunStatus} mock={Boolean(run.mock)} />
                      ) : (
                        String(run.status)
                      )}
                    </TD>
                    <TD>{run.lead_count === null ? "—" : String(run.lead_count)}</TD>
                    <TD className="text-xs">{new Date(String(run.updated_at)).toLocaleString()}</TD>
                    <TD className="space-x-2 text-xs">
                      <Link className="text-evergreen hover:underline" href={`/runs/${run.id}/progress`}>
                        Progress
                      </Link>
                      <Link className="text-evergreen hover:underline" href={`/runs/${run.id}/review`}>
                        Review
                      </Link>
                      <Link className="text-evergreen hover:underline" href={`/runs/${run.id}/results`}>
                        Results
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configurations used by this campaign</CardTitle>
        </CardHeader>
        <CardBody>
          {(campaign.campaign_configs as Array<Record<string, unknown>>).length === 0 ? (
            <p className="text-sm text-charcoal/50">None yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {(campaign.campaign_configs as Array<Record<string, unknown>>).map((config) => (
                <li key={String(config.id)} className="flex items-center justify-between">
                  <span>{String(config.name)}</span>
                  <span className="text-xs text-charcoal/50">
                    {new Date(String(config.updated_at)).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
