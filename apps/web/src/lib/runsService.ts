import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertTransition,
  InvalidTransitionError,
  isRunStatus,
  safeFileName,
  type RunStatus,
  type Stage,
} from "@aureli/shared";
import { ApiError } from "./api";

export const ARTIFACTS_BUCKET = "artifacts";

/** Storage layout: <user_id>/<run_id>/<stage>/<file>. Prevents traversal by construction. */
export function artifactStoragePath(
  userId: string,
  runId: string,
  stage: Stage,
  fileName: string,
): string {
  const safe = safeFileName(fileName);
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !/^[0-9a-f-]{36}$/i.test(runId)) {
    throw new ApiError(400, "Invalid identifiers for storage path", "bad_path");
  }
  return `${userId}/${runId}/${stage}/${safe}`;
}

/**
 * Guarded status transition. Uses optimistic concurrency on the current
 * status value so two concurrent writers can never both win.
 */
export async function transitionRun(
  admin: SupabaseClient,
  runId: string,
  from: RunStatus,
  to: RunStatus,
  patch: Record<string, unknown> = {},
): Promise<void> {
  try {
    assertTransition(from, to);
  } catch (error) {
    if (error instanceof InvalidTransitionError) {
      throw new ApiError(409, error.message, "invalid_transition");
    }
    throw error;
  }
  const { data, error } = await admin
    .from("pipeline_runs")
    .update({ status: to, ...patch })
    .eq("id", runId)
    .eq("status", from)
    .select("id");
  if (error) throw new ApiError(500, "Run update failed", "internal");
  if (!data || data.length === 0) {
    throw new ApiError(409, `Run is no longer in status '${from}'`, "stale_status");
  }
}

const RUNNING_STATUSES: Record<string, readonly [RunStatus, RunStatus]> = {
  stage_one: ["stage_one_running", "stage_one_retrying"],
  stage_two: ["stage_two_running", "stage_two_retrying"],
  fallback_resolver: ["fallback_resolver_running", "fallback_resolver_retrying"],
};

const FAILED_STATUS: Record<string, RunStatus> = {
  stage_one: "stage_one_failed",
  stage_two: "stage_two_failed",
  fallback_resolver: "fallback_resolver_failed",
};

/** Statuses a run must be in for a stage-complete report for `stage` to be
 * accepted rather than treated as an already-acknowledged duplicate. */
export function expectedRunningStatuses(stage: string): readonly [RunStatus, RunStatus] {
  return RUNNING_STATUSES[stage] ?? RUNNING_STATUSES.stage_one!;
}

/** Target status when a stage reports `outcome: "failed"`. */
export function failedStatusFor(stage: string): RunStatus {
  return FAILED_STATUS[stage] ?? "stage_one_failed";
}

export type StageCompletionPlan =
  | { kind: "auto_continue"; status: RunStatus; nextStage: Stage }
  | { kind: "await_approval"; status: RunStatus; approvalKind: "stage_one" | "final" };

/**
 * What happens when a stage reports `outcome: "completed"`. stage_two never
 * pauses for human approval — it auto-advances into the mandatory fallback
 * resolver stage. Every other stage pauses at its corresponding approval
 * checkpoint (stage_one -> stage_one approval, fallback_resolver -> final
 * approval, since that's the resolver's own completion — the human's last
 * checkpoint before an optional Instantly upload).
 */
export function stageCompletionPlan(stage: string): StageCompletionPlan {
  if (stage === "stage_two") {
    return { kind: "auto_continue", status: "queued", nextStage: "fallback_resolver" };
  }
  if (stage === "fallback_resolver") {
    return { kind: "await_approval", status: "awaiting_final_approval", approvalKind: "final" };
  }
  return { kind: "await_approval", status: "awaiting_stage_one_approval", approvalKind: "stage_one" };
}

export function runStatusOf(run: Record<string, unknown>): RunStatus {
  const status = String(run.status ?? "");
  if (!isRunStatus(status)) throw new ApiError(500, "Run has unknown status", "internal");
  return status;
}

/** Loads a run owned by the given user (via admin client + explicit check). */
export async function getOwnedRun(
  admin: SupabaseClient,
  userId: string,
  runId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await admin
    .from("pipeline_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new ApiError(500, "Run lookup failed", "internal");
  // 404 (not 403): do not reveal the existence of other users' runs.
  if (!data || data.user_id !== userId) throw new ApiError(404, "Run not found", "not_found");
  return data as Record<string, unknown>;
}

export async function getOwnedCampaign(
  admin: SupabaseClient,
  userId: string,
  campaignId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await admin
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  if (error) throw new ApiError(500, "Campaign lookup failed", "internal");
  if (!data || data.user_id !== userId) throw new ApiError(404, "Campaign not found", "not_found");
  return data as Record<string, unknown>;
}

export async function signedDownloadUrl(
  admin: SupabaseClient,
  storagePath: string,
  expiresInSeconds = 300,
): Promise<string> {
  const { data, error } = await admin.storage
    .from(ARTIFACTS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data?.signedUrl) {
    throw new ApiError(500, "Could not create signed URL", "internal");
  }
  return data.signedUrl;
}

export async function signedUploadUrl(
  admin: SupabaseClient,
  storagePath: string,
): Promise<{ signedUrl: string; token: string; path: string }> {
  const { data, error } = await admin.storage
    .from(ARTIFACTS_BUCKET)
    .createSignedUploadUrl(storagePath, { upsert: true });
  if (error || !data) {
    throw new ApiError(500, "Could not create signed upload URL", "internal");
  }
  return { signedUrl: data.signedUrl, token: data.token, path: data.path };
}
