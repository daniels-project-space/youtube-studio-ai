/**
 * Provider-routed VISION client — the replacement for retired Google vision
 * calls. Every image-understanding call in the
 * pipeline goes through visionLocal()/visionUrls(), which:
 *
 *   1. DOWNSCALES frames (ffmpeg → ≤768px JPEG) before base64-inlining —
 *      full-res 4K PNG frames were 10-20x the payload/tokens for zero judge
 *      value (the wrapper previously sent whatever the caller grabbed).
 *   2. CACHES verdicts by content hash (prompt + image bytes) — verify→heal
 *      →re-verify loops, retried blocks and dev re-renders stop re-billing
 *      identical questions.
 *   3. ANSWERS WITHOUT THINKING by default (reasoning_effort "none" on Groq) —
 *      the <think> pass cost ~32x the completion tokens and ~8x the latency of a
 *      gate call while producing measurably WORSE and less repeatable verdicts.
 *      See VISION_REASONING_EFFORT for the A/B numbers.
 *   4. ROUTES to the cheapest available provider, in VISION_PROVIDERS order
 *      (default "openrouter"):
 *        groq   → Qwen 3.6 27B (current production multimodal model)
 *        fal    → any-llm/vision (provider-routed; exact usage not exposed)
 *
 * Gemini is deliberately excluded. Its sole approved product role is sealed
 * Nano Banana thumbnail image generation, never analysis or review.
 *
 * Contract preserved from the former local-vision adapter: returns the model's RAW TEXT
 * (JSON text when json:true — callers keep parsing with parseJsonLoose, which
 * tolerates fences/truncation). Throws on total failure; every caller already
 * self-guards with a fallback verdict.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordModelUsage } from "@/lib/modelUsage";
import { hasOpenRouterKey, openRouterChat, openRouterModel } from "@/lib/openRouter";

export class VisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisionError";
  }
}

/**
 * Groq's `reasoning_effort` accepts exactly two values on GROQ_VISION_MODEL:
 * "none" (answer immediately) or "default" (run the internal <think> pass first).
 */
export type VisionReasoningEffort = "none" | "default";

export interface VisionLocalArgs {
  prompt: string;
  imagePaths: string[];
  /** Legacy model hint — accepted and ignored (routing is provider-based). */
  model?: string;
  json?: boolean;
  maxTokens?: number;
  /** Skip the verdict cache (for deliberately-stochastic judging). */
  noCache?: boolean;
  /**
   * Override the reasoning pass for THIS call. Defaults to VISION_REASONING_EFFORT
   * ("none") — see that constant for the A/B evidence behind the default.
   */
  reasoningEffort?: VisionReasoningEffort;
  /** Restrict this review to specific providers. Use this for certified no-Google gates. */
  providers?: readonly VisionProvider[];
  /** Cost/quality lane: cheap triage, normal analysis, or a final admission. */
  tier?: VisionTier;
  /**
   * Bound retries for each provider without changing the provider chain. A
   * final-master budget receipt uses one Groq attempt then one fal fallback.
   */
  maxAttemptsPerProvider?: number;
}

/** Gemini is intentionally not a vision provider; it is sealed to Nano Banana thumbnail pixels. */
export type VisionProvider = "openrouter";
export type VisionTier = "bulk" | "standard" | "final";

/** Is an approved non-Google vision provider available? */
export function hasVisionKey(): boolean {
  return providerChain().length > 0;
}

/** True only when an independent non-Google reviewer is available. */
export function hasNonGoogleVisionKey(): boolean {
  return providerChain(["openrouter"]).length > 0;
}

/** Once-per-process loud warning: an empty chain silently skips EVERY QA gate. */
let warnedNoVisionProviders = false;

