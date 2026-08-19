/**
 * Gemini (Google Generative Language API v1beta) thin wrapper.
 *
 * Two uses for the competitor-intelligence engine:
 *   - geminiJson    — structured JSON generation (SEO databank, title optimise)
 *   - geminiVision  — multimodal image analysis (thumbnail style guide / QA)
 *
 * Key: GEMINI_API_KEY. Gemini is not a general runtime provider: the only
 * admitted production use is the sealed Nano Banana thumbnail image route.
 * A key alone never authorizes text, audio, video, embeddings, browser agents,
 * or visual review; those paths must use approved alternatives.
 */

import {
  cacheModelResponse,
  getCachedModelResponse,
  modelRequestCacheKey,
  recordModelUsage,
  type ModelCallKind,
} from "@/lib/modelUsage";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Deliberate thumbnail-only latch. The product's default is no Gemini
 * execution even if an old vault secret remains available.
 */
export const GEMINI_RUNTIME_OPT_IN_ENV = "YOUTUBE_STUDIO_ALLOW_GEMINI_RUNTIME";

export class GeminiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiError";
  }
}

/** A deterministic, non-retryable refusal before any Gemini provider request. */
export class GeminiRuntimeDisabledError extends GeminiError {
  readonly retryable = false;
  readonly code = "GEMINI_RUNTIME_DISABLED";

  constructor(operation: string) {
    super(
      `${operation}: Gemini runtime is disabled by policy. ` +
        "Use the approved non-Gemini module/provider. The sole exception is the sealed Nano Banana thumbnail " +
        `route, which additionally requires ${GEMINI_RUNTIME_OPT_IN_ENV}=1 alongside GEMINI_API_KEY.`,
    );
    this.name = "GeminiRuntimeDisabledError";
  }
}

/**
 * A generateContent submission that ended without a durable provider response.
 * Gemini's synchronous endpoint exposes no request idempotency/status handle,
 * so repeating an ambiguous transport or server failure can duplicate billed
 * tokens. Explicit 429 rejection and the known thinking-config 400 are handled
 * before this error because those responses prove the request was not run.
 */
export class GeminiSubmissionError extends GeminiError {
  readonly retryable = false;
  readonly status?: number;
  readonly code = "GEMINI_SUBMISSION_AMBIGUOUS";

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message);
    this.name = "GeminiSubmissionError";
    this.status = options.status;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export function isGeminiRuntimeEnabled(): boolean {
  return process.env[GEMINI_RUNTIME_OPT_IN_ENV] === "1";
}

/**
 * Generic Gemini is intentionally unavailable. Thumbnail code must use its
 * own `hasNanoBanana()` capability instead of treating this as an LLM key.
 */
export function hasGeminiKey(): boolean {
  return false;
}

/**
 * Opaque capability used by the receipt-bound Nano Banana adapter.  This is a
 * runtime identity, rather than an exported string literal, so a future
 * Google caller cannot accidentally inherit the thumbnail exception by
 * spelling a purpose string correctly.
 */
const SEALED_NANO_BANANA_THUMBNAIL_PURPOSE = Symbol("sealed-nano-banana-thumbnail");
export type GeminiRuntimePurpose = typeof SEALED_NANO_BANANA_THUMBNAIL_PURPOSE;

/**
 * The sole capability issuer. Keep the raw symbol private: callers can obtain
 * it only by deliberately importing the sealed thumbnail capability.
 */
export function sealedNanoBananaThumbnailPurpose(): GeminiRuntimePurpose {
  return SEALED_NANO_BANANA_THUMBNAIL_PURPOSE;
}

/**
 * Reject every Gemini provider boundary before it can read, upload, or send
 * data, except the receipt-bound Nano Banana thumbnail route. This purpose is
 * deliberately a closed union so a new Gemini caller must be consciously
 * reviewed rather than inheriting the thumbnail exception.
 */
export function assertGeminiRuntimeAllowed(operation: string, purpose?: GeminiRuntimePurpose): void {
  if (purpose !== SEALED_NANO_BANANA_THUMBNAIL_PURPOSE || !isGeminiRuntimeEnabled()) {
    throw new GeminiRuntimeDisabledError(operation);
  }
}

