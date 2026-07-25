import { notFound } from "next/navigation";
import { parseCsv } from "@aureli/shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatTile, Alert } from "@/components/ui/misc";
import { StatusBadge } from "@/components/StatusBadge";
import { StageOneActions } from "@/components/run/StageOneActions";
import { ArtifactList, type ArtifactRow } from "@/components/run/ArtifactList";
import type { RunStatus } from "@aureli/shared";

export const dynamic = "force-dynamic";

const COUNT_LABELS: Array<[string, string]> = [
  ["total_submitted", "Submitted"],
  ["discovered", "Discovered"],
  ["verified", "Verified"],
  ["catch_all", "Catch-all"],
  ["invalid", "Invalid"],
  ["duplicate", "Duplicates"],
  ["rejected", "Rejected"],
  ["failed", "Failed"],
];

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: run } = await supabase
    .from("pipeline_runs")
    .select("*, campaigns(id, title), run_stages(*), artifacts(*)")
    .eq("id", id)
    .maybeSingle();
  if (!run) notFound();

  const stageOne = (run.run_stages as Array<Record<string, unknown>>).find(
    (s) => s.stage === "stage_one",
  );
  const counts = (stageOne?.counts ?? {}) as Record<string, number>;
  const artifacts = (run.artifacts as ArtifactRow[]).filter((a) => a.stage === "stage_one");
  const verifiedArtifact = artifacts.find((a) => a.artifact_type === "verified_csv");

  // Server-side preview of the verified CSV (ownership already proven by RLS
  // read above; admin client is only used to stream the file).
  let preview: { headers: string[]; rows: string[][] } | null = null;
  if (verifiedArtifact) {
    try {
      const admin = createSupabaseAdminClient();
      const { data: full } = await admin
        .from("artifacts")
        .select("storage_path, user_id")
        .eq("id", verifiedArtifact.id)
        .maybeSingle();
      if (full && full.user_id === (run.user_id as string)) {
        const { data: blob } = await admin.storage
          .from("artifacts")
          .download(String(full.storage_path));
        if (blob) {
          const text = (await blob.text()).slice(0, 400_000);
          const rows = parseCsv(text, 26);
          preview = { headers: rows[0] ?? [], rows: rows.slice(1, 26) };
        }
      }
    } catch {
      preview = null;
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-evergreen-deep">
            Stage-one review · {(run.campaigns as { title?: string })?.title}
          </h1>
          <StatusBadge status={run.status as RunStatus} mock={run.mock as boolean} />
        </div>
      </div>

      {run.status !== "awaiting_stage_one_approval" ? (
        <Alert tone="info">
          This run is not awaiting stage-one approval right now (status: {String(run.status)}).
        </Alert>
      ) : (
        <Alert tone="warning">
          The pipeline is paused. The GTM scoring & personalization stage will not start until you
          approve these results.
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {COUNT_LABELS.filter(([key]) => counts[key] !== undefined).map(([key, label]) => (
          <StatTile key={key} label={label} value={counts[key] ?? 0} />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Verified CSV preview</CardTitle>
          {verifiedArtifact ? (
            <span className="text-xs text-charcoal/50">
              {verifiedArtifact.file_name} · {verifiedArtifact.row_count ?? "?"} rows
            </span>
          ) : null}
        </CardHeader>
        <CardBody className="p-0">
          {preview && preview.rows.length > 0 ? (
            <div className="max-h-96 overflow-auto">
              <Table>
                <THead>
                  <TR>
                    {preview.headers.slice(0, 10).map((header, i) => (
                      <TH key={i} className="whitespace-nowrap">{header}</TH>
                    ))}
                    {preview.headers.length > 10 ? <TH>…</TH> : null}
                  </TR>
                </THead>
                <TBody>
                  {preview.rows.map((row, rowIndex) => (
                    <TR key={rowIndex}>
                      {row.slice(0, 10).map((cell, cellIndex) => (
                        <TD key={cellIndex} className="max-w-52 truncate whitespace-nowrap text-xs">
                          {cell}
                        </TD>
                      ))}
                      {preview!.headers.length > 10 ? <TD className="text-xs">…</TD> : null}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          ) : (
            <div className="px-4 py-6 text-sm text-charcoal/50">
              No verified CSV preview available.
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stage-one artifacts</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          <ArtifactList artifacts={artifacts} />
        </CardBody>
      </Card>

      {run.status === "awaiting_stage_one_approval" ? <StageOneActions runId={id} /> : null}
    </div>
  );
}
