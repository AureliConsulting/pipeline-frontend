import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_CONFIG_YAML,
  campaignConfigSchema,
  extractCampaignVariables,
  spintaxTokens,
  validateCampaign,
  validateCampaignYaml,
  validateSpintax,
  type CampaignConfig,
} from "../src";

const fixtureYaml = readFileSync(
  join(__dirname, "../../../fixtures/campaign_config.fixture.yaml"),
  "utf8",
);

/** Accepts pre-parse (defaults-not-yet-applied) shapes; runtime validates. */
function parsed(config: Record<string, unknown>): CampaignConfig {
  return campaignConfigSchema.parse(config);
}

const baseConfig = {
  campaign_id: "x",
  version: 1,
  name: "Test",
  emails: [{ id: "e1", sequence_position: 1, body: "Hey {{firstname}}" }],
  variables: { firstname: { type: "source", source_column: "first_name" } },
};

describe("campaign configuration validation (structural)", () => {
  it("accepts the canonical YAML", () => {
    const result = validateCampaignYaml(CANONICAL_CONFIG_YAML);
    expect(result.syntaxErrors).toEqual([]);
    expect(result.schemaErrors).toEqual([]);
    expect(result.semanticErrors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.normalized?.campaign_id).toBe("new-campaign");
  });

  it("accepts the fixture and preserves spintax content through parsing", () => {
    const result = validateCampaignYaml(fixtureYaml);
    expect(result.ok).toBe(true);
    const email = result.normalized!.emails[0]!;
    expect(email.body).toContain("{build|put together} the first campaign");
  });

  it("reports YAML syntax errors", () => {
    const result = validateCampaignYaml("campaign_id: [unclosed");
    expect(result.ok).toBe(false);
    expect(result.syntaxErrors.length).toBeGreaterThan(0);
  });

  it("reports schema violations with paths (strict -- unknown keys rejected)", () => {
    const result = validateCampaignYaml(
      'campaign_id: "x"\nversion: 1\nname: "x"\nemails: []\nvariables: {}\nnot_a_real_key: 1\n',
    );
    expect(result.ok).toBe(false);
    expect(result.schemaErrors.join(" ")).toMatch(/not_a_real_key|emails/);
  });

  it("rejects out-of-range generation settings (mirrors Pydantic bounds)", () => {
    const bad = fixtureYaml.replace("temperature: 0.2", "temperature: 3.5");
    const result = validateCampaignYaml(bad);
    expect(result.ok).toBe(false);
    expect(result.schemaErrors.join(" ")).toMatch(/generation.temperature/);
  });

  it("requires at least one email", () => {
    expect(() => parsed({ ...baseConfig, emails: [] })).toThrow();
  });

  it.each([
    ["source", { source_column: undefined }, "source_column"],
    ["static", { value: undefined }, "value"],
    ["system", { system_value: undefined }, "system_value"],
    ["generated", { description: undefined }, "description"],
  ] as const)("requires the companion field for type=%s", (type, overrides, field) => {
    const result = campaignConfigSchema.safeParse({
      ...baseConfig,
      variables: { v: { type, ...overrides } },
      emails: [{ id: "e1", sequence_position: 1, body: "no vars here" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes(field))).toBe(true);
    }
  });

  it("rejects duplicate email ids", () => {
    const result = campaignConfigSchema.safeParse({
      ...baseConfig,
      emails: [
        { id: "e1", sequence_position: 1, body: "a {{firstname}}" },
        { id: "e1", sequence_position: 2, body: "b {{firstname}}" },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((i) => i.message).join(" ")).toMatch(/Duplicate email id/);
  });

  it("rejects duplicate and non-ascending sequence_position", () => {
    const duplicate = campaignConfigSchema.safeParse({
      ...baseConfig,
      emails: [
        { id: "e1", sequence_position: 1, body: "a {{firstname}}" },
        { id: "e2", sequence_position: 1, body: "b {{firstname}}" },
      ],
    });
    expect(duplicate.success).toBe(false);

    const outOfOrder = campaignConfigSchema.safeParse({
      ...baseConfig,
      emails: [
        { id: "e1", sequence_position: 2, body: "a {{firstname}}" },
        { id: "e2", sequence_position: 1, body: "b {{firstname}}" },
      ],
    });
    expect(outOfOrder.success).toBe(false);
    if (!outOfOrder.success) expect(outOfOrder.error.issues.map((i) => i.message).join(" ")).toMatch(/ascending/);
  });

  it("rejects invalid variable names", () => {
    const result = campaignConfigSchema.safeParse({
      ...baseConfig,
      variables: { "not valid!": { type: "static", value: "x" } },
      emails: [{ id: "e1", sequence_position: 1, body: "no vars" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects must_differ_from referencing an undefined variable", () => {
    const result = campaignConfigSchema.safeParse({
      ...baseConfig,
      variables: {
        firstname: { type: "source", source_column: "first_name" },
        a: { type: "generated", description: "d", must_differ_from: ["not_declared"] },
      },
      emails: [{ id: "e1", sequence_position: 1, body: "{{firstname}} {{a}}" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((i) => i.message).join(" ")).toMatch(/undefined variables/);
  });
});

describe("extractCampaignVariables", () => {
  it("finds every {{var}} used, in stable order, without confusing spintax", () => {
    const config = parsed({
      ...baseConfig,
      emails: [{ id: "e1", sequence_position: 1, body: "{a|b} {{firstname}} {{last}}" }],
      variables: {
        firstname: { type: "source", source_column: "first_name" },
        last: { type: "source", source_column: "last_name" },
      },
    });
    expect(extractCampaignVariables(config)).toEqual(["firstname", "last"]);
  });

  it("throws on malformed personalization braces", () => {
    const config = parsed({ ...baseConfig, emails: [{ id: "e1", sequence_position: 1, body: "{{broken" }] });
    expect(() => extractCampaignVariables(config)).toThrow(/Malformed personalization/);
  });
});

describe("validateSpintax", () => {
  it("accepts valid spintax and ignores {{vars}}", () => {
    expect(validateSpintax("{a|b} and {{firstname}}", "loc")).toEqual([]);
  });

  it.each([
    ["{a}", "at least two alternatives"],
    ["{a|}", "empty alternative"],
    ["{a|{b|c}}", "Nested spintax"],
    ["{a|b", "Unbalanced"],
    ["a}", "Unbalanced"],
  ])("rejects %s", (text, expectedSubstring) => {
    const errors = validateSpintax(text, "loc");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(" ")).toContain(expectedSubstring);
  });
});

describe("validateCampaign (semantic pass)", () => {
  it("errors on a variable used but never declared", () => {
    const config = parsed({
      ...baseConfig,
      emails: [{ id: "e1", sequence_position: 1, body: "{{firstname}} {{missing}}" }],
    });
    const result = validateCampaign(config);
    expect(result.errors.join(" ")).toMatch(/undefined variables: missing/);
  });

  it("warns (does not error) on a declared-but-unused variable", () => {
    const config = parsed({
      ...baseConfig,
      variables: {
        firstname: { type: "source", source_column: "first_name" },
        unused: { type: "static", value: "x" },
      },
    });
    const result = validateCampaign(config);
    expect(result.errors).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/'unused' is defined but not used/);
  });

  it("errors on malformed spintax inside a real email body", () => {
    const config = parsed({
      ...baseConfig,
      emails: [{ id: "e1", sequence_position: 1, body: "{{firstname}} {oops}" }],
    });
    const result = validateCampaign(config);
    expect(result.errors.join(" ")).toMatch(/at least two alternatives/);
  });

  it("end-to-end via validateCampaignYaml: undefined variable blocks before any paid call", () => {
    const yaml = fixtureYaml.replace("{{secondary_signal_short}}", "{{secondary_signal_short}} {{never_declared}}");
    const result = validateCampaignYaml(yaml);
    expect(result.ok).toBe(false);
    expect(result.semanticErrors.join(" ")).toMatch(/never_declared/);
  });
});

describe("spintaxTokens (lightweight detector)", () => {
  it("detects spintax and template tokens", () => {
    const tokens = spintaxTokens("{Hey|Hi} {{firstname}}, {build|make} it");
    expect(tokens).toEqual(["{Hey|Hi}", "{{firstname}}", "{build|make}"]);
  });
});