/** Detect the two model-id forms used by raw REST and model-router clients. */
export function isGeminiModelIdentifier(model: string | undefined): boolean {
  const normalized = model?.trim().toLowerCase() ?? "";
  // Creative callers must fail closed on every Google-model notation that the
  // SDK router could resolve, not only the two spellings we currently use.
  return (
    normalized.startsWith("gemini-") ||
    normalized.startsWith("models/gemini-") ||
    normalized.startsWith("google/") ||
    normalized.startsWith("google:")
  );
}

/**
 * Use this at model-router boundaries (Mastra, browser agents, SDK adapters).
 * A router model is not a thumbnail image request, so it can never receive the
 * sealed Nano Banana capability even when the thumbnail environment opt-in is
 * present.
 */
export function assertNonGeminiModelIdentifier(model: string | undefined, operation: string): void {
  if (isGeminiModelIdentifier(model)) {
    throw new GeminiRuntimeDisabledError(
      `${operation}: Gemini models are thumbnail-only and cannot be selected for this runtime`,
    );
  }
}

function key(): string {
  assertGeminiRuntimeAllowed("Gemini REST provider");
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new GeminiError("GEMINI_API_KEY is not configured");
  return k;
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  fileData?: { mimeType: string; fileUri: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ask a model to watch an ALREADY-UPLOADED video (reuse one upload across passes). */
export async function geminiVideoUri(args: {
  fileUri: string;
  mimeType: string;
  prompt: string;
  model?: string;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  return generate(
    args.model ?? "gemini-2.5-flash",
    [{ fileData: { mimeType: args.mimeType, fileUri: args.fileUri } }, { text: args.prompt }],
    { json: args.json, maxTokens: args.maxTokens ?? 2048, temperature: args.temperature ?? 0.3 },
  );
}

/** Upload a local video to the Gemini File API and wait until ACTIVE. */
export async function uploadGeminiVideo(
  path: string,
  mime?: string,
): Promise<{ fileUri: string; mimeType: string }> {
  assertGeminiRuntimeAllowed("Gemini File API upload");
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(path);
  const mimeType = mime ?? "video/mp4";
  const k = key();

  // 1) start resumable upload
  const start = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${k}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.length),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: "render" } }),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new GeminiError(`gemini file upload start failed: HTTP ${start.status} ${(await start.text()).slice(0, 200)}`);

  // 2) upload bytes + finalize
  const up = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Length": String(bytes.length), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body: bytes,
  });
  if (!up.ok) throw new GeminiError(`gemini file upload failed: HTTP ${up.status} ${(await up.text()).slice(0, 200)}`);
  const uploaded = ((await up.json()) as { file?: { name?: string; uri?: string; state?: string; mimeType?: string } }).file;
  if (!uploaded?.name || !uploaded?.uri) throw new GeminiError("gemini file upload: no file in response");
  const fileName = uploaded.name.replace(/^files\//, "");
  const fileUri = uploaded.uri;
  let state = uploaded.state;
  let fileMime = uploaded.mimeType ?? mimeType;

  // 3) poll until the video finishes processing (ACTIVE)
  for (let i = 0; i < 40 && state === "PROCESSING"; i++) {
    await sleep(3000);
    const st = await fetch(`${BASE}/files/${fileName}?key=${k}`);
    const j = (await st.json()) as { state?: string; mimeType?: string };
    state = j.state;
    if (j.mimeType) fileMime = j.mimeType;
  }
  if (state !== "ACTIVE") throw new GeminiError(`gemini file not ACTIVE (state=${state})`);
  return { fileUri, mimeType: fileMime };
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    groundingMetadata?: { webSearchQueries?: string[] };
  }[];
  error?: { message?: string };
  modelVersion?: string;
  responseId?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    cachedContentTokenCount?: number;
    candidatesTokenCount?: number;
    toolUsePromptTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
    promptTokensDetails?: { modality?: string; tokenCount?: number }[];
    cacheTokensDetails?: { modality?: string; tokenCount?: number }[];
  };
}

