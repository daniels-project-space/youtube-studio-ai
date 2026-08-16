/**
 * BANANA — shared still-image provider adapter.
 *
 * Real thumbnail paths use `thumbnailRenderer.ts`: this module renders their
 * text-free base art, while exact typography is composited locally. Thumbnail
 * callers use the strict Nano Banana exports below; the legacy provider router
 * remains available only to non-thumbnail still-image workloads.
 */
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { canonicalJson } from "@/lib/canonicalJson";
import {
  assertGeminiRuntimeAllowed,
  isGeminiRuntimeEnabled,
  parseJsonLoose,
  sealedNanoBananaThumbnailPurpose,
} from "@/lib/gemini";
import { visionLocal, VISION_GATE_MAX_TOKENS } from "@/lib/vision";
import { generateFalImage } from "@/lib/falImage";
import { hydrateEnv } from "@/lib/vault";
import { PRICE } from "@/engine/pricing";
import { recordImageUsage } from "@/lib/imageUsage";
import { rasterImageDimensions } from "@/lib/imageDimensions";
import {
  NANO_BANANA_THUMBNAIL_PROFILE,
  nanoBananaThumbnailCostUsd,
  nanoBananaThumbnailPromptCostUsd,
  type NanoBananaImageReceipt,
} from "@/lib/nanoBananaThumbnailContract";

export {
  NANO_BANANA_THUMBNAIL_PROFILE,
  type NanoBananaImageReceipt,
} from "@/lib/nanoBananaThumbnailContract";

/**
 * MODEL TIERS. Pro (gemini-3-pro-image, ~$0.13/img) remains available for
 * explicitly non-thumbnail design experiments/type cards. Flash (classic Nano
 * Banana, ~$0.04/img) is the DEFAULT for
 * every picture-only render (documotion assets, whiteboard layers, comic
 * panels, lore scenes, lofi stills — ~90% of image volume): Pro-first for
 * those was a silent 3.4x on the whole image bill. Flash tier never silently
 * upgrades to Pro (a transient flash blip must not 3.4x the price).
 * BANANA_FORCE_MODEL overrides everything (emergency pin).
 */
const PRO_MODELS = ["gemini-3-pro-image-preview", "gemini-2.5-flash-image"];
const FLASH_MODELS = ["gemini-2.5-flash-image"];

function modelsFor(tier: "pro" | "flash"): string[] {
  if (process.env.BANANA_FORCE_MODEL) return [process.env.BANANA_FORCE_MODEL];
  return tier === "pro" ? PRO_MODELS : FLASH_MODELS;
}

/** Billed-generation counters (by tier) — pipeline blocks report real cost from
 *  these. `fal` counts router-delegated FLUX renders (≈ $0.04/image — the same
 *  rate as banana flash, which is what cost consumers bill it at). */
/** Legacy diagnostics/fallback only. Authoritative per-block accounting lives
 * in the AsyncLocalStorage image-usage scope installed by the runner. */
export const bananaCounters = { pro: 0, flash: 0, fal: 0, falCostUsd: 0 };

/**
 * A Gemini image submission that ended without a durable image response.
 * The generateContent endpoint exposes neither an idempotency key nor an
 * accepted-job recovery handle, so repeating an ambiguous request can buy the
 * same image twice. Explicit 429 responses are handled separately because
 * they prove the request was rejected before generation.
 */
export class BananaImageSubmissionError extends Error {
  readonly retryable = false;
  readonly status?: number;
  readonly code = "BANANA_IMAGE_SUBMISSION_AMBIGUOUS";

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "BananaImageSubmissionError";
    this.status = options.status;
  }
}

/**
 * PROVIDER ROUTER ("no Google image gen" switch). The fal route is active when
 * the operator sets IMAGE_DISABLE_GEMINI=1 or puts "fal" FIRST in
 * IMAGE_PROVIDERS. Default (both unset) keeps the Google path byte-for-byte.
 */


export function hasBanana(): boolean {
  // Generic image generation is FAL-only. Gemini's distinct capability is
  // intentionally exposed only as `hasNanoBanana()` for sealed thumbnails.
  return !!process.env.FAL_KEY;
}

/** Thumbnail readiness ignores the generic image router by design. */
export function hasNanoBanana(): boolean {
  // Normal worker bootstrap intentionally does not load the thumbnail-only
  // credential. A vault-authenticated worker is therefore *eligible* here;
  // the actual sealed route hydrates and verifies the key immediately before
  // its provider boundary below.
  return isGeminiRuntimeEnabled() && Boolean(process.env.GEMINI_API_KEY || process.env.VAULT_ACCESS_TOKEN);
}

