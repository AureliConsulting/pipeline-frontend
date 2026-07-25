import Link from "next/link";
import { notFound } from "next/navigation";
import { PROTOCOL, type RunStatus } from "@aureli/shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { downloadArtifactText } from "@/lib/downloadArtifact";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatTile, Alert } from "@/components/ui/misc";
import { StatusBadge } from "@/components/StatusBadge";
import { ArtifactList, type ArtifactRow } from "@/components/run/ArtifactList";
import { FinalActions } from "@/components/run/FinalActions";

export const dynamic = "force-dynamic";

const STAGE_TITLES: Record<string, string> = {
  stage_one: "Stage 1 · Sourcing & verification",
  stage_two: "Stage 2 · GTM scoring & personalization",
  fallback_resolver: "Stage 3 · Manual review fallback resolution",
  instantly_upload: "Instantly upload",
};

interface FallbackSummary {
  campaign_key?: string;
  campaign_name?: string;
  campaign_config_hash?: string;
  input_rows?: number;
  targeted_rows?: number;
  remediated_rows?: number;
  ready_rows?: number;
  blocked_rows?: number;
  fallback_changes?: number;
  blocked_reason_counts?: Record<string, number>;
  partial_mode?: boolean;
}

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: run } = await supabase
    .from("pipeline_runs")
    .select("*, campaigns(id, title), run_stages(*), artifacts(*), instantly_uploads(*)")
    .eq("id", id)
    .maybeSingle();
  if (!run) notFound();

  const artifacts = (run.artifacts as ArtifactRow[]).sort((a, b) =>
    a.artifact_type.localeCompare(b.artifact_type),
  );
  const stageTwo = (run.run_stages as Array<Record<string, unknown>>).find(
    (s) => s.stage === "stage_two",
  );
  const counts = (stageTwo?.counts ?? {}) as Record<string, number>;
  const instantlyReady = artifacts.find((a) => a.artifact_type === "instantly_ready_csv");
  const upload = Array.isArray(run.instantly_uploads)
    ? (run.instantly_uploads[0] as Record<string, unknown> | undefined)
    : (run.instantly_uploads as Record<string, unknown> | null);

  const grouped = PROTOCOL.stages.map((stage) => ({
    stage,
    items: artifacts.filter((a) => a.stage === stage),
  }));

  const readyToPush = artifacts.find((a) => a.artifact_type === "ready_to_push_csv");
  const blockedForReview = artifacts.find((a) => a.artifact_type === "blocked_for_review_csv");
  const runSummaryArtifact = artifacts.find((a) => a.artifact_type === "run_summary_json");
  let fallbackSummary: FallbackSummary | null = null;
  if (runSummaryArtifact) {
    const text = await downloadArtifactText(run.user_id as string, runSummaryArtifact.id);
    if (text) {
      try {
        fallbackSummary = JSON.parse(text) as FallbackSummary;
      } catch {
        fallbackSummary = null;
      }
    }
  }
  const blockedRows = fallbackSummary?.blocked_rows ?? blockedForReview?.row_count ?? 0;
  const partialMode = fallbackSummary?.partial_mode ?? false;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-evergreen-deep">
            Results · {(run.campaigns as { title?: string })?.title}
          </h1>
          <StatusBadge status={run.status as RunStatus} mock={run.mock as boolean} />
        </div>
      </div>

      {run.mock ? (
        <Alert tone="info">
          Mock run — outputs are fixtures; no paid APIs were called and no real upload happens.
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile label="Scored" value={counts.scored ?? counts.successful ?? 0} />
        <StatTile label="Personalized" value={counts.personalized ?? 0} />
        <StatTile label="Send-ready" value={counts.send_ready ?? instantlyReady?.row_count ?? 0} />
        <StatTile label="Manual review" value={counts.manual_review ?? 0} />
        <StatTile label="Artifacts" value={artifacts.length} />
      </div>

      {fallbackSummary ? (
        <Card>
          <CardHeader>
            <CardTitle>Fallback resolution summary</CardTitle>
            <div className="flex gap-2">
              <Link href={`/runs/${id}/leads`} className="text-xs text-evergreen hover:underline" data-testid="goto-leads">
                Review leads →
              </Link>
              <Link href={`/runs/${id}/audit`} className="text-xs text-evergreen hover:underline" data-testid="goto-audit">
                View audit trail →
              </Link>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="text-xs text-charcoal/60">
              {fallbackSummary.campaign_name ?? fallbackSummary.campaign_key} · config{" "}
              <code className="text-[11px]">{fallbackSummary.campaign_config_hash}</code>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
              <StatTile label="Input rows" value={fallbackSummary.input_rows ?? 0} />
              <StatTile label="Targeted" value={fallbackSummary.targeted_rows ?? 0} />
              <StatTile label="Remediated" value={fallbackSummary.remediated_rows ?? 0} />
              <StatTile label="Ready" value={fallbackSummary.ready_rows ?? readyToPush?.row_count ?? 0} />
              <StatTile label="Blocked" value={blockedRows} />
              <StatTile label="Fallback changes" value={fallbackSummary.fallback_changes ?? 0} />
            </div>
            {blockedRows > 0 ? (
              <Alert tone={partialMode ? "warning" : "danger"} data-testid="fail-closed-banner">
                {blockedRows} lead(s) were blocked for manual review.{" "}
                {partialMode
                  ? "Partial mode was on — the run completed with the remaining leads ready to push."
                  : "Partial mode was off — this is a fail-closed result, not a clean success. Export requires explicit confirmation."}
              </Alert>
            ) : (
              <Alert tone="success">All leads resolved cleanly — nothing was blocked.</Alert>
            )}
            {fallbackSummary.blocked_reason_counts &&
            Object.keys(fallbackSummary.blocked_reason_counts).length > 0 ? (
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-charcoal/70">
                  Blocked-reason breakdown
                </div>
                <Table>
                  <THead>
                    <TR>
                      <TH>Reason</TH>
                      <TH>Count</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {Object.entries(fallbackSummary.blocked_reason_counts).map(([reason, count]) => (
                      <TR key={reason}>
                        <TD className="font-mono text-xs">{reason}</TD>
                        <TD>{count}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {grouped.map(({ stage, items }) =>
        items.length > 0 ? (
          <Card key={stage}>
            <CardHeader>
              <CardTitle>{STAGE_TITLES[stage]}</CardTitle>
              <span className="text-xs text-charcoal/50">{items.length} file(s)</span>
            </CardHeader>
            <CardBody className="p-0">
              <ArtifactList artifacts={items} />
            </CardBody>
          </Card>
        ) : null,
      )}

      {run.status === "awaiting_final_approval" ? (
        <FinalActions
          runId={id}
          campaignTitle={(run.campaigns as { title?: string })?.title ?? ""}
          instantlyReadyCount={fallbackSummary?.ready_rows ?? readyToPush?.row_count ?? null}
          blockedRowsCount={blockedRows}
          uploadStatus={upload ? String(upload.status) : null}
        />
      ) : null}

      {run.status === "uploading_to_instantly" ? (
        <Alert tone="info">
          Instantly upload in progress on your local runner… this page updates when it completes.
        </Alert>
      ) : null}
      {upload && String(upload.status) === "completed" ? (
        <Alert tone="success">
          Uploaded {String(upload.uploaded_count ?? upload.lead_count)} leads to Instantly list{" "}
          {String(upload.list_id)}.
        </Alert>
      ) : null}
    </div>
  );
}
