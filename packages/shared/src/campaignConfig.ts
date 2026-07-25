import { parse as parseYaml, YAMLParseError } from "yaml";
import { z } from "zod";

/**
 * Mirror of the REAL pipeline configuration model:
 * `gtm_research/personalization/campaign_runtime.py::CampaignConfig` (strict
 * Pydantic, extra="forbid"). This is the config-driven engine — arbitrary
 * email sequences, declared personalization variables, spintax kept fully
 * separate from `{{variables}}` — as opposed to the older, retired
 * `campaign_config.py::LegacyCampaignConfig` (fixed template + hardcoded
 * variable set) this schema replaced in the frontend.
 *
 * IMPORTANT: raw YAML text is stored verbatim. Copy strings (including
 * Instantly spintax like "{Hey|Hi} {{firstname}}") are never re-serialized,
 * trimmed, or normalized on the write path except through the guided-edit
 * flow, which re-serializes the WHOLE document with every string
 * double-quoted specifically so brace content survives untouched (see
 * ConfigStep.tsx). Parsing here is used only for validation, the read-only
 * normalized preview, and the guided-edit round trip.
 */

const VARIABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const campaignSettingsSchema = z
  .object({
    preserve_spintax: z.boolean().default(true),
    max_exa_queries: z.number().int().min(0).default(4),
    // Plain string on the Python side (campaign_runtime.py::CampaignSettings
    // .minimum_personalization_confidence: str) — not a Literal — so this
    // stays a free string rather than an invented closed enum.
    minimum_personalization_confidence: z.string().default("moderate"),
    max_leads_per_run: z.number().int().min(1).default(500),
    fail_on_undefined_variables: z.boolean().default(true),
    generate_rendered_previews: z.boolean().default(true),
  })
  .strict();

const generationSettingsSchema = z
  .object({
    model: z.string().default("deepseek-v4-flash"),
    temperature: z.number().min(0).max(1).default(0.2),
    max_tokens: z.number().int().positive().default(1200),
    max_attempts: z.number().int().min(1).max(3).default(2),
    evidence_confidence_threshold: z.number().min(0).max(1).default(0.6),
    max_evidence_age_days: z.number().int().min(1).default(365),
    prohibited_style_terms: z.array(z.string()).default([]),
  })
  .strict();

const eligibilitySettingsSchema = z
  .object({
    allowed_outreach_decisions: z.array(z.string()).default(["Yes", "Review"]),
    send_eligible_outreach_decisions: z.array(z.string()).default(["Yes"]),
    require_email_approved: z.boolean().default(true),
    require_email_eligible: z.boolean().default(true),
    require_completed_research: z.boolean().default(true),
  })
  .strict();

const campaignEmailSchema = z
  .object({
    id: z.string().min(1),
    sequence_position: z.number().int().min(1),
    delay_days: z.number().int().min(0).default(0),
    subject: z.string().default(""),
    body: z.string().min(1),
  })
  .strict();

const campaignVariableTypeSchema = z.enum(["source", "generated", "static", "system"]);

const outputClassSchema = z.enum([
  "verified_fact",
  "evidence_backed_inference",
  "campaign_hypothesis",
  "aureli_offer",
  "conversational_bridge",
]);

const campaignVariableSchema = z
  .object({
    type: campaignVariableTypeSchema,
    source_column: z.string().min(1).nullish(),
    value: z.string().nullish(),
    system_value: z.string().min(1).nullish(),
    required: z.boolean().default(true),
    description: z.string().min(1).nullish(),
    max_words: z.number().int().min(1).nullish(),
    evidence_required: z.boolean().default(false),
    output_class: outputClassSchema.nullish(),
    must_differ_from: z.array(z.string()).default([]),
    examples_good: z.array(z.string()).default([]),
    examples_bad: z.array(z.string()).default([]),
    allow_spintax: z.boolean().default(false),
    fallback: z.string().min(1).nullish(),
  })
  .strict()
  // Mirrors campaign_runtime.py::CampaignVariable's model_validator
  // (_has_type_fields): each variable type has exactly one required
  // companion field.
  .superRefine((variable, ctx) => {
    if (variable.type === "source" && !variable.source_column) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source_column"],
        message: "source variables require source_column",
      });
    }
    if (variable.type === "static" && !variable.value) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "static variables require value" });
    }
    if (variable.type === "system" && !variable.system_value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["system_value"],
        message: "system variables require system_value",
      });
    }
    if (variable.type === "generated" && !variable.description) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["description"],
        message: "generated variables require description",
      });
    }
  });

