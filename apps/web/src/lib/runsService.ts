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
