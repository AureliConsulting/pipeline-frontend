import { saveFallbackRuleSetSchema } from "@aureli/shared";
import { handled, json, parseBody, requireUser, ApiError } from "@/lib/api";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET /api/fallback-rules — the user's saved shared fallback-rules JSON library. */
export const GET = handled(async () => {
  await requireUser();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("fallback_rule_sets")
    .select("id, name, json, updated_at, created_at")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) return json({ error: "Query failed" }, 500);
  return json({ fallback_rule_sets: data ?? [] });
});

/**
 * POST /api/fallback-rules — save a shared fallback-rules configuration.
 * This is plain JSON handed to the resolver's --config flag as-is; deep
 * semantic validation of its shape (variables/fallbacks/etc.) is the
 * resolver's own job at runtime, not this route's.
 */
export const POST = handled(async (request: Request) => {
  const user = await requireUser();
  const input = await parseBody(request, saveFallbackRuleSetSchema);
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.json_text);
  } catch {
    return json({ error: "Fallback rules must be valid JSON" }, 422);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return json({ error: "Fallback rules must be a JSON object" }, 422);
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("fallback_rule_sets")
    .insert({ user_id: user.id, name: input.name, json: parsed })
    .select("*")
    .single();
  if (error) throw new ApiError(500, "Could not save fallback rule set");
  return json({ fallback_rule_set: data }, 201);
});