function tokenCountForModality(
  details: { modality?: string; tokenCount?: number }[] | undefined,
  modality: string,
): number {
  return (details ?? []).reduce(
    (sum, detail) =>
      detail.modality?.toUpperCase() === modality &&
      typeof detail.tokenCount === "number" &&
      Number.isFinite(detail.tokenCount)
        ? sum + Math.max(0, detail.tokenCount)
        : sum,
    0,
  );
}

function callKind(parts: GeminiPart[]): ModelCallKind {
  const mimeTypes = parts
    .map((part) => part.inlineData?.mimeType ?? part.fileData?.mimeType)
    .filter((value): value is string => Boolean(value));
  if (mimeTypes.some((mime) => mime.startsWith("video/"))) return "video";
  if (mimeTypes.some((mime) => mime.startsWith("audio/"))) return "audio";
  if (mimeTypes.some((mime) => mime.startsWith("image/"))) return "vision";
  return "text";
}

function recordGeminiResponseUsage(
  requestedModel: string,
  kind: ModelCallKind,
  response: GeminiResponse,
  usedGrounding: boolean,
): void {
  const usage = response.usageMetadata;
  const hasAudioBreakdown = usage?.promptTokensDetails?.some(
    (detail) => detail.modality?.toUpperCase() === "AUDIO",
  );
  const actualGroundedQueries = response.candidates?.reduce(
    (sum, candidate) => sum + (candidate.groundingMetadata?.webSearchQueries?.length ?? 0),
    0,
  ) ?? 0;
  recordModelUsage({
    provider: "gemini",
    model: response.modelVersion ?? requestedModel,
    kind,
    requestId: response.responseId,
    inputTokens: usage?.promptTokenCount,
    outputTokens: usage?.candidatesTokenCount,
    reasoningTokens: usage?.thoughtsTokenCount,
    cachedInputTokens: usage?.cachedContentTokenCount,
    audioInputTokens: tokenCountForModality(usage?.promptTokensDetails, "AUDIO"),
    cachedAudioInputTokens: tokenCountForModality(usage?.cacheTokensDetails, "AUDIO"),
    totalTokens: usage?.totalTokenCount,
    ...(!usage
      ? { unpricedReason: "Gemini response omitted usageMetadata" }
      : kind === "audio" && !hasAudioBreakdown
        ? { unpricedReason: "Gemini audio response omitted modality token breakdown" }
        : {}),
    ...(usedGrounding
      ? {
          additionalUnpricedReason:
            `Google Search grounding fee is quota-dependent` +
            (actualGroundedQueries > 0 ? ` (${actualGroundedQueries} reported queries)` : ""),
        }
      : {}),
  });
}

/**
 * Thinking control per model family. Thinking tokens BILL AS OUTPUT (~$10-12/M
 * on Pro) and Pro models think UNBOUNDED by default — this was a top driver of
 * the Google bill. FLASH: disabled outright (budget 0). 2.5-PRO: budget capped
 * (min the API allows is 128; 0 is rejected). GEMINI-3 previews: thinkingLevel
 * "low" (they take a level, not a budget). If a preview rejects the field, the
 * caller strips it and retries once (see the 400 handler below).
 */
function thinkingConfigFor(model: string): Record<string, unknown> | null {
  if (/flash/i.test(model)) return { thinkingBudget: 0 };
  if (/gemini-3/i.test(model)) return { thinkingLevel: process.env.GEMINI_PRO_THINKING || "low" };
  if (/2\.5-pro/i.test(model)) return { thinkingBudget: Number(process.env.GEMINI_PRO_THINKING_BUDGET || 1024) };
  return null;
}

