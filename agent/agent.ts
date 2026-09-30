import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { agentRuns } from "@/db/schema";
import { DomainError } from "@/lib/errors/domain-error";
import { logEvent, startSpan, type ObservationSpan } from "@/lib/observability";
import type { ActorContext } from "@/lib/auth/context";
import { claimReceiptForProcessing, failReceiptProcessing, getSelectedReceipt } from "@/domain/receipts/repository";
import {
  assignGifiTool,
  calculateItcTool,
  classifyExpenseTool,
  getCurrentReceipt,
  requestHumanReviewTool,
  updateExpenseClassificationTool,
  validateDocumentationTool,
  validateGstHstTool,
} from "@/agent/tools/receipt-tools";
import type { GstHstFormatStatus } from "@/domain/types";
import { generateModelNarrative, type DeterministicExplanationFacts } from "@/agent/explanation";

import type { AgentRunContext, ProcessingStage, StreamEvent } from "./types";

export type EmitEvent = (event: StreamEvent) => void;

function emit(emitEvent: EmitEvent, runId: string, type: StreamEvent["type"], data: Record<string, unknown>): void {
  emitEvent({ type, runId, timestamp: new Date().toISOString(), data });
}

function toolStage(emitEvent: EmitEvent, runId: string, stage: ProcessingStage, label: string): void {
  emit(emitEvent, runId, "stage", { stage, label });
}

async function createAgentRun(receiptId: string): Promise<{ id: string; startedAt: number }> {
  const id = crypto.randomUUID();
  const startedAt = Date.now();
  const db = getDb();
  await db.insert(agentRuns).values({
    id,
    receiptId,
    modelProvider: "deterministic_orchestrator",
    modelName: "rules-first-v1",
    status: "running",
    startedAt: new Date(startedAt),
  });
  return { id, startedAt };
}

async function finishAgentRun(id: string, status: "completed" | "review_required" | "failed", startedAt: number, errorCode?: string): Promise<void> {
  const db = getDb();
  await db.update(agentRuns).set({ status, completedAt: new Date(), totalLatencyMs: Date.now() - startedAt, errorCode }).where(eq(agentRuns.id, id));
}

async function markTimeToFirstText(id: string, startedAt: number): Promise<void> {
  const db = getDb();
  await db.update(agentRuns).set({ ttftMs: Date.now() - startedAt }).where(eq(agentRuns.id, id));
}

async function recordModelNarrative(agentRunId: string, narrative: { provider: string; modelName: string; inputTokens?: number; outputTokens?: number }): Promise<void> {
  const db = getDb();
  await db.update(agentRuns).set({
    modelProvider: narrative.provider,
    modelName: narrative.modelName,
    inputTokens: narrative.inputTokens,
    outputTokens: narrative.outputTokens,
  }).where(eq(agentRuns.id, agentRunId));
}

async function emitOptionalModelNarrative(
  context: AgentRunContext,
  facts: DeterministicExplanationFacts,
  emitEvent: EmitEvent,
): Promise<void> {
  const narrative = await generateModelNarrative(context.agentRunId, facts);
  if (!narrative) return;
  await recordModelNarrative(context.agentRunId, narrative);
  emit(emitEvent, context.agentRunId, "text_delta", { text: `\nAI explanation (non-authoritative): ${narrative.text}\n` });
}

function requiresReview(
  documentationStatus: "sufficient" | "insufficient" | "review",
  gstHstStatus: GstHstFormatStatus,
  isExpense: boolean,
  category: string,
  gifiStatus: "assigned" | "review" | "rejected",
  itcStatus: "eligible" | "partial" | "ineligible" | "review",
): boolean {
  if (!isExpense) return false;
  return documentationStatus !== "sufficient" || gstHstStatus !== "valid_format" || category === "Unknown" || gifiStatus !== "assigned" || itcStatus === "review";
}

