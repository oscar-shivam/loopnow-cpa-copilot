export type DocumentationStatus = "sufficient" | "insufficient" | "review";
export type GstHstFormatStatus = "valid_format" | "invalid_format" | "missing" | "malformed" | "suspicious" | "unknown";
export type ItcStatus = "eligible" | "partial" | "ineligible" | "review";
export type ExpenseProcessingStatus = "pending" | "processing" | "processed" | "review_required" | "failed";

export interface ReceiptRecord {
  id: string;
  companyId: string;
  receiptNumber: string;
  vendorName: string;
  receiptDate: Date;
  description: string;
  subtotal: string;
  taxAmount: string;
  taxType: "GST" | "HST" | "NONE";
  total: string;
  gstHstNumber: string | null;
  commercialUsePercentage: string;
  documentStatus: "available" | "missing" | "partial" | "suspicious";
  processingStatus: ExpenseProcessingStatus;
  recipientName?: string | null;
  paymentTerms?: string | null;
}

export interface DocumentationValidationResult {
  status: DocumentationStatus;
  tier: 1 | 2 | 3;
  requiredFields: string[];
  missingFields: string[];
  ruleVersion: string;
  sourceId: string;
  reasonCode: string;
}

export interface GstHstValidationResult {
  status: GstHstFormatStatus;
  normalizedNumber: string | null;
  reasonCode: string;
}

export interface ItcResult {
  grossTax: string;
  eligibilityPercentage: string;
  eligibleItc: string;
  reasonCode: string;
  status: ItcStatus;
}

export interface ClassificationResult {
  category: string;
  confidence: string;
  isExpense: boolean;
  reasonCode: string;
}

export interface GifiAssignmentResult {
  status: "assigned" | "review" | "rejected";
  code: string | null;
  description: string | null;
  reasonCode: string;
}
