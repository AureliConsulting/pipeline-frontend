import { notFound } from "next/navigation";
import type { RunStatus } from "@aureli/shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { downloadArtifactText, parseCsvRows } from "@/lib/downloadArtifact";
import { StatusBadge } from "@/components/StatusBadge";
import { Alert } from "@/components/ui/misc";
import { AuditTable } from "@/components/run/AuditTable";
import type { ArtifactRow } from "@/components/run/ArtifactList";

export const dynamic = "force-dynamic";

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: run } = await supabase
    .from("pipeline_runs")
    .select("*, campaigns(id, title), artifacts(*)")
    .eq("id", id)
    .maybeSingle();
  if (!run) notFound();

  const artifacts = run.artifacts as ArtifactRow[];
  const auditArtifact = artifacts.find((a) => a.artifact_type === "fallback_audit_csv");
  const text = await downloadArtifactText(run.user_id as string, auditArtifact?.id);
  const audit = text ? parseCsvRows(text) : { headers: [], rows: [] };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-evergreen-deep">
            Fallback audit trail · {(run.campaigns as { title?: string })?.title}
          </h1>
          <StatusBadge status={run.status as RunStatus} mock={run.mock as boolean} />
        </div>
      </div>

      {audit.rows.length === 0 ? (
        <Alert tone="info">
          No fallback changes recorded for this run — either the resolver hasn&apos;t completed yet
          or every field was already present.
        </Alert>
      ) : (
        <AuditTable audit={audit} />
      )}
    </div>
  );
}
