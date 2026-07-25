import { describe, expect, it } from "vitest";
import {
  PROTOCOL,
  RUN_TRANSITIONS,
  assertTransition,
  canTransition,
  isCancellable,
  isClaimable,
  isRunStatus,
  isTerminal,
  stageForClaim,
  type RunStatus,
} from "../src";

describe("run state machine", () => {
  it("covers every protocol status exactly", () => {
    expect(Object.keys(RUN_TRANSITIONS).sort()).toEqual([...PROTOCOL.run_statuses].sort());
  });

  it("terminal statuses have no exits", () => {
    for (const status of PROTOCOL.terminal_statuses) {
      expect(RUN_TRANSITIONS[status as RunStatus]).toEqual([]);
      expect(isTerminal(status as RunStatus)).toBe(true);
    }
  });

  it("all transition targets are valid statuses", () => {
    for (const targets of Object.values(RUN_TRANSITIONS)) {
      for (const target of targets) expect(isRunStatus(target)).toBe(true);
    }
  });

  it("walks the happy path end to end (three mandatory stages)", () => {
    const path: RunStatus[] = [
      "draft",
      "queued",
      "stage_one_running",
      "awaiting_stage_one_approval",
      "queued",
      "stage_two_running",
      // stage_two's success edge auto-advances to queued — no human gate —
      // because the fallback resolver always runs next.
      "queued",
      "fallback_resolver_running",
      "awaiting_final_approval",
      "uploading_to_instantly",
      "completed",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!), `${path[i]} -> ${path[i + 1]}`).toBe(true);
    }
  });

  it("stage_two never jumps straight to awaiting_final_approval", () => {
    expect(canTransition("stage_two_running", "awaiting_final_approval")).toBe(false);
    expect(canTransition("stage_two_retrying", "awaiting_final_approval")).toBe(false);
  });

  it("supports retry + failure decision loops", () => {
    expect(canTransition("stage_one_running", "stage_one_retrying")).toBe(true);
    expect(canTransition("stage_one_retrying", "stage_one_running")).toBe(true);
    expect(canTransition("stage_one_retrying", "stage_one_failed")).toBe(true);
    expect(canTransition("stage_one_failed", "queued")).toBe(true);
    expect(canTransition("stage_two_failed", "queued")).toBe(true);
    expect(canTransition("fallback_resolver_running", "fallback_resolver_retrying")).toBe(true);
    expect(canTransition("fallback_resolver_retrying", "fallback_resolver_failed")).toBe(true);
    expect(canTransition("fallback_resolver_failed", "queued")).toBe(true);
  });

  it("rejects illegal jumps (approval can never be skipped)", () => {
    expect(canTransition("stage_one_running", "stage_two_running")).toBe(false);
    expect(canTransition("queued", "completed")).toBe(false);
    expect(canTransition("awaiting_stage_one_approval", "stage_two_running")).toBe(false);
    expect(canTransition("completed", "queued")).toBe(false);
    expect(() => assertTransition("draft", "completed")).toThrow(/Invalid run transition/);
  });

  it("instantly failure returns to final approval, not terminal", () => {
    expect(canTransition("uploading_to_instantly", "awaiting_final_approval")).toBe(true);
    expect(canTransition("uploading_to_instantly", "cancelled")).toBe(false);
  });

  it("claim + cancel helpers", () => {
    expect(isClaimable("queued")).toBe(true);
    expect(isClaimable("awaiting_runner")).toBe(true);
    expect(isClaimable("stage_one_running")).toBe(false);
    expect(stageForClaim("queued", "stage_two")).toBe("stage_two");
    expect(stageForClaim("queued", null)).toBe("stage_one");
    expect(stageForClaim("completed", null)).toBeNull();
    expect(isCancellable("uploading_to_instantly")).toBe(false);
    expect(isCancellable("stage_two_running")).toBe(true);
    expect(isCancellable("completed")).toBe(false);
  });
});
