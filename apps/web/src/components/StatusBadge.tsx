import { STATUS_LABELS, type RunStatus } from "@aureli/shared";
import { Badge } from "@/components/ui/badge";

const TONE: Record<RunStatus, "neutral" | "success" | "warning" | "danger" | "info" | "evergreen"> = {
  draft: "neutral",
  awaiting_runner: "warning",
  queued: "info",
  stage_one_running: "evergreen",
  stage_one_retrying: "warning",
  stage_one_failed: "danger",
  awaiting_stage_one_approval: "warning",
  stage_two_running: "evergreen",
  stage_two_retrying: "warning",
  stage_two_failed: "danger",
  fallback_resolver_running: "evergreen",
  fallback_resolver_retrying: "warning",
  fallback_resolver_failed: "danger",
  awaiting_final_approval: "warning",
  uploading_to_instantly: "info",
  completed: "success",
  completed_with_warnings: "warning",
  cancelled: "neutral",
};

export function StatusBadge({ status, mock }: { status: RunStatus; mock?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={TONE[status]}>{STATUS_LABELS[status]}</Badge>
      {mock ? <Badge tone="info">MOCK</Badge> : null}
    </span>
  );
}