export const campaignConfigSchema = z
  .object({
    campaign_id: z.string().min(1),
    version: z.number().int().min(1),
    name: z.string().min(1),
    description: z.string().default(""),
    settings: campaignSettingsSchema.default({}),
    generation: generationSettingsSchema.default({}),
    eligibility: eligibilitySettingsSchema.default({}),
    emails: z.array(campaignEmailSchema).min(1),
    variables: z.record(z.string(), campaignVariableSchema).default({}),
  })
  .strict()
  // Mirrors campaign_runtime.py::CampaignConfig's model_validator
  // (_email_shape): unique email ids, unique + ascending sequence_position,
  // valid variable names (z.record doesn't validate its own keys), and
  // must_differ_from only referencing declared variables. Undefined-variable
  // (used-but-not-declared) and spintax checks are semantic, not structural
  // — see validateCampaign() below, run only after this structural pass
  // succeeds, mirroring the Python split between Pydantic model validation
  // and the separate pure functions in campaign_runtime.py.
  .superRefine((config, ctx) => {
    const seenIds = new Set<string>();
    let previousPosition = -Infinity;
    config.emails.forEach((email, index) => {
      if (seenIds.has(email.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["emails", index, "id"],
          message: `Duplicate email id '${email.id}'`,
        });
      }
      seenIds.add(email.id);
      if (email.sequence_position === previousPosition) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["emails", index, "sequence_position"],
          message: `Duplicate sequence_position ${email.sequence_position}`,
        });
      } else if (email.sequence_position < previousPosition) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["emails", index, "sequence_position"],
          message: "emails must be listed in ascending sequence_position order",
        });
      }
      previousPosition = email.sequence_position;
    });

    for (const name of Object.keys(config.variables)) {
      if (!VARIABLE_NAME_RE.test(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["variables", name],
          message: `Invalid variable name '${name}'`,
        });
      }
    }

    const declared = new Set(Object.keys(config.variables));
    for (const [name, variable] of Object.entries(config.variables)) {
      const unknown = variable.must_differ_from.filter((other) => !declared.has(other));
      if (unknown.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["variables", name, "must_differ_from"],
          message: `must_differ_from references undefined variables: ${unknown.join(", ")}`,
        });
      }
    }
  });

export type CampaignConfig = z.infer<typeof campaignConfigSchema>;
export type CampaignVariable = z.infer<typeof campaignVariableSchema>;
export type CampaignEmail = z.infer<typeof campaignEmailSchema>;

export interface ConfigValidation {
  ok: boolean;
  /** YAML syntax errors (line/col where available). */
  syntaxErrors: string[];
  /** Structural violations against the real pipeline model (zod/Pydantic-equivalent). */
  schemaErrors: string[];
  /**
   * Semantic violations: variables used in a body/subject but never
   * declared, or malformed spintax. Blocks before any paid call, exactly
   * like the pipeline's own `validate_campaign()` / `validate-campaign` CLI
   * command.
   */
  semanticErrors: string[];
  /** Non-fatal: variables declared but never used by any email. */
  warnings: string[];
  /** Parsed + defaulted config, only when ok. */
  normalized: CampaignConfig | null;
}

function emptyValidation(overrides: Partial<ConfigValidation>): ConfigValidation {
  return {
    ok: false,
    syntaxErrors: [],
    schemaErrors: [],
    semanticErrors: [],
    warnings: [],
    normalized: null,
    ...overrides,
  };
}

/** Validate raw YAML (or JSON — JSON is a YAML subset) against the pipeline schema. */
export function validateCampaignYaml(rawText: string): ConfigValidation {
  if (rawText.length === 0) {
    return emptyValidation({ syntaxErrors: ["Configuration is empty."] });
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
    return emptyValidation({ syntaxErrors: [message] });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return emptyValidation({ schemaErrors: ["Configuration must be a mapping of keys to values."] });
  }
  const result = campaignConfigSchema.safeParse(parsed);
  if (!result.success) {
    const schemaErrors = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    return emptyValidation({ schemaErrors });
  }
  const semantic = validateCampaign(result.data);
  if (semantic.errors.length > 0) {
    return emptyValidation({ semanticErrors: semantic.errors, warnings: semantic.warnings });
  }
  return {
    ok: true,
    syntaxErrors: [],
    schemaErrors: [],
    semanticErrors: [],
    warnings: semantic.warnings,
    normalized: result.data,
  };
}