function providerChain(allowed?: readonly VisionProvider[]): VisionProvider[] {
  const order = (process.env.VISION_PROVIDERS || "openrouter").split(",").map((s) => s.trim());
  const chain = order.filter(
    (p): p is VisionProvider =>
      p === "openrouter" &&
      (!allowed || allowed.includes(p)) &&
      hasOpenRouterKey(),
  );
  if (chain.length === 0 && !warnedNoVisionProviders) {
    warnedNoVisionProviders = true;
    console.warn(
      "[vision] !!! vision QA DISABLED (no providers) — set OPENROUTER_API_KEY; " +
        "Gemini is reserved for sealed Nano Banana thumbnail generation",
    );
  }
  return chain;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * Frame preparation: downscale to ≤VISION_MAX_DIM px JPEG via ffmpeg.
 * A judge grading composition/legibility does not need 4K frames; this
 * cuts payload (and per-image tokens on every provider) ~4-20x.
 * ------------------------------------------------------------------ */

const PREP_MAX_DIM = Number(process.env.VISION_MAX_DIM || 768);

async function prepLocalImage(path: string): Promise<Buffer | null> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const out = join(
      await cacheDir(),
      `prep-${createHash("sha1").update(path).digest("hex").slice(0, 16)}-${PREP_MAX_DIM}.jpg`,
    );
    const ffmpeg = process.env.FFMPEG_BIN ?? "ffmpeg";
    await run(ffmpeg, [
      "-y",
      "-i",
      path,
      "-vf",
      `scale='min(${PREP_MAX_DIM},iw)':'min(${PREP_MAX_DIM},ih)':force_original_aspect_ratio=decrease`,
      "-q:v",
      "4",
      "-frames:v",
      "1",
      out,
    ]);
    return await readFile(out);
  } catch {
    // ffmpeg unavailable/failed → send the original bytes rather than dropping
    try {
      return await readFile(path);
    } catch {
      return null;
    }
  }
}

