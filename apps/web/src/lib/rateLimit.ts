import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "./api";

/**
 * DB-backed fixed-window rate limiter (works across serverless instances).
 * Buckets should include a stable caller identity (user id, token hash, IP).
 */
export async function enforceRateLimit(
  admin: SupabaseClient,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const { data, error } = await admin.rpc("check_rate_limit", {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw new ApiError(500, "Rate limit check failed", "internal");
  if (data !== true) {
    throw new ApiError(429, "Too many requests — slow down and retry shortly", "rate_limited");
  }
}

export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0] : null)?.trim() || "unknown";
}
