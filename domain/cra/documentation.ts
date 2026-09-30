import { decimal } from "@/domain/money/money";
import type { DocumentationValidationResult, ReceiptRecord } from "@/domain/types";

import type { CraRuleSet } from "./rules";

function tierForTotal(total: string, ruleSet: CraRuleSet): 1 | 2 | 3 {
  const amount = decimal(total);
  const firstMaximum = ruleSet.documentationTiers[0].maxExclusive;
  const secondMaximum = ruleSet.documentationTiers[1].maxExclusive;
  if (firstMaximum && amount.lessThan(firstMaximum)) return 1;
  if (secondMaximum && amount.lessThan(secondMaximum)) return 2;
  return 3;
}

function hasField(receipt: ReceiptRecord, field: string): boolean {
  switch (field) {
    case "vendorName": return receipt.vendorName.trim().length > 0 && receipt.vendorName !== "Unknown Vendor";
    case "receiptDate": return !Number.isNaN(receipt.receiptDate.getTime());
    case "total": return decimal(receipt.total).greaterThanOrEqualTo(0);
    case "taxAmountOrTaxIncluded": return decimal(receipt.taxAmount).greaterThanOrEqualTo(0) && receipt.taxType !== "NONE";
    case "gstHstNumber": return Boolean(receipt.gstHstNumber?.trim());
    case "recipientName": return Boolean(receipt.recipientName?.trim());
    case "paymentTerms": return Boolean(receipt.paymentTerms?.trim());
    case "description": return receipt.description.trim().length > 0;
    default: return false;
  }
}

export function validateCraDocumentation(receipt: ReceiptRecord, ruleSet: CraRuleSet): DocumentationValidationResult {
  const tier = tierForTotal(receipt.total, ruleSet);
  const requiredFields = ruleSet.documentationTiers[tier - 1].requiredFields;
  const missingFields = requiredFields.filter((field) => !hasField(receipt, field));

  if (receipt.documentStatus === "suspicious") {
    return { status: "review", tier, requiredFields, missingFields, ruleVersion: ruleSet.version, sourceId: ruleSet.sourceId, reasonCode: "SUSPICIOUS_DOCUMENT" };
  }
  if (receipt.documentStatus === "missing") {
    return { status: "review", tier, requiredFields, missingFields: [...new Set([...missingFields, "document"])], ruleVersion: ruleSet.version, sourceId: ruleSet.sourceId, reasonCode: "DOCUMENT_MISSING" };
  }
  if (missingFields.length > 0) {
    const gstMissing = missingFields.includes("gstHstNumber");
    return {
      status: gstMissing ? "review" : "insufficient",
      tier,
      requiredFields,
      missingFields,
      ruleVersion: ruleSet.version,
      sourceId: ruleSet.sourceId,
      reasonCode: gstMissing ? "GST_HST_DOCUMENTATION_MISSING" : "DOCUMENTATION_INSUFFICIENT",
    };
  }
  return { status: "sufficient", tier, requiredFields, missingFields: [], ruleVersion: ruleSet.version, sourceId: ruleSet.sourceId, reasonCode: "DOCUMENTATION_SUFFICIENT" };
}
