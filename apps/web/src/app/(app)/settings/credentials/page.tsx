import { PROTOCOL } from "@aureli/shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, EmptyState } from "@/components/ui/misc";

export const dynamic = "force-dynamic";

const GROUPS: Array<{ title: string; keys: readonly string[]; note: string }> = [
  {
    title: "Pipeline 1 — sourcing & verification",
    keys: PROTOCOL.credential_keys.stage_one,
    note: "Vayne (Sales Navigator ingestion), Icypeas (email discovery), MillionVerifier (verification).",
  },
  {
    title: "Pipeline 2 — GTM scoring & personalization",
    keys: PROTOCOL.credential_keys.stage_two,
    note: "Exa (web research), DeepSeek (evidence extraction & personalization).",
  },
  {
    title: "Instantly upload (optional)",
    keys: PROTOCOL.credential_keys.instantly_upload,
    note: "Only used after your explicit final approval; upload runs locally.",
  },
];

const TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  configured: "success",
  missing: "warning",
  invalid: "danger",
  unchecked: "neutral",
};

export default async function CredentialsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: runners } = await supabase
    .from("runner_devices")
    .select("id, name, status, credential_report, last_connection_test_at, last_seen_at, runner_version")
    .eq("status", "active")
    .order("last_seen_at", { ascending: false });

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-lg font-semibold text-evergreen-deep">API keys</h1>
      <Alert tone="info">
        Credentials live ONLY in a local <code className="text-xs">.env</code> file (or OS
        keychain) on each runner machine — never in this application, its database, its logs, or
        Vercel. This page shows detection status reported by your runners; values are never
        transmitted.
      </Alert>

      {(runners ?? []).length === 0 ? (
        <EmptyState
          title="No active runners"
          hint="Pair a runner to see which credentials it detects."
        />
      ) : (
        (runners ?? []).map((runner) => {
          const report = (runner.credential_report ?? {}) as Record<string, string>;
          return (
            <Card key={String(runner.id)}>
              <CardHeader>
                <CardTitle>Runner · {String(runner.name)}</CardTitle>
                <span className="text-xs text-charcoal/50">
                  Last connection test:{" "}
                  {runner.last_connection_test_at
                    ? new Date(String(runner.last_connection_test_at)).toLocaleString()
                    : "not run yet"}
                </span>
              </CardHeader>
              <CardBody className="space-y-4">
                {GROUPS.map((group) => (
                  <div key={group.title}>
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-charcoal/70">
                      {group.title}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {group.keys.map((key) => {
                        const status = report[key] ?? "unchecked";
                        return (
                          <Badge key={key} tone={TONE[status] ?? "neutral"}>
                            {key}: {status}
                          </Badge>
                        );
                      })}
                    </div>
                    <p className="mt-1 text-[11px] text-charcoal/50">{group.note}</p>
                  </div>
                ))}
                <p className="text-[11px] text-charcoal/45">
                  To update credentials, edit the runner&apos;s local .env file and run{" "}
                  <code>python -m aureli_runner check-credentials</code>.
                </p>
              </CardBody>
            </Card>
          );
        })
      )}
    </div>
  );
}
