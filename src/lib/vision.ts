/**
 * Provider-routed VISION client. Every image-understanding call in the
 * pipeline goes through visionLocal()/visionUrls(), which:
 *
 *   1. DOWNSCALES frames (ffmpeg → ≤768px JPEG) before base64-inlining —
 *      full-res 4K PNG frames were 10-20x the payload/tokens for zero judge
 *      value (the wrapper previously sent whatever the caller grabbed).
 *   2. CACHES verdicts by content hash (prompt + image bytes) — verify→heal
 *      →re-verify loops, retried blocks and dev re-renders stop re-billing
 *      identical questions.
 *   3. Uses one pinned application route instead of provider-specific fallbacks.
 *   4. ROUTES every review through the pinned Gemini 3.7 Flash model on
 *      OpenRouter (default VISION_PROVIDERS="openrouter").
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
import {
  FINAL_VISUAL_REVIEW_MAX_IMAGES_PER_REQUEST,
  NON_GOOGLE_VISION_MAX_IMAGES_PER_REQUEST,
} from "@/engine/visualReviewBudget";
import { recordModelUsage } from "@/lib/modelUsage";
import { hasOpenRouterKey, openRouterChat, openRouterModel } from "@/lib/openRouter";

/** Exact image limit for one OpenRouter vision-provider request. */
export const VISION_MAX_IMAGES_PER_REQUEST = NON_GOOGLE_VISION_MAX_IMAGES_PER_REQUEST;

export class VisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisionError";
  }
}

/**
 * Compatibility hint retained for existing callers; the pinned OpenRouter
 * Gemini route ignores provider-specific Groq reasoning controls.
 */

export interface VisionLocalArgs {
  prompt: string;
  imagePaths: string[];
  /** Legacy model hint — accepted and ignored (routing is provider-based). */
  model?: string;
  json?: boolean;
  maxTokens?: number;
  /** Skip the verdict cache (for deliberately-stochastic judging). */
  noCache?: boolean;
  /** Restrict this review to specific application providers. */
  providers?: readonly VisionProvider[];
  /** Cost/quality lane: cheap triage, normal analysis, or a final admission. */
  tier?: VisionTier;
}

/** OpenRouter is the single application vision boundary. */
export type VisionProvider = "openrouter";
export type VisionTier = "bulk" | "standard" | "final";

/**
 * Final-master review uses a constrained receipt route. Keep direct callers
 * on its same envelope so they cannot bypass the
 * visual-review batch planner with a larger final-tier request.
 */
function maxImagesForVisionTier(tier: VisionTier | undefined): number {
  return tier === "final"
    ? FINAL_VISUAL_REVIEW_MAX_IMAGES_PER_REQUEST
    : VISION_MAX_IMAGES_PER_REQUEST;
}

/** Is the approved OpenRouter vision provider available? */
export function hasVisionKey(): boolean {
  return providerChain().length > 0;
}

/** Compatibility name: true when the independent OpenRouter reviewer is available. */
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
      "[vision] !!! vision QA DISABLED (no providers) — set OPENROUTER_API_KEY",
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


/**
 * Minimum completion budget for ANY vision gate.
 *
 * The pinned vision model is a REASONING model: its internal pass is billed
 * against max_tokens and runs BEFORE a single answer token is emitted. Measured
 * on real frames with a full-length production gate prompt, reasoning alone came
 * in at 1277-3928 tokens per call. Anything below that emits nothing, surfaced
 * as a hard `400 json_validate_failed` (json mode) or a truncated reasoning blob
 * that fails to parse (non-json mode).
 *
 * That measurement was taken on the since-retired Groq route, but the constraint
 * did not go away with it — it got stricter. Groq at least accepted
 * reasoning_effort:"none"; the OpenRouter route vision now runs on refuses to
 * disable reasoning at all (see the note below the constant). So this budget is
 * the only thing standing between a gate and silence.
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
 * WHY GATES WOULD RATHER NOT REASON — kept as evidence, no longer as a control.
 *
 * The retired Groq vision route could send reasoning_effort, and an A/B over 13
 * real gate cases (footagecraft relevance + natureMode, documotion asset gate,
 * thumbnailLab QA gate, cinecraft keyframe drift), 5 runs per condition, 130
 * calls, measured "none" as strictly better for gate-style judgement:
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
 * "none" regressed zero gates and strictly beat "default" on two, including
 * documotion's clean-asset case where reasoning returned FOUR different verdicts
 * for one unchanged image.
 *
 * That control no longer exists here. Vision now runs exclusively through
 * OpenRouter, whose pinned Gemini route makes reasoning MANDATORY — the API
 * rejects reasoning:{enabled:false}, {effort:"none"}, {max_tokens:0} and
 * reasoning_effort with "Reasoning is mandatory for this endpoint and cannot be
 * disabled", and {exclude:true} only hides it from the response while still
 * spending the budget (measured: 193 of 200 tokens). The old reasoningEffort
 * option was therefore doing nothing except partitioning the verdict cache, so
 * it has been removed rather than left looking like a lever.
 *
 * The practical consequence is VISION_GATE_MAX_TOKENS above: since reasoning
 * cannot be switched off, the ceiling has to be able to absorb it.
 */
  process.env.VISION_REASONING_EFFORT === "default" ? "default" : "none";

