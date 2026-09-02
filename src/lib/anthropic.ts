/**
 * Compatibility surface for the historic Claude-named callers.
 *
 * All creative text now uses the exact pinned Gemini 3.7 Flash OpenRouter
 * route.  The public function names deliberately remain stable while callers
 * migrate, but direct Anthropic credentials and endpoints are no longer an
 * eligible runtime path.
 */
import { getOrCreateModelResponse, modelRequestCacheKey } from "@/lib/modelUsage";
import {
  hasOpenRouterKey,
  OpenRouterGenerationOutcomeUnknownError,
  openRouterJson,
  openRouterModel,
} from "@/lib/openRouter";

/** @deprecated Kept only for source compatibility; errors are OpenRouter errors. */
export const ClaudeGenerationOutcomeUnknownError = OpenRouterGenerationOutcomeUnknownError;

/** @deprecated Use hasOpenRouterKey in new code. */
export function hasAnthropicKey(): boolean {
  return hasOpenRouterKey();
}

function configuredModel(tier: "flash" | "pro", explicit?: string): string {
  const pinned = openRouterModel(tier === "pro" ? "creative" : "intelligence");
  const requested = explicit?.trim();
  if (requested && requested !== pinned) {
    throw new Error(`claudeJson: ${requested} is not an approved creative-text model; use ${pinned}`);
  }
  return pinned;
}

/** Single-turn structured completion through pinned OpenRouter only. */
export async function claudeJson<T = unknown>(args: {
  prompt: string;
  system?: string;
  model?: string;
  tier?: "flash" | "pro";
  maxTokens?: number;
  temperature?: number;
  log?: (message: string) => void;
  /** An outer, schema-aware caller owns response reuse for this request. */
  memoize?: boolean;
}): Promise<T> {
  const tier = args.tier ?? "flash";
  const maxTokens = Math.max(128, Math.min(tier === "pro" ? 16_000 : 8_000, Math.floor(args.maxTokens ?? 1_200)));
  const model = configuredModel(tier, args.model);
  if (!hasOpenRouterKey()) {
    throw new Error("claudeJson: OPENROUTER_API_KEY is required; direct Anthropic routing is retired");
  }
  const requestKey = modelRequestCacheKey("openrouter", model, {
    prompt: args.prompt,
    system: args.system?.trim() || undefined,
    maxTokens,
    temperature: args.temperature,
    responseFormat: "json",
  });

  return getOrCreateModelResponse(requestKey, {
    provider: "openrouter",
    model,
    kind: "text",
  }, async () => {
    return openRouterJson<T>({
      tier,
      prompt: args.prompt,
      system: args.system,
      model,
      maxTokens,
      temperature: args.temperature,
      log: args.log,
    });
  }, { memoize: args.memoize });
}

export async function claudeJsonPro<T = unknown>(args: Omit<Parameters<typeof claudeJson<T>>[0], "tier">): Promise<T> {
  return claudeJson<T>({ ...args, tier: "pro" });
}

/** Kept as a named script-generation model selector for the existing script seam. */
export function scriptProModel(): string {
  return configuredModel("pro");
}
