import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, Alert } from "@/components/ui/misc";

export const dynamic = "force-dynamic";

export default async function ConfigurationsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: configs } = await supabase
    .from("campaign_configs")
    .select("id, name, campaign_id, updated_at, created_at, campaigns(title)")
    .order("updated_at", { ascending: false })
    .limit(200);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-lg font-semibold text-evergreen-deep">Saved configurations</h1>
      <Alert tone="info">
        Configurations are YAML documents validated against the real pipeline schema
        (gtm_research CampaignConfig). They are stored verbatim — spintax and copy strings are
        passed to the pipeline exactly as written. Create or edit them inside a campaign
        (Campaign → Configure) so each version stays attached to its campaign.
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>Library</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {(configs ?? []).length === 0 ? (
            <div className="p-4">
              <EmptyState title="No configurations yet" hint="Create one from the campaign wizard." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Campaign</TH>
                  <TH>Updated</TH>
                  <TH>Created</TH>
                </TR>
              </THead>
              <TBody>
                {(configs ?? []).map((config) => (
                  <TR key={String(config.id)}>
                    <TD className="font-medium">{String(config.name)}</TD>
                    <TD>
                      {config.campaign_id ? (
                        <Link
                          href={`/campaigns/${config.campaign_id}`}
                          className="text-evergreen hover:underline"
                        >
                          {(config.campaigns as { title?: string } | null)?.title ?? "Campaign"}
                        </Link>
                      ) : (
                        <span className="text-charcoal/40">Library</span>
                      )}
                    </TD>
                    <TD className="text-xs">{new Date(String(config.updated_at)).toLocaleString()}</TD>
                    <TD className="text-xs">{new Date(String(config.created_at)).toLocaleString()}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
