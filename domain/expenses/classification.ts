import type { ClassificationResult, GifiAssignmentResult } from "@/domain/types";

interface ClassificationRule {
  category: string;
  gifiCode: string;
  description: string;
  patterns: RegExp[];
}

const classificationRules: ClassificationRule[] = [
  { category: "Office Expenses", gifiCode: "8810", description: "Office expenses", patterns: [/staples|office supply|stationery|printer|paper/i] },
  { category: "Meals & Entertainment", gifiCode: "8523", description: "Meals and entertainment", patterns: [/restaurant|cafe|meal|catering|dining/i] },
  { category: "Software", gifiCode: "9150", description: "Computer-related expenses", patterns: [/software|subscription|saas|microsoft|adobe/i] },
  { category: "Travel", gifiCode: "9200", description: "Travel expenses", patterns: [/hotel|airline|flight|travel|uber|taxi/i] },
  { category: "Utilities", gifiCode: "9220", description: "Utilities", patterns: [/hydro|utility|electric|internet|telecom/i] },
  { category: "Computer Equipment", gifiCode: "1774", description: "Computer equipment/software", patterns: [/laptop|computer|equipment|machinery/i] },
  { category: "Cash and Bank", gifiCode: "1001", description: "Cash and deposits", patterns: [/bank deposit|cash deposit|deposit/i] },
];

export function classifyExpense(vendorName: string, description: string): ClassificationResult {
  const source = `${vendorName} ${description}`;
  const match = classificationRules.find((rule) => rule.patterns.some((pattern) => pattern.test(source)));
  if (!match) {
    return { category: "Unknown", confidence: "0.0000", isExpense: false, reasonCode: "CLASSIFICATION_AMBIGUOUS" };
  }
  const isExpense = match.category !== "Cash and Bank";
  return { category: match.category, confidence: "0.9500", isExpense, reasonCode: isExpense ? "CONTROLLED_RULE_MATCH" : "NON_EXPENSE_TRANSACTION" };
}

export function assignGifiCode(category: string): GifiAssignmentResult {
  const match = classificationRules.find((rule) => rule.category === category);
  if (!match) {
    return { status: "review", code: null, description: null, reasonCode: "GIFI_MAPPING_AMBIGUOUS" };
  }
  return { status: "assigned", code: match.gifiCode, description: match.description, reasonCode: "CONTROLLED_GIFI_MAPPING" };
}

export const controlledGifiCatalogue = classificationRules.map(({ category, gifiCode, description }) => ({ category, code: gifiCode, description }));
