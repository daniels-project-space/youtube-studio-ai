/**
 * Claude JSON completion seam.
 *
 * The historical Claude seam now prefers the pinned, non-Google OpenRouter
 * fleet when it is configured. Keeping the public function names avoids a
 * risky caller-by-caller migration while moving ordinary channel intelligence
 * to GPT-OSS 20B and creative work to Ministral 3 8B.
 */
import { recordModelUsage } from "@/lib/modelUsage";
import { hasOpenRouterKey, openRouterJson, openRouterModel } from "@/lib/openRouter";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

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
}): Promise<T> {
  const tier = args.tier ?? "flash";
  const maxTokens = Math.max(128, Math.min(tier === "pro" ? 16_000 : 8_000, Math.floor(args.maxTokens ?? 1_200)));
  if (hasOpenRouterKey()) {
    return openRouterJson<T>({
      tier,
      prompt: args.prompt,
      system: args.system,
      model: args.model,
      maxTokens,
      temperature: args.temperature,
      log: args.log,
    });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("claudeJson: OPENROUTER_API_KEY or ANTHROPIC_API_KEY is required; no Gemini fallback is permitted");
  const model = configuredModel(tier, args.model);
  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
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
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = payload && typeof payload === "object"
      ? String((payload as { error?: { message?: unknown } }).error?.message ?? "Claude request failed")
      : "Claude request failed";
    throw new Error(`claudeJson: HTTP ${response.status}: ${message.slice(0, 500)}`);
  }
  const text = responseText(payload);
  if (!text) throw new Error("claudeJson: response contained no text block");
  const usage = payload && typeof payload === "object" ? (payload as { usage?: Record<string, unknown> }).usage : undefined;
  recordModelUsage({
    provider: "anthropic",
    model,
    kind: "text",
    requestId: payload && typeof payload === "object" ? String((payload as { id?: unknown }).id ?? "") || undefined : undefined,
    inputTokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined,
    outputTokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined,
  });
  args.log?.(`claudeJson: ${model} returned structured text`);
  return parseStructuredText<T>(text);
}

export async function claudeJsonPro<T = unknown>(args: Omit<Parameters<typeof claudeJson<T>>[0], "tier">): Promise<T> {
  return claudeJson<T>({ ...args, tier: "pro" });
}

/** Kept as a named script-generation model selector for the existing script seam. */
export function scriptProModel(): string {
  return configuredModel("pro");
}
