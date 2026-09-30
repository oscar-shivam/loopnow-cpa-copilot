"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

interface Receipt {
  id: string;
  receiptNumber: string;
  vendorName: string;
  receiptDate: string;
  description: string;
  subtotal: string;
  taxAmount: string;
  taxType: "GST" | "HST" | "NONE";
  total: string;
  gstHstNumber: string | null;
  commercialUsePercentage: string;
  documentStatus: "available" | "missing" | "partial" | "suspicious";
  processingStatus: "pending" | "processing" | "processed" | "review_required" | "failed";
}

interface AgentEvent {
  type: string;
  runId: string;
  data: Record<string, unknown>;
}

interface ActivityItem {
  id: string;
  label: string;
  detail?: string;
  state: "active" | "complete" | "review" | "error";
}

interface AuditReplay {
  runs: Array<{ id: string; status: string; totalLatencyMs: number | null; ttftMs: number | null; firstToolCallMs: number | null }>;
  toolCalls: Array<{ id: string; toolName: string; status: string; latencyMs: number | null }>;
  auditEvents: Array<{ id: string; action: string; status: string; ruleVersion: string; createdAt: string }>;
}

const defaultMessage = "Process this one and tell me if we can claim the GST.";

function currency(value: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(Number(value));
}

function statusLabel(status: Receipt["processingStatus"]): string {
  return status.replace("_", " ");
}

function eventActivity(event: AgentEvent): ActivityItem | null {
  const toolName = typeof event.data.toolName === "string" ? event.data.toolName : null;
  if (event.type === "stage") {
    return { id: `${event.runId}-${event.type}-${String(event.data.stage)}`, label: String(event.data.label ?? "Processing"), state: "active" };
  }
  if (event.type === "tool_completed" && toolName) {
    const detail = [event.data.status, event.data.category, event.data.code, event.data.eligibleItc ? `$${event.data.eligibleItc}` : undefined].filter(Boolean).join(" · ");
    return { id: `${event.runId}-${toolName}`, label: toolName.replaceAll("_", " "), detail, state: "complete" };
  }
  if (event.type === "review_required") return { id: `${event.runId}-review`, label: "Human review required", detail: "No automatic approval was made", state: "review" };
  if (event.type === "error") return { id: `${event.runId}-error`, label: "Processing stopped", detail: String(event.data.message ?? "Unknown error"), state: "error" };
  return null;
}

