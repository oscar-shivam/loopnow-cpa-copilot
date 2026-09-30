import { z } from "zod";

const environmentSchema = z.object({
  APP_ORIGIN: z.string().url().optional(),
  CRA_RULESET_VERSION: z.enum(["assessment_legacy_30_150", "cra_current_2026"]).default("cra_current_2026"),
  DATABASE_URL: z.string().url().optional(),
  MODEL_API_KEY: z.string().optional(),
  MODEL_EXPLANATIONS_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  MODEL_NAME: z.string().min(1).default("qwen3:4b"),
  MODEL_PROVIDER: z.enum(["ollama", "openai_compatible"]).default("ollama"),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
});

export type RuntimeEnvironment = z.infer<typeof environmentSchema>;

export function getEnvironment(): RuntimeEnvironment {
  return environmentSchema.parse({
    APP_ORIGIN: process.env.APP_ORIGIN,
    CRA_RULESET_VERSION: process.env.CRA_RULESET_VERSION,
    DATABASE_URL: process.env.DATABASE_URL,
    MODEL_API_KEY: process.env.MODEL_API_KEY,
    MODEL_EXPLANATIONS_ENABLED: process.env.MODEL_EXPLANATIONS_ENABLED,
    MODEL_NAME: process.env.MODEL_NAME,
    MODEL_PROVIDER: process.env.MODEL_PROVIDER,
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
  });
}
