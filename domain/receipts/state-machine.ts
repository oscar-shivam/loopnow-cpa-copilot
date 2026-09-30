import type { ExpenseProcessingStatus } from "@/domain/types";
import { DomainError } from "@/lib/errors/domain-error";

export type StableReceiptStatus = Exclude<ExpenseProcessingStatus, "processing">;

const transitionTable: Record<ExpenseProcessingStatus, readonly ExpenseProcessingStatus[]> = {
  pending: ["processing"],
  processing: ["processed", "review_required", "failed"],
  processed: ["processing", "pending"],
  review_required: ["processing", "pending", "processed", "failed"],
  failed: ["processing", "pending"],
};

export function canTransitionReceiptStatus(from: ExpenseProcessingStatus, to: ExpenseProcessingStatus): boolean {
  return transitionTable[from].includes(to);
}

export function assertReceiptTransition(from: ExpenseProcessingStatus, to: ExpenseProcessingStatus): void {
  if (!canTransitionReceiptStatus(from, to)) {
    throw new DomainError("INVALID_RECEIPT_TRANSITION", `Receipt transition ${from} -> ${to} is not allowed.`, 409);
  }
}
