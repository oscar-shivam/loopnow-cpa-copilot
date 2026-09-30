import { and, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { approvals, auditEvents, expenses, gifiCodes, idempotencyKeys, receipts } from "@/db/schema";
import { DomainError } from "@/lib/errors/domain-error";
import { hashRecord } from "@/lib/security/hashing";
import { assertReceiptTransition } from "@/domain/receipts/state-machine";

interface PersistDecisionInput {
  actorId: string;
  agentRunId: string;
  category: string;
  confidence: string;
  gifiCode: string | null;
  grossTax: string;
  eligibleItc: string;
  itcPercentage: string;
  receiptId: string;
  reasonCode: string;
  ruleVersion: string;
  shouldReview: boolean;
  idempotencyKey: string;
}

interface PersistDecisionResult {
  duplicate: boolean;
  status: "approved" | "review_required";
}

async function assertActiveCompatibleGifi(gifiCode: string, category: string): Promise<void> {
  const db = getDb();
  const [gifi] = await db.select().from(gifiCodes).where(and(eq(gifiCodes.code, gifiCode), eq(gifiCodes.active, true))).limit(1);
  if (!gifi || !gifi.applicableExpenseTypes.includes(category)) {
    throw new DomainError("INVALID_GIFI_ASSIGNMENT", "The proposed GIFI code is not active or compatible with the category.", 422);
  }
}

export async function persistExpenseDecision(input: PersistDecisionInput): Promise<PersistDecisionResult> {
  if (input.gifiCode) await assertActiveCompatibleGifi(input.gifiCode, input.category);
  const db = getDb();
  const status = input.shouldReview ? "review_required" as const : "approved" as const;
  const result = { receiptId: input.receiptId, status, category: input.category, gifiCode: input.gifiCode, eligibleItc: input.eligibleItc };
  const resultHash = hashRecord(result);
  const now = new Date();

  return db.transaction(async (transaction) => {
    const claimed = await transaction.insert(idempotencyKeys).values({
      id: crypto.randomUUID(), key: input.idempotencyKey, operation: "persist_expense_decision", receiptId: input.receiptId,
      resultHash, status: "completed", expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    }).onConflictDoNothing().returning({ resultHash: idempotencyKeys.resultHash });

    if (claimed.length === 0) {
      const [savedKey] = await transaction.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.key, input.idempotencyKey), eq(idempotencyKeys.operation, "persist_expense_decision"))).limit(1);
      if (!savedKey || savedKey.resultHash !== resultHash) {
        throw new DomainError("IDEMPOTENCY_CONFLICT", "A conflicting processing request already exists.", 409);
      }
      const [receipt] = await transaction.select().from(receipts).where(eq(receipts.id, input.receiptId)).limit(1);
      if (!receipt) throw new DomainError("RECEIPT_NOT_FOUND", "The receipt is unavailable for this decision.", 404);
      if (receipt.processingStatus === "processing") {
        assertReceiptTransition(receipt.processingStatus, input.shouldReview ? "review_required" : "processed");
        await transaction.update(receipts).set({ processingStatus: input.shouldReview ? "review_required" : "processed", updatedAt: now }).where(eq(receipts.id, input.receiptId));
      }
      return { duplicate: true, status };
    }

    const [receipt] = await transaction.select().from(receipts).where(eq(receipts.id, input.receiptId)).limit(1);
    if (!receipt) throw new DomainError("RECEIPT_NOT_FOUND", "The receipt is unavailable for this decision.", 404);
    if (receipt.processingStatus !== "processing") {
      throw new DomainError("RECEIPT_NOT_CLAIMED", "The receipt must have an active processing run before it can be updated.", 409);
    }
    assertReceiptTransition(receipt.processingStatus, input.shouldReview ? "review_required" : "processed");

    await transaction.insert(expenses).values({
      id: crypto.randomUUID(), receiptId: input.receiptId, category: input.category, gifiCode: input.gifiCode,
      classificationConfidence: input.confidence, itcPercentage: input.itcPercentage, grossTax: input.grossTax,
      eligibleItc: input.eligibleItc, status, reasonCode: input.reasonCode, ruleVersion: input.ruleVersion,
    }).onConflictDoUpdate({
      target: expenses.receiptId,
      set: { category: input.category, gifiCode: input.gifiCode, classificationConfidence: input.confidence, itcPercentage: input.itcPercentage, grossTax: input.grossTax, eligibleItc: input.eligibleItc, status, reasonCode: input.reasonCode, ruleVersion: input.ruleVersion, updatedAt: now },
    });

    const [updatedReceipt] = await transaction.update(receipts).set({ processingStatus: input.shouldReview ? "review_required" : "processed", updatedAt: now }).where(and(
      eq(receipts.id, input.receiptId),
      eq(receipts.processingStatus, "processing"),
    )).returning({ id: receipts.id });
    if (!updatedReceipt) {
      throw new DomainError("RECEIPT_STATE_CONFLICT", "The receipt state changed before the decision could be persisted.", 409);
    }
    if (input.shouldReview) {
      await transaction.insert(approvals).values({
        id: crypto.randomUUID(), receiptId: input.receiptId, agentRunId: input.agentRunId, proposedCategory: input.category,
        proposedGifiCode: input.gifiCode, proposedItc: input.eligibleItc, reason: input.reasonCode, createdBy: input.actorId,
      });
    }
    await transaction.insert(auditEvents).values({
      id: crypto.randomUUID(), agentRunId: input.agentRunId, receiptId: input.receiptId, actor: input.actorId,
      action: input.shouldReview ? "request_human_review" : "update_expense_classification", inputHash: hashRecord(input), resultHash,
      ruleVersion: input.ruleVersion, status: "success", metadata: { status, category: input.category, gifiCode: input.gifiCode },
    });
    return { duplicate: false, status };
  });
}
