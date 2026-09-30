import { describe, expect, it } from "vitest";

import { summarizeRunMetrics } from "@/evaluation/metrics";

describe("measured performance summary", () => {
  it("calculates outcome counts and latency percentiles without fabricating values", () => {
    const report = summarizeRunMetrics([
      { status: "completed", ttftMs: 10, firstToolCallMs: 5, totalLatencyMs: 100 },
      { status: "review_required", ttftMs: 20, firstToolCallMs: 7, totalLatencyMs: 200 },
      { status: "failed", ttftMs: null, firstToolCallMs: null, totalLatencyMs: 300 },
    ], [
      { toolName: "classify_expense", status: "completed", latencyMs: 8 },
      { toolName: "classify_expense", status: "completed", latencyMs: 10 },
      { toolName: "validate_cra_documentation", status: "completed", latencyMs: 4 },
    ]);

    expect(report.runs).toMatchObject({
      total: 3,
      outcomes: { completed: 1, review_required: 1, failed: 1 },
      timeToFirstText: { count: 2, p50Ms: 10, p95Ms: 20 },
      totalLatency: { count: 3, p50Ms: 200, p95Ms: 300 },
    });
    expect(report.tools).toMatchObject({
      classify_expense: { calls: 2, outcomes: { completed: 2 }, latency: { p50Ms: 8, p95Ms: 10 } },
      validate_cra_documentation: { calls: 1, latency: { p50Ms: 4 } },
    });
  });
});
