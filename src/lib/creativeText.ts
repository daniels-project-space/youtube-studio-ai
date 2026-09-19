/**
 * Canonical structured creative-text boundary.
 *
 * The Studio's approved text route is OpenRouter's pinned Gemini Flash model.
 * This file intentionally names that capability rather than the historic
 * provider it replaced. It owns request coalescing and cost attribution, so
 * modules share one honest, retry-safe boundary.
 */
import { getOrCreateModelResponse, modelRequestCacheKey } from "@/lib/modelUsage";
import {
  hasOpenRouterKey,
  OpenRouterGenerationOutcomeUnknownError,
  openRouterJson,
  openRouterModel,
} from "@/lib/openRouter";

export { OpenRouterGenerationOutcomeUnknownError };

export function hasCreativeTextKey(): boolean {
  return hasOpenRouterKey();
}

function configuredModel(tier: "flash" | "pro", explicit?: string): string {
  const pinned = openRouterModel(tier === "pro" ? "creative" : "intelligence");
  const requested = explicit?.trim();
  if (requested && requested !== pinned) {
    throw new Error(`creativeTextJson: ${requested} is not an approved creative-text model; use ${pinned}`);
  }
  return pinned;
}

/** Single-turn structured completion through the pinned OpenRouter route. */
export async function creativeTextJson<T = unknown>(args: {
  prompt: string;
  system?: string;
  model?: string;
  tier?: "flash" | "pro";
  maxTokens?: number;
  temperature?: number;
  log?: (message: string) => void;
  signal?: AbortSignal;
  /** Admission for a new provider dispatch, never for an already cached response. */
  beforeDispatch?: () => Promise<void>;
  /** An outer, schema-aware caller owns response reuse for this request. */
  memoize?: boolean;
}): Promise<T> {
  const tier = args.tier ?? "flash";
  const maxTokens = Math.max(128, Math.min(tier === "pro" ? 16_000 : 8_000, Math.floor(args.maxTokens ?? 1_200)));
  const model = configuredModel(tier, args.model);
  if (!hasOpenRouterKey()) {
    throw new Error("creativeTextJson: OPENROUTER_API_KEY is required for the approved creative-text route");
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
  }, async () => openRouterJson<T>({
    tier,
    prompt: args.prompt,
    system: args.system,
    model,
    maxTokens,
    temperature: args.temperature,
    log: args.log,
    signal: args.signal,
    beforeDispatch: args.beforeDispatch,
  }), {
    memoize: args.memoize,
    // A caller-owned deadline must never abort a response that another sibling
    // joined. Completed responses remain reusable; cancellation-sensitive
    // in-flight sharing is deliberately disabled.
    coalesceInFlight: args.signal === undefined,
  });
}

export async function creativeTextJsonPro<T = unknown>(
  args: Omit<Parameters<typeof creativeTextJson<T>>[0], "tier">,
): Promise<T> {
  return creativeTextJson<T>({ ...args, tier: "pro" });
}

/** One explicit re-call only when a completed response was unusable JSON. */
export async function retryOnUnusableOutput<T>(
  call: () => Promise<T>,
  onRetry: () => void,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof OpenRouterGenerationOutcomeUnknownError) || error.outcome !== "consumed_unusable") {
      throw error;
    }
    onRetry();
    return call();
  }
}

/** Named selector for long-form script work on the approved creative-text route. */
export function scriptCreativeTextModel(): string {
  return configuredModel("pro");
}

/** @deprecated Use scriptCreativeTextModel; retained for unmigrated callers. */
export function scriptProModel(): string {
  return scriptCreativeTextModel();
}
