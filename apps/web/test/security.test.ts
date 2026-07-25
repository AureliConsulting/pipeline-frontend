import { describe, expect, it } from "vitest";
import { hashToken, safeEqualHex, requireRunner, requireRunnerRun } from "@/lib/runnerAuth";
import { artifactStoragePath, transitionRun, getOwnedRun } from "@/lib/runsService";
import { ApiError } from "@/lib/api";
import { fakeAdmin } from "./fakeSupabase";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RUN_A = "11111111-1111-4111-8111-111111111111";
const RUN_B = "22222222-2222-4222-8222-222222222222";
const TOKEN = `arn_${"ab".repeat(32)}`;

function requestWith(auth?: string): Request {
  return new Request("https://example.test/api/runner/claim", {
    headers: auth ? { authorization: auth } : {},
  });
}

describe("runner token auth", () => {
  const tables = {
    runner_devices: {
      rows: [
        {
          id: "dev-1",
          user_id: USER_A,
          name: "PC",
          status: "active",
          token_hash: hashToken(TOKEN),
          protocol_version: "1.0.0",
          runner_version: "1.0.0",
        },
      ],
    },
  };

  it("rejects missing / malformed / wrong tokens", async () => {
    const admin = fakeAdmin(tables);
    await expect(requireRunner(requestWith(), admin)).rejects.toMatchObject({ status: 401 });
    await expect(requireRunner(requestWith("Bearer nope"), admin)).rejects.toMatchObject({ status: 401 });
    await expect(
      requireRunner(requestWith(`Bearer arn_${"cd".repeat(32)}`), admin),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("accepts a valid token and resolves the runner identity", async () => {
    const admin = fakeAdmin(tables);
    const { runner } = await requireRunner(requestWith(`Bearer ${TOKEN}`), admin);
    expect(runner.user_id).toBe(USER_A);
  });

  it("rejects revoked runners", async () => {
    const admin = fakeAdmin({
      runner_devices: {
        rows: [{ ...tables.runner_devices.rows[0]!, status: "revoked" }],
      },
    });
    await expect(requireRunner(requestWith(`Bearer ${TOKEN}`), admin)).rejects.toMatchObject({
      status: 401,
    });
  });

  it("never lets a runner see another user's run (404, not 403)", async () => {
    const admin = fakeAdmin({
      pipeline_runs: {
        rows: [
          { id: RUN_A, user_id: USER_A, status: "queued" },
          { id: RUN_B, user_id: USER_B, status: "queued" },
        ],
      },
    });
    const runner = { id: "dev-1", user_id: USER_A, name: "PC", protocol_version: "", runner_version: "" };
    const own = await requireRunnerRun(admin, runner, RUN_A);
    expect(own.id).toBe(RUN_A);
    await expect(requireRunnerRun(admin, runner, RUN_B)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("token hashing is deterministic and comparison is constant-time-safe", () => {
    expect(hashToken(TOKEN)).toHaveLength(64);
    expect(safeEqualHex(hashToken(TOKEN), hashToken(TOKEN))).toBe(true);
    expect(safeEqualHex(hashToken(TOKEN), hashToken("arn_other"))).toBe(false);
    expect(safeEqualHex("", "")).toBe(false);
  });
});

describe("artifact storage paths", () => {
  it("builds owner-scoped paths and sanitizes file names", () => {
    const path = artifactStoragePath(USER_A, RUN_A, "stage_one", "..\\..\\evil.csv");
    expect(path).toBe(`${USER_A}/${RUN_A}/stage_one/evil.csv`);
    expect(path).not.toContain("..");
  });
  it("rejects non-uuid identifiers (no path injection via ids)", () => {
    expect(() => artifactStoragePath("../../x", RUN_A, "stage_one", "a.csv")).toThrow(ApiError);
  });
});

describe("ownership + state transitions", () => {
  it("getOwnedRun hides other users' runs as 404", async () => {
    const admin = fakeAdmin({
      pipeline_runs: { rows: [{ id: RUN_B, user_id: USER_B, status: "queued" }] },
    });
    await expect(getOwnedRun(admin, USER_A, RUN_B)).rejects.toMatchObject({ status: 404 });
  });

  it("transitionRun enforces the state machine", async () => {
    const admin = fakeAdmin({
      pipeline_runs: { rows: [{ id: RUN_A, user_id: USER_A, status: "queued" }] },
    });
    await expect(transitionRun(admin, RUN_A, "queued", "completed")).rejects.toMatchObject({
      code: "invalid_transition",
    });
  });

  it("transitionRun is optimistic — a stale status loses the race", async () => {
    const admin = fakeAdmin({
      pipeline_runs: { rows: [{ id: RUN_A, user_id: USER_A, status: "cancelled" }] },
    });
    await expect(
      transitionRun(admin, RUN_A, "stage_one_running", "awaiting_stage_one_approval"),
    ).rejects.toMatchObject({ code: "stale_status" });
  });

  it("valid transition updates the row", async () => {
    const tables = {
      pipeline_runs: { rows: [{ id: RUN_A, user_id: USER_A, status: "queued" }] },
    };
    const admin = fakeAdmin(tables);
    await transitionRun(admin, RUN_A, "queued", "stage_one_running", { claimed_by: "dev-1" });
    expect(tables.pipeline_runs.rows[0]).toMatchObject({
      status: "stage_one_running",
      claimed_by: "dev-1",
    });
  });
});