async function generate(
  model: string,
  parts: GeminiPart[],
  opts: { json?: boolean; maxTokens?: number; temperature?: number; tools?: unknown[] } = {},
): Promise<string> {
  assertGeminiRuntimeAllowed("Gemini generateContent");
  const thinking = thinkingConfigFor(model);
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts }],
    ...(opts.tools ? { tools: opts.tools } : {}),
    generationConfig: {
      maxOutputTokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.7,
      ...(thinking ? { thinkingConfig: thinking } : {}),
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  const kind = callKind(parts);
  const requestKey = modelRequestCacheKey("gemini", model, body);
  const cached = getCachedModelResponse<string>(requestKey, {
    provider: "gemini",
    model,
    kind,
  });
  if (cached !== undefined) return cached;
  const retryBaseMs = Math.max(0, Number(process.env.GEMINI_RETRY_BASE_MS ?? 2_000) || 0);
  // Retry only explicit pre-admission rejections. A 429 proves no generation
  // ran; the known thinking-config 400 likewise rejects validation before
  // inference. Network failures and 5xx responses are ambiguous without a
  // provider idempotency/status handle and must never be auto-resubmitted.
  let json: GeminiResponse | undefined;
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    // Hard deadline prevents a hung render. A timeout after dispatch is still
    // ambiguous, so it stops rather than silently buying a duplicate call.
    let res: Response;
    try {
      res = await fetch(
        `${BASE}/models/${model}:generateContent?key=${key()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120_000),
        },
      );
    } catch (error) {
      throw new GeminiSubmissionError(
        `gemini ${model} submission transport failed without a durable response; refusing automatic resubmission`,
        { cause: error },
      );
    }
    try {
      json = (await res.json()) as GeminiResponse;
    } catch (e) {
      lastErr = `HTTP ${res.status}: unreadable response (${e instanceof Error ? e.message : e})`;
      if (res.ok) {
        // The provider may already have billed this successful response. An
        // outer block retry would blindly buy it again with no usage evidence.
        throw new GeminiError(
          `gemini ${model} provider retry budget exhausted (unreadable successful response)`,
        );
      }
      if (res.status === 429 && attempt < 3) {
        await sleep(retryBaseMs * (attempt + 1) * (attempt + 1));
        continue;
      }
      if (res.status === 429) {
        throw new GeminiError(`gemini ${model} provider retry budget exhausted (${lastErr})`);
      }
      throw new GeminiSubmissionError(
        `gemini ${model} returned ${lastErr} without a durable response; refusing automatic resubmission`,
        { status: res.status, cause: e },
      );
    }
    if (res.ok) {
      recordGeminiResponseUsage(model, kind, json, Boolean(opts.tools));
      break;
    }
    const code = res.status;
    lastErr = `HTTP ${code}: ${json.error?.message ?? ""}`;
    // A preview model may reject our thinking field shape (400) — strip it and
    // retry rather than failing the whole call. Costs one round-trip, once.
    if (code === 400 && /thinking/i.test(json.error?.message ?? "") && (body.generationConfig as Record<string, unknown>)?.thinkingConfig) {
      delete (body.generationConfig as Record<string, unknown>).thinkingConfig;
      continue;
    }
    if (code === 429 && attempt < 3) {
      await sleep(retryBaseMs * (attempt + 1) * (attempt + 1)); // 2s, 8s, 18s by default
      continue;
    }
    if (code === 429) {
      throw new GeminiError(`gemini ${model} provider retry budget exhausted (${lastErr})`);
    }
    throw new GeminiSubmissionError(
      `gemini ${model} returned ${lastErr} without a durable response; refusing automatic resubmission`,
      { status: code },
    );
  }
  const text = json?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) {
    throw new GeminiError(
      `gemini ${model} provider retry budget exhausted (successful response returned no usable text)`,
    );
  }
  cacheModelResponse(requestKey, text);
  return text;
}

/**
 * Analyze a public YouTube video directly (no download) — Gemini accepts a
 * YouTube URL as a fileData part. Capped to the first `windowSec` seconds to
 * bound cost/latency. Returns the raw model text (use json:true for structured).
 */
export async function geminiAnalyzeYouTube(
  url: string,
  prompt: string,
  opts: { json?: boolean; maxTokens?: number; windowSec?: number; model?: string } = {},
): Promise<string> {
  const window = opts.windowSec ?? 90;
  const part = {
    fileData: { fileUri: url },
    videoMetadata: { startOffset: "0s", endOffset: `${window}s` },
  } as unknown as GeminiPart;
  return generate(opts.model ?? "gemini-2.5-flash", [part, { text: prompt }], {
    json: opts.json ?? true,
    maxTokens: opts.maxTokens ?? 900,
    temperature: 0.3,
  });
}

/**
 * Escape raw control characters INSIDE JSON string literals. Gemini frequently
 * emits real newlines/tabs inside long narration strings ("Bad control
 * character in string literal") — structurally valid JSON otherwise, so repair
 * instead of failing the whole section. Whitespace BETWEEN tokens is left
 * untouched (it's legal JSON).
 */
function escapeCtrlInStrings(s: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === "\\") { out += ch; esc = true; continue; }
      if (ch === '"') { inStr = false; out += ch; continue; }
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        out += code === 10 ? "\\n" : code === 13 ? "\\r" : code === 9 ? "\\t" : " ";
        continue;
      }
      out += ch;
    } else {
      if (ch === '"') inStr = true;
      out += ch;
    }
  }
  return out;
}

/** Parse a JSON object out of a model response (tolerates code fences). */
export function parseJsonLoose<T = unknown>(text: string): T {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // A TRUNCATED response can open a fence and never close it — strip the
  // leading fence anyway (this made every truncated Claude critique unparseable:
  // "Unexpected token '`'").
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  // Fall back to the first {...} or [...] span if there's surrounding prose.
  if (!/^[[{]/.test(s)) {
    const m = s.match(/[[{][\s\S]*[\]}]/);
    if (m) s = m[0];
  }
  // TRAILING JUNK: models sometimes emit a complete balanced value and then
  // keep talking (a closing brace followed by prose) — JSON.parse rejects the whole
  // thing ("Unexpected non-whitespace character after JSON"). Since the text
  // starts with {/[, the prose-span fallback above never fires. Trim to the
  // end of the FIRST balanced top-level value. (Killed a comic storyboard and
  // a plan-week slate within 24h — same signature, two pipelines.)
  const bal = balancedSpanEnd(s);
  if (bal > 0 && bal < s.length) s = s.slice(0, bal);
  try {
    return JSON.parse(s) as T;
  } catch {
    try {
      return JSON.parse(escapeCtrlInStrings(s)) as T;
    } catch {
      // Last resort: the reply was TRUNCATED mid-value (maxTokens) — close the
      // open string and any unclosed objects/arrays so the parsed prefix is
      // usable instead of losing the whole result.
      return JSON.parse(closeTruncatedJson(escapeCtrlInStrings(s))) as T;
    }
  }
}

/** Index just past the first balanced top-level {...}/[...] (0 = not found). */
function balancedSpanEnd(s: string): number {
  if (!/^[[{]/.test(s)) return 0;
  let inStr = false;
  let esc = false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return 0;
}

/** Close an unterminated string + unclosed braces/brackets on truncated JSON. */
function closeTruncatedJson(s: string): string {
  let inStr = false;
  let esc = false;
  const stack: string[] = [];
  for (const ch of s) {
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let out = s;
  if (esc) out = out.slice(0, -1); // drop a dangling backslash
  if (inStr) out += '"';
  out = out.replace(/,\s*$/, "");
  while (stack.length) out += stack.pop();
  return out;
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
 * JSON via Gemini WITH Google Search grounding — for verifying real-world
 * claims against live sources. JSON response mode is incompatible with the
 * search tool, so the JSON contract is prompt-enforced and parsed loosely.
 */
export async function geminiGroundedJson<T = unknown>(args: {
  prompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<T> {
  const text = await generate(
    args.model ?? "gemini-2.5-flash",
    [{ text: args.prompt + '\nReturn ONLY the JSON object, no prose around it.' }],
    {
      maxTokens: args.maxTokens ?? 2500,
      temperature: args.temperature ?? 0.2,
      tools: [{ google_search: {} }],
    },
  );
  return parseJsonLoose<T>(text);
}

/**
 * The LATEST Gemini Pro text model — the narration writer (Daniel: "they are
 * the best at narration"). Env-pinnable via GEMINI_SCRIPT_MODEL; the chain in
 * geminiJsonPro degrades LOUDLY through older Pros if the preview rotates away.
 */
export function scriptProModel(): string {
  return process.env.GEMINI_SCRIPT_MODEL || "gemini-3.1-pro-preview";
}

const PRO_FALLBACKS = ["gemini-3-pro-preview", "gemini-2.5-pro"];

/**
 * Strict JSON via the latest Gemini PRO (scriptProModel), with a loud model
 * fallback chain when a preview id stops existing. PRO GOTCHA: thinking eats
 * maxOutputTokens first — small budgets return truncated JSON with
 * finishReason MAX_TOKENS (verified live on gemini-3.1-pro-preview) — so the
 * budget is floored at 6000.
 */
export async function geminiJsonPro<T = unknown>(args: {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  log?: (msg: string) => void;
}): Promise<T> {
  const chain = [scriptProModel(), ...PRO_FALLBACKS.filter((m) => m !== scriptProModel())];
  const maxTokens = Math.max(6000, args.maxTokens ?? 0);
  let lastErr: unknown;
  for (const model of chain) {
    try {
      const text = await generate(model, [{ text: args.prompt }], {
        json: true,
        maxTokens,
        temperature: args.temperature,
      });
      try {
        return parseJsonLoose<T>(text);
      } catch (pe) {
        // MALFORMED-JSON RETRY (once): even in json mode the model
        // occasionally emits junk parseJsonLoose can't recover. One paid
        // retry with an explicit strictness nudge beats killing a run that
        // already carries upstream spend (a comic storyboard and a plan-week
        // slate both died on this within 24h).
        args.log?.(`geminiJsonPro: unparseable JSON from ${model} (${pe instanceof Error ? pe.message.slice(0, 80) : pe}) — one strict retry`);
        const retryText = await generate(model, [{ text: `${args.prompt}\n\nCRITICAL: output STRICTLY VALID minified JSON only. No prose, no trailing text, no markdown.` }], {
          json: true,
          maxTokens,
          temperature: Math.max(0, (args.temperature ?? 0.7) - 0.3),
        });
        return parseJsonLoose<T>(retryText);
      }
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      // Only a missing/forbidden MODEL falls through the chain — content and
      // transient errors (already retried in generate) must surface honestly.
      if (!/not[ _]?found|404|permission|unsupported|does not exist/i.test(msg)) throw e;
      args.log?.(`geminiJsonPro: model ${model} unavailable (${msg.slice(0, 120)}) — trying next in chain`);
    }
  }
  throw lastErr instanceof Error ? lastErr : new GeminiError(String(lastErr));
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
/**
 * Native AUDIO judging — Gemini hears the clips (base64 mp3) and returns a
 * structured verdict. Used by voice casting (auditions vs the DNA register).
 */
export async function geminiAudioJudge(args: {
  audios: string[]; // base64 mp3
  prompt: string;
  model?: string;
  maxTokens?: number;
}): Promise<{ takes?: { idx?: number; score?: number; note?: string }[]; winner?: number; why?: string }> {
  const parts: GeminiPart[] = [{ text: args.prompt }];
  for (const b64 of args.audios.slice(0, 6)) {
    parts.push({ inlineData: { mimeType: "audio/mpeg", data: b64 } });
  }
  const raw = await generate(args.model ?? "gemini-2.5-flash", parts, {
    json: true,
    maxTokens: args.maxTokens ?? 800,
    temperature: 0.2,
  });
  return parseJsonLoose(raw);
}

/**
 * Generic audio-grounded JSON: Gemini LISTENS to the supplied mp3s and
 * returns the prompt's JSON contract (voicecraft profiling/casting/gating).
 */
export async function geminiAudioJson<T = unknown>(args: {
  audios: string[]; // base64 mp3
  prompt: string;
  model?: string;
  maxTokens?: number;
}): Promise<T> {
  const parts: GeminiPart[] = [{ text: args.prompt }];
  for (const b64 of args.audios.slice(0, 6)) {
    parts.push({ inlineData: { mimeType: "audio/mpeg", data: b64 } });
  }
  const raw = await generate(args.model ?? "gemini-2.5-flash", parts, {
    json: true,
    maxTokens: args.maxTokens ?? 1000,
    temperature: 0.2,
  });
  return parseJsonLoose<T>(raw);
}

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
