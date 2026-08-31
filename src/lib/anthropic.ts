/**
 * Claude JSON completion seam.
 *
 * The historical Claude seam now prefers the pinned, non-Google OpenRouter
 * fleet when it is configured. Keeping the public function names avoids a
 * risky caller-by-caller migration while moving ordinary channel intelligence
 * to GPT-OSS 20B and creative work to Ministral 3 8B.
 */
import {
  getOrCreateModelResponse,
  modelRequestCacheKey,
  recordModelUsage,
} from "@/lib/modelUsage";
import { hasOpenRouterKey, openRouterJson, openRouterModel } from "@/lib/openRouter";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_REQUEST_TIMEOUT_MS = 120_000;

/**
 * A direct Anthropic request has crossed the paid-provider boundary but did
 * not yield a safely usable result. We do not have an idempotency receipt or
 * recovery lookup for this endpoint, so automatic block/task retries must not
 * turn one uncertain outcome into a second billed completion.
 */
export class ClaudeGenerationOutcomeUnknownError extends Error {
  readonly code = "claude_generation_outcome_unknown";
  readonly retryable = false;
  readonly status?: number;

  constructor(detail: string, options?: { status?: number; cause?: unknown }) {
    super(
      `claudeJson: Anthropic generation may already have consumed provider work; refusing automatic replay: ${detail}`,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ClaudeGenerationOutcomeUnknownError";
    if (options?.status !== undefined) this.status = options.status;
  }
}

export function hasAnthropicKey(): boolean {
  return hasOpenRouterKey() || Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

function configuredModel(tier: "flash" | "pro", explicit?: string): string {
  if (hasOpenRouterKey()) return explicit?.trim() || openRouterModel(tier === "pro" ? "creative" : "intelligence");
  if (explicit?.trim()) return explicit.trim();
  if (tier === "pro") {
    return process.env.ANTHROPIC_CREATIVE_PRO_MODEL?.trim()
      || process.env.ANTHROPIC_CREATIVE_MODEL?.trim()
      || "claude-sonnet-4-5-20250929";
  }
  return process.env.ANTHROPIC_CREATIVE_FAST_MODEL?.trim()
    || process.env.ANTHROPIC_CREATIVE_MODEL?.trim()
    || "claude-sonnet-4-5-20250929";
}

function parseStructuredText<T>(text: string): T {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = Math.min(
      ...[trimmed.indexOf("{"), trimmed.indexOf("[")].filter((index) => index >= 0),
    );
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (Number.isFinite(start) && end >= start) return JSON.parse(trimmed.slice(start, end + 1)) as T;
    throw new Error("Claude response did not contain valid JSON");
  }
}

function responseText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => block && typeof block === "object" && (block as { type?: unknown }).type === "text"
      ? [String((block as { text?: unknown }).text ?? "")]
      : [])
    .join("\n")
    .trim();
}

/** Single-turn structured completion; no fallback to Google or any hidden model. */
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
  const viaOpenRouter = hasOpenRouterKey();
  const model = configuredModel(tier, args.model);
  const provider = viaOpenRouter ? "openrouter" : "anthropic";
  const requestKey = modelRequestCacheKey(provider, model, {
    prompt: args.prompt,
    system: args.system?.trim() || undefined,
    maxTokens,
    temperature: args.temperature,
    responseFormat: "json",
  });

  return getOrCreateModelResponse(requestKey, {
    provider,
    model,
    kind: "text",
  }, async () => {
    if (viaOpenRouter) {
      return openRouterJson<T>({
        tier,
        prompt: args.prompt,
        system: args.system,
        model,
        maxTokens,
        temperature: args.temperature,
        log: args.log,
      });
    }
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) throw new Error("claudeJson: OPENROUTER_API_KEY or ANTHROPIC_API_KEY is required; no Gemini fallback is permitted");
    let response: Response;
    try {
      response = await fetch(ANTHROPIC_MESSAGES_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          ...(args.system?.trim() ? { system: args.system.trim() } : {}),
          ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
          messages: [{ role: "user", content: args.prompt }],
        }),
        signal: AbortSignal.timeout(ANTHROPIC_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new ClaudeGenerationOutcomeUnknownError(
        `request transport failed after dispatch (${error instanceof Error ? error.message : String(error)})`,
        { cause: error },
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new ClaudeGenerationOutcomeUnknownError(
        `HTTP ${response.status} response body could not be read`,
        { status: response.status, cause: error },
      );
    }
    if (!response.ok) {
      const message = payload && typeof payload === "object"
        ? String((payload as { error?: { message?: unknown } }).error?.message ?? "Claude request failed")
        : "Claude request failed";
      if (response.status === 408 || response.status >= 500) {
        throw new ClaudeGenerationOutcomeUnknownError(
          `HTTP ${response.status} after request dispatch: ${message.slice(0, 500)}`,
          { status: response.status },
        );
      }
      throw new Error(`claudeJson: HTTP ${response.status}: ${message.slice(0, 500)}`);
    }
    const usage = payload && typeof payload === "object" ? (payload as { usage?: Record<string, unknown> }).usage : undefined;
    recordModelUsage({
      provider: "anthropic",
      model,
      kind: "text",
      requestId: payload && typeof payload === "object" ? String((payload as { id?: unknown }).id ?? "") || undefined : undefined,
      inputTokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined,
      outputTokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined,
    });
    const text = responseText(payload);
    if (!text) {
      throw new ClaudeGenerationOutcomeUnknownError(
        "successful response contained no text block",
        { status: response.status },
      );
    }
    args.log?.(`claudeJson: ${model} returned structured text`);
    try {
      return parseStructuredText<T>(text);
    } catch (error) {
      throw new ClaudeGenerationOutcomeUnknownError(
        "successful response text failed the requested JSON contract",
        { status: response.status, cause: error },
      );
    }
  }, { memoize: args.memoize });
}

export async function claudeJsonPro<T = unknown>(args: Omit<Parameters<typeof claudeJson<T>>[0], "tier">): Promise<T> {
  return claudeJson<T>({ ...args, tier: "pro" });
}

/** Kept as a named script-generation model selector for the existing script seam. */
export function scriptProModel(): string {
  return configuredModel("pro");
}
