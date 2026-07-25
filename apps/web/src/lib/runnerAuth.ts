import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "./api";
import { createSupabaseAdminClient } from "./supabase/admin";

export interface RunnerIdentity {
  id: string;
  user_id: string;
  name: string;
  protocol_version: string;
  runner_version: string;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time hex compare (both inputs are our own fixed-length hashes). */
export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Authenticates a runner request via `Authorization: Bearer arn_...`.
 * Token is looked up by SHA-256 hash; raw tokens are never stored.
 */
export async function requireRunner(
  request: Request,
  admin?: SupabaseClient,
): Promise<{ runner: RunnerIdentity; tokenHash: string; admin: SupabaseClient }> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(arn_[a-f0-9]{64})$/.exec(header.trim());
  if (!match || !match[1]) {
    throw new ApiError(401, "Missing or malformed runner token", "runner_unauthorized");
  }
  const tokenHash = hashToken(match[1]);
  const client = admin ?? createSupabaseAdminClient();
  const { data, error } = await client
    .from("runner_devices")
    .select("id, user_id, name, status, protocol_version, runner_version")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) throw new ApiError(500, "Runner lookup failed", "internal");
  if (!data || data.status !== "active") {
    throw new ApiError(401, "Runner token is invalid or revoked", "runner_unauthorized");
  }
  return {
    runner: {
      id: data.id as string,
      user_id: data.user_id as string,
      name: data.name as string,
      protocol_version: (data.protocol_version as string) ?? "",
      runner_version: (data.runner_version as string) ?? "",
    },
    tokenHash,
    admin: client,
  };
}

/** Loads a run and asserts it belongs to the runner's user. */
export async function requireRunnerRun(
  admin: SupabaseClient,
  runner: RunnerIdentity,
  runId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await admin
    .from("pipeline_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new ApiError(500, "Run lookup failed", "internal");
  // 404 (not 403) so runner tokens cannot probe for other users' run IDs.
  if (!data || data.user_id !== runner.user_id) {
    throw new ApiError(404, "Run not found", "not_found");
  }
  return data as Record<string, unknown>;
}