/**
 * Walk every email subject/body for `{{variable_name}}` tokens, in stable
 * first-appearance order. Direct port of
 * campaign_runtime.py::extract_campaign_variables /
 * campaign_runtime.py::_extract_variables — hand-written character walking,
 * not a regex, so malformed braces (`}}` with no matching `{{`, or `{{`
 * never closed) are caught precisely rather than silently skipped.
 */
export function extractCampaignVariables(config: CampaignConfig): string[] {
  const seen = new Set<string>();
  const variables: string[] = [];
  const sorted = [...config.emails].sort((a, b) => a.sequence_position - b.sequence_position);
  for (const email of sorted) {
    for (const [text, field] of [
      [email.subject, `${email.id}.subject`],
      [email.body, `${email.id}.body`],
    ] as const) {
      for (const name of extractVariablesFromText(text, field)) {
        if (!seen.has(name)) {
          seen.add(name);
          variables.push(name);
        }
      }
    }
  }
  return variables;
}

function extractVariablesFromText(text: string, location: string): string[] {
  const found: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf("{{", cursor);
    const strayEnd = text.indexOf("}}", cursor);
    if (strayEnd !== -1 && (start === -1 || strayEnd < start)) {
      throw new CampaignConfigError(`Malformed personalization braces in ${location}: unexpected '}}'`);
    }
    if (start === -1) break;
    const end = text.indexOf("}}", start + 2);
    if (end === -1) {
      throw new CampaignConfigError(`Malformed personalization braces in ${location}: missing '}}'`);
    }
    const name = text.slice(start + 2, end);
    if (!VARIABLE_NAME_RE.test(name)) {
      throw new CampaignConfigError(`Malformed personalization variable in ${location}: {{${name}}}`);
    }
    found.push(name);
    cursor = end + 2;
  }
  return found;
}

export class CampaignConfigError extends Error {}

/**
 * Validate flat Instantly spintax (`{a|b}`) without treating `{{variables}}`
 * as spintax. Direct port of campaign_runtime.py::validate_spintax. Returns
 * error strings rather than throwing, so callers can accumulate errors
 * across every email instead of stopping at the first one.
 */
export function validateSpintax(text: string, location: string): string[] {
  const errors: string[] = [];
  let index = 0;
  while (index < text.length) {
    if (text.startsWith("{{", index)) {
      const end = text.indexOf("}}", index + 2);
      if (end === -1) {
        errors.push(`Malformed personalization braces in ${location}`);
        return errors;
      }
      index = end + 2;
      continue;
    }
    const char = text[index];
    if (char === "}") {
      errors.push(`Unbalanced spintax brace in ${location}`);
      return errors;
    }
    if (char !== "{") {
      index += 1;
      continue;
    }
    let end = index + 1;
    let nested = false;
    while (end < text.length && text[end] !== "}") {
      if (text[end] === "{") nested = true;
      end += 1;
    }
    if (nested) {
      errors.push(`Nested spintax is not supported in ${location}`);
      return errors;
    }
    if (end === text.length) {
      errors.push(`Unbalanced spintax brace in ${location}`);
      return errors;
    }
    const alternatives = text.slice(index + 1, end).split("|");
    if (alternatives.length < 2) {
      errors.push(`Spintax requires at least two alternatives in ${location}`);
      return errors;
    }
    if (alternatives.some((alternative) => alternative.length === 0)) {
      errors.push(`Spintax has an empty alternative in ${location}`);
      return errors;
    }
    index = end + 1;
  }
  return errors;
}

export interface CampaignValidation {
  /** Blocks before any paid call: undefined variables, malformed spintax. */
  errors: string[];
  /** Never blocks: variables declared but not used by any email. */
  warnings: string[];
  requiredVariables: string[];
}

