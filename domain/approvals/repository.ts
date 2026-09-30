import { and, asc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/db/client";
import { agentRuns, approvals, auditEvents, expenses, gifiCodes, receipts, toolCalls } from "@/db/schema";
import { assertCanResolveApproval, type ActorContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors/domain-error";
import { hashRecord } from "@/lib/security/hashing";
import { assertReceiptTransition } from "@/domain/receipts/state-machine";

export interface PendingApproval {
  id: string;
  receiptId: string;
  receiptNumber: string;
  vendorName: string;
  proposedCategory: string;
  proposedGifiCode: string | null;
  proposedItc: string;
  reason: string;
  createdAt: Date;
}

export async function listPendingApprovals(companyId: string): Promise<PendingApproval[]> {
  const db = getDb();
  const rows = await db.select({
    id: approvals.id,
    receiptId: approvals.receiptId,
    receiptNumber: receipts.receiptNumber,
    vendorName: receipts.vendorName,
    proposedCategory: approvals.proposedCategory,
    proposedGifiCode: approvals.proposedGifiCode,
    proposedItc: approvals.proposedItc,
    reason: approvals.reason,
    createdAt: approvals.createdAt,
  }).from(approvals).innerJoin(receipts, eq(approvals.receiptId, receipts.id)).where(and(eq(receipts.companyId, companyId), eq(approvals.status, "pending"))).orderBy(asc(approvals.createdAt));
  return rows;
}

export async function resolveApproval(actor: ActorContext, approvalId: string, decision: "approve" | "reject", resolutionNotes: string): Promise<{ status: "approved" | "rejected" }> {
  assertCanResolveApproval(actor);
  const db = getDb();
  return db.transaction(async (transaction) => {
    const [approval] = await transaction.select({
      id: approvals.id,
      receiptId: approvals.receiptId,
      proposedCategory: approvals.proposedCategory,
      proposedGifiCode: approvals.proposedGifiCode,
      proposedItc: approvals.proposedItc,
      agentRunId: approvals.agentRunId,
      status: approvals.status,
      companyId: receipts.companyId,
    }).from(approvals).innerJoin(receipts, eq(approvals.receiptId, receipts.id)).where(eq(approvals.id, approvalId)).limit(1);
    if (!approval || approval.companyId !== actor.companyId) {
      throw new DomainError("APPROVAL_NOT_FOUND", "The requested approval is unavailable.", 404);
    }
    if (approval.status !== "pending") {
      throw new DomainError("APPROVAL_ALREADY_RESOLVED", "This approval has already been resolved.", 409);
    }

    if (decision === "approve") {
      if (!approval.proposedGifiCode) {
        throw new DomainError("APPROVAL_REQUIRES_EDIT", "A reviewer cannot approve an unresolved category without an active GIFI mapping.", 422);
      }
      const [gifi] = await transaction.select().from(gifiCodes).where(and(eq(gifiCodes.code, approval.proposedGifiCode), eq(gifiCodes.active, true))).limit(1);
      if (!gifi || !gifi.applicableExpenseTypes.includes(approval.proposedCategory)) {
        throw new DomainError("APPROVAL_INVALID_GIFI", "The proposal fails the controlled GIFI compatibility check.", 422);
      }
      const [receipt] = await transaction.select().from(receipts).where(eq(receipts.id, approval.receiptId)).limit(1);
      if (!receipt) throw new DomainError("RECEIPT_NOT_FOUND", "The receipt is unavailable for this review.", 404);
      assertReceiptTransition(receipt.processingStatus, "processed");
      await transaction.update(expenses).set({ status: "approved", updatedAt: new Date() }).where(eq(expenses.receiptId, approval.receiptId));
      await transaction.update(receipts).set({ processingStatus: "processed", updatedAt: new Date() }).where(eq(receipts.id, approval.receiptId));
    } else {
      const [receipt] = await transaction.select().from(receipts).where(eq(receipts.id, approval.receiptId)).limit(1);
      if (!receipt) throw new DomainError("RECEIPT_NOT_FOUND", "The receipt is unavailable for this review.", 404);
      assertReceiptTransition(receipt.processingStatus, "failed");
      await transaction.update(expenses).set({ status: "rejected", updatedAt: new Date() }).where(eq(expenses.receiptId, approval.receiptId));
      await transaction.update(receipts).set({ processingStatus: "failed", updatedAt: new Date() }).where(eq(receipts.id, approval.receiptId));
    }

    const status = decision === "approve" ? "approved" as const : "rejected" as const;
    const [resolvedApproval] = await transaction.update(approvals).set({ status, resolvedAt: new Date(), resolutionNotes }).where(and(
      eq(approvals.id, approval.id),
      eq(approvals.status, "pending"),
    )).returning({ id: approvals.id });
    if (!resolvedApproval) {
      throw new DomainError("APPROVAL_ALREADY_RESOLVED", "This approval has already been resolved or superseded.", 409);
    }
    await transaction.insert(auditEvents).values({
      id: crypto.randomUUID(),
      agentRunId: approval.agentRunId,
      receiptId: approval.receiptId,
      actor: actor.actorId,
      action: `human_review_${status}`,
      inputHash: hashRecord({ approvalId, decision, resolutionNotes }),
      resultHash: hashRecord({ approvalId, status, proposedGifiCode: approval.proposedGifiCode, proposedItc: approval.proposedItc }),
      ruleVersion: "HUMAN_REVIEW_DECISION",
      status: "success",
      metadata: { approvalId, decision },
    });
    return { status };
  });
}

export async function getReceiptReplay(companyId: string, receiptId: string) {
  const db = getDb();
  const [receipt] = await db.select({ id: receipts.id }).from(receipts).where(and(eq(receipts.id, receiptId), eq(receipts.companyId, companyId))).limit(1);
  if (!receipt) throw new DomainError("RECEIPT_NOT_FOUND", "The requested receipt is unavailable.", 404);
  const runs = await db.select().from(agentRuns).where(eq(agentRuns.receiptId, receiptId)).orderBy(asc(agentRuns.startedAt));
  const runIds = runs.map((run) => run.id);
  const calls = runIds.length === 0 ? [] : await db.select().from(toolCalls).where(inArray(toolCalls.agentRunId, runIds)).orderBy(asc(toolCalls.startedAt));
  const audit = await db.select().from(auditEvents).where(eq(auditEvents.receiptId, receiptId)).orderBy(asc(auditEvents.createdAt));
  return { runs, toolCalls: calls, auditEvents: audit };
}