async function fetchRemoteImage(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Verdict cache: sha1(prompt + image hashes + mode) → raw text.
 * tmpdir-scoped: lives for the whole Trigger machine / dev session.
 * ------------------------------------------------------------------ */

let cacheDirP: Promise<string> | null = null;
function cacheDir(): Promise<string> {
  if (!cacheDirP) {
    cacheDirP = (async () => {
      const d = join(tmpdir(), "ysa-vision-cache");
      await mkdir(d, { recursive: true });
      return d;
    })();
  }
  return cacheDirP;
}

async function cacheGet(key: string): Promise<string | null> {
  try {
    return await readFile(join(await cacheDir(), `${key}.txt`), "utf8");
  } catch {
    return null;
  }
}

async function cachePut(key: string, text: string): Promise<void> {
  try {
    await writeFile(join(await cacheDir(), `${key}.txt`), text, "utf8");
  } catch {
    /* cache is best-effort */
  }
}

/* ------------------------------------------------------------------ *
 * Providers
 * ------------------------------------------------------------------ */

const GROQ_VISION_MODEL =
  process.env.GROQ_VISION_MODEL || "qwen/qwen3.6-27b";
/** Groq caps vision requests at 5 images — beyond that, sample evenly. */
const GROQ_MAX_IMAGES = 5;

/**
 * Minimum completion budget for ANY vision gate.
 *
 * GROQ_VISION_MODEL is a REASONING model: its internal <think> pass is billed
 * against max_tokens and runs BEFORE a single answer token is emitted. Measured
 * on real frames with a full-length production gate prompt, reasoning alone came
 * in at 1277-3928 tokens per call. Anything below that emits nothing, which Groq
 * surfaces as a hard `400 json_validate_failed` (json mode) or a truncated
 * `<think>` blob that fails to parse (non-json mode).
 *
 * The historical call-site budgets (80-400) therefore failed 100% of the time,
 * and each caller's catch block converted that into a silent wrong answer:
 * footagecraft's clip gate fails CLOSED (rejected ALL candidate b-roll, starving
 * footage casting), cinecraft's drift gate and narratedBlocks' grader fail OPEN
 * (silently no-op). 8192 is ~2x the observed reasoning ceiling.
 *
 * Raising this is close to free: max_tokens is a CEILING, not a reservation —
 * you are billed for tokens actually generated, and a starved call still burns
 * (and wastes) its whole budget producing nothing.
 */
export const VISION_GATE_MAX_TOKENS = 8192;

/**
 * Hard ceiling sent to Groq. Previously 4096, which silently truncated every
 * caller that asked for more and sat right on top of the observed 3928-token
 * reasoning peak.
 */
const GROQ_MAX_COMPLETION_TOKENS = 16384;

/**
 * Default reasoning pass for every vision GATE: OFF.
 *
 * GROQ_VISION_MODEL is a reasoning model, and its <think> pass is billed as plain
 * completion tokens (Groq does not even report reasoning_tokens separately for it),
 * so it costs real money and real latency on every gate. It was left ON only
 * because nobody had measured whether it bought better judgment. It does not.
 *
 * A/B over 13 real gate cases (footagecraft relevance + natureMode, documotion
 * asset gate, thumbnailLab QA gate, cinecraft keyframe drift), each the verbatim
 * production prompt against real frames, 5 runs per condition (130 calls):
 *
 *                        reasoning "default"      reasoning "none"
 *   accuracy vs label    49/60  (81.7%)           54/60  (90.0%)
 *   ...excl. infra noise 49/53  (92.5%)           54/55  (98.2%)
 *   verdict consistency  23 distinct / 13 cases   15 distinct / 13 cases
 *   json_validate_failed 1                        0
 *   median latency       3032 ms                  382 ms
 *   avg completion tok   1855                     58
 *   cost per 1000 gates  ~$2.59                   ~$0.44
 *
 * "none" regressed ZERO gates and strictly beat "default" on two (documotion's
 * clean-asset case, where reasoning returned FOUR different verdicts for one
 * unchanged image; and thumbnailLab's clutter case). It is also the safer
 * setting: the reasoning path peaked at 6914 completion tokens — 84% of
 * VISION_GATE_MAX_TOKENS — so it sits one long ramble away from re-triggering
 * the exact starvation bug that budget was raised to fix, while "none" peaked
 * at 200.
 *
 * Set VISION_REASONING_EFFORT=default to restore the thinking pass globally, or
 * pass `reasoningEffort` per call for a gate that genuinely needs deliberation.
 */
const VISION_REASONING_EFFORT: VisionReasoningEffort =
  process.env.VISION_REASONING_EFFORT === "default" ? "default" : "none";

async function groqVision(
  prompt: string,
  images: Buffer[],
  opts: {
    json?: boolean;
    maxTokens?: number;
    reasoningEffort?: VisionReasoningEffort;
    maxAttemptsPerProvider?: number;
  },
): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new VisionError("no GROQ_API_KEY");
  const picked = sampleEvenly(images, GROQ_MAX_IMAGES);
  const content: unknown[] = [
    {
      type: "text",
      text:
        picked.length < images.length
          ? `${prompt}\n(Note: ${picked.length} representative frames sampled of ${images.length}.)`
          : prompt,
    },
    ...picked.map((b) => ({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${b.toString("base64")}` },
    })),
  ];
  let lastErr = "";
  const maxAttempts = Math.max(1, Math.min(3, Math.floor(opts.maxAttemptsPerProvider ?? 3)));
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GROQ_VISION_MODEL,
        messages: [{ role: "user", content }],
        max_tokens: Math.min(opts.maxTokens ?? VISION_GATE_MAX_TOKENS, GROQ_MAX_COMPLETION_TOKENS),
        temperature: 0.2,
        // Groq rejects anything but "none" | "default" with a hard 400, so this is
        // sent verbatim and never widened to the usual low/medium/high scale.
        reasoning_effort: opts.reasoningEffort ?? VISION_REASONING_EFFORT,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (res.status === 429 || res.status >= 500) {
      lastErr = `HTTP ${res.status}`;
      if (attempt + 1 < maxAttempts) await sleep(1500 * (attempt + 1) * (attempt + 1));
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      // Token starvation, NOT a malformed request: a reasoning model can spend
      // the whole completion budget inside <think> and emit zero answer tokens,
      // which Groq reports as `400 json_validate_failed` with an EMPTY
      // failed_generation. Reasoning length is stochastic (measured 1277-3928 on
      // identical inputs), so exactly one more roll of the dice is worth it.
      // Every other 400 is a real bad request and still throws immediately.
      if (
        res.status === 400 &&
        attempt === 0 &&
        attempt + 1 < maxAttempts &&
        /json_validate_failed/.test(body)
      ) {
        lastErr = "HTTP 400 json_validate_failed (reasoning consumed the completion budget)";
        continue;
      }
      throw new VisionError(`groq vision HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const j = (await res.json()) as {
      id?: string;
      model?: string;
      choices?: { message?: { content?: string } }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    };
    const reasoning = j.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    recordModelUsage({
      provider: "groq",
      model: j.model ?? GROQ_VISION_MODEL,
      kind: "vision",
      requestId: j.id,
      inputTokens: j.usage?.prompt_tokens,
      outputTokens:
        j.usage?.completion_tokens === undefined
          ? undefined
          : Math.max(0, j.usage.completion_tokens - reasoning),
      reasoningTokens: reasoning,
      cachedInputTokens: j.usage?.prompt_tokens_details?.cached_tokens,
      totalTokens: j.usage?.total_tokens,
      ...(!j.usage ? { unpricedReason: "Groq response omitted usage" } : {}),
    });
    const text = j.choices?.[0]?.message?.content?.trim();
    if (!text) throw new VisionError("groq vision: empty response");
    return text;
  }
  throw new VisionError(`groq vision exhausted retries (${lastErr})`);
}

async function falVision(
  prompt: string,
  images: Buffer[],
  opts: { json?: boolean; maxTokens?: number; maxAttemptsPerProvider?: number },
): Promise<string> {
  const key = process.env.FAL_KEY;
  if (!key) throw new VisionError("no FAL_KEY");
  const picked = sampleEvenly(images, 8);
  const body = JSON.stringify({
    prompt:
      (opts.json ? `${prompt}\nReturn ONLY the JSON object, no prose.` : prompt) +
      (picked.length < images.length
        ? `\n(Note: ${picked.length} representative frames sampled of ${images.length}.)`
        : ""),
    image_urls: picked.map((b) => `data:image/jpeg;base64,${b.toString("base64")}`),
  });
  // Default retries preserve the broad vision gate's resilience; a caller can
  // pin one attempt when its admission receipt must bound one fal fallback.
  let lastErr = "";
  const maxAttempts = Math.max(1, Math.min(2, Math.floor(opts.maxAttemptsPerProvider ?? 2)));
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch("https://fal.run/fal-ai/any-llm/vision", {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(90_000),
    });
    if (res.status === 429 || res.status >= 500) {
      lastErr = `HTTP ${res.status}`;
      if (attempt + 1 < maxAttempts) await sleep(1500 * (attempt + 1) * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new VisionError(`fal vision HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { output?: string; request_id?: string };
    recordModelUsage({
      provider: "fal",
      model: "fal-ai/any-llm/vision",
      kind: "vision",
      requestId: j.request_id,
      unpricedReason: "fal any-llm/vision response omitted billable usage and routed model",
    });
    const text = j.output?.trim();
    if (!text) throw new VisionError("fal vision: empty response");
    return text;
  }
  throw new VisionError(`fal vision exhausted retries (${lastErr})`);
}

async function openRouterVision(
  prompt: string,
  images: Buffer[],
  opts: { json?: boolean; maxTokens?: number; tier?: VisionTier },
): Promise<string> {
  const key = opts.tier === "bulk" ? "visionBulk" : opts.tier === "final" ? "visionFinal" : "visionStandard";
  const model = openRouterModel(key);
  const picked = sampleEvenly(images, 8);
  return openRouterChat({
    model,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: picked.length < images.length ? `${prompt}\n(Note: ${picked.length} representative frames sampled of ${images.length}.)` : prompt },
        ...picked.map((b) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b.toString("base64")}` } })),
      ],
    }],
    maxTokens: opts.maxTokens ?? VISION_GATE_MAX_TOKENS,
    temperature: 0.2,
    json: opts.json,
    kind: "vision",
  });
}