/**
 * Direct port of campaign_runtime.py::validate_campaign. Runs only after
 * campaignConfigSchema's structural (zod .strict()/superRefine) validation
 * has already succeeded — mirrors the Python split between Pydantic
 * model-level validation (always-on, part of construction) and these
 * separate pure functions (explicit second pass).
 */
export function validateCampaign(config: CampaignConfig): CampaignValidation {
  const errors: string[] = [];
  let required: string[];
  try {
    required = extractCampaignVariables(config);
  } catch (error) {
    return {
      errors: [error instanceof CampaignConfigError ? error.message : String(error)],
      warnings: [],
      requiredVariables: [],
    };
  }
  const declared = new Set(Object.keys(config.variables));
  const undefinedVariables = required.filter((name) => !declared.has(name));
  if (undefinedVariables.length > 0) {
    errors.push(
      `Campaign ${config.campaign_id} v${config.version} contains undefined variables: ${undefinedVariables.join(", ")}`,
    );
  }
  const sorted = [...config.emails].sort((a, b) => a.sequence_position - b.sequence_position);
  for (const email of sorted) {
    errors.push(...validateSpintax(email.subject, `${email.id}.subject`));
    errors.push(...validateSpintax(email.body, `${email.id}.body`));
  }
  const requiredSet = new Set(required);
  const unused = Object.keys(config.variables)
    .filter((name) => !requiredSet.has(name))
    .sort();
  const warnings = unused.map((name) => `Variable '${name}' is defined but not used by any email.`);
  return { errors, warnings, requiredVariables: required };
}

/**
 * Detector (not a validator) for `{{var}}` and `{a|b}` tokens in raw text —
 * used for lightweight UI hinting (e.g. "N spintax/placeholder tokens
 * detected") before/independent of full schema validation.
 */
export function spintaxTokens(text: string): string[] {
  return text.match(/\{\{[^}]+\}\}|\{[^{}]*\|[^{}]*\}/g) ?? [];
}

/** Canonical starter YAML shown in the "create from canonical" flow. */
export const CANONICAL_CONFIG_YAML = `# Aureli campaign configuration (schema: gtm_research campaign_runtime.CampaignConfig)
# Copy strings are passed to the pipeline exactly as written here.
# Personalization variables use double braces: {{variable_name}}
# Instantly spintax uses single braces with pipe-separated alternatives: {option one|option two}
# These are two separate syntaxes -- quote any value containing spintax braces
# so YAML keeps it verbatim, and never remove the double braces around a
# personalization variable.
campaign_id: "new-campaign"
version: 1
name: "New Campaign"
description: ""

settings:
  preserve_spintax: true
  max_exa_queries: 4
  minimum_personalization_confidence: "moderate"
  max_leads_per_run: 500
  fail_on_undefined_variables: true
  generate_rendered_previews: true

generation:
  model: "deepseek-v4-flash"
  temperature: 0.2
  max_tokens: 1200
  max_attempts: 2
  evidence_confidence_threshold: 0.6
  max_evidence_age_days: 365
  prohibited_style_terms:
    - "leverage"
    - "unlock"
    - "elevate"
    - "cutting-edge"
    - "game-changing"
    - "seamless"
    - "robust"
    - "next-level"

eligibility:
  allowed_outreach_decisions: ["Yes", "Review"]
  send_eligible_outreach_decisions: ["Yes"]
  require_email_approved: true
  require_email_eligible: true
  require_completed_research: true

emails:
  - id: "email_1"
    sequence_position: 1
    delay_days: 0
    subject: ""
    body: |
      Hey {{firstname}},

      {Quick note|Wanted to reach out} about {{gtm_trigger_short}}.

  - id: "email_2"
    sequence_position: 2
    delay_days: 3
    subject: ""
    body: |
      Hey {{firstname}},

      Following up from {{sender_company}} -- happy to share more if useful.

variables:
  firstname:
    type: "source"
    source_column: "first_name"
    required: true

  gtm_trigger_short:
    type: "generated"
    description: "A concise, evidence-backed recent company signal."
    max_words: 18
    evidence_required: true
    output_class: "verified_fact"
    examples_good: []
    examples_bad: []

  sender_company:
    type: "static"
    value: "Aureli"
    required: true
`;
