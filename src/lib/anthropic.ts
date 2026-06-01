/**
 * Anthropic Messages API thin wrapper (claude_flux thumbnailer concept phase).
 *
 * Key: ANTHROPIC_API_KEY. If absent, callers should `hasAnthropicKey()`-guard
 * and degrade — these functions throw loud only when actually invoked without
 * a key, so import/build never crashes.
 */
import { parseJsonLoose } from "@/lib/gemini";

const BASE = "https://api.anthropic.com/v1";
const VERSION = "2023-06-01";

/** Pinned model for thumbnail concept generation (per locked decision). */
export const CLAUDE_THUMBNAIL_MODEL =
  process.env.ANTHROPIC_THUMBNAIL_MODEL ?? "claude-sonnet-4-6";

export class AnthropicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnthropicError";
  }
}

export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function key(): string {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) throw new AnthropicError("ANTHROPIC_API_KEY is not configured");
  return k;
}

interface MessagesResponse {
  content?: { type: string; text?: string }[];
  error?: { message?: string };
}

/** Single-turn completion; returns the concatenated text content. */
export async function claudeText(args: {
  prompt: string;
  system?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const res = await fetch(`${BASE}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": key(),
      "anthropic-version": VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: args.model ?? CLAUDE_THUMBNAIL_MODEL,
      max_tokens: args.maxTokens ?? 600,
      temperature: args.temperature ?? 0.7,
      ...(args.system ? { system: args.system } : {}),
      messages: [{ role: "user", content: args.prompt }],
    }),
  });
  const json = (await res.json()) as MessagesResponse;
  if (!res.ok) {
    throw new AnthropicError(
      `anthropic -> HTTP ${res.status}: ${json.error?.message ?? ""}`,
    );
  }
  const text = (json.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
  if (!text) throw new AnthropicError("anthropic returned no text");
  return text;
}

/** Single-turn completion parsed as JSON (tolerates code fences/prose). */
export async function claudeJson<T = unknown>(args: {
  prompt: string;
  system?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<T> {
  const text = await claudeText(args);
  return parseJsonLoose<T>(text);
}
