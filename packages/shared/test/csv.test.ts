import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isSalesNavigatorSearchUrl,
  parseCsv,
  safeFileName,
  validateLeadCsv,
} from "../src";

const fixture = readFileSync(join(__dirname, "../../../fixtures/sample_leads.csv"), "utf8");

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, commas and CRLF", () => {
    const rows = parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["x, y", 'he said "hi"'],
    ]);
  });
  it("strips a BOM", () => {
    expect(parseCsv("﻿a,b\n1,2")[0]).toEqual(["a", "b"]);
  });
});

describe("validateLeadCsv (canonical schema)", () => {
  it("accepts the fixture and counts rows + duplicates", () => {
    const result = validateLeadCsv(fixture);
    expect(result.ok).toBe(true);
    expect(result.totalRows).toBe(6);
    expect(result.duplicateRowCount).toBe(1); // jordan appears twice
    expect(result.missingRequired).toEqual([]);
    expect(result.preview.rows.length).toBe(6);
  });

  it("blocks when required columns are missing and never auto-maps", () => {
    const result = validateLeadCsv("foo,bar\n1,2\n");
    expect(result.ok).toBe(false);
    expect(result.missingRequired).toContain("company");
    expect(result.missingRequired).toContain("Email");
    expect(result.errors.join(" ")).toMatch(/never guessed or auto-mapped/);
  });

  it("keeps unexpected columns and only warns", () => {
    const header = fixture.split("\n")[0] + ",totally_custom_column";
    const row = fixture.split("\n")[1] + ",custom";
    const result = validateLeadCsv(`${header}\n${row}\n`);
    expect(result.ok).toBe(true);
    expect(result.unexpectedColumns).toEqual(["totally_custom_column"]);
    expect(result.warnings.join(" ")).toMatch(/kept as-is/);
  });

  it("enforces the 10k row cap via options", () => {
    const lines = [fixture.split("\n")[0]];
    const template = fixture.split("\n")[1]!;
    for (let i = 0; i < 5; i++) lines.push(template.replace("avery@acme-msp.example", `user${i}@x.example`));
    const result = validateLeadCsv(lines.join("\n"), { maxRows: 3 });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/maximum per run is 3/);
  });

  it("rejects an empty file", () => {
    expect(validateLeadCsv("").ok).toBe(false);
  });
});

describe("safeFileName", () => {
  it("strips path traversal and separators", () => {
    expect(safeFileName("..\\..\\evil.csv")).toBe("evil.csv");
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("nice name.csv")).toBe("nice name.csv");
    expect(safeFileName('a<b>:c"|d?*.csv')).toBe("abcd.csv");
    expect(safeFileName("...")).toBe("file.csv");
  });
});

describe("isSalesNavigatorSearchUrl", () => {
  it("accepts real Sales Navigator search/list URLs", () => {
    expect(
      isSalesNavigatorSearchUrl("https://www.linkedin.com/sales/search/people?query=abc"),
    ).toBe(true);
    expect(isSalesNavigatorSearchUrl("https://linkedin.com/sales/lists/people/123")).toBe(true);
  });
  it("rejects everything else", () => {
    expect(isSalesNavigatorSearchUrl("https://www.linkedin.com/in/someone")).toBe(false);
    expect(isSalesNavigatorSearchUrl("https://evil.example/sales/search/people")).toBe(false);
    expect(isSalesNavigatorSearchUrl("http://www.linkedin.com/sales/search/people")).toBe(false);
    expect(isSalesNavigatorSearchUrl("not a url")).toBe(false);
  });
});