/**
 * Keep the Gemini credential inside the only admitted caller. Generic worker
 * bootstrap must never make this credential available to scripts, planners,
 * reviewers, or any future Google SDK import.
 */
async function hydrateSealedNanoBananaThumbnailCredential(): Promise<void> {
  assertGeminiRuntimeAllowed(
    "Nano Banana thumbnail credential",
    sealedNanoBananaThumbnailPurpose(),
  );
  if (!process.env.GEMINI_API_KEY) {
    await hydrateEnv("gemini", {
      geminiPurpose: sealedNanoBananaThumbnailPurpose(),
    });
  }
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("nano banana thumbnail: GEMINI_API_KEY is not configured in the sealed thumbnail vault service");
  }
}

/** The proven craft contract — prepended to EVERY brief. */
export const BANANA_RULES =
  "Rules: 1280x720 YouTube thumbnail. The hero fills 55-75% of the frame, aggressively cropped. " +
  "Typography is HUGE (owns 25-40% of the frame), ultra-bold, rendered as a designed physical object " +
  "(plate, smear, strip, slab or sticker) made of the scene's material world, with one PAYOFF word 2-4x " +
  "larger than the rest. HARD RULE: text NEVER covers the hero's face or eyes - beside, above or across " +
  "the body only. Spelling EXACTLY as quoted - every visible word must be a correctly spelled real word. " +
  "Everything must read at 120px on a phone. No play buttons, no UI, no watermarks, no extra small text.";

/** Channel-signature type treatments, described as physical material. */
export const TEXT_OBJECT_LANGUAGE: Record<string, string> = {
  torn_strip: "each word printed HUGE on its own torn newspaper strip, every strip a DIFFERENT bold tabloid serif, aged newsprint texture, strips rotated and interleaved - some BEHIND the hero, some IN FRONT - with hard drop shadows",
  paint_smear: "in elegant wide-letterspaced serif capitals sitting ON TOP of a rough hand-swiped paint smear in the accent color, wet bristle texture and flicked droplets",
  censor_bar: "in white stencil capitals printed on a solid accent-color censor bar laid straight across the frame (across the eyes if the hero is a face)",
  grunge_sticker: "as ONE single lowercase word ending in a period, in a distressed punk typeface, white knockout on a rough black sticker box with peeling corners - deadpan, huge",
  spaced_elegant: "in thin EXTREMELY wide-letterspaced capitals integrated into the artwork material, with a small quiet subtitle beneath",
  block_plate: "in ultra-heavy condensed capitals on hard solid plates, the key word underlined with a rough hand-painted brush stroke in the accent color",
  neon_sign: "as REAL glowing neon tubes mounted in the scene, casting colored light onto the hero, one tube flickering half-lit",
  spray_paint: "stencil-sprayed onto the scene surface in the accent color, paint drips running from the letterforms, overspray haze",
  stamp_ink: "as a HUGE rubber-stamp imprint slammed diagonally across the frame like a CLASSIFIED stamp, cracked dry ink, double-struck ghosting",
  movie_poster: "as cinematic title-card lettering with metallic bevel and rim light, embedded in the scene atmosphere, blockbuster one-sheet gravity",
  ransom_note: "with each letter cut from a different magazine page in a different font and color, glued unevenly with visible tape and shadows",
  carved: "physically carved into the scene's dominant material (stone, wood, steel) with real chisel depth, the cuts catching the key light",
};

export interface ThumbBriefArgs {
  channelName: string;
  /** ≤12-word channel rendering style, e.g. "bold sumi-e ink wash on washi paper". */
  imageStyle?: string;
  palette?: string[];
  accentColor?: string;
  /** Signature type treatment key (TEXT_OBJECT_LANGUAGE) — omit for model's choice. */
  textObject?: string;
  /** "cutout_collage" forces die-cut-photo-over-collage (anti-AI-look for commentary channels). */
  composition?: string;
  /** The scene that ENACTS the topic: hero + background + story details. */
  scene: string;
  /** 1-3 headline lines; mark exactly one as the payoff (rendered 2-4x larger). */
  lines: { text: string; payoff?: boolean; accent?: boolean }[];
  badge: string;
}

