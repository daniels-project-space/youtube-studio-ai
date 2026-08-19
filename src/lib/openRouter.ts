/**
 * Pinned OpenRouter boundary for the YouTube factory.
 *
 * The router is deliberately model- and provider-pinned: a generic OpenRouter
 * fallback could otherwise select Google-hosted capacity, which is prohibited
 * for planning and vision. Nano Banana thumbnails retain their separately
 * sealed exception and do not pass through this boundary.
 */
import { recordModelUsage } from "@/lib/modelUsage";
import type { ModelCallKind } from "@/lib/modelUsage";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

export const OPENROUTER_MODELS = {
  intelligence: "openai/gpt-oss-20b",
  creative: "mistralai/ministral-8b-2512",
  visionBulk: "mistralai/ministral-3b-2512",
  visionStandard: "mistralai/ministral-8b-2512",
  visionFinal: "qwen/qwen3.6-27b",
} as const;

export type OpenRouterModelKey = keyof typeof OPENROUTER_MODELS;

type OpenRouterMessage = {
  role: "system" | "user";
  content: unknown;
};

export type OpenRouterProviderPreferences = {
  only: string[];
  allow_fallbacks: false;
  require_parameters: true;
  data_collection: "deny";
};

const PROVIDERS: Record<string, OpenRouterProviderPreferences> = {
  "openai/gpt-oss-20b": {
    // CoreWeave's endpoint supports structured output and is not Google-hosted.
    only: ["coreweave/fp4"],
    allow_fallbacks: false,
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
  "qwen/qwen3.6-27b": {
    // Morph supports the JSON mode used by final visual admissions.
    only: ["morph/fp4"],
    allow_fallbacks: false,
    require_parameters: true,
    data_collection: "deny",
  },
};

function configured(key: OpenRouterModelKey): string {
  const envKey = `OPENROUTER_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}_MODEL`;
  const model = process.env[envKey]?.trim() || OPENROUTER_MODELS[key];
  if (/\b(?:google|gemini)\b/i.test(model)) {
    throw new Error(`OpenRouter ${key} model must not be Google/Gemini: ${model}`);
  }
  if (!PROVIDERS[model]) {
    throw new Error(`OpenRouter ${key} model is not an approved pinned non-Google route: ${model}`);
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

export async function openRouterChat(args: {
  model: string;
  messages: OpenRouterMessage[];
  maxTokens: number;
  temperature?: number;
  json?: boolean;
  kind?: ModelCallKind;
  log?: (message: string) => void;
}): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new Error("OpenRouter requires OPENROUTER_API_KEY");
  const provider = PROVIDERS[args.model];
  if (!provider) throw new Error(`OpenRouter model is not an approved pinned non-Google route: ${args.model}`);
  const response = await fetch(OPENROUTER_CHAT_URL, {
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
    signal: AbortSignal.timeout(90_000),
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = payload && typeof payload === "object"
      ? String((payload as { error?: { message?: unknown } }).error?.message ?? "OpenRouter request failed")
      : "OpenRouter request failed";
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
  const text = responseText(payload);
  if (!text) throw new Error("OpenRouter response contained no text");
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
  const provider = PROVIDERS[model];
  if (!provider) throw new Error(`OpenRouter model is not an approved pinned non-Google route: ${model}`);
  return provider;
}
