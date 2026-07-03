/**
 * Channel art generator — a square avatar + a 16:9 banner from the channel's
 * visual identity (palette + style + persona + the Show Bible's iconic motif).
 *
 * The avatar is the channel's face, so it gets the premium treatment: a
 * DP-art-directed prompt built around the iconic motif, generated on FLUX1.1
 * [pro] (fal), then put through a CRITIC LOOP — the image is downscaled to a 48px
 * icon and an agent judges whether the subject is still instantly recognizable,
 * high-contrast, and on-vibe; if not it regenerates with the critique. Text-free
 * (the name renders in the UI). Falls back to replicate FLUX when fal is absent.
 */
import { generateFluxImage } from "@/lib/replicate";
import { generateFalFluxProImage, hasFalKey } from "@/lib/falImage";
import { channelKey, putObject } from "@/lib/storage";
import { makeRunTempDir, downloadTo } from "@/lib/files";
import { imageToJpeg } from "@/lib/ffmpeg";
import { parseJsonLoose, hasGeminiKey } from "@/lib/gemini";
import { visionLocal } from "@/lib/vision";
import { produceAndCritique } from "@/engine/critiqueLoop";
import { join } from "node:path";

export interface ArtIdentity {
  name: string;
  persona?: string;
  styleGrammar?: string;
  palette?: string[];
  niche?: string;
  /** Show Bible iconic motif — the recurring visual signature to build around. */
  iconicMotif?: string;
  /** Show Bible vibe — the emotional/tonal signature. */
  vibe?: string;
}

export interface ChannelArtResult {
  imageKey: string;
  bannerKey: string;
}

type Logger = (msg: string, extra?: Record<string, unknown>) => void;

function paletteClause(palette?: string[]): string {
  return palette && palette.length
    ? `color palette ${palette.slice(0, 5).join(", ")}`
    : "cohesive cinematic color palette";
}

/** DP-art-directed avatar prompt. Critique notes are folded in on regeneration. */
function avatarPrompt(id: ArtIdentity, notes: string[]): string {
  return [
    `Premium YouTube channel PROFILE-PICTURE icon for "${id.name}"`,
    id.niche ? `a ${id.niche} channel` : "",
    id.iconicMotif ? `ICONIC MOTIF (make this the subject): ${id.iconicMotif}` : (id.persona ?? ""),
    id.vibe ? `mood: ${id.vibe}` : "",
    id.styleGrammar ?? "",
    paletteClause(id.palette),
    // CIRCULAR-CROP SAFE: YouTube renders avatars as a small CIRCLE, so the
    // subject (its face/front) must be DEAD-CENTER and fill the frame.
    "CRITICAL COMPOSITION: tight head-on/centered portrait — the subject's FACE/FRONT is perfectly CENTERED " +
      "and FILLS the frame (head-and-shoulders crop only, NOT a wide body or off-center pose). Symmetrical, " +
      "centered, designed to read inside a CIRCULAR crop at tiny (48px) size — keep all key detail in the central " +
      "circle, nothing important near the edges or corners. ONE bold subject, luminous and clearly lit (bright, " +
      "not murky), strong contrast, intense focal presence, ultra-detailed, crisp and instantly recognizable at " +
      "icon size, no text, no letters, no words, app-icon style.",
    notes.length ? `FIX from the last attempt: ${notes.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function bannerPrompt(id: ArtIdentity): string {
  return [
    `Wide cinematic YouTube channel banner artwork for "${id.name}"`,
    id.niche ? `a ${id.niche} channel` : "",
    id.iconicMotif ? `featuring the channel's motif: ${id.iconicMotif}` : "",
    id.styleGrammar ?? id.persona ?? "",
    paletteClause(id.palette),
    "epic atmospheric wide establishing composition, luminous cinematic lighting, depth and soft bokeh, " +
      "high production value, ultra-detailed, no text, no letters, no words",
  ]
    .filter(Boolean)
    .join(", ");
}

/** Generate one still (1:1 by default) via fal FLUX1.1 [pro], replicate fallback. */
async function generateStill(prompt: string, square: boolean): Promise<string> {
  if (hasFalKey()) {
    try {
      return await generateFalFluxProImage({
        prompt,
        width: square ? 1024 : 1344,
        height: square ? 1024 : 768,
      });
    } catch {
      /* fall through to replicate */
    }
  }
  return generateFluxImage({ prompt, aspectRatio: square ? "1:1" : "16:9" });
}