/** Compose the proven brief shape (rules + identity + scene + headline + badge). */
export function buildThumbBrief(a: ThumbBriefArgs): string {
  const typeClause = a.textObject && TEXT_OBJECT_LANGUAGE[a.textObject]
    ? ` Render the headline ${TEXT_OBJECT_LANGUAGE[a.textObject]}.`
    : " Render the headline as a designed physical object belonging to the scene's material world.";
  const collage = a.composition === "cutout_collage"
    ? " COMPOSITION: the hero is a die-cut PHOTO cutout with a crisp edge pasted OVER a designed collage background (torn clippings, photos, graphic shapes, paper texture, hard cut shadows) - real photographic grain, magazine composite, NEVER a continuous smooth AI scene."
    : "";
  const headline = a.lines
    .map((l) => `"${l.text.toUpperCase()}"${l.payoff ? " (the payoff word, HUGE)" : ""}${l.accent ? " (accent color)" : ""}`)
    .join(" then ");
  return (
    `${BANANA_RULES} Channel "${a.channelName.toUpperCase()}"` +
    `${a.imageStyle ? ` (signature look, obey strictly: ${a.imageStyle}` : " ("}` +
    `${a.palette?.length ? `, palette ${a.palette.join(" / ")}` : ""}` +
    `${a.accentColor ? `, accent ${a.accentColor}` : ""}).` +
    `${collage} Scene: ${a.scene}` +
    ` Headline: ${headline} - placed clear of all faces.${typeClause}` +
    ` Small badge pill "${a.badge.toUpperCase()}" in a corner away from the text.`
  );
}

/**
 * Picture-only half of the thumbnail brief. Used on providers that are strong
 * scene renderers but unreliable spellers; the channel typography is added by
 * the deterministic safe-zone compositor afterward.
 */
export function buildThumbSceneBrief(a: ThumbBriefArgs & { textZone?: string }): string {
  const collage = a.composition === "cutout_collage"
    ? " The hero is a crisp die-cut photographic cutout over a deliberate editorial collage of torn clippings, graphic shapes, paper texture, and hard cut shadows."
    : " Render one coherent, premium cinematic scene with clear depth.";
  const zone = a.textZone ?? "left";
  return (
    `1280x720 YouTube thumbnail BASE ART for channel "${a.channelName}". ` +
    `Signature look: ${a.imageStyle ?? "premium cinematic editorial art"}. ` +
    `${a.palette?.length ? `Palette: ${a.palette.join(" / ")}. ` : ""}` +
    `${a.accentColor ? `Accent: ${a.accentColor}. ` : ""}` +
    `Scene: ${a.scene}.${collage} ` +
    `The hero must fill 55-70% of the frame on the side OPPOSITE the ${zone} text zone. ` +
    `Keep the ${zone} 42% of the frame darker, simple, and genuinely empty for a later headline overlay. ` +
    `The scene alone must communicate the video's subject at phone size. Maximum three visual elements. ` +
    `No text, no letters, no numbers, no signs, no logos, no badges, no UI, no watermark.`
  );
}

/** Locked request contract for deterministic-composite thumbnails. */
export function buildThumbSceneRequest(a: ThumbBriefArgs & { textZone?: string }): {
  prompt: string;
  allowText: false;
  tier: "flash";
} {
  return {
    prompt: buildThumbSceneBrief(a),
    allowText: false,
    tier: "flash",
  };
}

/**
 * Judge-gate vision call that DISTINGUISHES a provider error from a verdict.
 * The old `.catch(() => "")` failed OPEN: a dead vision provider turned every
 * gate check into a pass (`v.x !== false`), so unverified spelling shipped.
 * Now a provider error is RETRIED once; a second error returns null, and the
 * caller decides: allowText renders (thumbnails/type cards) must treat null as
 * a FAILED textOk (spelling can't ship unverified); picture-only
 * (allowText:false) renders keep the old pass-with-warning behavior.
 */
async function judgeVision(
  args: Parameters<typeof visionLocal>[0],
  log?: (m: string) => void,
): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await visionLocal(args);
    } catch (e) {
      log?.(`banana: vision judge error (attempt ${attempt + 1}/2): ${e instanceof Error ? e.message : e}`);
    }
  }
  return null;
}

/**
 * BANANA TYPE CARD — generate a bespoke DESIGNED-TYPOGRAPHY card (a film
 * title/end card) for a hero line, instead of a generic web font. Spelling is
 * gated by the vision judge with one retry; returns the jpg path, or null so
 * the caller falls back to rendered CSS type. (Daniel: "fonts especially at the
 * end need to be more unique — maybe nano banana?")
 */
