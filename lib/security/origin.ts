import { DomainError } from "@/lib/errors/domain-error";

interface MutationOriginRequest {
  headers: Headers;
  nextUrl: { origin: string };
}

function configuredApplicationOrigin(): string | undefined {
  const value = process.env.APP_ORIGIN?.trim();
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    throw new DomainError("INVALID_APP_ORIGIN", "The server origin configuration is invalid.", 500);
  }
}

/**
 * Browsers attach Origin to the JSON mutation requests made by this app. In
 * production, rejecting an absent or foreign origin blocks cross-site form and
 * fetch requests before any state-changing handler is reached. A configured
 * APP_ORIGIN supports a TLS-terminating reverse proxy.
 */
export function assertTrustedMutationOrigin(request: MutationOriginRequest): void {
  const origin = request.headers.get("origin");
  if (!origin) {
    if (process.env.NODE_ENV === "production") {
      throw new DomainError("MISSING_ORIGIN", "A trusted request origin is required.", 403);
    }
    return;
  }
  const expectedOrigin = configuredApplicationOrigin() ?? request.nextUrl.origin;
  if (origin !== expectedOrigin) {
    throw new DomainError("UNTRUSTED_ORIGIN", "The request origin is not allowed.", 403);
  }
}
