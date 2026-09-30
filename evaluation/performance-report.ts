import "dotenv/config";

import { getDb } from "@/db/client";
import { agentRuns, toolCalls } from "@/db/schema";

import { summarizeRunMetrics } from "./metrics";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to report measured performance.");
  process.exitCode = 1;
} else {
  const db = getDb();
  const [runs, calls] = await Promise.all([
    db.select({
      status: agentRuns.status,
      ttftMs: agentRuns.ttftMs,
      firstToolCallMs: agentRuns.firstToolCallMs,
      totalLatencyMs: agentRuns.totalLatencyMs,
    }).from(agentRuns),
    db.select({
      toolName: toolCalls.toolName,
      status: toolCalls.status,
      latencyMs: toolCalls.latencyMs,
    }).from(toolCalls),
  ]);
  console.info(JSON.stringify(summarizeRunMetrics(runs, calls), null, 2));
  await globalThis.loopnowPool?.end();
  globalThis.loopnowPool = undefined;
}
