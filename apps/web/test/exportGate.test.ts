import { describe, expect, it } from "vitest";
import { canConfirmInstantlyUpload } from "@/lib/exportGate";

const BASE = {
  confirmTitle: "My Campaign",
  campaignTitle: "My Campaign",
  confirmCount: "10",
  readyCount: 10,
  listId: "list_1",
  blockedRowsCount: 0,
  partialAcknowledged: false,
};

describe("canConfirmInstantlyUpload", () => {
  it("confirms when everything matches and nothing is blocked", () => {
    expect(canConfirmInstantlyUpload(BASE)).toBe(true);
  });

  it("requires exact title and count retype", () => {
    expect(canConfirmInstantlyUpload({ ...BASE, confirmTitle: "wrong" })).toBe(false);
    expect(canConfirmInstantlyUpload({ ...BASE, confirmCount: "11" })).toBe(false);
  });

  it("requires a list id", () => {
    expect(canConfirmInstantlyUpload({ ...BASE, listId: "  " })).toBe(false);
  });

  it("blocks confirmation when leads were blocked and not acknowledged", () => {
    expect(canConfirmInstantlyUpload({ ...BASE, blockedRowsCount: 3 })).toBe(false);
  });

  it("allows confirmation once blocked leads are explicitly acknowledged", () => {
    expect(
      canConfirmInstantlyUpload({ ...BASE, blockedRowsCount: 3, partialAcknowledged: true }),
    ).toBe(true);
  });

  it("acknowledging with zero blocked rows doesn't matter either way", () => {
    expect(canConfirmInstantlyUpload({ ...BASE, partialAcknowledged: true })).toBe(true);
  });
});
