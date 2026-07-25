import { z } from "zod";
import { PROTOCOL } from "@aureli/shared";
import { handled, json, parseBody, requireUser } from "@/lib/api";

export const dynamic = "force-dynamic";

const schema = z.object({ json_text: z.string().min(1).max(PROTOCOL.limits.max_yaml_bytes) }).strict();

/** POST /api/fallback-rules/validate — JSON-syntax validate only (no save). */
export const POST = handled(async (request: Request) => {
  await requireUser();
  const { json_text } = await parseBody(request, schema);
  try {
    const parsed = JSON.parse(json_text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return json({ ok: false, error: "Fallback rules must be a JSON object" });
    }
    return json({ ok: true, normalized: parsed });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Invalid JSON" });
  }
});
