import { NextRequest } from "next/server";
import { z } from "zod";

import { processSelectedReceipt } from "@/agent/agent";
import { getDemoActor } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors/domain-error";
import { requestIdFor } from "@/lib/http";
import { logEvent } from "@/lib/observability";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const chatSchema = z.object({
  message: z.string().min(1).max(4_000),
  idempotencyKey: z.string().min(16).max(256).optional(),
}).strict();

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sse(type: string, payload: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export async function POST(request: NextRequest) {
  const requestId = requestIdFor(request.headers.get("x-request-id"));
  try {
    assertTrustedMutationOrigin(request);
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 8_192) throw new DomainError("REQUEST_TOO_LARGE", "The request is too large.", 413);
    const input = chatSchema.parse(await request.json());
    const actor = getDemoActor(request);
    enforceRateLimit(`${actor.actorId}:${actor.sessionId}`);
    const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        processSelectedReceipt(actor, idempotencyKey, (event) => controller.enqueue(sse(event.type, event))).then(
          () => controller.close(),
          () => controller.close(),
        );
      },
    });
    logEvent({ event: "chat_processing_requested", requestId, actorId: actor.actorId });
    return new Response(stream, {
      headers: {
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
        "x-accel-buffering": "no",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    const known = error instanceof DomainError;
    const status = known ? error.status : 400;
    return Response.json({ error: { code: known ? error.code : "INVALID_REQUEST", message: known ? error.message : "Invalid request.", requestId } }, { status, headers: { "x-request-id": requestId } });
  }
}
