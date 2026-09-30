import { updateDecisionSchema } from "@/agent/tools/contracts";
import { validateCraDocumentation } from "@/domain/cra/documentation";
import { validateGstHstNumberFormat } from "@/domain/cra/gst-hst";
import { calculateEligibleItc } from "@/domain/cra/itc";
import { getRuleSet } from "@/domain/cra/rules";
import { assignGifiCode, classifyExpense } from "@/domain/expenses/classification";
import type { ReceiptRecord } from "@/domain/types";

import { goldenCases, type GoldenCase } from "./golden-cases";

function receiptForCase(input: Extract<GoldenCase, { suite: "documentation" }>["input"]): ReceiptRecord {
  return {
    id: "evaluation_receipt",
    companyId: "evaluation_company",
    receiptNumber: "E-001",
    vendorName: "Evaluation Vendor",
    receiptDate: new Date("2026-09-01T00:00:00Z"),
    description: "Evaluation receipt",
    subtotal: input.total,
    taxAmount: "5.00",
    taxType: "GST",
    total: input.total,
    gstHstNumber: input.gstHstNumber === undefined ? "123456789RT0001" : input.gstHstNumber,
    commercialUsePercentage: "100",
    documentStatus: input.documentStatus ?? "available",
    recipientName: input.recipientName,
    paymentTerms: input.paymentTerms,
    processingStatus: "pending",
  };
}

function matches(actual: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function evaluateCase(testCase: GoldenCase): Record<string, unknown> {
  switch (testCase.suite) {
    case "documentation": {
      const result = validateCraDocumentation(receiptForCase(testCase.input), getRuleSet(testCase.input.ruleSet));
      return { tier: result.tier, status: result.status, reasonCode: result.reasonCode };
    }
    case "gst_hst": {
      const result = validateGstHstNumberFormat(testCase.input.value);
      return { status: result.status, normalizedNumber: result.normalizedNumber };
    }
    case "classification": {
      const result = classifyExpense(testCase.input.vendorName, testCase.input.description);
      const gifi = assignGifiCode(result.category);
      return { category: result.category, isExpense: result.isExpense, gifiCode: gifi.code };
    }
    case "itc": {
      const result = calculateEligibleItc(testCase.input);
      return { eligibleItc: result.eligibleItc, status: result.status, eligibilityPercentage: result.eligibilityPercentage };
    }
    case "tool_contract": {
      const parsed = updateDecisionSchema.safeParse(testCase.input);
      return { accepts: parsed.success };
    }
  }
}

const failures = goldenCases.flatMap((testCase) => {
  const actual = evaluateCase(testCase);
  return matches(actual, testCase.expected) ? [] : [{ id: testCase.id, suite: testCase.suite, expected: testCase.expected, actual }];
});

const passed = goldenCases.length - failures.length;
console.info(JSON.stringify({
  evaluator: "deterministic-golden-cases",
  total: goldenCases.length,
  passed,
  failed: failures.length,
  suites: [...new Set(goldenCases.map((testCase) => testCase.suite))],
}, null, 2));

if (failures.length > 0) {
  console.error(JSON.stringify({ failures }, null, 2));
  process.exitCode = 1;
}
