import { NextRequest, NextResponse } from "next/server";

import { getDemoActor } from "@/lib/auth/context";
import { listCompanyReceipts } from "@/domain/receipts/repository";
import { errorResponse, requestIdFor } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = requestIdFor(request.headers.get("x-request-id"));
  try {
    const actor = getDemoActor(request);
    const receiptList = await listCompanyReceipts(actor.companyId);
    return NextResponse.json({ receipts: receiptList }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
