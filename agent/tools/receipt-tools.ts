import { z } from "zod";

import { validateCraDocumentation } from "@/domain/cra/documentation";
import { validateGstHstNumberFormat } from "@/domain/cra/gst-hst";
import { calculateEligibleItc } from "@/domain/cra/itc";
import { getRuleSet, type RuleSetId } from "@/domain/cra/rules";
import { assignGifiCode, classifyExpense } from "@/domain/expenses/classification";
import { persistExpenseDecision } from "@/domain/expenses/repository";
import { getReceiptForCompany } from "@/domain/receipts/repository";
import type { DocumentationValidationResult, GstHstValidationResult, ItcResult, ClassificationResult, GifiAssignmentResult, ReceiptRecord } from "@/domain/types";

import type { AgentRunContext } from "../types";
import { currentReceiptResultSchema, currentReceiptSchema, receiptIdSchema, updateDecisionSchema } from "./contracts";
import { runInstrumentedTool } from "./instrumentation";

function ruleSetId(): RuleSetId {
  const configured = process.env.CRA_RULESET_VERSION;
  return configured === "assessment_legacy_30_150" ? configured : "cra_current_2026";
}

function currentReceiptResult(receipt: ReceiptRecord): z.infer<typeof currentReceiptResultSchema> {
  return { id: receipt.id, receiptNumber: receipt.receiptNumber, vendorName: receipt.vendorName, description: receipt.description, total: receipt.total, processingStatus: receipt.processingStatus };
}

export async function getCurrentReceipt(context: AgentRunContext): Promise<ReceiptRecord> {
  currentReceiptSchema.parse({});
  return runInstrumentedTool(context, "get_current_receipt", {}, async () => {
    const receipt = await getReceiptForCompany(context.receiptId, context.actor.companyId);
    return currentReceiptResultSchema.parse(currentReceiptResult(receipt));
  }).then(async (result) => getReceiptForCompany(result.id, context.actor.companyId));
}

export async function getReceiptDetails(context: AgentRunContext, rawInput: unknown): Promise<ReceiptRecord> {
  const input = receiptIdSchema.parse(rawInput);
  return runInstrumentedTool(context, "get_receipt_details", input, async () => {
    const receipt = await getReceiptForCompany(input.receiptId, context.actor.companyId);
    return currentReceiptResultSchema.parse(currentReceiptResult(receipt));
  }).then(async (result) => getReceiptForCompany(result.id, context.actor.companyId));
}

export async function validateDocumentationTool(context: AgentRunContext, receipt: ReceiptRecord): Promise<DocumentationValidationResult> {
  return runInstrumentedTool(context, "validate_cra_documentation", { receiptId: receipt.id, ruleSetId: ruleSetId() }, async () => validateCraDocumentation(receipt, getRuleSet(ruleSetId())));
}

export async function validateGstHstTool(context: AgentRunContext, receipt: ReceiptRecord): Promise<GstHstValidationResult> {
  return runInstrumentedTool(context, "validate_gst_hst_number_format", { receiptId: receipt.id }, async () => validateGstHstNumberFormat(receipt.gstHstNumber));
}

export async function classifyExpenseTool(context: AgentRunContext, receipt: ReceiptRecord): Promise<ClassificationResult> {
  return runInstrumentedTool(context, "classify_expense", { receiptId: receipt.id }, async () => classifyExpense(receipt.vendorName, receipt.description));
}

export async function assignGifiTool(context: AgentRunContext, receipt: ReceiptRecord, classification: ClassificationResult): Promise<GifiAssignmentResult> {
  return runInstrumentedTool(context, "assign_gifi_code", { receiptId: receipt.id, category: classification.category }, async () => assignGifiCode(classification.category));
}

export async function calculateItcTool(context: AgentRunContext, receipt: ReceiptRecord, classification: ClassificationResult, documentation: DocumentationValidationResult): Promise<ItcResult> {
  return runInstrumentedTool(context, "calculate_eligible_itc", { receiptId: receipt.id, category: classification.category, documentationStatus: documentation.status }, async () => calculateEligibleItc({
    taxAmount: receipt.taxAmount,
    expenseCategory: classification.category,
    commercialUsePercentage: receipt.commercialUsePercentage,
    documentationStatus: documentation.status,
    isExpense: classification.isExpense,
    ordinaryMealRate: getRuleSet(ruleSetId()).ordinaryMealItcRate,
  }));
}

interface PersistToolInput {
  receipt: ReceiptRecord;
  classification: ClassificationResult;
  gifi: GifiAssignmentResult;
  itc: ItcResult;
  shouldReview: boolean;
}

async function persist(context: AgentRunContext, input: PersistToolInput, toolName: "update_expense_classification" | "request_human_review") {
  updateDecisionSchema.parse({ receiptId: input.receipt.id, idempotencyKey: context.idempotencyKey });
  return runInstrumentedTool(context, toolName, { receiptId: input.receipt.id, idempotencyKey: context.idempotencyKey }, async () => persistExpenseDecision({
    actorId: context.actor.actorId,
    agentRunId: context.agentRunId,
    category: input.classification.category,
    confidence: input.classification.confidence,
    gifiCode: input.gifi.code,
    grossTax: input.itc.grossTax,
    eligibleItc: input.itc.eligibleItc,
    itcPercentage: input.itc.eligibilityPercentage,
    receiptId: input.receipt.id,
    reasonCode: input.shouldReview ? "HUMAN_REVIEW_REQUIRED" : input.itc.reasonCode,
    ruleVersion: getRuleSet(ruleSetId()).version,
    shouldReview: input.shouldReview,
    idempotencyKey: context.idempotencyKey,
  }));
}

export function updateExpenseClassificationTool(context: AgentRunContext, input: PersistToolInput) {
  return persist(context, input, "update_expense_classification");
}

export function requestHumanReviewTool(context: AgentRunContext, input: PersistToolInput) {
  return persist(context, input, "request_human_review");
}
