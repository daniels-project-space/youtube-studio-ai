/**
 * BANANA — the thumbnail engine. Nano Banana Pro (Gemini 3 Pro Image) renders
 * the COMPLETE thumbnail in one pass from a rich design brief: dimensional
 * material typography, photo-cutout collage, hero dominance, faces never
 * covered, correct badges — proven 9/9 SHIP across wildly different channels.
 *
 * Fully standalone: brief in → judged jpg out. The only deps are the Gemini
 * key (vault service "gemini") and the local vision judge. Set
 * IMAGE_DISABLE_GEMINI=1 (or IMAGE_PROVIDERS=fal,…) to render every image on
 * fal FLUX instead — zero Google image spend, same call sites.
 *
 *   const { path } = await bananaThumbnail({ brief: buildThumbBrief({...}), outJpg, log });
 */
import { writeFile } from "node:fs/promises";
import { parseJsonLoose } from "@/lib/gemini";
import { visionLocal } from "@/lib/vision";
import { generateFalImage } from "@/lib/falImage";

/**
 * MODEL TIERS. Pro (gemini-3-pro-image, ~$0.13/img) exists for DESIGNED
 * TYPOGRAPHY — thumbnails and type cards, where its text rendering is the
 * proven 9/9 edge. Flash (classic Nano Banana, ~$0.04/img) is the DEFAULT for
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
export const bananaCounters = { pro: 0, flash: 0, fal: 0 };

/**
 * PROVIDER ROUTER ("no Google image gen" switch). The fal route is active when
 * the operator sets IMAGE_DISABLE_GEMINI=1 or puts "fal" FIRST in
 * IMAGE_PROVIDERS. Default (both unset) keeps the Google path byte-for-byte.
 */
