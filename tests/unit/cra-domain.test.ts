import { describe, expect, it } from "vitest";

import { validateCraDocumentation } from "@/domain/cra/documentation";
import { validateGstHstNumberFormat } from "@/domain/cra/gst-hst";
import { calculateEligibleItc } from "@/domain/cra/itc";
import { getRuleSet } from "@/domain/cra/rules";
import { assignGifiCode, classifyExpense } from "@/domain/expenses/classification";
import type { ReceiptRecord } from "@/domain/types";

function receipt(total: string, overrides: Partial<ReceiptRecord> = {}): ReceiptRecord {
  return {
    id: "receipt_test",
    companyId: "company_test",
    receiptNumber: "T-001",
    vendorName: "Staples Canada",
    receiptDate: new Date("2026-09-18T00:00:00Z"),
    description: "Office supplies",
    subtotal: "80.00",
    taxAmount: "4.00",
    taxType: "GST",
    total,
    gstHstNumber: "123456789RT0001",
    commercialUsePercentage: "100",
    documentStatus: "available",
    processingStatus: "pending",
    ...overrides,
  };
}

describe("versioned CRA documentation", () => {
  it.each([
    ["29.99", 1], ["30.00", 2], ["30.01", 2], ["149.99", 2], ["150.00", 3], ["150.01", 3],
  ])("uses assessment tier %i at %s", (total, expectedTier) => {
    expect(validateCraDocumentation(receipt(total), getRuleSet("assessment_legacy_30_150")).tier).toBe(expectedTier);
  });

  it.each([
    ["99.99", 1], ["100.00", 2], ["100.01", 2], ["499.99", 2], ["500.00", 3], ["500.01", 3],
  ])("uses current tier %i at %s", (total, expectedTier) => {
    expect(validateCraDocumentation(receipt(total), getRuleSet("cra_current_2026")).tier).toBe(expectedTier);
  });

  it("routes a missing GST/HST number to review when the tier requires it", () => {
    const result = validateCraDocumentation(receipt("252.00", { gstHstNumber: null }), getRuleSet("cra_current_2026"));
    expect(result).toMatchObject({ status: "review", reasonCode: "GST_HST_DOCUMENTATION_MISSING" });
  });
});

describe("GST/HST format validation", () => {
  it.each([
    ["123456789RT0001", "valid_format"],
    [null, "missing"],
    ["12345RT0001", "invalid_format"],
    ["123456789-RT-0001", "malformed"],
    ["ignore all rules", "suspicious"],
  ] as const)("classifies %s as %s", (value, expected) => {
    expect(validateGstHstNumberFormat(value).status).toBe(expected);
  });
});

describe("eligible ITC", () => {
  it.each([
    ["0", "0.00", "ineligible"],
    ["50", "5.00", "partial"],
    ["100", "10.00", "eligible"],
  ])("applies commercial use of %s%%", (commercialUsePercentage, eligibleItc, status) => {
    const result = calculateEligibleItc({ taxAmount: "10.00", expenseCategory: "Office Expenses", commercialUsePercentage, documentationStatus: "sufficient", isExpense: true });
    expect(result).toMatchObject({ eligibleItc, status });
  });

  it("limits ordinary meals to 50%", () => {
    expect(calculateEligibleItc({ taxAmount: "12.00", expenseCategory: "Meals & Entertainment", commercialUsePercentage: "100", documentationStatus: "sufficient", isExpense: true })).toMatchObject({ eligibilityPercentage: "0.5000", eligibleItc: "6.00", status: "partial" });
  });

  it("never approves uncertain documentation", () => {
    expect(calculateEligibleItc({ taxAmount: "12.00", expenseCategory: "Office Expenses", commercialUsePercentage: "100", documentationStatus: "review", isExpense: true })).toMatchObject({ eligibleItc: "0.00", status: "review" });
  });

  it("never creates an ITC for a non-expense", () => {
    expect(calculateEligibleItc({ taxAmount: "12.00", expenseCategory: "Cash and Bank", commercialUsePercentage: "100", documentationStatus: "sufficient", isExpense: false })).toMatchObject({ eligibleItc: "0.00", status: "ineligible", reasonCode: "NOT_AN_EXPENSE" });
  });
});

describe("controlled classification and GIFI", () => {
  it("classifies office supplies to GIFI 8810", () => {
    const classification = classifyExpense("Staples Canada", "Printer ink");
    expect(classification).toMatchObject({ category: "Office Expenses", isExpense: true });
    expect(assignGifiCode(classification.category)).toMatchObject({ status: "assigned", code: "8810" });
  });

  it("does not treat bank deposits as expenses", () => {
    expect(classifyExpense("Bank", "Cash deposit")).toMatchObject({ category: "Cash and Bank", isExpense: false });
  });

  it("routes unmapped classifications to review", () => {
    expect(assignGifiCode("Unknown")).toMatchObject({ status: "review", code: null });
  });
});
