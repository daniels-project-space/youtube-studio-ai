/**
 * Pinned OpenRouter boundary for the YouTube factory.
 *
 * The router is deliberately model- and provider-pinned to Gemini 3.7 Flash
 * through OpenRouter. Nano Banana image generation remains a separate Fal
 * boundary and does not pass through this text/vision client.
 */
import { recordModelUsage } from "@/lib/modelUsage";
import type { ModelCallKind } from "@/lib/modelUsage";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
// Final multimodal receipts can take longer than lightweight planning calls.
// These bounded limits allow the pinned reviewer to finish one operational
// batch without turning a slow body into a synthetic "no text" outcome.
const OPENROUTER_REQUEST_TIMEOUT_MS = 180_000;
// A final reviewer can return headers before its constrained JSON body is
// ready. Four minutes previously aborted a real two-frame response after
// an HTTP 200; six minutes remains a hard bound while allowing the admitted
// model to finish a complete receipt instead of manufacturing a false failure.
const OPENROUTER_RESPONSE_BODY_TIMEOUT_MS = 360_000;

/**
 * The router accepted a request boundary but did not produce a safely usable
 * result. Its endpoint has no durable caller-visible receipt/recovery lookup,
 * so retries here could buy the same completion twice.
 */
export class OpenRouterGenerationOutcomeUnknownError extends Error {
  readonly code = "openrouter_generation_outcome_unknown";
  readonly retryable = false;
  readonly status?: number;
  /**
   * Whether provider work is KNOWN to have been consumed, or merely might have
   * been. The distinction matters to a caller deciding whether to call again.
   *
   * "unknown"           transport died, the body was unreadable, an HTTP error
   *                     arrived after dispatch, or a 2xx carried no text. It is
   *                     genuinely unclear what the provider did, so replaying
   *                     could silently buy the same generation twice.
   * "consumed_unusable" a complete response arrived and its text was not valid
   *                     JSON. There is no ambiguity here: the generation ran, it
   *                     was billed, and the output cannot be used. Calling again
   *                     is a second deliberate purchase, not a blind replay —
   *                     which is a cost decision only the caller can make.
   *
   * `retryable` stays false for both: it governs AUTOMATIC replay inside this
   * client, which neither case permits.
   */
  readonly outcome: "unknown" | "consumed_unusable";

  constructor(detail: string, options?: { status?: number; cause?: unknown; outcome?: "unknown" | "consumed_unusable" }) {
    super(
      `openRouter: generation may already have consumed provider work; refusing automatic replay: ${detail}`,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "OpenRouterGenerationOutcomeUnknownError";
    this.outcome = options?.outcome ?? "unknown";
    if (options?.status !== undefined) this.status = options.status;
  }
}

export const OPENROUTER_MODELS = {
  intelligence: "google/gemini-3.7-flash",
  creative: "google/gemini-3.7-flash",
  visionBulk: "google/gemini-3.7-flash",
  visionStandard: "google/gemini-3.7-flash",
  visionFinal: "google/gemini-3.7-flash",
} as const;

export type OpenRouterModelKey = keyof typeof OPENROUTER_MODELS;

type OpenRouterMessage = {
  role: "system" | "user";
  content: unknown;
};

export type OpenRouterProviderPreferences = {
  only: string[];
  allow_fallbacks: boolean;
  require_parameters: true;
  data_collection: "deny";
};

const PROVIDERS: Record<string, OpenRouterProviderPreferences> = {
  "google/gemini-3.7-flash": {
    only: ["google-ai-studio", "google-vertex"],
    allow_fallbacks: true,
    require_parameters: true,
    data_collection: "deny",
  },
  "mistralai/ministral-3b-2512": {
    only: ["mistral"],
    allow_fallbacks: false,
    require_parameters: true,
    data_collection: "deny",
  },
  "mistralai/ministral-8b-2512": {
    only: ["mistral"],
    allow_fallbacks: false,
    require_parameters: true,
    data_collection: "deny",
  },
};

function assertNoOpenAiModel(model: string): void {
  // A Codex subscription is not a deployable application credential. The
  // Studio therefore uses its explicitly approved non-OpenAI provider routes
  // only, and must fail closed if an environment override tries to reintroduce
  // an OpenAI-branded hosted model through OpenRouter.
  if (/^openai\//i.test(model.trim())) {
    throw new Error(`OpenRouter ${model} is prohibited: Studio runtime must not use OpenAI API models`);
  }
}

function configured(key: OpenRouterModelKey): string {
  const envKey = `OPENROUTER_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}_MODEL`;
  const model = process.env[envKey]?.trim() || OPENROUTER_MODELS[key];
  assertNoOpenAiModel(model);
  if (!PROVIDERS[model]) {
    throw new Error(`OpenRouter ${key} model is not an approved pinned route: ${model}`);
  }
  return model;
}

export function openRouterModel(key: OpenRouterModelKey): string {
  return configured(key);
}

export function hasOpenRouterKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

function parseJson<T>(text: string): T {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = Math.min(...[trimmed.indexOf("{"), trimmed.indexOf("[")].filter((index) => index >= 0));
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (Number.isFinite(start) && end >= start) return JSON.parse(trimmed.slice(start, end + 1)) as T;
    throw new Error("OpenRouter response did not contain valid JSON");
  }
}

