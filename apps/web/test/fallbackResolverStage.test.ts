import { describe, expect, it } from "vitest";
import {
  expectedRunningStatuses,
  failedStatusFor,
  stageCompletionPlan,
} from "@/lib/runsService";

describe("fallback resolver stage-completion dispatch", () => {
  it("stage_two completion auto-continues into fallback_resolver with no approval gate", () => {
    const plan = stageCompletionPlan("stage_two");
    expect(plan).toEqual({ kind: "auto_continue", status: "queued", nextStage: "fallback_resolver" });
  });

  it("fallback_resolver completion pauses at the final approval checkpoint", () => {
    const plan = stageCompletionPlan("fallback_resolver");
    expect(plan).toEqual({ kind: "await_approval", status: "awaiting_final_approval", approvalKind: "final" });
  });

  it("stage_one completion pauses at the stage-one approval checkpoint", () => {
    const plan = stageCompletionPlan("stage_one");
    expect(plan).toEqual({
      kind: "await_approval",
      status: "awaiting_stage_one_approval",
      approvalKind: "stage_one",
    });
  });

  it("each stage has a distinct failed status", () => {
    expect(failedStatusFor("stage_one")).toBe("stage_one_failed");
    expect(failedStatusFor("stage_two")).toBe("stage_two_failed");
    expect(failedStatusFor("fallback_resolver")).toBe("fallback_resolver_failed");
  });

  it("each stage has distinct running/retrying statuses used for idempotency checks", () => {
    expect(expectedRunningStatuses("fallback_resolver")).toEqual([
      "fallback_resolver_running",
      "fallback_resolver_retrying",
    ]);
    expect(expectedRunningStatuses("stage_two")).toEqual(["stage_two_running", "stage_two_retrying"]);
    // Unknown stage falls back to stage_one rather than throwing.
    expect(expectedRunningStatuses("unknown")).toEqual(["stage_one_running", "stage_one_retrying"]);
  });
});