export async function processSelectedReceipt(actor: ActorContext, idempotencyKey: string, emitEvent: EmitEvent): Promise<void> {
  const startedAt = Date.now();
  let claimedReceiptId: string | undefined;
  const preliminaryContext: AgentRunContext = { actor, agentRunId: "pending", idempotencyKey, receiptId: "pending", runStartedAt: startedAt };
  let agentRunId = "unavailable";
  let runSpan: ObservationSpan | undefined;
  try {
    const preflightReceipt = await getSelectedReceipt(actor.sessionId, actor.companyId);
    const claim = await claimReceiptForProcessing(actor.actorId, actor.companyId, preflightReceipt.id, idempotencyKey);
    const claimedReceipt = claim.receipt;
    claimedReceiptId = claim.claimed ? claimedReceipt.id : undefined;
    const createdRun = await createAgentRun(claimedReceipt.id);
    agentRunId = createdRun.id;
    const context = { ...preliminaryContext, agentRunId, receiptId: claimedReceipt.id, runStartedAt: createdRun.startedAt };
    runSpan = startSpan("agent.process_selected_receipt", {
      traceId: agentRunId,
      attributes: { receiptId: claimedReceipt.id, idempotencyKeyLength: idempotencyKey.length },
    });
    emit(emitEvent, agentRunId, "run_started", { receiptId: claimedReceipt.id, provider: "deterministic_orchestrator" });
    logEvent({ event: "agent_run_started", agentRunId, receiptId: claimedReceipt.id });

    toolStage(emitEvent, agentRunId, "reading", "Reading selected receipt");
    emit(emitEvent, agentRunId, "tool_started", { toolName: "get_current_receipt" });
    const receipt = await getCurrentReceipt(context);
    emit(emitEvent, agentRunId, "tool_completed", { toolName: "get_current_receipt", receiptId: receipt.id });

    toolStage(emitEvent, agentRunId, "validating", "Validating CRA documentation");
    emit(emitEvent, agentRunId, "tool_started", { toolName: "validate_cra_documentation" });
    const documentation = await validateDocumentationTool(context, receipt);
    emit(emitEvent, agentRunId, "tool_completed", { toolName: "validate_cra_documentation", status: documentation.status, reasonCode: documentation.reasonCode, ruleVersion: documentation.ruleVersion });

    emit(emitEvent, agentRunId, "tool_started", { toolName: "validate_gst_hst_number_format" });
    const gstHst = await validateGstHstTool(context, receipt);
    emit(emitEvent, agentRunId, "tool_completed", { toolName: "validate_gst_hst_number_format", status: gstHst.status, reasonCode: gstHst.reasonCode });

    toolStage(emitEvent, agentRunId, "categorizing", "Classifying expense and mapping GIFI");
    emit(emitEvent, agentRunId, "tool_started", { toolName: "classify_expense" });
    const classification = await classifyExpenseTool(context, receipt);
    emit(emitEvent, agentRunId, "tool_completed", { toolName: "classify_expense", category: classification.category, confidence: classification.confidence });

    emit(emitEvent, agentRunId, "tool_started", { toolName: "assign_gifi_code" });
    const gifi = await assignGifiTool(context, receipt, classification);
    emit(emitEvent, agentRunId, "tool_completed", { toolName: "assign_gifi_code", status: gifi.status, code: gifi.code });

    toolStage(emitEvent, agentRunId, "calculating", "Calculating eligible input tax credit");
    emit(emitEvent, agentRunId, "tool_started", { toolName: "calculate_eligible_itc" });
    const itc = await calculateItcTool(context, receipt, classification, documentation);
    emit(emitEvent, agentRunId, "tool_completed", { toolName: "calculate_eligible_itc", status: itc.status, eligibleItc: itc.eligibleItc, eligibilityPercentage: itc.eligibilityPercentage });

    const shouldReview = requiresReview(documentation.status, gstHst.status, classification.isExpense, classification.category, gifi.status, itc.status);
    if (shouldReview) {
      toolStage(emitEvent, agentRunId, "review", "Routing to human review");
      emit(emitEvent, agentRunId, "tool_started", { toolName: "request_human_review" });
      await requestHumanReviewTool(context, { receipt, classification, gifi, itc, shouldReview });
      emit(emitEvent, agentRunId, "review_required", { receiptId: receipt.id, category: classification.category, gifiCode: gifi.code, eligibleItc: itc.eligibleItc, reason: "A deterministic validation requires human review." });
      await markTimeToFirstText(agentRunId, createdRun.startedAt);
      emit(emitEvent, agentRunId, "text_delta", { text: `This receipt requires human review. Based on the configured policy, no final GST/HST claim is approved automatically.\n` });
      await emitOptionalModelNarrative(context, {
        category: classification.category,
        gifiCode: gifi.code,
        eligibleItc: itc.eligibleItc,
        outcome: "review_required",
        reasonCode: "HUMAN_REVIEW_REQUIRED",
        ruleVersion: documentation.ruleVersion,
      }, emitEvent);
      await finishAgentRun(agentRunId, "review_required", createdRun.startedAt);
      runSpan.end("ok", { outcome: "review_required" });
      return;
    }

    toolStage(emitEvent, agentRunId, "mapping", "Persisting verified classification and audit event");
    emit(emitEvent, agentRunId, "tool_started", { toolName: "update_expense_classification" });
    const persisted = await updateExpenseClassificationTool(context, { receipt, classification, gifi, itc, shouldReview: false });
    emit(emitEvent, agentRunId, "state_changed", { receiptId: receipt.id, processingStatus: "processed", duplicate: persisted.duplicate });
    await markTimeToFirstText(agentRunId, createdRun.startedAt);
    emit(emitEvent, agentRunId, "text_delta", { text: `Based on the configured CRA rule set and the receipt information, ${receipt.vendorName} is classified as ${classification.category} (${gifi.code}). Eligible ITC: $${itc.eligibleItc}. Rule version: ${documentation.ruleVersion}.\n` });
    await emitOptionalModelNarrative(context, {
      category: classification.category,
      gifiCode: gifi.code,
      eligibleItc: itc.eligibleItc,
      outcome: "processed",
      reasonCode: itc.reasonCode,
      ruleVersion: documentation.ruleVersion,
    }, emitEvent);
    toolStage(emitEvent, agentRunId, "complete", "Processing complete");
    await finishAgentRun(agentRunId, "completed", createdRun.startedAt);
    runSpan.end("ok", { outcome: "processed", duplicate: persisted.duplicate });
    emit(emitEvent, agentRunId, "complete", { receiptId: receipt.id, status: "processed" });
  } catch (error) {
    const isDomainError = error instanceof DomainError;
    const errorCode = isDomainError ? error.code : "PROCESSING_FAILED";
    if (agentRunId !== "unavailable") await finishAgentRun(agentRunId, "failed", startedAt, errorCode);
    if (claimedReceiptId) await failReceiptProcessing(actor.actorId, actor.companyId, claimedReceiptId, agentRunId === "unavailable" ? null : agentRunId, errorCode);
    runSpan?.end("error", { errorCode });
    emit(emitEvent, agentRunId, "error", { code: errorCode, message: isDomainError ? error.message : "The processing run could not complete safely." });
  }
}
