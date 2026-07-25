import { PROTOCOL, protocolWarning } from "@aureli/shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, EmptyState } from "@/components/ui/misc";
import { PairRunnerButton, RevokeRunnerButton } from "@/components/RunnerControls";

export const dynamic = "force-dynamic";

export default async function RunnersPage() {
  const supabase = await createSupabaseServerClient();
  const { data: runners } = await supabase
    .from("runner_devices")
    .select("*")
    .order("paired_at", { ascending: false });

  const cutoff = Date.now() - PROTOCOL.limits.runner_offline_after_seconds * 1000;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-evergreen-deep">Runners</h1>
        <PairRunnerButton />
      </div>

      <Alert tone="info">
        The local runner executes pipelines on your machine with credentials that never leave it.
        Pair it with: <code className="font-[family-name:var(--font-mono)] text-xs">python -m aureli_runner pair --code &lt;CODE&gt;</code>, then keep it
        running with <code className="font-[family-name:var(--font-mono)] text-xs">python -m aureli_runner run</code>.
      </Alert>

      {(runners ?? []).length === 0 ? (
        <EmptyState title="No runners paired" hint="Generate a pairing code to connect this computer." />
      ) : (
        (runners ?? []).map((runner) => {
          const online =
            runner.status === "active" &&
            runner.last_seen_at &&
            new Date(String(runner.last_seen_at)).getTime() >= cutoff;
          const warning = runner.protocol_version
            ? protocolWarning(String(runner.protocol_version))
            : null;
          return (
            <Card key={String(runner.id)}>
              <CardHeader>
                <CardTitle>{String(runner.name)}</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge tone={runner.status === "revoked" ? "danger" : online ? "success" : "warning"}>
                    {runner.status === "revoked" ? "Revoked" : online ? "Online" : "Offline"}
                  </Badge>
                  {runner.status === "active" ? <RevokeRunnerButton runnerId={String(runner.id)} /> : null}
                </div>
              </CardHeader>
              <CardBody className="space-y-2">
                {warning ? <Alert tone="warning">{warning}</Alert> : null}
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-charcoal/70 md:grid-cols-4">
                  <span>Platform: {String(runner.platform || "—")}</span>
                  <span>Runner: v{String(runner.runner_version || "?")}</span>
                  <span>Protocol: {String(runner.protocol_version || "?")}</span>
                  <span>
                    Last seen:{" "}
                    {runner.last_seen_at ? new Date(String(runner.last_seen_at)).toLocaleString() : "never"}
                  </span>
                  <span>Paired: {new Date(String(runner.paired_at)).toLocaleString()}</span>
                  <span>
                    Last connection test:{" "}
                    {runner.last_connection_test_at
                      ? new Date(String(runner.last_connection_test_at)).toLocaleString()
                      : "—"}
                  </span>
                </div>
              </CardBody>
            </Card>
          );
        })
      )}
    </div>
  );
}