function responseText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const choice = (value as { choices?: unknown[] }).choices?.[0];
  if (!choice || typeof choice !== "object") return "";
  const content = (choice as { message?: { content?: unknown } }).message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
      ? [(part as { text: string }).text]
      : [])
    .join("\n")
    .trim();
}

/**
 * Fraction of the ceiling that reasoning may consume before a call site is
 * warned. Chosen from the measured failures: the compliance call died at 94%
 * (189/200) and the advisors at similar shares, while healthy calls in this
 * codebase sit far below. 0.6 leaves real headroom for the answer and still
 * fires well before the contract breaks.
 */
const REASONING_STARVATION_RATIO = 0.6;

export async function openRouterChat(args: {
  model: string;
  messages: OpenRouterMessage[];
  maxTokens: number;
  temperature?: number;
  json?: boolean;
  kind?: ModelCallKind;
  log?: (message: string) => void;
}): Promise<string> {
  assertNoOpenAiModel(args.model);
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new Error("OpenRouter requires OPENROUTER_API_KEY");
  const provider = PROVIDERS[args.model];
  if (!provider) throw new Error(`OpenRouter model is not an approved pinned route: ${args.model}`);
  const controller = new AbortController();
  const requestDeadline = setTimeout(() => controller.abort(), OPENROUTER_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: args.model,
        messages: args.messages,
        max_tokens: args.maxTokens,
        ...(args.temperature === undefined ? {} : { temperature: args.temperature }),
        ...(args.json ? { response_format: { type: "json_object" } } : {}),
        provider,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new OpenRouterGenerationOutcomeUnknownError(
      `request transport failed after dispatch (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    );
  } finally {
    // fetch() resolves when response headers arrive. Do not let a request
    // deadline abort a valid, still-streaming structured body after headers.
    clearTimeout(requestDeadline);
  }
  let payload: unknown;
  const bodyDeadline = setTimeout(() => controller.abort(), OPENROUTER_RESPONSE_BODY_TIMEOUT_MS);
  try {
    payload = await response.json();
  } catch (error) {
    const detail = error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error);
    throw new OpenRouterGenerationOutcomeUnknownError(
      `HTTP ${response.status} response body could not be read (${detail.slice(0, 300)})`,
      { status: response.status, cause: error },
    );
  } finally {
    clearTimeout(bodyDeadline);
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object"
      ? String((payload as { error?: { message?: unknown } }).error?.message ?? "OpenRouter request failed")
      : "OpenRouter request failed";
    if (response.status === 408 || response.status >= 500) {
      throw new OpenRouterGenerationOutcomeUnknownError(
        `HTTP ${response.status} after request dispatch: ${message.slice(0, 500)}`,
        { status: response.status },
      );
    }
    throw new Error(`OpenRouter HTTP ${response.status}: ${message.slice(0, 500)}`);
  }
  const usage = payload && typeof payload === "object" ? (payload as { usage?: Record<string, unknown> }).usage : undefined;
  const returnedModel = payload && typeof payload === "object"
    ? String((payload as { model?: unknown }).model ?? args.model)
    : args.model;
  recordModelUsage({
    provider: "openrouter",
    model: returnedModel,
    kind: args.kind ?? "text",
    requestId: payload && typeof payload === "object" ? String((payload as { id?: unknown }).id ?? "") || undefined : undefined,
    inputTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : undefined,
    outputTokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : undefined,
    reasoningTokens: typeof usage?.reasoning_tokens === "number" ? usage.reasoning_tokens : undefined,
    cachedInputTokens: typeof usage?.prompt_tokens_details === "object" && usage.prompt_tokens_details
      && typeof (usage.prompt_tokens_details as { cached_tokens?: unknown }).cached_tokens === "number"
      ? (usage.prompt_tokens_details as { cached_tokens: number }).cached_tokens
      : undefined,
    totalTokens: typeof usage?.total_tokens === "number" ? usage.total_tokens : undefined,
    ...(!usage ? { unpricedReason: "OpenRouter response omitted usage" } : {}),
  });
  // STARVATION WARNING.
  //
  // Reasoning on this route is MANDATORY and is billed as completion tokens, so
  // it is spent out of max_tokens before a single character of the answer is
  // produced. Measured directly against the shipped advertiser-safety call at
  // its old ceiling of 200: completion_tokens=196, of which reasoning_tokens=189
  // — seven tokens left for the JSON, and 16 unparseable characters came back.
  //
  // It cannot be turned off. The API rejects reasoning:{enabled:false},
  // reasoning:{effort:"none"}, reasoning:{max_tokens:0} and reasoning_effort
  // with "Reasoning is mandatory for this endpoint and cannot be disabled", and
  // reasoning:{exclude:true} only hides it from the response while still burning
  // 193 of 200. (vision.ts CAN set reasoning_effort:"none" because that path
  // goes to Groq, a different provider.) So every ceiling here has to be sized
  // as reasoning + answer, and this warning is how a call site says it is close
  // to the edge BEFORE it starts failing.
  //
  // Four features had already died this way silently — an empty pinned comment
  // on every video, an advisor that never advised, a topic gate skipped on two
  // slates in three, and a safety scan that failed precisely when it had
  // something to report.
  const reasoningTokens = typeof usage?.reasoning_tokens === "number" ? usage.reasoning_tokens : 0;
  if (reasoningTokens > 0 && reasoningTokens > args.maxTokens * REASONING_STARVATION_RATIO) {
    (args.log ?? (() => {}))(
      `openRouter: STARVATION RISK — reasoning used ${reasoningTokens} of the ${args.maxTokens}-token ceiling ` +
      `(${Math.round((reasoningTokens / args.maxTokens) * 100)}%) on ${returnedModel}. The answer has to fit in ` +
      `what is left; raise maxTokens at this call site before it starts failing its contract.`,
    );
  }
  const text = responseText(payload);
  if (!text) {
    throw new OpenRouterGenerationOutcomeUnknownError(
      "successful response contained no text",
      { status: response.status },
    );
  }
  if (args.json) {
    try {
      parseJson(text);
    } catch (error) {
      throw new OpenRouterGenerationOutcomeUnknownError(
        "successful response text failed the requested JSON contract",
        { status: response.status, cause: error, outcome: "consumed_unusable" },
      );
    }
  }
  args.log?.(`openrouter: ${returnedModel} returned text`);
  return text;
}

export async function openRouterJson<T>(args: {
  tier: "flash" | "pro";
  prompt: string;
  system?: string;
  model?: string;
  maxTokens: number;
  temperature?: number;
  log?: (message: string) => void;
}): Promise<T> {
  const model = args.model?.trim() || openRouterModel(args.tier === "pro" ? "creative" : "intelligence");
  return parseJson<T>(await openRouterChat({
    model,
    messages: [
      ...(args.system?.trim() ? [{ role: "system" as const, content: args.system.trim() }] : []),
      { role: "user", content: args.prompt },
    ],
    maxTokens: args.maxTokens,
    temperature: args.temperature,
    json: true,
    log: args.log,
  }));
}

export function openRouterProviderPreferences(model: string): OpenRouterProviderPreferences {
  assertNoOpenAiModel(model);
  const provider = PROVIDERS[model];
  if (!provider) throw new Error(`OpenRouter model is not an approved pinned route: ${model}`);
  return provider;
}