export async function bananaTypeCard(args: {
  text: string;
  /** Words to emphasise in the accent colour. */
  emphasis?: string[];
  /** World/type art-direction, e.g. "distressed cinematic crime-thriller title". */
  styleDesc: string;
  /** Tone/framing note from the reasonability pass (keeps it tasteful). */
  framing?: string;
  accent: string;
  outJpg: string;
  log?: (m: string) => void;
}): Promise<string | null> {
  const emph = args.emphasis?.length ? ` Set the words ${args.emphasis.map((w) => `"${w}"`).join(", ")} in the accent colour ${args.accent}.` : "";
  const tone = args.framing ? ` TONE/FRAMING: ${args.framing}` : "";
  const base =
    `A cinematic 16:9 TITLE CARD built ENTIRELY from beautiful designed typography. Render this exact line as the ` +
    `hero lettering: "${args.text}". Art direction: ${args.styleDesc}; expressive, premium, magazine/film-poster ` +
    `quality, considered scale contrast and layout, atmospheric dark background with subtle texture and depth.${emph}${tone} ` +
    `HARD RULES: every word present and spelled EXACTLY as written; it must read perfectly; PURE TYPOGRAPHY ONLY — ` +
    `NO icons, NO illustrations, NO drawings, NO emoji; NO watermark, NO UI, NO extra words, NO gibberish letters.`;
  let fix = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const bytes = await generateBananaImage({ prompt: base + fix, aspectRatio: "16:9", allowText: true });
      await writeFile(args.outJpg, bytes);
      const raw = await judgeVision({
        prompt:
          `TYPOGRAPHY GATE. Does this card show the EXACT line "${args.text}" — every word present, correctly ` +
          `spelled, fully legible, no gibberish or extra words? Return STRICT JSON {"exact":bool,"legible":bool,"fix":"<=12 words"}.`,
        imagePaths: [args.outJpg],
        json: true,
        maxTokens: VISION_GATE_MAX_TOKENS,
      }, args.log);
      if (raw == null) {
        // Judge unavailable after retry → spelling is UNVERIFIED. Re-rendering
        // won't fix a dead judge, so fall straight back to crisp CSS type.
        args.log?.("banana type card: VISION JUDGE UNAVAILABLE — spelling unverified, falling back to CSS type");
        return null;
      }
      const v = parseJsonLoose<{ exact?: boolean; legible?: boolean; fix?: string }>(raw);
      if (v.exact !== false && v.legible !== false) {
        args.log?.(`banana type card OK: "${args.text.slice(0, 40)}"`);
        return args.outJpg;
      }
      fix = ` PREVIOUS ATTEMPT WRONG: ${v.fix ?? "spell every word exactly, no gibberish"}. Render the line letter-for-letter: "${args.text}".`;
      args.log?.(`banana type card rejected (exact=${v.exact} legible=${v.legible}) — ${attempt === 0 ? "retry" : "fallback to CSS"}`);
    } catch (e) {
      args.log?.(`banana type card error: ${e instanceof Error ? e.message : e}`);
    }
  }
  return null; // unconfirmed spelling → caller renders crisp CSS type instead
}

/** One generation. Returns jpg/png bytes. Throws loud — never silent-degrades. */
/** Appended to every PICTURE-ONLY render so the model never bakes in titles/
 *  captions/labels — those are the engine's overlays. The single universal guard
 *  every pipeline inherits (the per-brief "no text" notes were weak + inconsistent). */
export const NO_TEXT_CLAUSE =
  " ABSOLUTE RULE — PICTURE ONLY, NO TEXT: do NOT render any words, letters, numbers, titles, captions, " +
  "subtitles, labels, callouts, signage text, logos, watermarks or typography of ANY kind anywhere in the image. " +
  "Every title and label is added afterwards by the engine as an overlay. If a scene would naturally contain " +
  "writing (a sign, a page, a map), render it as ILLEGIBLE texture, not real words.";

export interface BananaImageArgs {
  prompt: string;
  aspectRatio?: string;
  /** "1K" | "2K" | "4K" — Pro model only; defaults to "2K". */
  imageSize?: string;
  /** Optional input images (base64) for img2img / style-reference conditioning. */
  images?: { data: string; mimeType?: string }[];
  /** Legacy/manual text-design escape hatch. Production thumbnails must use
   *  thumbnailRenderer and never set this. Default false: picture-only with
   *  NO_TEXT_CLAUSE appended. */
  allowText?: boolean;
  /** Cost tier. Default: "pro" only for legacy text-design renders
   *  (`allowText`), otherwise "flash". */
  tier?: "pro" | "flash";
  /** Maximum HTTP submissions after explicit 429 rejections. Every ambiguous
   * transport/response failure stops after one potentially-paid submission;
   * callers may still own a separate, intentional quality attempt after they
   * received and graded a real image. */
  maxProviderAttempts?: 1 | 2 | 3;
}

export interface NanoBananaImageResult {
  bytes: Buffer;
  receipt: NanoBananaImageReceipt;
}

