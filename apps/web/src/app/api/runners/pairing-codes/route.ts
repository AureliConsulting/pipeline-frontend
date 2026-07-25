import { randomBytes, createHash } from "node:crypto";
import { PROTOCOL } from "@aureli/shared";
import { handled, json, requireUser } from "@/lib/api";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // base32, unambiguous-ish

function generateCode(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) code += ALPHABET[(bytes[i] as number) % 32];
  return code;
}

/**
 * POST /api/runners/pairing-codes — create a short-lived one-time pairing code.
 * Only the SHA-256 hash is stored. Rate limited per user.
 */
export const POST = handled(async () => {
  const user = await requireUser();
  const admin = createSupabaseAdminClient();
  await enforceRateLimit(admin, `pairing_create:${user.id}`, 10, 600);

  const code = generateCode();
  const codeHash = createHash("sha256").update(code).digest("hex");
  const expiresAt = new Date(Date.now() + PROTOCOL.limits.pairing_code_ttl_seconds * 1000);
  const { error } = await admin.from("runner_pairing_codes").insert({
    user_id: user.id,
    code_hash: codeHash,
    expires_at: expiresAt.toISOString(),
  });
  if (error) return json({ error: "Could not create pairing code" }, 500);
  // The raw code is returned exactly once, to the authenticated owner.
  return json({
    code,
    expires_at: expiresAt.toISOString(),
    command: `python -m aureli_runner pair --code ${code}`,
  });
});
