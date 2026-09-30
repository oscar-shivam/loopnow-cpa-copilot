export interface LogFields {
  requestId?: string;
  agentRunId?: string;
  receiptId?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  event: string;
  [key: string]: unknown;
}

export function logEvent(fields: LogFields): void {
  console.info(JSON.stringify({ timestamp: new Date().toISOString(), ...fields }));
}

/**
 * Structured spans use OpenTelemetry's trace/span vocabulary so JSON logs can
 * be bridged to an OTEL collector without changing business code. No exporter
 * is enabled until the deployment supplies one; this avoids claiming telemetry
 * delivery that this prototype has not configured.
 */
export interface ObservationSpan {
  traceId: string;
  spanId: string;
  end: (status: "ok" | "error", attributes?: Record<string, unknown>) => void;
}

export function startSpan(name: string, options: {
  traceId?: string;
  parentSpanId?: string;
  attributes?: Record<string, unknown>;
} = {}): ObservationSpan {
  const traceId = options.traceId ?? crypto.randomUUID();
  const spanId = crypto.randomUUID();
  const startedAt = performance.now();
  logEvent({ event: "span_started", name, traceId, spanId, parentSpanId: options.parentSpanId, attributes: options.attributes });
  return {
    traceId,
    spanId,
    end(status, attributes = {}) {
      logEvent({
        event: "span_completed",
        name,
        traceId,
        spanId,
        parentSpanId: options.parentSpanId,
        status,
        durationMs: Math.round(performance.now() - startedAt),
        attributes,
      });
    },
  };
}
