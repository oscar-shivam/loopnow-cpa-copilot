import { describe, expect, it } from "vitest";

import { withVersionPath } from "@/agent/model-provider";
import { isSafeNarrative } from "@/agent/explanation";

describe("model provider configuration", () => {
  it("targets the OpenAI-compatible path exposed by Ollama", () => {
    expect(withVersionPath("http://localhost:11434")).toBe("http://localhost:11434/v1");
    expect(withVersionPath("http://localhost:11434/v1/")).toBe("http://localhost:11434/v1");
  });
});

describe("optional model narrative guard", () => {
  const facts = { category: "Office Expenses", eligibleItc: "4.10", gifiCode: "8810", outcome: "processed" as const, reasonCode: "COMMERCIAL_EXPENSE_ELIGIBLE", ruleVersion: "CRA_CURRENT_2026.09" };

  it("accepts only a bounded narrative anchored to deterministic facts", () => {
    expect(isSafeNarrative("Office Expenses has a deterministic eligible ITC of $4.10 under CRA_CURRENT_2026.09. This is a configured-policy result, not a CRA acceptance decision.", facts)).toBe(true);
  });

  it("rejects a narrative that promises CRA acceptance", () => {
    expect(isSafeNarrative("Office Expenses has a deterministic eligible ITC of $4.10 under CRA_CURRENT_2026.09. CRA will accept this claim without question.", facts)).toBe(false);
  });
});
