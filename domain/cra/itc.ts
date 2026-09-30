import { decimal, money, percentage, toMoneyString, toRateString } from "@/domain/money/money";
import type { DocumentationStatus, ItcResult } from "@/domain/types";

export interface ItcInput {
  taxAmount: string;
  expenseCategory: string;
  commercialUsePercentage: string;
  documentationStatus: DocumentationStatus;
  isExpense: boolean;
  ordinaryMealRate?: string;
}

export function calculateEligibleItc(input: ItcInput): ItcResult {
  const grossTax = money(input.taxAmount);
  const commercialUseRate = percentage(input.commercialUsePercentage).dividedBy(100);
  if (!input.isExpense) {
    return { grossTax: toMoneyString(grossTax), eligibilityPercentage: "0.0000", eligibleItc: "0.00", status: "ineligible", reasonCode: "NOT_AN_EXPENSE" };
  }
  if (input.documentationStatus === "review") {
    return { grossTax: toMoneyString(grossTax), eligibilityPercentage: "0.0000", eligibleItc: "0.00", status: "review", reasonCode: "DOCUMENTATION_REVIEW_REQUIRED" };
  }
  if (input.documentationStatus === "insufficient") {
    return { grossTax: toMoneyString(grossTax), eligibilityPercentage: "0.0000", eligibleItc: "0.00", status: "ineligible", reasonCode: "DOCUMENTATION_INSUFFICIENT" };
  }
  const mealRate = input.expenseCategory === "Meals & Entertainment" ? decimal(input.ordinaryMealRate ?? "0.5") : decimal(1);
  const eligibilityPercentage = commercialUseRate.times(mealRate);
  const eligibleItc = money(grossTax.times(eligibilityPercentage));
  if (eligibleItc.lessThan(0) || eligibleItc.greaterThan(grossTax)) {
    throw new Error("Calculated ITC violates financial invariants");
  }
  const status = eligibilityPercentage.isZero() ? "ineligible" : eligibilityPercentage.lessThan(1) ? "partial" : "eligible";
  const reasonCode = input.expenseCategory === "Meals & Entertainment" ? "ORDINARY_MEAL_LIMITATION" : status === "ineligible" ? "NO_COMMERCIAL_USE" : "COMMERCIAL_EXPENSE_ELIGIBLE";
  return { grossTax: toMoneyString(grossTax), eligibilityPercentage: toRateString(eligibilityPercentage), eligibleItc: toMoneyString(eligibleItc), status, reasonCode };
}
