import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getDemoActor } from "@/lib/auth/context";
import { setSelectedReceipt } from "@/domain/receipts/repository";
import { errorResponse, requestIdFor } from "@/lib/http";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";

const selectionSchema = z.object({ receiptId: z.string().min(1).max(128) }).strict();

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = requestIdFor(request.headers.get("x-request-id"));
  try {
    assertTrustedMutationOrigin(request);
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 4_096) return NextResponse.json({ error: { code: "REQUEST_TOO_LARGE", requestId } }, { status: 413 });
    const input = selectionSchema.parse(await request.json());
    const actor = getDemoActor(request);
    const receipt = await setSelectedReceipt(actor.sessionId, actor.companyId, input.receiptId);
    const response = NextResponse.json({ receipt }, { headers: { "x-request-id": requestId } });
    response.cookies.set("loopnow_session", actor.sessionId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
    return response;
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
