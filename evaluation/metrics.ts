export interface RunMetricSample {
  status: string;
  ttftMs: number | null;
  firstToolCallMs: number | null;
  totalLatencyMs: number | null;
}

export interface ToolMetricSample {
  toolName: string;
  status: string;
  latencyMs: number | null;
}

interface Distribution {
  count: number;
  minMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(percentileValue * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function distribution(values: Array<number | null>): Distribution {
  const measured = values.filter((value): value is number => value !== null).sort((left, right) => left - right);
  return {
    count: measured.length,
    minMs: measured.at(0) ?? null,
    p50Ms: percentile(measured, 0.5),
    p95Ms: percentile(measured, 0.95),
    maxMs: measured.at(-1) ?? null,
  };
}

function countsBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

export function summarizeRunMetrics(runs: RunMetricSample[], toolCalls: ToolMetricSample[]) {
  const tools = Object.fromEntries(
    [...new Set(toolCalls.map((call) => call.toolName))].sort().map((toolName) => {
      const calls = toolCalls.filter((call) => call.toolName === toolName);
      return [toolName, {
        calls: calls.length,
        outcomes: countsBy(calls.map((call) => call.status)),
        latency: distribution(calls.map((call) => call.latencyMs)),
      }];
    }),
  );
  return {
    generatedAt: new Date().toISOString(),
    runs: {
      total: runs.length,
      outcomes: countsBy(runs.map((run) => run.status)),
      timeToFirstText: distribution(runs.map((run) => run.ttftMs)),
      timeToFirstTool: distribution(runs.map((run) => run.firstToolCallMs)),
      totalLatency: distribution(runs.map((run) => run.totalLatencyMs)),
    },
    tools,
  };
}
