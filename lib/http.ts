import { NextResponse } from "next/server";

import { DomainError } from "@/lib/errors/domain-error";

export function errorResponse(error: unknown, requestId: string): NextResponse {
  const known = error instanceof DomainError;
  const status = known ? error.status : 500;
  const code = known ? error.code : "INTERNAL_ERROR";
  const message = known ? error.message : "An unexpected error occurred.";
  return NextResponse.json({ error: { code, message, requestId } }, { status, headers: { "x-request-id": requestId } });
}

export function requestIdFor(value: string | null): string {
  return value && value.length <= 128 ? value : crypto.randomUUID();
}