interface GeminiImageResult {
  bytes: Buffer;
  model: string;
  route: string;
  width: number;
  height: number;
  costUsd: number;
  sourceContentType: string;
  requestCanonicalJson: string;
  promptUtf8Bytes?: number;
  promptTokenCount?: number;
  promptCostUsd?: number;
  outputCostUsd?: number;
  modelVersion?: string;
  responseId?: string;
  providerResponseMetadataCanonicalJson?: string;
  providerResponseMetadataSha256?: string;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function generateGeminiImage(
  args: BananaImageArgs,
  options: {
    models: readonly string[];
    route?: string;
    requestContext?: string;
    strictNanoThumbnail?: boolean;
  },
): Promise<GeminiImageResult> {
  // Gemini is thumbnail-only. Generic `generateBananaImage()` callers must
  // take their FAL route; only the receipt-bound profile below can spend here.
  assertGeminiRuntimeAllowed(
    options.strictNanoThumbnail
      ? "sealed Nano Banana thumbnail image generation"
      : "Gemini image generation outside the sealed thumbnail module",
    options.strictNanoThumbnail ? sealedNanoBananaThumbnailPurpose() : undefined,
  );
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("banana: GEMINI_API_KEY missing (vault service 'gemini')");
  const prompt = args.allowText ? args.prompt : args.prompt + NO_TEXT_CLAUSE;
  const promptUtf8Bytes = Buffer.byteLength(prompt, "utf8");
  if (
    options.strictNanoThumbnail &&
    promptUtf8Bytes > NANO_BANANA_THUMBNAIL_PROFILE.maxPromptUtf8Bytes
  ) {
    throw new Error(
      `nano banana thumbnail prompt is ${promptUtf8Bytes} UTF-8 bytes; ` +
      `the fail-closed maximum is ${NANO_BANANA_THUMBNAIL_PROFILE.maxPromptUtf8Bytes}`,
    );
  }
  const maxProviderAttempts = Math.max(1, Math.min(2, args.maxProviderAttempts ?? 2));
  const parts: Record<string, unknown>[] = [{ text: prompt }];
  for (const im of args.images ?? []) {
    parts.push({ inlineData: { mimeType: im.mimeType ?? "image/png", data: im.data } });
  }
  let lastErr = "";
  for (const model of options.models) {
    const imageConfig: Record<string, string> = { aspectRatio: args.aspectRatio ?? "16:9" };
    if (model.includes("gemini-3-pro-image")) imageConfig.imageSize = args.imageSize ?? "2K";
    const body = {
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig,
      },
    };
    const requestCanonicalJson = canonicalJson({
      apiVersion: "v1beta",
      ...(options.requestContext ? { context: options.requestContext } : {}),
      model,
      operation: "generateContent",
      body,
    });
    for (let attempt = 0; attempt < maxProviderAttempts; attempt++) {
      let res: Response;
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(180_000),
          },
        );
      } catch (error) {
        throw new BananaImageSubmissionError(
          `${model}: image submission transport failed without a durable response; refusing automatic resubmission`,
          { cause: error },
        );
      }

      const raw = await res.text();
      let json: {
        candidates?: {
          content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] };
        }[];
        modelVersion?: string;
        responseId?: string;
        usageMetadata?: Record<string, unknown> & { promptTokenCount?: number };
        error?: { message?: string };
      } = {};
      try {
        json = raw ? JSON.parse(raw) as typeof json : {};
      } catch (error) {
        throw new BananaImageSubmissionError(
          `${model}: provider returned an unreadable HTTP ${res.status} response without a durable image; ` +
            "refusing automatic resubmission",
          { status: res.status, cause: error },
        );
      }

      if (res.status === 429) {
        lastErr = `${model} HTTP 429: ${json.error?.message ?? "rate limited"}`;
        if (attempt + 1 < maxProviderAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 4_000));
        }
        continue;
      }
      if (!res.ok) {
        throw new BananaImageSubmissionError(
          `${model}: provider returned HTTP ${res.status} without a durable image; ` +
            `refusing automatic resubmission: ${json.error?.message ?? raw.slice(0, 240)}`,
          { status: res.status },
        );
      }
      const part = (json.candidates?.[0]?.content?.parts ?? [])
        .find((candidate) => candidate.inlineData?.data);
      if (!part?.inlineData?.data) {
        throw new BananaImageSubmissionError(
          `${model}: provider accepted the request but returned no durable image; refusing model fallback/resubmission`,
          { status: res.status },
        );
      }
      const bytes = Buffer.from(part.inlineData.data, "base64");
      const dimensions = rasterImageDimensions(bytes);
      const declaredContentType = (part.inlineData.mimeType?.split(";", 1)[0] ?? "")
        .trim()
        .toLowerCase()
        .replace(/^image\/jpg$/, "image/jpeg");
      if (declaredContentType && declaredContentType !== dimensions.contentType) {
        throw new BananaImageSubmissionError(
          `${model}: provider declared ${declaredContentType} but returned ${dimensions.contentType} bytes`,
          { status: res.status },
        );
      }
      const isPro = model.includes("gemini-3-pro-image");
      let costUsd = isPro ? PRICE.bananaProUsd : PRICE.bananaFlashUsd;
      let promptTokenCount: number | undefined;
      let promptCostUsd: number | undefined;
      let outputCostUsd: number | undefined;
      let modelVersion: string | undefined;
      let responseId: string | undefined;
      let providerResponseMetadataCanonicalJson: string | undefined;
      let providerResponseMetadataSha256: string | undefined;
      if (options.strictNanoThumbnail) {
        promptTokenCount = json.usageMetadata?.promptTokenCount;
        if (
          !Number.isInteger(promptTokenCount) ||
          (promptTokenCount ?? 0) < 1 ||
          (promptTokenCount ?? 0) > NANO_BANANA_THUMBNAIL_PROFILE.maxPromptTokenCount
        ) {
          throw new BananaImageSubmissionError(
            `${model}: provider usageMetadata.promptTokenCount is missing or outside the admitted bound`,
            { status: res.status },
          );
        }
        modelVersion = json.modelVersion?.trim();
        responseId = json.responseId?.trim();
        if (!modelVersion || modelVersion.length > 256 || !responseId || responseId.length > 256) {
          throw new BananaImageSubmissionError(
            `${model}: provider response is missing bounded modelVersion/responseId evidence`,
            { status: res.status },
          );
        }
        providerResponseMetadataCanonicalJson = canonicalJson({
          modelVersion,
          responseId,
          usageMetadata: json.usageMetadata,
        });
        providerResponseMetadataSha256 = sha256(
          `nano-banana-response-metadata\0${providerResponseMetadataCanonicalJson}`,
        );
        promptCostUsd = nanoBananaThumbnailPromptCostUsd(promptTokenCount!);
        outputCostUsd = NANO_BANANA_THUMBNAIL_PROFILE.outputImageUsd;
        costUsd = nanoBananaThumbnailCostUsd(promptTokenCount!);
        if (costUsd > NANO_BANANA_THUMBNAIL_PROFILE.admissionCeilingUsd + Number.EPSILON) {
          throw new BananaImageSubmissionError(
            `${model}: exact provider cost ${costUsd} exceeded the admitted thumbnail ceiling`,
            { status: res.status },
          );
        }
      }
      const route = options.route ?? (isPro ? "banana-pro" : "banana-flash");
      bananaCounters[isPro ? "pro" : "flash"]++;
      recordImageUsage({
        provider: "gemini",
        model,
        route,
        images: 1,
        width: dimensions.width,
        height: dimensions.height,
        costUsd,
      });
      return {
        bytes,
        model,
        route,
        width: dimensions.width,
        height: dimensions.height,
        costUsd,
        sourceContentType: dimensions.contentType,
        requestCanonicalJson,
        ...(options.strictNanoThumbnail ? {
          promptUtf8Bytes,
          promptTokenCount: promptTokenCount!,
          promptCostUsd: promptCostUsd!,
          outputCostUsd: outputCostUsd!,
          modelVersion: modelVersion!,
          responseId: responseId!,
          providerResponseMetadataCanonicalJson: providerResponseMetadataCanonicalJson!,
          providerResponseMetadataSha256: providerResponseMetadataSha256!,
        } : {}),
      };
    }
  }
  throw new Error(`banana: provider retry budget exhausted (${lastErr})`);
}

