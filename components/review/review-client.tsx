"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

interface Approval {
  id: string;
  receiptId: string;
  receiptNumber: string;
  vendorName: string;
  proposedCategory: string;
  proposedGifiCode: string | null;
  proposedItc: string;
  reason: string;
  createdAt: string;
}

export function ReviewClient() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [selected, setSelected] = useState<Approval | null>(null);
  const [notes, setNotes] = useState("Reviewed against supporting documentation.");
  const [gstHstNumber, setGstHstNumber] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/approvals", { cache: "no-store" });
    const body = await response.json() as { approvals?: Approval[]; error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message ?? "Unable to load approvals.");
    setApprovals(body.approvals ?? []);
  }, []);

  useEffect(() => {
    void load().catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Unable to load approvals."));
  }, [load]);

  async function resolve(decision: "approve" | "reject"): Promise<void> {
    if (!selected) return;
    setStatus(null);
    const response = await fetch(`/api/approvals/${selected.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-loopnow-role": "reviewer" },
      body: JSON.stringify({ decision, resolutionNotes: notes }),
    });
    const body = await response.json() as { result?: { status: string }; error?: { message?: string } };
    if (!response.ok) {
      setStatus(body.error?.message ?? "The review could not be resolved.");
      return;
    }
    setStatus(`Review ${body.result?.status ?? "resolved"}.`);
    setSelected(null);
    await load();
  }

  async function submitCorrection(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected) return;
    const body = Object.fromEntries(Object.entries({
      gstHstNumber: gstHstNumber || undefined,
      recipientName: recipientName || undefined,
      paymentTerms: paymentTerms || undefined,
      documentStatus: "available",
    }).filter(([, value]) => value !== undefined));
    const response = await fetch(`/api/receipts/${selected.receiptId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-loopnow-role": "reviewer" },
      body: JSON.stringify(body),
    });
    const responseBody = await response.json() as { error?: { message?: string } };
    if (!response.ok) {
      setStatus(responseBody.error?.message ?? "Documentation could not be updated.");
      return;
    }
    setStatus("Documentation was corrected. Return to the workspace and run the deterministic process again.");
  }

  return (
    <section className="review-grid">
      <aside className="approval-list" aria-label="Pending approvals">
        <p className="surface-label">Pending review</p>
        {approvals.length === 0 ? <p className="muted">No pending approvals.</p> : approvals.map((approval) => (
          <button key={approval.id} type="button" className={`approval-row ${selected?.id === approval.id ? "is-selected" : ""}`} onClick={() => { setSelected(approval); setStatus(null); }}>
            <strong>Receipt {approval.receiptNumber}</strong><span>{approval.vendorName}</span><small>{approval.reason.replaceAll("_", " ")}</small>
          </button>
        ))}
      </aside>
      <section className="review-detail">
        {selected ? <>
          <p className="surface-label">Reviewer decision</p>
          <h2>{selected.vendorName} · Receipt {selected.receiptNumber}</h2>
          <dl className="detail-grid review-summary"><div><dt>Proposed category</dt><dd>{selected.proposedCategory}</dd></div><div><dt>Proposed GIFI</dt><dd>{selected.proposedGifiCode ?? "Unresolved"}</dd></div><div><dt>Proposed ITC</dt><dd>${selected.proposedItc}</dd></div><div><dt>Reason</dt><dd>{selected.reason.replaceAll("_", " ")}</dd></div></dl>
          <label className="form-label" htmlFor="review-notes">Resolution notes</label>
          <textarea id="review-notes" className="review-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
          <div className="review-actions"><button type="button" className="primary-action" onClick={() => void resolve("approve")}>Approve controlled proposal</button><button type="button" className="secondary-action" onClick={() => void resolve("reject")}>Reject</button></div>
          <form className="correction-form" onSubmit={submitCorrection}>
            <p className="surface-label">Edit documentation</p>
            <p className="muted">Only supporting-document fields can be changed here. ITC, tax and GIFI are recalculated server-side after reprocessing.</p>
            <label htmlFor="gst-number">GST/HST number</label><input id="gst-number" value={gstHstNumber} onChange={(event) => setGstHstNumber(event.target.value)} placeholder="123456789RT0001" />
            <label htmlFor="recipient-name">Recipient name</label><input id="recipient-name" value={recipientName} onChange={(event) => setRecipientName(event.target.value)} />
            <label htmlFor="payment-terms">Payment terms</label><input id="payment-terms" value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} />
            <button type="submit" className="secondary-action">Save correction and reprocess</button>
          </form>
        </> : <div className="empty-state"><h2>Select a review item</h2><p>Reviewer actions are authorization-checked, transactionally persisted, and added to the audit trail.</p></div>}
        {status ? <p className="review-status" role="status">{status}</p> : null}
      </section>
    </section>
  );
}
