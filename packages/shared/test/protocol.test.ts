import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PROTOCOL,
  eventBatchSchema,
  runnerEventSchema,
  redactSecrets,
  isProtocolCompatible,
  heartbeatSchema,
  finalApprovalSchema,
  pairRequestSchema,
} from "../src";

describe("protocol sync", () => {
  it("generated TS matches protocol.json", () => {
    const source = JSON.parse(readFileSync(join(__dirname, "../protocol.json"), "utf8"));
    expect(JSON.parse(JSON.stringify(PROTOCOL))).toEqual(source);
  });

  it("generated Python matches protocol.json", () => {
    const py = readFileSync(
      join(__dirname, "../../../runner/aureli_runner/protocol.py"),
      "utf8",
    );
    const match = /PROTOCOL = json\.loads\(r"""([\s\S]*?)"""\)/.exec(py);
    expect(match).not.toBeNull();
    const source = JSON.parse(readFileSync(join(__dirname, "../protocol.json"), "utf8"));
    expect(JSON.parse(match![1]!)).toEqual(source);
  });

  it("SQL enum matches protocol statuses (base CREATE TYPE + later ALTER TYPE ADD VALUE)", () => {
    const migrationsDir = join(__dirname, "../../../supabase/migrations");
    const baseSql = readFileSync(join(migrationsDir, "0001_types.sql"), "utf8");
    const enumBlock = /create type public\.run_status as enum \(([\s\S]*?)\);/.exec(baseSql)![1]!;
    const statuses = [...enumBlock.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);

    // Later migrations may extend the enum additively via
    // `alter type public.run_status add value 'x' after 'y';` — fold those
    // into the same ordered list rather than requiring every status to live
    // in the original 0001 file forever.
    const laterFiles = readdirSync(migrationsDir)
      .filter((f) => f !== "0001_types.sql" && f.endsWith(".sql"))
      .sort();
    const addValueRe =
      /alter type public\.run_status add value '([a-z_]+)'(?:\s+after\s+'([a-z_]+)')?;/g;
    for (const file of laterFiles) {
      const sql = readFileSync(join(migrationsDir, file), "utf8");
      for (const match of sql.matchAll(addValueRe)) {
        const [, value, after] = match;
        if (!value || statuses.includes(value)) continue;
        if (after && statuses.includes(after)) {
          statuses.splice(statuses.indexOf(after) + 1, 0, value);
        } else {
          statuses.push(value);
        }
      }
    }

    expect(statuses).toEqual([...PROTOCOL.run_statuses]);
  });
});

describe("runner event schema", () => {
  const valid = {
    seq: 0,
    stage: "stage_one" as const,
    ts: new Date().toISOString(),
    severity: "info" as const,
    event_type: "stage_progress" as const,
    message: "hello",
    current_item: 1,
    total_items: 10,
  };
  it("accepts a valid event and batch", () => {
    expect(runnerEventSchema.safeParse(valid).success).toBe(true);
    expect(eventBatchSchema.safeParse({ events: [valid] }).success).toBe(true);
  });
  it("rejects unknown fields, bad severities, oversized batches", () => {
    expect(runnerEventSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(runnerEventSchema.safeParse({ ...valid, severity: "fatal" }).success).toBe(false);
    const batch = Array.from({ length: PROTOCOL.limits.event_batch_max + 1 }, (_, i) => ({
      ...valid,
      seq: i,
    }));
    expect(eventBatchSchema.safeParse({ events: batch }).success).toBe(false);
  });
});

describe("secret redaction", () => {
  it("redacts key=value shapes, bearer headers, JWTs", () => {
    expect(redactSecrets("EXA_API_KEY=abcd1234secret")).not.toContain("abcd1234secret");
    expect(redactSecrets("Authorization: Bearer abc.def.ghi")).toContain("[redacted]");
    expect(redactSecrets("using sk-abcdefghijklmnop1234")).not.toContain("sk-abcdefghijklmnop1234");
    expect(
      redactSecrets("eyJabcdefghijklmnopqrstu.eyJabcdefghij.SflKxwRJSMeKKF2QT4"),
    ).toContain("[redacted]");
  });
  it("leaves normal text alone", () => {
    expect(redactSecrets("Processed 10/100 leads")).toBe("Processed 10/100 leads");
  });
});

describe("api schemas", () => {
  it("heartbeat accepts only status enums — never values", () => {
    const good = {
      active_run_id: null,
      runner_version: "1.0.0",
      protocol_version: "1.0.0",
      credentials: { EXA_API_KEY: "configured" },
      last_connection_test_at: null,
    };
    expect(heartbeatSchema.safeParse(good).success).toBe(true);
    expect(
      heartbeatSchema.safeParse({
        ...good,
        credentials: { EXA_API_KEY: "sk-realkey123456" },
      }).success,
    ).toBe(false);
    expect(
      heartbeatSchema.safeParse({ ...good, credentials: { "bad key!": "configured" } }).success,
    ).toBe(false);
  });

  it("final approval requires typed confirmation + idempotency key", () => {
    expect(
      finalApprovalSchema.safeParse({
        action: "approve_instantly",
        confirm_title: "My Campaign",
        confirm_lead_count: 42,
        list_id: "list_1",
        idempotency_key: "3f0b8f0e-6d2a-4b0e-9a2e-1c2d3e4f5a6b",
      }).success,
    ).toBe(true);
    expect(
      finalApprovalSchema.safeParse({ action: "approve_instantly", list_id: "x" }).success,
    ).toBe(false);
  });

  it("pairing code format is enforced", () => {
    const base = { runner_name: "PC", platform: "windows", runner_version: "1", protocol_version: "1.0.0" };
    expect(pairRequestSchema.safeParse({ code: "ABCD2345", ...base }).success).toBe(true);
    expect(pairRequestSchema.safeParse({ code: "abcd2345", ...base }).success).toBe(false);
    expect(pairRequestSchema.safeParse({ code: "SHORT", ...base }).success).toBe(false);
  });
});

describe("protocol version compatibility", () => {
  it("accepts current, rejects other majors and garbage", () => {
    expect(isProtocolCompatible(PROTOCOL.protocol_version)).toBe(true);
    expect(isProtocolCompatible("2.0.0")).toBe(false);
    expect(isProtocolCompatible("0.9.0")).toBe(false);
    expect(isProtocolCompatible("not-a-version")).toBe(false);
  });
});
