/**
 * Gemini (Google Generative Language API v1beta) thin wrapper.
 *
 * Two uses for the competitor-intelligence engine:
 *   - geminiJson    — structured JSON generation (SEO databank, title optimise)
 *   - geminiVision  — multimodal image analysis (thumbnail style guide / QA)
 *
 * Key: GEMINI_API_KEY. If absent, callers should `hasGeminiKey()`-guard and
 * degrade gracefully — these functions throw loud only when actually invoked
 * without a key, so the build/import never crashes.
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiError";
  }
}

export function hasGeminiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

function key(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new GeminiError("GEMINI_API_KEY is not configured");
  return k;
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
}

async function generate(
  model: string,
  parts: GeminiPart[],
  opts: { json?: boolean; maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      maxOutputTokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.7,
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  const res = await fetch(
    `${BASE}/models/${model}:generateContent?key=${key()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const json = (await res.json()) as GeminiResponse;
  if (!res.ok) {
    throw new GeminiError(
      `gemini ${model} -> HTTP ${res.status}: ${json.error?.message ?? ""}`,
    );
  }
  const text = json.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) throw new GeminiError("gemini returned no text");
  return text;
}

/** Parse a JSON object out of a model response (tolerates code fences). */
export function parseJsonLoose<T = unknown>(text: string): T {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // Fall back to the first {...} or [...] span if there's surrounding prose.
  if (!/^[[{]/.test(s)) {
    const m = s.match(/[[{][\s\S]*[\]}]/);
    if (m) s = m[0];
  }
  return JSON.parse(s) as T;
}

/** Generate strict JSON via Gemini 2.5 Flash (json mode). */
export async function geminiJson<T = unknown>(args: {
  prompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<T> {
  const text = await generate(
    args.model ?? "gemini-2.5-flash",
    [{ text: args.prompt }],
    { json: true, maxTokens: args.maxTokens, temperature: args.temperature },
  );
  return parseJsonLoose<T>(text);
}

/**
 * Analyse one or more images (by URL) with a text prompt. Downloads each image,
 * inlines it as base64, and returns the model's text answer. Used for the
 * thumbnail style guide and the thumbnail QA gate.
 */
export async function geminiVision(args: {
  prompt: string;
  imageUrls: string[];
  model?: string;
  json?: boolean;
  maxTokens?: number;
}): Promise<string> {
  const parts: GeminiPart[] = [{ text: args.prompt }];
  for (const url of args.imageUrls.slice(0, 12)) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const mime = r.headers.get("content-type") ?? "image/jpeg";
      parts.push({
        inlineData: { mimeType: mime, data: buf.toString("base64") },
      });
    } catch {
      /* skip unreachable images */
    }
  }
  return generate(args.model ?? "gemini-2.5-flash", parts, {
    json: args.json,
    maxTokens: args.maxTokens ?? 1024,
  });
}

/**
 * Like {@link geminiVision} but inlines LOCAL image files (e.g. ffmpeg-grabbed
 * frames) instead of fetching URLs. Used by the qa_visual gate.
 */
export async function geminiVisionLocal(args: {
  prompt: string;
  imagePaths: string[];
  model?: string;
  json?: boolean;
  maxTokens?: number;
}): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const parts: GeminiPart[] = [{ text: args.prompt }];
  for (const p of args.imagePaths.slice(0, 12)) {
    try {
      const buf = await readFile(p);
      const mime = p.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
      parts.push({ inlineData: { mimeType: mime, data: buf.toString("base64") } });
    } catch {
      /* skip unreadable frame */
    }
  }
  return generate(args.model ?? "gemini-2.5-flash", parts, {
    json: args.json,
    maxTokens: args.maxTokens ?? 1024,
  });
}