function falImageRouteActive(): boolean {
  if (process.env.IMAGE_DISABLE_GEMINI === "1") return true;
  const providers = (process.env.IMAGE_PROVIDERS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return providers[0] === "fal";
}

export function hasBanana(): boolean {
  if (falImageRouteActive()) return !!process.env.FAL_KEY;
  return !!process.env.GEMINI_API_KEY;
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
        maxTokens: 150,
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

export async function generateBananaImage(args: {
  prompt: string;
  aspectRatio?: string;
  /** "1K" | "2K" | "4K" — Pro model only; defaults to "2K". */
  imageSize?: string;
  /** Optional input images (base64) for img2img / style-reference conditioning. */
  images?: { data: string; mimeType?: string }[];
  /** Set true ONLY for TEXT-DESIGN renders (thumbnails, type cards). Default false:
   *  the render is picture-only and NO_TEXT_CLAUSE is appended, because every
   *  pipeline's titles/labels are engine overlays — baked-in text is the bug. */
  allowText?: boolean;
  /** Cost tier. Default: "pro" only for text-design renders (allowText), else
   *  "flash". Pass explicitly to override (e.g. flash preview thumbnails). */
  tier?: "pro" | "flash";
}): Promise<Buffer> {
  // PROVIDER ROUTER: when the operator disabled Google image gen, EVERY engine
  // that calls generateBananaImage transparently renders on fal FLUX instead
  // (same args, bytes out). A missing FAL_KEY throws — never silently fall back
  // to the provider the operator explicitly turned off.
  if (falImageRouteActive()) {
    if (!process.env.FAL_KEY) {
      throw new Error(
        "banana: fal image route active (IMAGE_DISABLE_GEMINI/IMAGE_PROVIDERS) but FAL_KEY missing " +
          "(vault service 'fal') — refusing to fall back to the disabled Google provider",
      );
    }
    const bytes = await generateFalImage({
      prompt: args.prompt,
      aspectRatio: args.aspectRatio,
      imageSize: args.imageSize,
      images: (args.images ?? []).map((im) => ({ data: im.data, mimeType: im.mimeType ?? "image/png" })),
      allowText: args.allowText, // generateFalImage appends NO_TEXT_CLAUSE itself
      // Mirror banana's tiering on the fal route: flash (picture-only bulk
      // assets) rides the cheap model; text-design renders stay on quality.
      tier: args.tier ?? (args.allowText ? "pro" : "flash"),
    });
    bananaCounters.fal++;
    return bytes;
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("banana: GEMINI_API_KEY missing (vault service 'gemini')");
  const prompt = args.allowText ? args.prompt : args.prompt + NO_TEXT_CLAUSE;
  const tier = args.tier ?? (args.allowText ? "pro" : "flash");
  // Text first, then any conditioning images (img2img / style reference).
  const parts: Record<string, unknown>[] = [{ text: prompt }];
  for (const im of args.images ?? []) parts.push({ inlineData: { mimeType: im.mimeType ?? "image/png", data: im.data } });
  let lastErr = "";
  for (const model of modelsFor(tier)) {
    // Nano Banana Pro (gemini-3-pro-image) honours imageConfig.imageSize for 2K/4K
    // output; the classic gemini-2.5-flash-image fallback rejects it (400) and caps
    // ~1024px anyway, so it silently degrades.
    const imageConfig: Record<string, string> = { aspectRatio: args.aspectRatio ?? "16:9" };
    if (model.includes("gemini-3-pro-image")) imageConfig.imageSize = args.imageSize ?? "2K";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: {
                responseModalities: ["IMAGE"],
                imageConfig,
              },
            }),
            signal: AbortSignal.timeout(180_000),
          },
        );
        const json = (await res.json()) as {
          candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
          error?: { message?: string };
        };
        if (!res.ok) {
          lastErr = `${model} HTTP ${res.status}: ${json.error?.message ?? ""}`;
          if ([429, 500, 503].includes(res.status) && attempt === 0) {
            await new Promise((r) => setTimeout(r, 4000));
            continue;
          }
          break; // non-transient → next model
        }
        const part = (json.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData?.data);
        if (!part?.inlineData?.data) { lastErr = `${model}: no image part in response`; break; }
        bananaCounters[model.includes("gemini-3-pro-image") ? "pro" : "flash"]++;
        return Buffer.from(part.inlineData.data, "base64");
      } catch (e) {
        lastErr = `${model}: ${e instanceof Error ? e.message : e}`;
      }
    }
  }
  throw new Error(`banana: generation failed (${lastErr})`);
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
  brief: string;
  outJpg: string;
  /** for the judge: exact headline words + channel style to verify against */
  expectWords?: string[];
  imageStyle?: string;
  title?: string;
  /** "flash" for plan-stage PREVIEW thumbnails (may never become videos);
   *  default "pro" — publish thumbnails keep the proven typography model. */
  tier?: "pro" | "flash";
  log?: (msg: string) => void;
}): Promise<{ path: string; verdict: BananaVerdict }> {
  let fixNote = "";
  let lastVerdict: BananaVerdict = {};
  for (let attempt = 0; attempt < 2; attempt++) {
    const bytes = await generateBananaImage({ prompt: args.brief + fixNote, allowText: true, tier: args.tier });
    await writeFile(args.outJpg, bytes);
    const wordList = (args.expectWords ?? []).map((w) => `"${w.toUpperCase()}"`).join(" and ");
    const raw = await judgeVision({
      prompt:
        `THUMBNAIL GATE. 1. textOk: ${wordList ? `exact words ${wordList} fully visible, spelled exactly, ` : ""}` +
        `every visible word a correctly spelled real word? 2. faceClear: NO text covering any face or eyes? ` +
        `3. punch 1-10 (scroll-stopping)? 4. styleMatch 1-10 vs "${args.imageStyle ?? "professional design"}"? ` +
        `5. storyMatch 1-10: image alone evokes the topic${args.title ? ` "${args.title}"` : ""}? ` +
        `(for analysis/essay/abstract topics, an ICONIC depiction of the subject matter IS the story - ` +
        `judge subject relevance, not literal plot illustration) ` +
        `6. uiClean: no fake play buttons/player UI/watermarks? ` +
        `Return STRICT JSON {"textOk":bool,"faceClear":bool,"punch":n,"styleMatch":n,"storyMatch":n,"uiClean":bool,"fix":"<=15 words"}.`,
      imagePaths: [args.outJpg],
      json: true,
      maxTokens: 250,
    }, args.log);
    if (raw == null) {
      // Judge unavailable after retry — a thumbnail is an allowText render, so
      // its spelling CANNOT ship unverified: count this attempt as a FAILED
      // textOk (loud), never the old silent pass.
      lastVerdict = { textOk: false, fix: "vision judge unavailable — spelling unverified" };
      args.log?.(
        `banana: VISION JUDGE UNAVAILABLE on attempt ${attempt + 1} — treating textOk as FAILED (spelling cannot ship unverified)`,
      );
      fixNote = " CRITICAL FIX FROM THE LAST ATTEMPT: render every headline word spelled exactly as quoted.";
      continue;
    }
    const v: BananaVerdict = parseJsonLoose<BananaVerdict>(raw);
    lastVerdict = v;
    const pass =
      v.textOk !== false && v.faceClear !== false && v.uiClean !== false &&
      (v.punch ?? 10) >= 7 && (v.styleMatch ?? 10) >= 7 && (v.storyMatch ?? 10) >= 7;
    if (pass) {
      args.log?.(`banana: render OK (punch ${v.punch ?? "?"}/10, style ${v.styleMatch ?? "?"}/10)`);
      return { path: args.outJpg, verdict: v };
    }
    fixNote = ` CRITICAL FIX FROM THE LAST ATTEMPT: ${v.fix ?? "stronger composition, exact spelling, text clear of faces"}.`;
    args.log?.(
      `banana: attempt ${attempt + 1} rejected (textOk=${v.textOk} faceClear=${v.faceClear} punch=${v.punch} style=${v.styleMatch} story=${v.storyMatch}) -> ${attempt === 0 ? "retrying with fix" : "FAILING LOUD"}`,
    );
  }
  throw new Error(
    `banana: both attempts failed the gate (last: punch=${lastVerdict.punch} style=${lastVerdict.styleMatch} fix="${lastVerdict.fix ?? ""}")`,
  );
}