async function fetchReceiptList(): Promise<Receipt[]> {
  const response = await fetch("/api/receipts", { cache: "no-store" });
  const body = await response.json() as { receipts?: Receipt[]; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Unable to load receipts.");
  return body.receipts ?? [];
}

async function parseSse(response: Response, onEvent: (event: AgentEvent) => void): Promise<void> {
  if (!response.body) throw new Error("The server did not start a processing stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const messages = buffer.split("\n\n");
    buffer = messages.pop() ?? "";
    for (const message of messages) {
      const dataLine = message.split("\n").find((line) => line.startsWith("data: "));
      if (dataLine) onEvent(JSON.parse(dataLine.slice(6)) as AgentEvent);
    }
    if (done) break;
  }
}

export function DashboardClient() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const [message, setMessage] = useState(defaultMessage);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [explanation, setExplanation] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replay, setReplay] = useState<AuditReplay | null>(null);
  const [isLoadingReplay, setIsLoadingReplay] = useState(false);
  const retryIdempotencyKey = useRef<string | null>(null);

  const selectedReceipt = useMemo(() => receipts.find((receipt) => receipt.id === selectedReceiptId) ?? null, [receipts, selectedReceiptId]);
  const loadReceipts = useCallback(async () => {
    setReceipts(await fetchReceiptList());
  }, []);

  useEffect(() => {
    let active = true;
    void fetchReceiptList().then(
      (initialReceipts) => { if (active) setReceipts(initialReceipts); },
      (loadError: unknown) => { if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load receipts."); },
    );
    return () => { active = false; };
  }, []);

  async function selectReceipt(receiptId: string): Promise<void> {
    setError(null);
    const response = await fetch("/api/receipts/select", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ receiptId }) });
    const body = await response.json() as { error?: { message?: string } };
    if (!response.ok) {
      setError(body.error?.message ?? "Unable to select this receipt.");
      return;
    }
    setSelectedReceiptId(receiptId);
    retryIdempotencyKey.current = crypto.randomUUID();
    setActivity([]);
    setExplanation("");
    setReplay(null);
  }

  async function loadReplay(): Promise<void> {
    if (!selectedReceipt || isLoadingReplay) return;
    setError(null);
    setIsLoadingReplay(true);
    try {
      const response = await fetch(`/api/audit/${selectedReceipt.id}`, { cache: "no-store" });
      const body = await response.json() as { replay?: AuditReplay; error?: { message?: string } };
      if (!response.ok || !body.replay) throw new Error(body.error?.message ?? "Unable to load the audit replay.");
      setReplay(body.replay);
    } catch (replayError) {
      setError(replayError instanceof Error ? replayError.message : "Unable to load the audit replay.");
    } finally {
      setIsLoadingReplay(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedReceipt || isProcessing) return;
    setError(null);
    setActivity([]);
    setExplanation("");
    setIsProcessing(true);
    let agentReportedFailure = false;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, idempotencyKey: retryIdempotencyKey.current ?? (retryIdempotencyKey.current = crypto.randomUUID()) }),
      });
      if (!response.ok) {
        const body = await response.json() as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "Processing could not start.");
      }
      await parseSse(response, (agentEvent) => {
        const item = eventActivity(agentEvent);
        if (item) setActivity((previous) => [...previous.filter((entry) => entry.id !== item.id), item]);
        if (agentEvent.type === "text_delta" && typeof agentEvent.data.text === "string") setExplanation((previous) => previous + agentEvent.data.text);
        if (agentEvent.type === "error") {
          agentReportedFailure = true;
          setError(typeof agentEvent.data.message === "string" ? agentEvent.data.message : "Processing stopped safely. Retry uses the same idempotency key.");
        }
      });
      await loadReceipts();
      if (!agentReportedFailure) retryIdempotencyKey.current = null;
    } catch (processingError) {
      setError(processingError instanceof Error ? processingError.message : "Processing could not complete.");
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">LOOPNOW · CPA COPILOT</p>
          <h1>Expense processing</h1>
        </div>
        <div className="header-actions"><Link href="/review" className="secondary-action">Review queue</Link><div className="rule-indicator"><span aria-hidden="true">●</span> CRA_CURRENT_2026.09</div></div>
      </header>

      {error ? <div className="error-banner" role="alert">{error}</div> : null}

      <section className="workspace-grid" aria-label="Bookkeeping workspace">
        <aside className="queue-panel" aria-label="Receipt queue">
          <div className="panel-heading">
            <div><p className="surface-label">Expense queue</p><h2>{receipts.length} receipts</h2></div>
            <span className="queue-count">{receipts.filter((receipt) => receipt.processingStatus === "review_required").length} review</span>
          </div>
          <div className="receipt-list">
            {receipts.map((receipt) => (
              <button className={`receipt-row ${receipt.id === selectedReceiptId ? "is-selected" : ""}`} type="button" key={receipt.id} onClick={() => void selectReceipt(receipt.id)} aria-pressed={receipt.id === selectedReceiptId}>
                <span className="receipt-row-top"><strong>Receipt {receipt.receiptNumber}</strong><span className={`status-dot status-${receipt.processingStatus}`} aria-label={statusLabel(receipt.processingStatus)} /></span>
                <span>{receipt.vendorName}</span>
                <span className="receipt-row-bottom"><span>{currency(receipt.total)}</span><span>{statusLabel(receipt.processingStatus)}</span></span>
              </button>
            ))}
          </div>
        </aside>

        <section className="detail-panel" aria-live="polite">
          <p className="surface-label">Receipt detail</p>
          {selectedReceipt ? (
            <>
              <div className="receipt-title"><div><h2>{selectedReceipt.vendorName}</h2><p>Receipt {selectedReceipt.receiptNumber} · {new Date(selectedReceipt.receiptDate).toLocaleDateString("en-CA", { dateStyle: "medium" })}</p></div><span className={`status-chip status-${selectedReceipt.processingStatus}`}>{statusLabel(selectedReceipt.processingStatus)}</span></div>
              <div className="money-total">{currency(selectedReceipt.total)}</div>
              <dl className="detail-grid">
                <div><dt>Subtotal</dt><dd>{currency(selectedReceipt.subtotal)}</dd></div>
                <div><dt>{selectedReceipt.taxType}</dt><dd>{currency(selectedReceipt.taxAmount)}</dd></div>
                <div><dt>Commercial use</dt><dd>{selectedReceipt.commercialUsePercentage}%</dd></div>
                <div><dt>GST/HST no.</dt><dd>{selectedReceipt.gstHstNumber ?? "Not supplied"}</dd></div>
              </dl>
              <div className="receipt-description"><p className="surface-label">Untrusted receipt data</p><p>{selectedReceipt.description}</p></div>
              <div className="policy-note">Final eligibility is calculated by server-side policy rules. Receipt text and chat instructions cannot override that policy.</div>
              <div className="replay-panel">
                <div className="panel-heading"><div><p className="surface-label">Audit replay</p><p className="muted">Persisted runs, tool timing and immutable decision events.</p></div><button type="button" className="secondary-action" onClick={() => void loadReplay()} disabled={isLoadingReplay}>{isLoadingReplay ? "Loading…" : "Load replay"}</button></div>
                {replay ? <div className="replay-timeline" aria-live="polite">
                  {replay.runs.map((run) => <div className="replay-item" key={run.id}><strong>Run {run.id.slice(0, 8)}</strong><small>{run.status} · {run.totalLatencyMs ?? "—"}ms total · {run.firstToolCallMs ?? "—"}ms first tool · {run.ttftMs ?? "—"}ms first text</small></div>)}
                  {replay.toolCalls.map((call) => <div className="replay-item" key={call.id}><strong>{call.toolName.replaceAll("_", " ")}</strong><small>{call.status} · {call.latencyMs ?? "—"}ms</small></div>)}
                  {replay.auditEvents.map((event) => <div className="replay-item" key={event.id}><strong>{event.action.replaceAll("_", " ")}</strong><small>{event.status} · {event.ruleVersion}</small></div>)}
                  {replay.runs.length + replay.toolCalls.length + replay.auditEvents.length === 0 ? <p className="muted">No persisted activity exists for this receipt yet.</p> : null}
                </div> : null}
              </div>
            </>
          ) : <div className="empty-state"><h2>Select a receipt</h2><p>Choose an item from the queue. The selected context is synchronised with the server before processing begins.</p></div>}
        </section>

        <aside className="copilot-panel" aria-label="AI Copilot">
          <div className="panel-heading"><div><p className="surface-label">AI Copilot</p><h2>Run activity</h2></div><span className={isProcessing ? "live-indicator" : ""}>{isProcessing ? "Working" : "Ready"}</span></div>
          <div className="activity-list" aria-live="polite" aria-label="Agent activity">
            {activity.length === 0 ? <p className="muted">Select a receipt, then ask the copilot to process it.</p> : activity.map((item) => <div className={`activity-item ${item.state}`} key={item.id}><span aria-hidden="true">{item.state === "complete" ? "✓" : item.state === "review" ? "!" : item.state === "error" ? "×" : "·"}</span><div><strong>{item.label}</strong>{item.detail ? <small>{item.detail}</small> : null}</div></div>)}
          </div>
          {explanation ? <div className="explanation"><p className="surface-label">Result</p><p>{explanation}</p></div> : null}
          <form className="copilot-form" onSubmit={submit}>
            <label htmlFor="copilot-message">Message</label>
            <textarea id="copilot-message" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={4000} disabled={!selectedReceipt || isProcessing} />
            <button className="primary-action" type="submit" disabled={!selectedReceipt || isProcessing}>{isProcessing ? "Processing…" : "Process selected receipt"}</button>
          </form>
        </aside>
      </section>
    </main>
  );
}
