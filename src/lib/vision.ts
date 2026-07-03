/**
 * Provider-routed VISION client — the drop-in replacement for direct Gemini
 * vision calls (the Google-bill driver). Every image-understanding call in the
 * pipeline goes through visionLocal()/visionUrls(), which:
 *
 *   1. DOWNSCALES frames (ffmpeg → ≤768px JPEG) before base64-inlining —
 *      full-res 4K PNG frames were 10-20x the payload/tokens for zero judge
 *      value (the wrapper previously sent whatever the caller grabbed).
 *   2. CACHES verdicts by content hash (prompt + image bytes) — verify→heal
 *      →re-verify loops, retried blocks and dev re-renders stop re-billing
 *      identical questions.
 *   3. ROUTES to the cheapest available provider, in VISION_PROVIDERS order
 *      (default "groq,fal,gemini"):
 *        groq   → llama-4-scout (FREE tier: 1k req/day, vision, JSON mode)
 *        fal    → any-llm/vision (existing paid key; ~$0.01/request)
 *        gemini → gemini-2.5-flash (LAST resort — set VISION_DISABLE_GEMINI=1
 *                 to hard-forbid Google vision)
 *
 * Contract preserved from geminiVisionLocal: returns the model's RAW TEXT
 * (JSON text when json:true — callers keep parsing with parseJsonLoose, which
 * tolerates fences/truncation). Throws on total failure; every caller already
 * self-guards with a fallback verdict.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class VisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisionError";
  }
}

export interface VisionLocalArgs {
  prompt: string;
  imagePaths: string[];
  /** Legacy Gemini model hint — accepted and ignored (routing is provider-based). */
  model?: string;
  json?: boolean;
  maxTokens?: number;
  /** Skip the verdict cache (for deliberately-stochastic judging). */
  noCache?: boolean;
}

/** Mirror of hasGeminiKey() guard semantics: is ANY vision provider available? */
export function hasVisionKey(): boolean {
  return providerChain().length > 0;
}

function geminiVisionAllowed(): boolean {
  return Boolean(process.env.GEMINI_API_KEY) && process.env.VISION_DISABLE_GEMINI !== "1";
}

function providerChain(): string[] {
  const order = (process.env.VISION_PROVIDERS || "groq,fal,gemini").split(",").map((s) => s.trim());
  return order.filter(
    (p) =>
      (p === "groq" && !!process.env.GROQ_API_KEY) ||
      (p === "fal" && !!process.env.FAL_KEY) ||
      (p === "gemini" && geminiVisionAllowed()),
  );
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
    const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
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
  process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";
/** Groq caps vision requests at 5 images — beyond that, sample evenly. */
const GROQ_MAX_IMAGES = 5;

async function groqVision(
  prompt: string,
  images: Buffer[],
  opts: { json?: boolean; maxTokens?: number },
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
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GROQ_VISION_MODEL,
        messages: [{ role: "user", content }],
        max_tokens: Math.min(opts.maxTokens ?? 1024, 4096),
        temperature: 0.2,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (res.status === 429 || res.status >= 500) {
      lastErr = `HTTP ${res.status}`;
      await sleep(1500 * (attempt + 1) * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new VisionError(`groq vision HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = j.choices?.[0]?.message?.content?.trim();
    if (!text) throw new VisionError("groq vision: empty response");
    return text;
  }
  throw new VisionError(`groq vision exhausted retries (${lastErr})`);
}

async function falVision(
  prompt: string,
  images: Buffer[],
  opts: { json?: boolean; maxTokens?: number },
): Promise<string> {
  const key = process.env.FAL_KEY;
  if (!key) throw new VisionError("no FAL_KEY");
  const picked = sampleEvenly(images, 8);
  const res = await fetch("https://fal.run/fal-ai/any-llm/vision", {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt:
        (opts.json ? `${prompt}\nReturn ONLY the JSON object, no prose.` : prompt) +
        (picked.length < images.length
          ? `\n(Note: ${picked.length} representative frames sampled of ${images.length}.)`
          : ""),
      image_urls: picked.map((b) => `data:image/jpeg;base64,${b.toString("base64")}`),
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new VisionError(`fal vision HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { output?: string };
  const text = j.output?.trim();
  if (!text) throw new VisionError("fal vision: empty response");
  return text;
}

async function geminiVisionBuffers(
  prompt: string,
  images: Buffer[],
  opts: { json?: boolean; maxTokens?: number },
): Promise<string> {
  const { geminiVisionLocal } = await import("@/lib/gemini");
  const dir = await cacheDir();
  const paths: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const p = join(dir, `gv-${createHash("sha1").update(images[i]).digest("hex").slice(0, 16)}.jpg`);
    await writeFile(p, images[i]);
    paths.push(p);
  }
  return geminiVisionLocal({ prompt, imagePaths: paths, json: opts.json, maxTokens: opts.maxTokens });
}

function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.round((i * (items.length - 1)) / (max - 1))]);
  return out;
}

/* ------------------------------------------------------------------ *
 * Public API — drop-in for geminiVisionLocal / geminiVision.
 * ------------------------------------------------------------------ */

async function visionBuffers(
  prompt: string,
  buffers: Buffer[],
  args: { json?: boolean; maxTokens?: number; noCache?: boolean },
): Promise<string> {
  if (buffers.length === 0) throw new VisionError("no readable images");
  const cacheKey = createHash("sha1")
    .update(prompt)
    .update(String(!!args.json))
    .update(buffers.map((b) => createHash("sha1").update(b).digest("hex")).join(","))
    .digest("hex");
  if (!args.noCache) {
    const hit = await cacheGet(cacheKey);
    if (hit) return hit;
  }

  const chain = providerChain();
  if (chain.length === 0) throw new VisionError("no vision provider keyed (GROQ_API_KEY / FAL_KEY / GEMINI_API_KEY)");
  const errors: string[] = [];
  for (const provider of chain) {
    try {
      const text =
        provider === "groq"
          ? await groqVision(prompt, buffers, args)
          : provider === "fal"
            ? await falVision(prompt, buffers, args)
            : await geminiVisionBuffers(prompt, buffers, args);
      await cachePut(cacheKey, text);
      return text;
    } catch (e) {
      errors.push(`${provider}: ${e instanceof Error ? e.message : e}`);
    }
  }
  throw new VisionError(`all vision providers failed: ${errors.join(" | ")}`);
}

/** Drop-in for geminiVisionLocal: local image files + prompt → raw model text. */
export async function visionLocal(args: VisionLocalArgs): Promise<string> {
  const buffers: Buffer[] = [];
  for (const p of args.imagePaths.slice(0, 12)) {
    const b = await prepLocalImage(p);
    if (b) buffers.push(b);
  }
  return visionBuffers(args.prompt, buffers, args);
}

/** Drop-in for geminiVision: remote image URLs + prompt → raw model text. */
export async function visionUrls(args: {
  prompt: string;
  imageUrls: string[];
  model?: string;
  json?: boolean;
  maxTokens?: number;
}): Promise<string> {
  const buffers: Buffer[] = [];
  for (const u of args.imageUrls.slice(0, 12)) {
    const b = await fetchRemoteImage(u);
    if (b) buffers.push(b);
  }
  return visionBuffers(args.prompt, buffers, args);
}
