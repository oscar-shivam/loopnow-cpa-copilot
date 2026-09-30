import { NextRequest } from "next/server";

import { DomainError } from "@/lib/errors/domain-error";

export interface ActorContext {
  actorId: string;
  companyId: string;
  role: "bookkeeper" | "reviewer";
  sessionId: string;
}

const demoCompanyId = "company_loopnow_demo";

function demoModeEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.LOOPNOW_DEMO_MODE === "true";
}

/**
 * This is a deliberately constrained local/demo identity. Production fails
 * closed unless an operator explicitly enables demo mode, making it impossible
 * to accidentally expose the seeded tenant as an authenticated production app.
 * Replace this function with verified SSO/session claims before real use.
 */
export function getDemoActor(request?: NextRequest): ActorContext {
  if (!demoModeEnabled()) {
    throw new DomainError("AUTH_NOT_CONFIGURED", "Production authentication is not configured. Configure verified identity before serving bookkeeping data.", 503);
  }
  const requestedRole = request?.headers.get("x-loopnow-role");
  return {
    actorId: "demo_bookkeeper",
    companyId: demoCompanyId,
    role: requestedRole === "reviewer" ? "reviewer" : "bookkeeper",
    sessionId: request?.cookies.get("loopnow_session")?.value ?? "demo_session",
  };
}

export function assertCanResolveApproval(actor: ActorContext): void {
  if (actor.role !== "reviewer") {
    throw new DomainError("FORBIDDEN_APPROVAL_ROLE", "Reviewer authorization is required for this action.", 403);
  }
}
