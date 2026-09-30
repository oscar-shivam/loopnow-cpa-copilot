export type RuleSetId = "assessment_legacy_30_150" | "cra_current_2026";

export interface DocumentationTierPolicy {
  maxExclusive: string | null;
  requiredFields: string[];
}

export interface CraRuleSet {
  id: RuleSetId;
  version: string;
  sourceId: string;
  documentationTiers: [DocumentationTierPolicy, DocumentationTierPolicy, DocumentationTierPolicy];
  ordinaryMealItcRate: string;
}

const basicFields = ["vendorName", "receiptDate", "total"];
const taxFields = ["taxAmountOrTaxIncluded", "gstHstNumber"];
const highValueFields = ["recipientName", "paymentTerms", "description"];

export const craRuleSets: Record<RuleSetId, CraRuleSet> = {
  assessment_legacy_30_150: {
    id: "assessment_legacy_30_150",
    version: "ASSESSMENT_LEGACY_30_150.1",
    sourceId: "cra-memorandum-8-4-legacy",
    documentationTiers: [
      { maxExclusive: "30", requiredFields: basicFields },
      { maxExclusive: "150", requiredFields: [...basicFields, ...taxFields] },
      { maxExclusive: null, requiredFields: [...basicFields, ...taxFields, ...highValueFields] },
    ],
    ordinaryMealItcRate: "0.5",
  },
  cra_current_2026: {
    id: "cra_current_2026",
    version: "CRA_CURRENT_2026.09",
    sourceId: "cra-itc-current-2026",
    documentationTiers: [
      { maxExclusive: "100", requiredFields: basicFields },
      { maxExclusive: "500", requiredFields: [...basicFields, ...taxFields] },
      { maxExclusive: null, requiredFields: [...basicFields, ...taxFields, ...highValueFields] },
    ],
    ordinaryMealItcRate: "0.5",
  },
};

export function getRuleSet(id: RuleSetId): CraRuleSet {
  return craRuleSets[id];
}