/**
 * Strict thumbnail route. It deliberately ignores IMAGE_DISABLE_GEMINI,
 * IMAGE_PROVIDERS, BANANA_FORCE_MODEL, Fal, and Novita: generated thumbnail
 * pixels always come from the pinned Nano Banana Flash model.
 */
export async function generateNanoBananaImageWithReceipt(
  args: Pick<BananaImageArgs, "prompt" | "aspectRatio" | "maxProviderAttempts"> & {
    /** Durable caller scope included in the request hash, never sent as prompt text. */
    idempotencyContext?: string;
  },
): Promise<NanoBananaImageResult> {
  await hydrateSealedNanoBananaThumbnailCredential();
  const profile = NANO_BANANA_THUMBNAIL_PROFILE;
  const generated = await generateGeminiImage({
    prompt: args.prompt,
    aspectRatio: profile.aspectRatio,
    allowText: false,
    tier: profile.tier,
    maxProviderAttempts: args.maxProviderAttempts ?? 1,
  }, {
    models: [profile.model],
    route: profile.route,
    requestContext: args.idempotencyContext,
    strictNanoThumbnail: true,
  });
  if (generated.model !== profile.model || generated.route !== profile.route) {
    throw new Error("nano banana thumbnail route escaped its pinned provider profile");
  }
  if (
    generated.width !== profile.providerOutputWidth ||
    generated.height !== profile.providerOutputHeight
  ) {
    throw new Error(
      `nano banana thumbnail returned ${generated.width}x${generated.height}; ` +
      `the pinned 16:9 source contract requires ${profile.providerOutputWidth}x${profile.providerOutputHeight}`,
    );
  }
  const providerRequestSha256 = sha256(`nano-banana-provider\0${generated.requestCanonicalJson}`);
  return {
    bytes: generated.bytes,
    receipt: {
      provider: profile.provider,
      model: profile.model,
      apiVersion: profile.apiVersion,
      modelVersion: generated.modelVersion!,
      responseId: generated.responseId!,
      route: profile.route,
      width: generated.width as typeof profile.providerOutputWidth,
      height: generated.height as typeof profile.providerOutputHeight,
      promptUtf8Bytes: generated.promptUtf8Bytes!,
      promptTokenCount: generated.promptTokenCount!,
      promptCostUsd: generated.promptCostUsd!,
      outputCostUsd: profile.outputImageUsd,
      costUsd: generated.costUsd,
      sourceContentType: generated.sourceContentType,
      providerRequestCanonicalJson: generated.requestCanonicalJson,
      providerRequestSha256,
      providerResponseMetadataCanonicalJson: generated.providerResponseMetadataCanonicalJson!,
      providerResponseMetadataSha256: generated.providerResponseMetadataSha256!,
      responseSha256: sha256(generated.bytes),
      createdAt: Date.now(),
    },
  };
}

