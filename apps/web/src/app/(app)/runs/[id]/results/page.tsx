import { notFound } from "next/navigation";
import { PROTOCOL, type RunStatus } from "@aureli/shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile, Alert } from "@/components/ui/misc";
import { StatusBadge } from "@/components/StatusBadge";
import { ArtifactList, type ArtifactRow } from "@/components/run/ArtifactList";
import { FinalActions } from "@/components/run/FinalActions";

export const dynamic = "force-dynamic";

const STAGE_TITLES: Record<string, string> = {
  stage_one: "Stage 1 · Sourcing & verification",
  stage_two: "Stage 2 · GTM scoring & personalization",
  instantly_upload: "Instantly upload",
};

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
          instantlyReadyCount={instantlyReady?.row_count ?? null}
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