/** Fetch a remote image URL into R2 at `key`; returns the key. */
async function pipeToR2(url: string, key: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`channelArt: fetch ${key} -> HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  await putObject(key, bytes, { contentType: "image/png" });
  return key;
}

/**
 * Critic loop for the avatar: render → downscale to a 48px icon (then back up so
 * the judge sees the degraded version) → score recognizability / contrast / vibe;
 * regenerate with notes until it clears the bar (max 3). Returns the winning url.
 */
async function directAvatar(id: ArtIdentity, log: Logger): Promise<string> {
  const tmp = await makeRunTempDir(`art-${id.name}`);
  const canJudge = hasGeminiKey();
  let n = 0;

  const loop = await produceAndCritique<{ url: string; path: string }>({
    label: "avatar",
    threshold: 0.8,
    maxIters: canJudge ? 3 : 1,
    log: (m) => log(m),
    produce: async (priorIssues) => {
      const url = await generateStill(avatarPrompt(id, priorIssues), true);
      const path = join(tmp, `avatar_${n++}.png`);
      await downloadTo(url, path);
      return { url, path };
    },
    critique: async (cand) => {
      if (!canJudge) return { score: 1, pass: true, issues: [] };
      try {
        // Simulate a tiny channel icon: shrink to 48px, then up to 256 so the
        // judge actually sees how it reads at avatar size.
        const tiny = join(tmp, "tiny48.jpg");
        const shown = join(tmp, "tiny_shown.jpg");
        await imageToJpeg(cand.path, tiny, 48, 48);
        await imageToJpeg(tiny, shown, 256, 256);
        const raw = await visionLocal({
          prompt:
            `This is a YouTube PROFILE PICTURE shown at icon size for "${id.name}"` +
            (id.iconicMotif ? ` (motif: ${id.iconicMotif})` : "") + ".\n" +
            `YouTube crops avatars to a CIRCLE. Judge it for that: is the subject's FACE/FRONT CENTERED and ` +
            `FILLING the frame so it survives a tight circular crop? HEAVILY penalize an OFF-CENTER subject, a ` +
            `subject too small/far, or key detail near the edges/corners (those get cropped away). Also require ` +
            `it be INSTANTLY recognizable, HIGH-CONTRAST, distinctive, on-vibe; penalize mush, low contrast, ` +
            `clutter, or any text. Return STRICT JSON {"score":0..1,"issues":string[]}.`,
          imagePaths: [shown],
          json: true,
          maxTokens: 300,
        });
        const v = (parseJsonLoose(raw) as { score?: number; issues?: string[] } | null) ?? {};
        const score = typeof v.score === "number" ? Math.max(0, Math.min(1, v.score)) : 0.7;
        return { score, pass: score >= 0.8, issues: Array.isArray(v.issues) ? v.issues.slice(0, 4) : [] };
      } catch (e) {
        log(`avatar critique skipped (${e instanceof Error ? e.message : e})`);
        return { score: 0.8, pass: true, issues: [] };
      }
    },
  });
  log(`avatar: accepted=${loop.accepted} score=${loop.critique.score.toFixed(2)} after ${loop.iterations} iter(s)`);
  return loop.value.url;
}

/**
 * Generate avatar (critic-looped) + banner for a channel and store them in R2.
 * Returns the two R2 keys (caller persists them onto the channel record).
 */
export async function generateChannelArt(
  ownerId: string,
  slug: string,
  identity: ArtIdentity,
  log: Logger = () => {},
): Promise<ChannelArtResult> {
  log("channelArt: art-directing avatar (1:1, critic loop)…");
  const avatarUrl = await directAvatar(identity, log);
  log("channelArt: generating banner (16:9)…");
  const bannerUrl = await generateStill(bannerPrompt(identity), false);

  const imageKey = await pipeToR2(avatarUrl, channelKey(ownerId, slug, "art/avatar.png"));
  const bannerKey = await pipeToR2(bannerUrl, channelKey(ownerId, slug, "art/banner.png"));
  log("channelArt: uploaded to R2", { imageKey, bannerKey });
  return { imageKey, bannerKey };
}

/**
 * Banner for a language sibling: the channel's look with the country's flag softly
 * filling the background, so the group reads as "the German / Spanish edition" while
 * sharing the base avatar. Returns the R2 banner key. (Avatar isn't API-settable,
 * so siblings reuse the base avatar; the flag lives on the banner.)
 */
export async function generateFlagBanner(
  ownerId: string,
  slug: string,
  identity: ArtIdentity,
  country: string,
  log: Logger = () => {},
): Promise<string> {
  const prompt = [
    `Wide cinematic YouTube channel banner for "${identity.name}"`,
    identity.niche ? `a ${identity.niche} channel` : "",
    identity.iconicMotif ? `motif: ${identity.iconicMotif}` : (identity.styleGrammar ?? ""),
    paletteClause(identity.palette),
    `a large, softly out-of-focus waving flag of ${country} filling the background — ` +
      `subtle and atmospheric (not garish), low contrast so foreground stays readable`,
    "epic atmospheric composition, luminous cinematic lighting, depth and soft bokeh, " +
      "high production value, ultra-detailed, no text, no letters, no words",
  ].filter(Boolean).join(", ");
  log(`channelArt: generating ${country} flag banner…`);
  const url = await generateStill(prompt, false);
  const bannerKey = await pipeToR2(url, channelKey(ownerId, slug, "art/banner.png"));
  log("channelArt: flag banner uploaded", { bannerKey, country });
  return bannerKey;
}
