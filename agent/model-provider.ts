import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

import { getEnvironment } from "@/lib/validation/env";

export interface ModelProvider {
  name: "ollama" | "openai_compatible";
  modelName: string;
  model: LanguageModel;
  availabilityUrl: string;
}

function withVersionPath(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/, "");
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

export function createModelProvider(): ModelProvider {
  const environment = getEnvironment();
  const isOllama = environment.MODEL_PROVIDER === "ollama";
  const baseURL = isOllama ? withVersionPath(environment.OLLAMA_BASE_URL) : environment.OLLAMA_BASE_URL;
  const provider = createOpenAI({
    name: isOllama ? "ollama-compatible" : "openai-compatible",
    baseURL,
    apiKey: environment.MODEL_API_KEY || "ollama-local-no-key",
  });
  return {
    name: environment.MODEL_PROVIDER,
    modelName: environment.MODEL_NAME,
    model: provider.chat(environment.MODEL_NAME),
    availabilityUrl: isOllama ? `${environment.OLLAMA_BASE_URL.replace(/\/$/, "")}/api/tags` : `${baseURL}/models`,
  };
}

export async function isModelAvailable(provider = createModelProvider()): Promise<boolean> {
  try {
    const response = await fetch(provider.availabilityUrl, { signal: AbortSignal.timeout(2_000), cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

export { withVersionPath };
