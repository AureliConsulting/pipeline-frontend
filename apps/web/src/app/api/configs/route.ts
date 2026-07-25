import { saveConfigSchema, validateCampaignYaml } from "@aureli/shared";
import { handled, json, parseBody, requireUser, ApiError } from "@/lib/api";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOwnedCampaign } from "@/lib/runsService";

export const dynamic = "force-dynamic";

/** GET /api/configs — the user's saved configuration library. */
export const GET = handled(async () => {
  await requireUser();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("campaign_configs")
    .select("id, name, campaign_id, yaml_text, normalized_json, updated_at, created_at")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) return json({ error: "Query failed" }, 500);
  return json({ configs: data ?? [] });
});

/**
 * POST /api/configs — save a configuration. YAML is stored VERBATIM
 * (spintax-safe); normalized_json is the schema-validated parse used for
 * preview and handed to the pipeline.
 */
export const POST = handled(async (request: Request) => {
  const user = await requireUser();
  const input = await parseBody(request, saveConfigSchema);
  const validation = validateCampaignYaml(input.yaml_text);
  if (!validation.ok || !validation.normalized) {
    return json(
      {
        error: "Configuration is invalid",
        syntax_errors: validation.syntaxErrors,
        schema_errors: validation.schemaErrors,
      },
      422,
    );
  }
  const admin = createSupabaseAdminClient();
  if (input.campaign_id) {
    await getOwnedCampaign(admin, user.id, input.campaign_id);
  }
  const { data, error } = await admin
    .from("campaign_configs")
    .insert({
      user_id: user.id,
      campaign_id: input.campaign_id ?? null,
      name: input.name,
      yaml_text: input.yaml_text,
      normalized_json: validation.normalized,
    })
    .select("*")
    .single();
  if (error) throw new ApiError(500, "Could not save configuration");
  return json({ config: data }, 201);
});