async function openRouterVision(
  prompt: string,
  images: Buffer[],
  opts: { json?: boolean; maxTokens?: number; tier?: VisionTier },
): Promise<string> {
  if (images.length > VISION_MAX_IMAGES_PER_REQUEST) {
    throw new VisionError(
      `OpenRouter vision requests may contain at most ${VISION_MAX_IMAGES_PER_REQUEST} images`,
    );
  }
  const key = opts.tier === "bulk" ? "visionBulk" : opts.tier === "final" ? "visionFinal" : "visionStandard";
  const model = openRouterModel(key);
  return openRouterChat({
    model,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        ...images.map((b) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b.toString("base64")}` } })),
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
 * Public API — local/remote image inputs → raw pinned OpenRouter model text.
 * ------------------------------------------------------------------ */

async function visionBuffers(
  prompt: string,
  buffers: Buffer[],
  args: {
    json?: boolean;
    maxTokens?: number;
    noCache?: boolean;
    providers?: readonly VisionProvider[];
    tier?: VisionTier;
  },
): Promise<string> {
  if (buffers.length === 0) throw new VisionError("no readable images");
  if (buffers.length > VISION_MAX_IMAGES_PER_REQUEST) {
    throw new VisionError(
      `OpenRouter vision requests may contain at most ${VISION_MAX_IMAGES_PER_REQUEST} images`,
    );
  }
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
  };
  const cacheKey = createHash("sha1")
    .update(prompt)
    .update(String(!!args.json))
    .update(String(effective.maxTokens))
    // Reasoning mode is part of the verdict's identity: the two modes measurably
    // disagree on borderline frames, so flipping VISION_REASONING_EFFORT must
    // re-judge rather than replay the other mode's cached answer.
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

/** Local image files + prompt → raw pinned OpenRouter model text. */
export async function visionLocal(args: VisionLocalArgs): Promise<string> {
  const maxImages = maxImagesForVisionTier(args.tier);
  if (args.imagePaths.length > maxImages) {
    throw new VisionError(
      `visionLocal received ${args.imagePaths.length} images for ${args.tier ?? "standard"} review; ` +
        `split into requests of at most ${maxImages}`,
    );
  }
  const buffers: Buffer[] = [];
  for (const p of args.imagePaths) {
    const b = await prepLocalImage(p);
    if (!b) throw new VisionError(`could not prepare required image ${p}`);
    buffers.push(b);
  }
  return visionBuffers(args.prompt, buffers, args);
}

/** Remote image URLs + prompt → raw pinned OpenRouter model text. */
export async function visionUrls(args: {
  prompt: string;
  imageUrls: string[];
  model?: string;
  json?: boolean;
  maxTokens?: number;
  /** Skip the verdict cache (for deliberately-stochastic judging/tests). */
  noCache?: boolean;
  /** See VISION_REASONING_EFFORT — defaults to "none". */
  /** Cost/quality lane: cheap triage, normal analysis, or a final admission. */
  tier?: VisionTier;
  /** Restrict this request to a declared vision provider. */
  providers?: readonly VisionProvider[];
}): Promise<string> {
  const maxImages = maxImagesForVisionTier(args.tier);
  if (args.imageUrls.length > maxImages) {
    throw new VisionError(
      `visionUrls received ${args.imageUrls.length} images for ${args.tier ?? "standard"} review; ` +
        `split into requests of at most ${maxImages}`,
    );
  }
  const buffers: Buffer[] = [];
  for (const u of args.imageUrls) {
    const b = await fetchRemoteImage(u);
    if (!b) throw new VisionError(`could not fetch required image ${u}`);
    buffers.push(b);
  }
  return visionBuffers(args.prompt, buffers, args);
}
