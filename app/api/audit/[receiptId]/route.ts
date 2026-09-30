import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getDemoActor } from "@/lib/auth/context";
import { getReceiptReplay } from "@/domain/approvals/repository";
import { errorResponse, requestIdFor } from "@/lib/http";

const paramsSchema = z.object({ receiptId: z.string().min(1).max(128) });

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ receiptId: string }> }) {
  const requestId = requestIdFor(request.headers.get("x-request-id"));
  try {
    const { receiptId } = paramsSchema.parse(await context.params);
    const replay = await getReceiptReplay(getDemoActor(request).companyId, receiptId);
    return NextResponse.json({ replay }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
