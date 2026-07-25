import { parse as parseYaml, YAMLParseError } from "yaml";
import { z } from "zod";

/**
 * Mirror of the REAL pipeline configuration model:
 * `gtm_research/personalization/campaign_config.py` (strict Pydantic,
 * extra="forbid"). The pipeline consumes JSON; the web UI lets users edit
 * YAML for readability and the runner converts YAML -> JSON losslessly.
 *
 * IMPORTANT: raw YAML text is stored verbatim. Copy strings (including
 * Instantly spintax like "{Hey|Hi} {{firstname}}") are never re-serialized,
 * trimmed, or normalized on the write path. Parsing here is used only for
 * validation and the read-only normalized preview.
 */

const approvedOfferSchema = z
  .object({
    id: z.string().min(1),
    canonical_text: z.string().min(1),
    allowed_variations: z.array(z.string()).default([]),
    prohibited_promises: z.array(z.string()).default([]),
  })
  .strict();

const approvedBridgeSchema = z
  .object({
    id: z.string().min(1),
    canonical_text: z.string().min(1),
    allowed_variations: z.array(z.string()).default([]),
  })
  .strict();

const generationSchema = z
  .object({
    model: z.string().default("deepseek-chat"),
    temperature: z.number().min(0).max(1).default(0.2),
    max_tokens: z.number().int().positive().default(500),
    max_attempts: z.number().int().min(1).max(2).default(2),
    evidence_confidence_threshold: z.number().min(0).max(1).default(0.6),
    max_evidence_age_days: z.number().int().min(1).default(365),
    prohibited_style_terms: z.array(z.string()).default([]),
  })
  .strict();

const generationEligibilitySchema = z
  .object({
    allowed_outreach_decisions: z.array(z.string()).default(["Yes", "Review"]),
    require_email_approved: z.boolean().default(true),
    require_email_eligible: z.boolean().default(true),
    require_completed_research: z.boolean().default(true),
    require_approved_evidence_event: z.boolean().default(true),
  })
  .strict();

const sendEligibilitySchema = z
  .object({
    allowed_outreach_decisions: z.array(z.string()).default(["Yes"]),
  })
  .strict();

export const campaignConfigSchema = z
  .object({
    campaign_id: z.string().min(1),
    template_id: z.string().min(1),
    proof: z.record(z.string()),
    approved_offers: z.array(approvedOfferSchema).min(1),
    approved_contact_bridges: z.array(approvedBridgeSchema).min(1),
    generation: generationSchema.default({}),
    generation_eligibility: generationEligibilitySchema.default({}),
    send_eligibility: sendEligibilitySchema.default({}),
  })
  .strict();

export type CampaignConfig = z.infer<typeof campaignConfigSchema>;

export interface ConfigValidation {
  ok: boolean;
  /** YAML syntax errors (line/col where available). */
  syntaxErrors: string[];
  /** Schema violations against the real pipeline model. */
  schemaErrors: string[];
  /** Parsed + defaulted config, only when ok. */
  normalized: CampaignConfig | null;
}

/** Validate raw YAML (or JSON — JSON is a YAML subset) against the pipeline schema. */
export function validateCampaignYaml(rawText: string): ConfigValidation {
  if (rawText.length === 0) {
    return { ok: false, syntaxErrors: ["Configuration is empty."], schemaErrors: [], normalized: null };
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(rawText, { uniqueKeys: true });
  } catch (error) {
    const message =
      error instanceof YAMLParseError
        ? `${error.message}`
        : error instanceof Error
          ? error.message
          : "Unknown YAML parse error";
    return { ok: false, syntaxErrors: [message], schemaErrors: [], normalized: null };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      syntaxErrors: [],
      schemaErrors: ["Configuration must be a mapping of keys to values."],
      normalized: null,
    };
  }
  const result = campaignConfigSchema.safeParse(parsed);
  if (!result.success) {
    const schemaErrors = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    return { ok: false, syntaxErrors: [], schemaErrors, normalized: null };
  }
  return { ok: true, syntaxErrors: [], schemaErrors: [], normalized: result.data };
}

/**
 * Spintax integrity check: verifies that `{...|...}` groups and `{{var}}`
 * placeholders in the raw text survive a YAML parse round-trip unchanged.
 * Used to warn (not rewrite) when quoting would be needed.
 */
export function spintaxTokens(text: string): string[] {
  return text.match(/\{\{[^}]+\}\}|\{[^{}]*\|[^{}]*\}/g) ?? [];
}

/** Canonical starter YAML shown in the "create from canonical" flow. */
export const CANONICAL_CONFIG_YAML = `# Aureli campaign configuration (schema: gtm_research CampaignConfig)
# Copy strings are passed to the pipeline exactly as written here.
# Quote any value containing spintax braces { } so YAML keeps it verbatim.
campaign_id: "my_campaign_v1"
template_id: "aureli_base_email_v1"
proof:
  company: "Motogistics Logistics"
  result: "over $100k in contracts"
  timeframe: "within 90 days"
  mechanism: "cold email"
approved_offers:
  - id: "approved_market_validation_offer"
    canonical_text: "build the first campaign and target-account list with no upfront fee"
    allowed_variations:
      - "map out the campaign and build the initial target list at no cost"
      - "build the initial outbound campaign before you commit to anything"
    prohibited_promises:
      - "guaranteed revenue"
      - "guaranteed pipeline"
      - "guaranteed meetings"
      - "free forever"
approved_contact_bridges:
  - id: "priority_uncertain"
    canonical_text: "Not sure if outbound is a priority right now"
  - id: "existing_process"
    canonical_text: "You may already have this covered"
  - id: "role_uncertain"
    canonical_text: "Not sure whether this sits with you directly"
    allowed_variations:
      - "Not sure whether outbound sits with you directly"
  - id: "commercial_owner_uncertain"
    canonical_text: "You may already have someone handling the commercial side"
generation:
  model: "deepseek-v4-flash"
  temperature: 0.2
  max_tokens: 3200
  max_attempts: 2
  evidence_confidence_threshold: 0.6
  max_evidence_age_days: 365
  prohibited_style_terms:
    - "leverage"
    - "unlock"
    - "elevate"
    - "supercharge"
    - "revolutionize"
    - "synergize"
    - "cutting-edge"
    - "game-changing"
    - "tailored solution"
    - "innovative solution"
    - "drive growth"
    - "maximize potential"
    - "scale to new heights"
    - "seamless"
    - "robust"
    - "dynamic"
    - "transformative"
    - "next-level"
generation_eligibility:
  allowed_outreach_decisions: ["Yes", "Review"]
  require_email_approved: true
  require_email_eligible: true
  require_completed_research: true
  require_approved_evidence_event: true
send_eligibility:
  allowed_outreach_decisions: ["Yes"]
`;
