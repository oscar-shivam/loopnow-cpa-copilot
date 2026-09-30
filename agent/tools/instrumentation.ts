import { eq, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { agentRuns, toolCalls } from "@/db/schema";
import { logEvent, startSpan } from "@/lib/observability";

import type { AgentRunContext } from "../types";

export async function runInstrumentedTool<TInput extends Record<string, unknown>, TResult extends object>(
  context: AgentRunContext,
  toolName: string,
  input: TInput,
  execute: () => Promise<TResult>,
): Promise<TResult> {
  const db = getDb();
  const toolCallId = crypto.randomUUID();
  const startedAt = Date.now();
  const span = startSpan(`tool.${toolName}`, {
    traceId: context.agentRunId,
    attributes: { agentRunId: context.agentRunId, toolCallId, toolName },
  });
  await db.insert(toolCalls).values({ id: toolCallId, agentRunId: context.agentRunId, toolName, input, status: "running" });
  await db.update(agentRuns).set({
    firstToolCallMs: sql`coalesce(${agentRuns.firstToolCallMs}, ${Math.max(0, startedAt - context.runStartedAt)})`,
  }).where(eq(agentRuns.id, context.agentRunId));
  logEvent({ event: "tool_started", traceId: context.agentRunId, agentRunId: context.agentRunId, toolCallId, toolName });
  try {
    const output = await execute();
    const latencyMs = Date.now() - startedAt;
    await db.update(toolCalls).set({ output: JSON.parse(JSON.stringify(output)) as Record<string, unknown>, status: "completed", latencyMs, completedAt: new Date() }).where(eq(toolCalls.id, toolCallId));
    logEvent({ event: "tool_completed", traceId: context.agentRunId, agentRunId: context.agentRunId, toolCallId, toolName, latencyMs });
    span.end("ok", { latencyMs });
    return output;
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const errorCode = error instanceof Error ? error.message : "TOOL_UNKNOWN_ERROR";
    await db.update(toolCalls).set({ status: "failed", latencyMs, errorCode, completedAt: new Date() }).where(eq(toolCalls.id, toolCallId));
    logEvent({ event: "tool_failed", traceId: context.agentRunId, agentRunId: context.agentRunId, toolCallId, toolName, latencyMs, errorCode });
    span.end("error", { latencyMs, errorCode });
    throw error;
  }
}
