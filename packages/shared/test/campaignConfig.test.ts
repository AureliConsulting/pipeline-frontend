import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_CONFIG_YAML,
  spintaxTokens,
  validateCampaignYaml,
} from "../src";

const fixtureYaml = readFileSync(
  join(__dirname, "../../../fixtures/campaign_config.fixture.yaml"),
  "utf8",
);

describe("campaign configuration validation", () => {
  it("accepts the canonical YAML", () => {
    const result = validateCampaignYaml(CANONICAL_CONFIG_YAML);
    expect(result.syntaxErrors).toEqual([]);
    expect(result.schemaErrors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.normalized?.campaign_id).toBe("my_campaign_v1");
  });

  it("accepts the fixture and preserves spintax content through parsing", () => {
    const result = validateCampaignYaml(fixtureYaml);
    expect(result.ok).toBe(true);
    const offer = result.normalized!.approved_offers[0]!;
    expect(offer.canonical_text).toBe(
      "{build|put together} the first campaign and target-account list with no upfront fee",
    );
  });

  it("reports YAML syntax errors", () => {
    const result = validateCampaignYaml("campaign_id: [unclosed");
    expect(result.ok).toBe(false);
    expect(result.syntaxErrors.length).toBeGreaterThan(0);
  });

  it("reports schema violations with paths (strict — unknown keys rejected)", () => {
    const result = validateCampaignYaml(
      'campaign_id: "x"\ntemplate_id: "t"\nproof: {}\napproved_offers: []\napproved_contact_bridges: []\nnot_a_real_key: 1\n',
    );
    expect(result.ok).toBe(false);
    expect(result.schemaErrors.join(" ")).toMatch(/not_a_real_key|approved_offers/);
  });

  it("rejects out-of-range generation settings (mirrors Pydantic bounds)", () => {
    const bad = fixtureYaml.replace("temperature: 0.2", "temperature: 3.5");
    const result = validateCampaignYaml(bad);
    expect(result.ok).toBe(false);
    expect(result.schemaErrors.join(" ")).toMatch(/generation.temperature/);
  });

  it("detects spintax and template tokens", () => {
    const tokens = spintaxTokens("{Hey|Hi} {{firstname}}, {build|make} it");
    expect(tokens).toEqual(["{Hey|Hi}", "{{firstname}}", "{build|make}"]);
  });
});
