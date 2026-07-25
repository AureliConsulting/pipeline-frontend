"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { fetchJson } from "@/lib/fetchJson";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";

export interface ArtifactRow {
  id: string;
  stage: string;
  artifact_type: string;
  file_name: string;
  size_bytes: number;
  row_count: number | null;
  created_at: string;
  verified: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  source_csv: "Original source CSV",
  vayne_export: "Vayne export",
  email_discovery_output: "Email-discovery output (Icypeas)",
  verification_output: "Verification output (MillionVerifier)",
  verified_csv: "Verified CSV",
  rejected_csv: "Rejected CSV",
  invalid_email_csv: "Invalid-email CSV",
  manual_review_csv: "Manual-review CSV",
  gtm_scored_csv: "GTM-scored CSV",
  personalized_csv: "Personalized CSV",
  instantly_ready_csv: "Instantly-ready CSV",
  cost_report: "Cost report",
  evidence_report: "Evidence / research report",
  pipeline_log: "Full pipeline log",
  config_snapshot: "Configuration snapshot",
};

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function DownloadButton({ artifactId, fileName }: { artifactId: string; fileName: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      data-testid={`download-${artifactId}`}
      onClick={async () => {
        setBusy(true);
        try {
          const body = await fetchJson<{ url: string }>(`/api/artifacts/${artifactId}/download`);
          const link = document.createElement("a");
          link.href = body.url;
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          link.remove();
        } finally {
          setBusy(false);
        }
      }}
    >
      <Download className="h-3.5 w-3.5" aria-hidden />
      {busy ? "…" : "Download"}
    </Button>
  );
}

export function ArtifactList({ artifacts }: { artifacts: ArtifactRow[] }) {
  if (artifacts.length === 0) {
    return <EmptyState title="No artifacts yet" hint="Outputs appear here as stages complete." />;
  }
  return (
    <Table>
      <THead>
        <TR>
          <TH>Type</TH>
          <TH>File</TH>
          <TH>Rows</TH>
          <TH>Size</TH>
          <TH>Created</TH>
          <TH />
        </TR>
      </THead>
      <TBody>
        {artifacts.map((artifact) => (
          <TR key={artifact.id}>
            <TD>
              <Badge tone="neutral">{TYPE_LABELS[artifact.artifact_type] ?? artifact.artifact_type}</Badge>
            </TD>
            <TD className="font-[family-name:var(--font-mono)] text-xs">{artifact.file_name}</TD>
            <TD>{artifact.row_count ?? "—"}</TD>
            <TD>{formatSize(artifact.size_bytes)}</TD>
            <TD className="text-xs text-charcoal/60">
              {new Date(artifact.created_at).toLocaleString()}
            </TD>
            <TD>
              <DownloadButton artifactId={artifact.id} fileName={artifact.file_name} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
