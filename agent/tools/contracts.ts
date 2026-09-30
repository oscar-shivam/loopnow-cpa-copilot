import { z } from "zod";

export const receiptIdSchema = z.object({ receiptId: z.string().min(1).max(128) }).strict();
export const currentReceiptSchema = z.object({}).strict();
export const idempotencyKeySchema = z.string().min(16).max(256);

export const updateDecisionSchema = z.object({
  receiptId: z.string().min(1).max(128),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const currentReceiptResultSchema = z.object({
  id: z.string(), receiptNumber: z.string(), vendorName: z.string(), description: z.string(), total: z.string(), processingStatus: z.string(),
}).strict();

export const processingStatusResultSchema = z.object({
  receiptId: z.string(), processingStatus: z.string(),
}).strict();
