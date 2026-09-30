import { NextRequest, NextResponse } from "next/server";

import { getDemoActor } from "@/lib/auth/context";
import { listPendingApprovals } from "@/domain/approvals/repository";
import { errorResponse, requestIdFor } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = requestIdFor(request.headers.get("x-request-id"));
  try {
    const actor = getDemoActor(request);
    const pendingApprovals = await listPendingApprovals(actor.companyId);
    return NextResponse.json({ approvals: pendingApprovals }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
