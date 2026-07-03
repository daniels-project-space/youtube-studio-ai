/**
 * whiteboard_scribe — the DRAWN-CINEMA visual engine for the `whiteboard` family.
 *
 * Unlike footage engines (which produce `footageClips` for timeline_assemble),
 * this is SELF-CONTAINED: it writes its own layered storyboard + narration and
 * draws the whole video in time with the voice (src/lib/whiteboardSync.ts). It
 * therefore REPLACES the script→narration→footage→assemble chain and produces
 * the final `videoKey` directly (mirrors the lofi `assemble` block).
 *
 * Deterministic write-on reveal = ZERO render credits (no video model); spend is
 * per-layer Nano-Banana art (Gemini, 2K) + Fish TTS. Resolution-configurable
 * (1080p default, 2K via `width`).
 *
 * RUNTIME NOTE: the renderer shells out to python3 with whisper + numpy/scipy/
 * scikit-image/Pillow (scripts/wb_scribe_sync.py + scripts/whisper_align.py).
 * Present on the VPS/local runner; to run on a Trigger worker these must be
 * baked into the task image (python build extension in trigger.config.ts).
 */
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { COST_PATCH_KEY, type Block, type StageContext } from "@/engine/types";
import { getVisualBrief } from "@/engine/creative/brief";
import { makeRunTempDir, readBytes } from "@/lib/files";
import { putObject } from "@/lib/storage";
import { castWhiteboardSync, hasWhiteboardSync } from "@/lib/whiteboardSync";
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

/** Fallback per-video spend when counters are unavailable (art + Fish TTS). */
const SCRIBE_COST = Number(process.env.WB_SYNC_COST_USD ?? 2.0);

export const whiteboardScribe: Block = {
  id: "whiteboard_scribe",
  consumes: ["topic"],
  produces: ["videoKey", "videoLocalPath", "videoDurationSec", "narrationText"],
  paid: true,
  run: async (ctx) => {
    if (!hasWhiteboardSync()) {
      throw new Error("whiteboard_scribe: GEMINI_API_KEY + FISH_AUDIO_API_KEY required (no fallback — this is the channel's visual engine)");
    }
    const topic = String(ctx.store["topic"] ?? "");
    if (!topic) throw new Error("whiteboard_scribe: no topic in store");

    // Grounding facts: prefer real research notes; else the channel's brief look.
    const facts =
      (ctx.store["researchNotes"] as string | undefined) ||
      (ctx.store["factSheet"] as string | undefined) ||
      undefined;
    const visualBrief = getVisualBrief(ctx.store);

    const styleId = String(ctx.params["styleId"] ?? "history");
    const voiceId = String(ctx.params["voiceId"] ?? ctx.store["voiceId"] ?? "sleepless_historian");
    const width = Math.max(1280, Math.min(2560, Number(ctx.params["width"] ?? 1920)));
    const height = Math.round((width * 9) / 16);

    // DETERMINISTIC dir (scoped): whiteboardSync's per-layer art cache is
    // path-keyed — a random mkdtemp meant every Trigger retry/self-heal
    // regenerated all 18-30 paid art layers from scratch.
    const runDir = await makeRunTempDir(ctx.runId, "whiteboard_scribe");
    const outPath = join(runDir, "final.mp4");
    ctx.log(`whiteboard_scribe: drawing synced explainer "${topic.slice(0, 60)}" @ ${width}x${height} (style ${styleId})…`);

    const countersBefore = { ...bananaCounters };
    const res = await castWhiteboardSync({
      brief: { topic, facts, styleId, header: visualBrief?.header, voiceId, width, height },
      runDir,
      outPath,
      log: (m) => ctx.log(`wb: ${m}`),
    });
    // Real image spend from the banana counters (the flat $2 guess undercounted
    // Pro-heavy runs and overcounted cached re-runs alike).
    const genPro = bananaCounters.pro - countersBefore.pro;
    const genFlash = bananaCounters.flash - countersBefore.flash;
    const artCost = genPro * PRICE.bananaProUsd + genFlash * PRICE.bananaFlashUsd;
    const scribeCost = genPro + genFlash > 0 ? artCost + 0.05 /* Fish TTS */ : SCRIBE_COST;
    ctx.log(`whiteboard_scribe: image spend ${genPro} pro + ${genFlash} flash ≈ $${scribeCost.toFixed(2)}`);

    const videoKey = `${ctx.keyPrefix}runs/${ctx.runId}/final.mp4`;
    await putObject(videoKey, await readBytes(res.outPath), { contentType: "video/mp4" });
    const videoDurationSec = Math.round(res.durationMs / 1000);
    await recordAsset(ctx, "video", videoKey, { durationSec: videoDurationSec, engine: "whiteboard_scribe", panels: res.panels.length });
    ctx.log(`whiteboard_scribe ✓ → ${videoKey} (${videoDurationSec}s, ${res.panels.length} panels)`);

    return {
      videoKey,
      videoLocalPath: res.outPath,
      videoDurationSec,
      narrationText: res.narrationText,
      [COST_PATCH_KEY]: scribeCost,
    };
  },
};

export const whiteboardScribeBlocks: Block[] = [whiteboardScribe];