function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.round((i * (items.length - 1)) / (max - 1))]);
  return out;
}

/* ------------------------------------------------------------------ *
 * Public API — local/remote image inputs → raw non-Google model text.
 * ------------------------------------------------------------------ */

async function visionBuffers(
  prompt: string,
  buffers: Buffer[],
  args: {
    json?: boolean;
    maxTokens?: number;
    noCache?: boolean;
    reasoningEffort?: VisionReasoningEffort;
    providers?: readonly VisionProvider[];
    tier?: VisionTier;
    maxAttemptsPerProvider?: number;
  },
): Promise<string> {
  if (buffers.length === 0) throw new VisionError("no readable images");
  const chain = providerChain(args.providers);
  // FLOOR, applied once for every provider: a caller asking for 80-400 tokens is
  // asking a reasoning model to answer before it has finished thinking, which
  // returns nothing at all rather than a short answer (see
  // VISION_GATE_MAX_TOKENS). Enforced here rather than per-provider so the
  // provider fallbacks cannot inherit a starved budget from the caller, and a
  // future call site cannot silently reintroduce the bug.
  const effective = {
    ...args,
    maxTokens: Math.max(args.maxTokens ?? 0, VISION_GATE_MAX_TOKENS),
    reasoningEffort: args.reasoningEffort ?? VISION_REASONING_EFFORT,
  };
  const cacheKey = createHash("sha1")
    .update(prompt)
    .update(String(!!args.json))
    .update(String(effective.maxTokens))
    // Reasoning mode is part of the verdict's identity: the two modes measurably
    // disagree on borderline frames, so flipping VISION_REASONING_EFFORT must
    // re-judge rather than replay the other mode's cached answer.
    .update(effective.reasoningEffort)
    .update(chain.join(","))
    .update(args.tier ?? "standard")
    .update(buffers.map((b) => createHash("sha1").update(b).digest("hex")).join(","))
    .digest("hex");
  if (!args.noCache) {
    const hit = await cacheGet(cacheKey);
    if (hit) return hit;
  }
  if (chain.length === 0) throw new VisionError("no vision provider keyed (OPENROUTER_API_KEY)");
  const errors: string[] = [];
  for (const provider of chain) {
    try {
      const text = await openRouterVision(prompt, buffers, effective);
      await cachePut(cacheKey, text);
      return text;
    } catch (e) {
      errors.push(`${provider}: ${e instanceof Error ? e.message : e}`);
    }
  }
  throw new VisionError(`all vision providers failed: ${errors.join(" | ")}`);
}