export async function generateNanoBananaImage(
  args: Pick<BananaImageArgs, "prompt" | "aspectRatio" | "maxProviderAttempts"> & {
    idempotencyContext?: string;
  },
): Promise<Buffer> {
  return (await generateNanoBananaImageWithReceipt(args)).bytes;
}

export async function generateBananaImage(args: BananaImageArgs): Promise<Buffer> {
  if (!process.env.FAL_KEY) {
    throw new Error(
      "banana: generic image generation requires FAL_KEY; Gemini is reserved exclusively for sealed Nano Banana thumbnails",
    );
  }
  const bytes = await generateFalImage({
    prompt: args.prompt,
    aspectRatio: args.aspectRatio,
    imageSize: args.imageSize,
    images: (args.images ?? []).map((im) => ({ data: im.data, mimeType: im.mimeType ?? "image/png" })),
    allowText: args.allowText, // generateFalImage appends NO_TEXT_CLAUSE itself
    // Mirror banana's tiering: picture-only bulk assets ride the cheap model;
    // text-design renders remain on the quality model.
    tier: args.tier ?? (args.allowText ? "pro" : "flash"),
    maxProviderAttempts: args.maxProviderAttempts,
    onUsage: (usage) => {
      bananaCounters.fal += usage.images;
      bananaCounters.falCostUsd += usage.costUsd;
    },
  });
  return bytes;
}

export interface BananaVerdict {
  textOk?: boolean;
  faceClear?: boolean;
  punch?: number;
  styleMatch?: number;
  storyMatch?: number;
  uiClean?: boolean;
  fix?: string;
}

/**
 * The full engine: brief → render → vision judge → ONE feedback retry →
 * judged jpg on disk. Throws when both attempts fail the gate (callers get
 * an honest failure, never a silent bad thumbnail).
 */
