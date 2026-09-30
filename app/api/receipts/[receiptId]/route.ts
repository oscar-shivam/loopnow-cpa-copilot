import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getDemoActor } from "@/lib/auth/context";
import { correctReceiptDocumentation } from "@/domain/receipts/documentation-editor";
import { getReceiptForCompany } from "@/domain/receipts/repository";
import { errorResponse, requestIdFor } from "@/lib/http";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";

const paramsSchema = z.object({ receiptId: z.string().min(1).max(128) });
const documentationCorrectionSchema = z.object({
  gstHstNumber: z.string().trim().max(32).nullable().optional(),
  recipientName: z.string().trim().min(1).max(240).optional(),
  paymentTerms: z.string().trim().min(1).max(240).optional(),
  documentStatus: z.enum(["available", "partial"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one documentation field to correct.");

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ receiptId: string }> }) {
  const requestId = requestIdFor(request.headers.get("x-request-id"));
  try {
    const { receiptId } = paramsSchema.parse(await context.params);
    const actor = getDemoActor(request);
    const receipt = await getReceiptForCompany(receiptId, actor.companyId);
    return NextResponse.json({ receipt }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ receiptId: string }> }) {
  const requestId = requestIdFor(request.headers.get("x-request-id"));
  try {
    assertTrustedMutationOrigin(request);
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 4_096) return NextResponse.json({ error: { code: "REQUEST_TOO_LARGE", requestId } }, { status: 413 });
    const { receiptId } = paramsSchema.parse(await context.params);
    const correction = documentationCorrectionSchema.parse(await request.json());
    await correctReceiptDocumentation(getDemoActor(request), receiptId, correction);
    return NextResponse.json({ status: "updated" }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
