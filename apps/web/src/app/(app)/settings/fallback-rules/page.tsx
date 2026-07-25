import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, Alert } from "@/components/ui/misc";
import { FallbackRulesManager } from "@/components/FallbackRulesManager";

export const dynamic = "force-dynamic";

export default async function FallbackRulesPage() {
  const supabase = await createSupabaseServerClient();
  const { data: ruleSets } = await supabase
    .from("fallback_rule_sets")
    .select("id, name, updated_at, created_at")
    .order("updated_at", { ascending: false })
    .limit(200);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-lg font-semibold text-evergreen-deep">Fallback rule sets</h1>
      <Alert tone="info">
        Shared, non-campaign-specific JSON handed to the manual review fallback resolver&apos;s{" "}
        <code>--config</code> flag. Runs that don&apos;t select one use the resolver&apos;s own
        built-in defaults. Select or create a rule set from the campaign launch wizard, or create
        one here to reuse across campaigns.
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>Library</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {(ruleSets ?? []).length === 0 ? (
            <div className="p-4">
              <EmptyState title="No fallback rule sets yet" hint="Create one below or from the campaign wizard." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Updated</TH>
                  <TH>Created</TH>
                </TR>
              </THead>
              <TBody>
                {(ruleSets ?? []).map((ruleSet) => (
                  <TR key={String(ruleSet.id)}>
                    <TD className="font-medium">{String(ruleSet.name)}</TD>
                    <TD className="text-xs">{new Date(String(ruleSet.updated_at)).toLocaleString()}</TD>
                    <TD className="text-xs">{new Date(String(ruleSet.created_at)).toLocaleString()}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
      <FallbackRulesManager />
    </div>
  );
}