export async function bananaThumbnail(args: {
  /** Structured brief is mandatory so provider scene pixels and local type cannot be conflated. */
  brief: ThumbBriefArgs & { textZone?: "left" | "right" | "upperLeft" | "upperRight" };
  outJpg: string;
  /** for the judge: exact headline words + channel style to verify against */
  expectWords?: string[];
  imageStyle?: string;
  title?: string;
  /** Channel thumbnail text-rule (from Style DNA). When it signals a RESTRAINED
   *  aesthetic (minimal/no baked hype text — comic "illustrative only",
   *  whiteboard "anti-sensationalist"), the judge stops demanding clickbait
   *  "punch" and grades the channel's own bar, so on-brand clean thumbnails no
   *  longer get rejected 0-for-N into the fallback. */
  styleRubric?: string;
  log?: (msg: string) => void;
}): Promise<{ path: string; verdict: BananaVerdict }> {
  if (!args.brief || typeof args.brief !== "object" || Array.isArray(args.brief)) {
    throw new Error(
      "bananaThumbnail requires a structured ThumbBriefArgs value; one-pass baked-text briefs are forbidden",
    );
  }
  let fixNote = "";
  let lastVerdict: BananaVerdict = {};
  // Restrained brands: relax the scroll-stopping "punch" floor and tell the
  // judge NOT to penalize the absence of hype text.
  const restrained = /minimal|no text|clean|understated|restrained|illustrat|no hype|anti.?sensational/i.test(args.styleRubric ?? "");
  const punchFloor = restrained ? 5 : 7;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { renderThumbnail } = await import("@/lib/thumbnailRenderer");
    await renderThumbnail({
      spec: {
        scene: {
          description: `${args.brief.scene}${fixNote}`,
          imageStyle: args.brief.imageStyle,
          palette: args.brief.palette,
          accentColor: args.brief.accentColor,
          composition: args.brief.composition,
          textZone: args.brief.textZone ?? "left",
        },
        typography: {
          lines: args.brief.lines,
          subtitle: args.brief.badge,
          accentColor: args.brief.accentColor,
          font: "impact",
          uppercase: true,
          treatment: "plate",
          textObject: args.brief.textObject as
            import("@/lib/thumbnailRenderer").ThumbnailTypographySpec["textObject"],
        },
      },
      outJpg: args.outJpg,
      tmpDir: dirname(args.outJpg),
    });
    const wordList = (args.expectWords ?? []).map((w) => `"${w.toUpperCase()}"`).join(" and ");
    const raw = await judgeVision({
      prompt:
        `THUMBNAIL GATE. 1. textOk: ${wordList ? `exact words ${wordList} fully visible, spelled exactly, ` : ""}` +
        `every visible word a correctly spelled real word? 2. faceClear: NO text covering any face or eyes? ` +
        `3. punch 1-10 (scroll-stopping)?${restrained ? " (this channel is deliberately RESTRAINED/illustrative — do NOT reward hype text or clickbait; a clean on-brand image scores well)" : ""} ` +
        `4. styleMatch 1-10 vs "${args.styleRubric || args.imageStyle || "professional design"}"? ` +
        `5. storyMatch 1-10: image alone evokes the topic${args.title ? ` "${args.title}"` : ""}? ` +
        `(for analysis/essay/abstract topics, an ICONIC depiction of the subject matter IS the story - ` +
        `judge subject relevance, not literal plot illustration) ` +
        `6. uiClean: no fake play buttons/player UI/watermarks? ` +
        `Return STRICT JSON {"textOk":bool,"faceClear":bool,"punch":n,"styleMatch":n,"storyMatch":n,"uiClean":bool,"fix":"<=15 words"}.`,
      imagePaths: [args.outJpg],
      json: true,
      maxTokens: VISION_GATE_MAX_TOKENS,
    }, args.log);
    if (raw == null) {
      // Judge unavailable after retry — a thumbnail is an allowText render, so
      // its spelling CANNOT ship unverified: count this attempt as a FAILED
      // textOk (loud), never the old silent pass.
      lastVerdict = { textOk: false, fix: "vision judge unavailable — spelling unverified" };
      args.log?.(
        `banana: VISION JUDGE UNAVAILABLE on attempt ${attempt + 1} — treating textOk as FAILED (spelling cannot ship unverified)`,
      );
      fixNote = " Improve subject separation and preserve the planned empty text zone.";
      continue;
    }
    const v: BananaVerdict = parseJsonLoose<BananaVerdict>(raw);
    lastVerdict = v;
    const pass =
      v.textOk !== false && v.faceClear !== false && v.uiClean !== false &&
      (v.punch ?? 10) >= punchFloor && (v.styleMatch ?? 10) >= 7 && (v.storyMatch ?? 10) >= 7;
    if (pass) {
      args.log?.(`banana: render OK (punch ${v.punch ?? "?"}/10, style ${v.styleMatch ?? "?"}/10)`);
      return { path: args.outJpg, verdict: v };
    }
    fixNote = ` CRITICAL SCENE FIX FROM THE LAST ATTEMPT: ${v.fix ?? "stronger composition and text clear of faces"}.`;
    args.log?.(
      `banana: attempt ${attempt + 1} rejected (textOk=${v.textOk} faceClear=${v.faceClear} punch=${v.punch} style=${v.styleMatch} story=${v.storyMatch}) -> ${attempt === 0 ? "retrying with fix" : "FAILING LOUD"}`,
    );
  }
  throw new Error(
    `banana: both attempts failed the gate (last: punch=${lastVerdict.punch} style=${lastVerdict.styleMatch} fix="${lastVerdict.fix ?? ""}")`,
  );
}
