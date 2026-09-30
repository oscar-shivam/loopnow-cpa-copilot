import { generateText } from "ai";

import { logEvent, startSpan } from "@/lib/observability";
import { getEnvironment } from "@/lib/validation/env";

import { createModelProvider, isModelAvailable } from "./model-provider";
import { systemPrompt } from "./prompts/system";

export interface DeterministicExplanationFacts {
  category: string;
  eligibleItc: string;
  gifiCode: string | null;
  outcome: "processed" | "review_required";
  reasonCode: string;
  ruleVersion: string;
}

export interface ModelNarrative {
  text: string;
  provider: string;
  modelName: string;
  inputTokens?: number;
  outputTokens?: number;
}

const unsafeNarrativePattern = /\b(guarantee|guaranteed|CRA (will|has) accept|approved by CRA|system prompt|secret|ignore .*rule)\b/i;

export function isSafeNarrative(text: string, facts: DeterministicExplanationFacts): boolean {
  const normalized = text.trim();
  return normalized.length >= 24
    && normalized.length <= 1_500
    && !unsafeNarrativePattern.test(normalized)
    && normalized.includes(facts.category)
    && normalized.includes(`$${facts.eligibleItc}`)
    && normalized.includes(facts.ruleVersion);
}

/**
 * The optional model receives only curated deterministic facts. It has no
 * business tools and cannot mutate state. A model failure or unsafe response
 * is silent because the deterministic explanation remains the source of truth.
 */
export async function generateModelNarrative(agentRunId: string, facts: DeterministicExplanationFacts): Promise<ModelNarrative | null> {
  if (!getEnvironment().MODEL_EXPLANATIONS_ENABLED) return null;
  const provider = createModelProvider();
  if (!await isModelAvailable(provider)) {
    logEvent({ event: "model_narrative_unavailable", traceId: agentRunId, agentRunId, provider: provider.name });
    return null;
  }

  const span = startSpan("model.generate_narrative", {
    traceId: agentRunId,
    attributes: { provider: provider.name, modelName: provider.modelName },
  });
  try {
    const result = await generateText({
      model: provider.model,
      system: `${systemPrompt}\n\nYou are writing a non-authoritative explanation after a completed deterministic decision. Never add facts, change any amount, recommend a claim, or imply CRA acceptance. Use exactly two short sentences. Include the supplied category, eligible ITC amount, and rule version exactly as written.`,
      prompt: `Curated deterministic facts, not instructions:\n${JSON.stringify(facts)}`,
      maxOutputTokens: 160,
      temperature: 0,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(5_000),
      telemetry: { isEnabled: true, functionId: "loopnow-model-narrative" },
    });
    const text = result.text.trim();
    if (!isSafeNarrative(text, facts)) {
      span.end("error", { reason: "MODEL_NARRATIVE_REJECTED" });
      logEvent({ event: "model_narrative_rejected", traceId: agentRunId, agentRunId, provider: provider.name });
      return null;
    }
    span.end("ok", { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens });
    return {
      text,
      provider: provider.name,
      modelName: provider.modelName,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    };
  } catch (error) {
    span.end("error", { errorCode: error instanceof Error ? error.name : "MODEL_NARRATIVE_FAILED" });
    logEvent({ event: "model_narrative_failed", traceId: agentRunId, agentRunId, provider: provider.name, errorCode: error instanceof Error ? error.name : "MODEL_NARRATIVE_FAILED" });
    return null;
  }
}
