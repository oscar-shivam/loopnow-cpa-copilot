import type { ActorContext } from "@/lib/auth/context";

export type ProcessingStage = "reading" | "validating" | "categorizing" | "calculating" | "mapping" | "review" | "complete" | "error";

export interface AgentRunContext {
  actor: ActorContext;
  agentRunId: string;
  idempotencyKey: string;
  receiptId: string;
  runStartedAt: number;
}

export interface StreamEvent {
  type: "run_started" | "stage" | "tool_started" | "tool_completed" | "state_changed" | "text_delta" | "review_required" | "error" | "complete";
  runId: string;
  timestamp: string;
  data: Record<string, unknown>;
}
