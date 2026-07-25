import { randomBytes, createHash } from "node:crypto";
import { pairRequestSchema, PROTOCOL, isProtocolCompatible } from "@aureli/shared";
import { ApiError, handled, json, parseBody } from "@/lib/api";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit, clientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * POST /api/runner/pair — exchange a one-time pairing code for a long-lived
 * runner token. Unauthenticated by design (the code IS the credential), so it
 * is strictly rate limited per IP and codes are single-use + short-lived
 * (atomic consumption via the consume_pairing_code RPC).
 *
 * The raw token (arn_<64 hex>) is returned exactly once; only its SHA-256
 * hash is stored.
 */
export const POST = handled(async (request: Request) => {
  const admin = createSupabaseAdminClient();
  await enforceRateLimit(admin, `pair:${clientIp(request)}`, 10, 300);

  const input = await parseBody(request, pairRequestSchema);
  if (!isProtocolCompatible(input.protocol_version)) {
    throw new ApiError(
      409,
      `Runner protocol ${input.protocol_version} is not compatible with server protocol ${PROTOCOL.protocol_version}. Update the runner.`,
      "protocol_mismatch",
    );
  }

  const codeHash = createHash("sha256").update(input.code).digest("hex");
  const { data: userId, error } = await admin.rpc("consume_pairing_code", {
    p_code_hash: codeHash,
  });
  if (error) throw new ApiError(500, "Pairing failed", "internal");
  if (!userId) {
    throw new ApiError(401, "Pairing code is invalid, expired, or already used", "bad_code");
  }

  const token = `arn_${randomBytes(32).toString("hex")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data: device, error: insertError } = await admin
    .from("runner_devices")
    .insert({
      user_id: userId,
      name: input.runner_name,
      token_hash: tokenHash,
      platform: input.platform,
      runner_version: input.runner_version,
      protocol_version: input.protocol_version,
      last_seen_at: new Date().toISOString(),
    })
    .select("id, name")
    .single();
  if (insertError || !device) throw new ApiError(500, "Could not register runner", "internal");

  return json({
    runner_id: device.id,
    runner_name: device.name,
    token, // returned once; never stored raw
    protocol_version: PROTOCOL.protocol_version,
    heartbeat_interval_seconds: PROTOCOL.limits.heartbeat_interval_seconds,
  });
});
