/**
 * motion_comic — the DRAWN-COMIC visual engine (src/lib/motionComic.ts) as a
 * pipeline block, structural twin of whiteboard_scribe.
 *
 * SELF-CONTAINED like whiteboard_scribe: it writes its own storyboard (Gemini),
 * renders character-consistent panel art (Nano Banana img2img), voices every
 * line (ElevenLabs v3 dialogue), lays a Suno bed, and draws the page with the
 * deterministic python renderer — so it REPLACES the script→narration→footage→
 * assemble chain and produces the final `videoKey` directly.
 *
 * Deterministic draw + camera = ZERO video-model credits; spend is per-panel
 * art + character sheets (Nano Banana) + ElevenLabs voices + one music track.
 *
 * RUNTIME NOTE: the renderer shells out to python3 (scripts/mc_page_render.py,
 * which imports scripts/mc_textplace.py) with numpy/Pillow/scikit-image/scipy.
 * Both scripts are baked into the Trigger image via additionalFiles and the
 * pip deps install lazily — castMotionComic preflights ALL of it at $0 spend
 * (src/lib/pydeps.ts) before any paid generation.
 */
import { join } from "node:path";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { COST_PATCH_KEY, type Block, type StageContext } from "@/engine/types";
import { getVisualBrief } from "@/engine/creative/brief";
import { makeRunTempDir } from "@/lib/files";
import { putObjectFromFile } from "@/lib/storage";
import { castMotionComic, hasMotionComic, motionComicPanelCount } from "@/lib/motionComic";
import { bananaCounters } from "@/lib/banana";
import { PRICE } from "@/engine/pricing";

function convex(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

async function recordAsset(ctx: StageContext, kind: string, r2Key: string, meta?: Record<string, unknown>): Promise<void> {
  try {
    await convex().mutation(api.assets.recordAsset, {
      ownerId: ctx.ownerId,
      channelId: ctx.channelId as Id<"channels">,
      runId: ctx.runId as Id<"runs">,
      kind,
      r2Key,
      meta,
    });
  } catch (e) {
    ctx.log(`recordAsset(${kind}) failed (non-fatal): ${e instanceof Error ? e.message : e}`);
  }
}

/** Fallback per-video spend when counters are unavailable (art + voices + music). */

/**
 * The no-text guard baked into motionComic's DEFAULT_STYLE. A channel style
 * (param or visual brief) REPLACES the default wholesale — without re-adding
 * this clause the model happily bakes lettering into the art, which then
 * collides with the engine's own overlay bubbles.
 */
const NO_TEXT_GUARD =
  "ABSOLUTELY NO speech bubbles, NO captions, NO lettering, NO text of any kind anywhere in the image.";

export const motionComicBlock: Block = {
  id: "motion_comic",
  consumes: ["topic"],
  produces: ["videoKey", "videoLocalPath", "videoDurationSec", "narrationText"],
  paid: true,
  run: async (ctx) => {
    if (!hasMotionComic()) {
      throw new Error("motion_comic: storyboard, ElevenLabs voice, and the selected Banana image route must all be configured (no fallback — this is the channel's visual engine)");
    }
    const topic = String(ctx.store["topic"] ?? "");
    if (!topic) throw new Error("motion_comic: no topic in store");

    // Grounding facts: prefer real research notes; else the channel's fact sheet.
    const facts =
      (ctx.store["researchNotes"] as string | undefined) ||
      (ctx.store["factSheet"] as string | undefined) ||
      undefined;
    const visualBrief = getVisualBrief(ctx.store);

    const panels = motionComicPanelCount(ctx.params["panels"]);
    // Style: explicit param wins; else the DP's promptStyle; else the engine's
    // curated default (undefined → motionComic's DEFAULT_STYLE). Any custom
    // style gets the no-text guard re-appended.
    const styleParam = typeof ctx.params["style"] === "string" ? (ctx.params["style"] as string).trim() : "";
    const styleBase = (styleParam || visualBrief?.promptStyle || "").replace(/[.\s]+$/, "");
    const style = styleBase ? `${styleBase}. ${NO_TEXT_GUARD}` : undefined;
    const width = Math.max(1280, Math.min(2560, Number(ctx.params["width"] ?? 1920)));

    // DETERMINISTIC dir (scoped): motionComic's plan/sheet/panel/line caches
    // are path-keyed — a random mkdtemp would make every Trigger retry
    // regenerate all paid art + voices from scratch.
    const runDir = await makeRunTempDir(ctx.runId, "motion_comic");
    const outPath = join(runDir, "final.mp4");
    ctx.log(`motion_comic: drawing "${topic.slice(0, 60)}" — ${panels} panels @ ${width}w…`);

    const countersBefore = { ...bananaCounters };
    const res = await castMotionComic({
      brief: { topic, facts, panels, style, width, targetSeconds: Number(ctx.params["targetSeconds"] ?? 0) || undefined },
      runDir,
      outPath,
      log: (m) => ctx.log(`mc: ${m}`),
    });
    // Real image spend from the banana counters (same rationale as
    // whiteboard_scribe: a flat guess undercounts Pro-heavy runs and
    // overcounts cached re-runs alike). The result also reports invocation-
    // local TTS, music, and grader usage below.
    const genPro = Math.max(0, bananaCounters.pro - countersBefore.pro);
    const genFlash = Math.max(0, bananaCounters.flash - countersBefore.flash);
    const genFal = Math.max(0, (bananaCounters.fal ?? 0) - (countersBefore.fal ?? 0));
    const legacyArtCost =
      genPro * PRICE.bananaProUsd +
      genFlash * PRICE.bananaFlashUsd +
      Math.max(0, bananaCounters.falCostUsd - countersBefore.falCostUsd);
    const artCost = ctx.imageUsageAccounting?.().costUsd ?? legacyArtCost;
    const ttsCost =
      (res.ttsCharactersGenerated / 1000) * PRICE.ttsElevenPerKCharUsd;
    const musicCost = res.musicGenerations * PRICE.musicTrackUsd;
    const graderCost = res.visionGraderCalls * PRICE.visionGraderUsd;
    // Every component is invocation-local. A fully cached resume is exactly
    // zero instead of the old phantom $0.10 fallback charge.
    const comicCost = artCost + ttsCost + musicCost + graderCost;
    ctx.log(
      `motion_comic: spend ${genPro} pro + ${genFlash} flash + ${genFal} fal, ` +
      `${res.ttsCharactersGenerated} TTS chars, ${res.musicGenerations} music, ` +
      `${res.visionGraderCalls} graders ≈ $${comicCost.toFixed(2)}`,
    );

    const videoKey = `${ctx.keyPrefix}runs/${ctx.runId}/final.mp4`;
    await putObjectFromFile(videoKey, res.outPath, { contentType: "video/mp4" });
    const videoDurationSec = Math.round(res.durationMs / 1000);
    await recordAsset(ctx, "video", videoKey, { durationSec: videoDurationSec, engine: "motion_comic", panels: res.panels });
    ctx.log(`motion_comic ✓ → ${videoKey} (${videoDurationSec}s, ${res.panels} panels)`);

    return {
      videoKey,
      videoLocalPath: res.outPath,
      videoDurationSec,
      narrationText: res.narrationText,
      [COST_PATCH_KEY]: comicCost,
    };
  },
};

export const motionComicBlocks: Block[] = [motionComicBlock];
