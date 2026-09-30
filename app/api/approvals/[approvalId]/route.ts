import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getDemoActor } from "@/lib/auth/context";
import { resolveApproval } from "@/domain/approvals/repository";
import { errorResponse, requestIdFor } from "@/lib/http";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";

const paramsSchema = z.object({ approvalId: z.string().min(1).max(128) });
const resolutionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  resolutionNotes: z.string().trim().min(3).max(1_000),
}).strict();

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ approvalId: string }> }) {
  const requestId = requestIdFor(request.headers.get("x-request-id"));
  try {
    assertTrustedMutationOrigin(request);
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 4_096) return NextResponse.json({ error: { code: "REQUEST_TOO_LARGE", requestId } }, { status: 413 });
    const { approvalId } = paramsSchema.parse(await context.params);
    const body = resolutionSchema.parse(await request.json());
    const result = await resolveApproval(getDemoActor(request), approvalId, body.decision, body.resolutionNotes);
    return NextResponse.json({ result }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
