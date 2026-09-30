import { and, asc, eq, ne } from "drizzle-orm";

import { getDb } from "@/db/client";
import { approvals, auditEvents, idempotencyKeys, receipts, selectedReceiptContexts } from "@/db/schema";
import { DomainError } from "@/lib/errors/domain-error";
import { hashRecord } from "@/lib/security/hashing";
import type { ReceiptRecord } from "@/domain/types";
import { assertReceiptTransition } from "@/domain/receipts/state-machine";

type ReceiptRow = typeof receipts.$inferSelect;

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

export function mapReceipt(row: ReceiptRow): ReceiptRecord {
  return {
    id: row.id,
    companyId: row.companyId,
    receiptNumber: row.receiptNumber,
    vendorName: row.vendorName,
    receiptDate: row.receiptDate,
    description: row.description,
    subtotal: row.subtotal,
    taxAmount: row.taxAmount,
    taxType: row.taxType as ReceiptRecord["taxType"],
    total: row.total,
    gstHstNumber: row.gstHstNumber,
    commercialUsePercentage: row.commercialUsePercentage,
    documentStatus: row.documentStatus,
    processingStatus: row.processingStatus,
    recipientName: metadataString(row.metadata, "recipientName"),
    paymentTerms: metadataString(row.metadata, "paymentTerms"),
  };
}

export async function listCompanyReceipts(companyId: string): Promise<ReceiptRecord[]> {
  const db = getDb();
  const rows = await db.select().from(receipts).where(eq(receipts.companyId, companyId)).orderBy(asc(receipts.receiptDate));
  return rows.map(mapReceipt);
}

export async function getReceiptForCompany(receiptId: string, companyId: string): Promise<ReceiptRecord> {
  const db = getDb();
  const [row] = await db.select().from(receipts).where(and(eq(receipts.id, receiptId), eq(receipts.companyId, companyId))).limit(1);
  if (!row) throw new DomainError("RECEIPT_NOT_FOUND", "The requested receipt is unavailable.", 404);
  return mapReceipt(row);
}

export async function setSelectedReceipt(sessionId: string, companyId: string, receiptId: string): Promise<ReceiptRecord> {
  const receipt = await getReceiptForCompany(receiptId, companyId);
  const db = getDb();
  await db.insert(selectedReceiptContexts).values({ sessionId, companyId, receiptId, updatedAt: new Date() }).onConflictDoUpdate({
    target: [selectedReceiptContexts.sessionId, selectedReceiptContexts.companyId],
    set: { receiptId, updatedAt: new Date() },
  });
  return receipt;
}

export async function getSelectedReceipt(sessionId: string, companyId: string): Promise<ReceiptRecord> {
  const db = getDb();
  const [context] = await db.select().from(selectedReceiptContexts).where(and(eq(selectedReceiptContexts.sessionId, sessionId), eq(selectedReceiptContexts.companyId, companyId))).limit(1);
  if (!context?.receiptId) throw new DomainError("NO_SELECTED_RECEIPT", "Select a receipt before starting processing.", 409);
  return getReceiptForCompany(context.receiptId, companyId);
}

/**
 * Acquires a receipt for one run. It also invalidates any prior unresolved
 * review proposal, so a reviewer can never approve a stale calculation after
 * the receipt has been corrected or reprocessed.
 */
export interface ReceiptProcessingClaim {
  receipt: ReceiptRecord;
  claimed: boolean;
}

export async function claimReceiptForProcessing(actorId: string, companyId: string, receiptId: string, idempotencyKey: string): Promise<ReceiptProcessingClaim> {
  const db = getDb();
  return db.transaction(async (transaction) => {
    const [receipt] = await transaction.select().from(receipts).where(and(eq(receipts.id, receiptId), eq(receipts.companyId, companyId))).limit(1);
    if (!receipt) throw new DomainError("RECEIPT_NOT_FOUND", "The requested receipt is unavailable.", 404);
    const [existingKey] = await transaction.select({ receiptId: idempotencyKeys.receiptId }).from(idempotencyKeys).where(and(
      eq(idempotencyKeys.key, idempotencyKey),
      eq(idempotencyKeys.operation, "persist_expense_decision"),
    )).limit(1);
    if (existingKey) {
      if (existingKey.receiptId !== receiptId) {
        throw new DomainError("IDEMPOTENCY_CONFLICT", "This idempotency key belongs to a different receipt.", 409);
      }
      return { receipt: mapReceipt(receipt), claimed: false };
    }
    if (receipt.processingStatus === "processing") {
      throw new DomainError("RECEIPT_ALREADY_PROCESSING", "This receipt already has an active processing run.", 409);
    }
    assertReceiptTransition(receipt.processingStatus, "processing");
    const now = new Date();
    const [claimed] = await transaction.update(receipts).set({ processingStatus: "processing", updatedAt: now }).where(and(
      eq(receipts.id, receiptId),
      eq(receipts.companyId, companyId),
      ne(receipts.processingStatus, "processing"),
    )).returning({ id: receipts.id });
    if (!claimed) {
      throw new DomainError("RECEIPT_ALREADY_PROCESSING", "This receipt already has an active processing run.", 409);
    }
    const superseded = await transaction.update(approvals).set({
      status: "superseded",
      resolvedAt: now,
      resolutionNotes: "Superseded by a newer deterministic processing run.",
    }).where(and(eq(approvals.receiptId, receiptId), eq(approvals.status, "pending"))).returning({ id: approvals.id });
    await transaction.insert(auditEvents).values({
      id: crypto.randomUUID(),
      receiptId,
      actor: actorId,
      action: "claim_receipt_for_processing",
      inputHash: hashRecord({ receiptId, previousStatus: receipt.processingStatus }),
      resultHash: hashRecord({ receiptId, status: "processing", supersededApprovalIds: superseded.map((approval) => approval.id) }),
      ruleVersion: "RECEIPT_STATE_MACHINE.1",
      status: "success",
      metadata: { previousStatus: receipt.processingStatus, supersededApprovalIds: superseded.map((approval) => approval.id) },
    });
    return { receipt: mapReceipt({ ...receipt, processingStatus: "processing", updatedAt: now }), claimed: true };
  });
}

export async function failReceiptProcessing(actorId: string, companyId: string, receiptId: string, agentRunId: string | null, errorCode: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (transaction) => {
    const [receipt] = await transaction.select().from(receipts).where(and(eq(receipts.id, receiptId), eq(receipts.companyId, companyId))).limit(1);
    if (!receipt || receipt.processingStatus !== "processing") return;
    assertReceiptTransition(receipt.processingStatus, "failed");
    await transaction.update(receipts).set({ processingStatus: "failed", updatedAt: new Date() }).where(eq(receipts.id, receiptId));
    await transaction.insert(auditEvents).values({
      id: crypto.randomUUID(),
      agentRunId,
      receiptId,
      actor: actorId,
      action: "fail_receipt_processing",
      inputHash: hashRecord({ receiptId, errorCode }),
      resultHash: hashRecord({ receiptId, status: "failed" }),
      ruleVersion: "RECEIPT_STATE_MACHINE.1",
      status: "failed",
      metadata: { errorCode },
    });
  });
}