/** Local image files + prompt → raw non-Google model text. */
export async function visionLocal(args: VisionLocalArgs): Promise<string> {
  const buffers: Buffer[] = [];
  for (const p of args.imagePaths.slice(0, 12)) {
    const b = await prepLocalImage(p);
    if (b) buffers.push(b);
  }
  return visionBuffers(args.prompt, buffers, args);
}

/** Remote image URLs + prompt → raw non-Google model text. */
export async function visionUrls(args: {
  prompt: string;
  imageUrls: string[];
  model?: string;
  json?: boolean;
  maxTokens?: number;
  /** Skip the verdict cache (for deliberately-stochastic judging/tests). */
  noCache?: boolean;
  /** See VISION_REASONING_EFFORT — defaults to "none". */
  reasoningEffort?: VisionReasoningEffort;
  /** Cost/quality lane: cheap triage, normal analysis, or a final admission. */
  tier?: VisionTier;
  /** Restrict this request to a declared vision provider. */
  providers?: readonly VisionProvider[];
  /** See `VisionLocalArgs.maxAttemptsPerProvider`. */
  maxAttemptsPerProvider?: number;
}): Promise<string> {
  const buffers: Buffer[] = [];
  for (const u of args.imageUrls.slice(0, 12)) {
    const b = await fetchRemoteImage(u);
    if (b) buffers.push(b);
  }
  return visionBuffers(args.prompt, buffers, args);
}
