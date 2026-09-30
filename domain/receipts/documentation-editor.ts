import { and, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { approvals, auditEvents, expenses, receipts } from "@/db/schema";
import { assertCanResolveApproval, type ActorContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors/domain-error";
import { hashRecord } from "@/lib/security/hashing";
import { assertReceiptTransition } from "@/domain/receipts/state-machine";

export interface DocumentationCorrection {
  gstHstNumber?: string | null;
  recipientName?: string;
  paymentTerms?: string;
  documentStatus?: "available" | "partial";
}

export async function correctReceiptDocumentation(actor: ActorContext, receiptId: string, correction: DocumentationCorrection): Promise<void> {
  assertCanResolveApproval(actor);
  const db = getDb();
  const [receipt] = await db.select().from(receipts).where(and(eq(receipts.id, receiptId), eq(receipts.companyId, actor.companyId))).limit(1);
  if (!receipt) throw new DomainError("RECEIPT_NOT_FOUND", "The requested receipt is unavailable.", 404);
  const metadata = {
    ...receipt.metadata,
    ...(correction.recipientName !== undefined ? { recipientName: correction.recipientName } : {}),
    ...(correction.paymentTerms !== undefined ? { paymentTerms: correction.paymentTerms } : {}),
  };
  const next = {
    gstHstNumber: correction.gstHstNumber === undefined ? receipt.gstHstNumber : correction.gstHstNumber,
    documentStatus: correction.documentStatus ?? receipt.documentStatus,
    metadata,
  };
  await db.transaction(async (transaction) => {
    assertReceiptTransition(receipt.processingStatus, "pending");
    const now = new Date();
    const superseded = await transaction.update(approvals).set({
      status: "superseded",
      resolvedAt: now,
      resolutionNotes: "Superseded by a documentation correction.",
    }).where(and(eq(approvals.receiptId, receiptId), eq(approvals.status, "pending"))).returning({ id: approvals.id });
    await transaction.update(expenses).set({ status: "proposed", updatedAt: now }).where(eq(expenses.receiptId, receiptId));
    const [updatedReceipt] = await transaction.update(receipts).set({
      ...next,
      processingStatus: "pending",
      updatedAt: now,
    }).where(and(eq(receipts.id, receiptId), eq(receipts.processingStatus, receipt.processingStatus))).returning({ id: receipts.id });
    if (!updatedReceipt) {
      throw new DomainError("RECEIPT_STATE_CONFLICT", "The receipt changed before the documentation correction could be saved.", 409);
    }
    await transaction.insert(auditEvents).values({
      id: crypto.randomUUID(), receiptId, actor: actor.actorId, action: "correct_receipt_documentation",
      inputHash: hashRecord(correction), resultHash: hashRecord(next), ruleVersion: "DOCUMENTATION_CORRECTION",
      status: "success", metadata: { correctedFields: Object.keys(correction), supersededApprovalIds: superseded.map((approval) => approval.id) },
    });
  });
}
