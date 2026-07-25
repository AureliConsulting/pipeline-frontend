import { claimRequestSchema, isProtocolCompatible } from "@aureli/shared";
import { ApiError, handled, json, parseBody } from "@/lib/api";
import { requireRunner } from "@/lib/runnerAuth";
import { enforceRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * POST /api/runner/claim — atomic job claim via the claim_next_job RPC
 * (FOR UPDATE SKIP LOCKED). A run can only ever be claimed by one device,
 * and only by devices belonging to the run's owner.
 */
export const POST = handled(async (request: Request) => {
  const { runner, tokenHash, admin } = await requireRunner(request);
  await enforceRateLimit(admin, `claim:${runner.id}`, 30, 60);
  const input = await parseBody(request, claimRequestSchema);
  if (!isProtocolCompatible(input.protocol_version)) {
    throw new ApiError(409, "Incompatible runner protocol version — update the runner", "protocol_mismatch");
  }
  const { data, error } = await admin.rpc("claim_next_job", {
    p_token_hash: tokenHash,
    p_protocol_version: input.protocol_version,
    p_resume_run_id: input.resume_run_id ?? null,
  });
  if (error) throw new ApiError(500, "Claim failed", "internal");
  const result = data as { ok: boolean; error?: string; job?: unknown };
  if (!result.ok) throw new ApiError(401, result.error ?? "Claim rejected", "runner_unauthorized");
  return json({ job: result.job ?? null });
});
