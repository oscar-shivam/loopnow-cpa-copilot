import { describe, expect, it } from "vitest";

import { assertReceiptTransition, canTransitionReceiptStatus } from "@/domain/receipts/state-machine";

describe("receipt state machine", () => {
  it.each([
    ["pending", "processing"],
    ["processing", "processed"],
    ["processing", "review_required"],
    ["processing", "failed"],
    ["review_required", "processed"],
    ["review_required", "failed"],
    ["review_required", "pending"],
    ["failed", "processing"],
    ["processed", "processing"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(canTransitionReceiptStatus(from, to)).toBe(true);
    expect(() => assertReceiptTransition(from, to)).not.toThrow();
  });

  it.each([
    ["pending", "processed"],
    ["pending", "review_required"],
    ["processing", "pending"],
    ["processed", "failed"],
    ["failed", "processed"],
  ] as const)("rejects %s -> %s", (from, to) => {
    expect(canTransitionReceiptStatus(from, to)).toBe(false);
    try {
      assertReceiptTransition(from, to);
      throw new Error("expected a state-transition failure");
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_RECEIPT_TRANSITION", status: 409 });
    }
  });
});
