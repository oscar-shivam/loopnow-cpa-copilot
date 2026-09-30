import { afterAll, describe, expect, it } from "vitest";

import { processSelectedReceipt } from "@/agent/agent";
import { getReceiptReplay, listPendingApprovals, resolveApproval } from "@/domain/approvals/repository";
import { correctReceiptDocumentation } from "@/domain/receipts/documentation-editor";
import { getReceiptForCompany, getSelectedReceipt, setSelectedReceipt } from "@/domain/receipts/repository";
import type { ActorContext } from "@/lib/auth/context";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeWithDatabase = hasDatabase ? describe : describe.skip;
const companyId = "company_loopnow_demo";

function actor(role: ActorContext["role"], sessionId: string): ActorContext {
  return { actorId: `integration_${role}`, companyId, role, sessionId };
}

async function processReceipt(actorContext: ActorContext, idempotencyKey: string): Promise<string[]> {
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  await processSelectedReceipt(actorContext, idempotencyKey, (event) => events.push(event));
  expect(events.some((event) => event.type === "error")).toBe(false);
  return events.map((event) => event.type);
}

describeWithDatabase("PostgreSQL persistence flow", () => {
  const officeActor = actor("bookkeeper", `integration-office-${crypto.randomUUID()}`);
  const reviewActor = actor("bookkeeper", `integration-review-${crypto.randomUUID()}`);

  it("persists selected context, ordered tool calls, and exactly one financial mutation across an idempotent retry", async () => {
    await setSelectedReceipt(officeActor.sessionId, companyId, "receipt_001");
    await expect(getSelectedReceipt(officeActor.sessionId, companyId)).resolves.toMatchObject({ id: "receipt_001" });

    const before = await getReceiptReplay(companyId, "receipt_001");
    const key = `integration-office-${crypto.randomUUID()}`;
    const firstEvents = await processReceipt(officeActor, key);
    const secondEvents = await processReceipt(officeActor, key);
    const after = await getReceiptReplay(companyId, "receipt_001");

    expect(firstEvents).toContain("complete");
    expect(secondEvents).toContain("complete");
    const addedCalls = after.toolCalls.slice(before.toolCalls.length).map((call) => call.toolName);
    expect(addedCalls).toEqual(expect.arrayContaining([
      "get_current_receipt",
      "validate_cra_documentation",
      "validate_gst_hst_number_format",
      "classify_expense",
      "assign_gifi_code",
      "calculate_eligible_itc",
      "update_expense_classification",
    ]));
    const mutations = after.auditEvents.filter((event) => event.action === "update_expense_classification").length
      - before.auditEvents.filter((event) => event.action === "update_expense_classification").length;
    expect(mutations).toBe(1);
  });

  it("routes missing documentation to review and records the reviewer rejection", async () => {
    await setSelectedReceipt(reviewActor.sessionId, companyId, "receipt_003");
    const events = await processReceipt(reviewActor, `integration-review-${crypto.randomUUID()}`);
    expect(events).toContain("review_required");

    const pending = await listPendingApprovals(companyId);
    const approval = pending.filter((entry) => entry.receiptId === "receipt_003").at(-1);
    expect(approval).toBeDefined();
    await expect(resolveApproval(actor("reviewer", `integration-reviewer-${crypto.randomUUID()}`), approval!.id, "reject", "Evidence remains incomplete.")).resolves.toEqual({ status: "rejected" });

    const replay = await getReceiptReplay(companyId, "receipt_003");
    expect(replay.auditEvents.some((event) => event.action === "human_review_rejected")).toBe(true);
    await expect(getReceiptForCompany("receipt_003", companyId)).resolves.toMatchObject({ processingStatus: "failed" });
  });

  it("retries a review decision without superseding its still-pending approval", async () => {
    const idempotentReviewActor = actor("bookkeeper", `integration-review-retry-${crypto.randomUUID()}`);
    await setSelectedReceipt(idempotentReviewActor.sessionId, companyId, "receipt_015");
    const before = (await listPendingApprovals(companyId)).filter((entry) => entry.receiptId === "receipt_015").length;
    const key = `integration-review-retry-${crypto.randomUUID()}`;
    await expect(processReceipt(idempotentReviewActor, key)).resolves.toContain("review_required");
    await expect(processReceipt(idempotentReviewActor, key)).resolves.toContain("review_required");
    const after = (await listPendingApprovals(companyId)).filter((entry) => entry.receiptId === "receipt_015").length;
    expect(after - before).toBe(1);
    await expect(getReceiptForCompany("receipt_015", companyId)).resolves.toMatchObject({ processingStatus: "review_required" });
  });

  it("supersedes a stale review proposal when documentation is corrected and then reprocessed", async () => {
    const correctionActor = actor("reviewer", `integration-correction-${crypto.randomUUID()}`);
    await setSelectedReceipt(correctionActor.sessionId, companyId, "receipt_011");
    const events = await processReceipt(correctionActor, `integration-malformed-registration-${crypto.randomUUID()}`);
    expect(events).toContain("review_required");

    const pending = await listPendingApprovals(companyId);
    const staleApproval = pending.filter((entry) => entry.receiptId === "receipt_011").at(-1);
    expect(staleApproval).toBeDefined();
    await correctReceiptDocumentation(correctionActor, "receipt_011", {
      gstHstNumber: "123456789RT0001",
      documentStatus: "available",
    });
    await expect(resolveApproval(correctionActor, staleApproval!.id, "approve", "Trying a stale proposal.")).rejects.toMatchObject({ code: "APPROVAL_ALREADY_RESOLVED", status: 409 });
    await expect(getReceiptForCompany("receipt_011", companyId)).resolves.toMatchObject({ processingStatus: "pending" });

    const rerunEvents = await processReceipt(correctionActor, `integration-correction-rerun-${crypto.randomUUID()}`);
    expect(rerunEvents).toContain("complete");
    await expect(getReceiptForCompany("receipt_011", companyId)).resolves.toMatchObject({ processingStatus: "processed" });
    const replay = await getReceiptReplay(companyId, "receipt_011");
    expect(replay.auditEvents.some((event) => event.action === "correct_receipt_documentation")).toBe(true);
  });
});

afterAll(async () => {
  await globalThis.loopnowPool?.end();
  globalThis.loopnowPool = undefined;
});
