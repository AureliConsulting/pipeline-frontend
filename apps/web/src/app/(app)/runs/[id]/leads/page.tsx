import { notFound } from "next/navigation";
import type { RunStatus } from "@aureli/shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { downloadArtifactText, parseCsvRows } from "@/lib/downloadArtifact";
import { StatusBadge } from "@/components/StatusBadge";
import { Alert } from "@/components/ui/misc";
import { LeadReviewTable } from "@/components/run/LeadReviewTable";
import type { ArtifactRow } from "@/components/run/ArtifactList";

export const dynamic = "force-dynamic";

export default async function LeadsPage({ params }: { params: Promise<{ id: string }> }) {
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
  const readyArtifact = artifacts.find((a) => a.artifact_type === "ready_to_push_csv");
  const blockedArtifact = artifacts.find((a) => a.artifact_type === "blocked_for_review_csv");
  const userId = run.user_id as string;

  const [readyText, blockedText] = await Promise.all([
    downloadArtifactText(userId, readyArtifact?.id),
    downloadArtifactText(userId, blockedArtifact?.id),
  ]);
  const ready = readyText ? parseCsvRows(readyText) : { headers: [], rows: [] };
  const blocked = blockedText ? parseCsvRows(blockedText) : { headers: [], rows: [] };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-evergreen-deep">
            Lead review · {(run.campaigns as { title?: string })?.title}
          </h1>
          <StatusBadge status={run.status as RunStatus} mock={run.mock as boolean} />
        </div>
      </div>

      {!readyArtifact && !blockedArtifact ? (
        <Alert tone="info">
          The fallback resolver hasn&apos;t completed for this run yet — no ready or blocked leads
          to review.
        </Alert>
      ) : (
        <LeadReviewTable ready={ready} blocked={blocked} />
      )}
    </div>
  );
}
