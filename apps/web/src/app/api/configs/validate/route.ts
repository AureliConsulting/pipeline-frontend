import { z } from "zod";
import { validateCampaignYaml, spintaxTokens, PROTOCOL } from "@aureli/shared";
import { handled, json, parseBody, requireUser } from "@/lib/api";

export const dynamic = "force-dynamic";

const schema = z.object({ yaml_text: z.string().min(1).max(PROTOCOL.limits.max_yaml_bytes) }).strict();

/** POST /api/configs/validate — validate-only (no save). */
export const POST = handled(async (request: Request) => {
  await requireUser();
  const { yaml_text } = await parseBody(request, schema);
  const result = validateCampaignYaml(yaml_text);
  return json({
    ok: result.ok,
    syntax_errors: result.syntaxErrors,
    schema_errors: result.schemaErrors,
    normalized: result.normalized,
    spintax_tokens: spintaxTokens(yaml_text).slice(0, 50),
  });
});
