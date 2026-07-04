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
 * RUNTIME NOTE: the renderer shells out to python3 with faster-whisper +
 * numpy/scipy/scikit-image/Pillow (scripts/wb_scribe_sync.py +
 * scripts/whisper_align.py). The scripts are baked into the Trigger image via
 * additionalFiles (trigger.config.ts) and the pip deps install lazily —
 * castWhiteboardSync preflights ALL of it at $0 spend (src/lib/pydeps.ts).
 */
import { join } from "node:path";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { COST_PATCH_KEY, type Block, type StageContext } from "@/engine/types";
import { getVisualBrief } from "@/engine/creative/brief";
import { makeRunTempDir, readBytes, downloadTo } from "@/lib/files";
import { putObject, getObjectBytes } from "@/lib/storage";
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

/** Minimal spawn helper (pattern: motionComic's run()) — logs stdout, collects stderr. */
function run(cmd: string, args: string[], log: (msg: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    c.stdout.on("data", (d) => log(`${cmd}: ${d.toString().trim()}`));
    c.stderr.on("data", (d) => (err += d.toString()));
    c.on("error", reject);
    c.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args[0]} exited ${code}: ${err.slice(-400)}`))));
  });
}

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
    // LENGTH: the wizard's lengthMinutes never reached this engine — it sized
    // itself from its own defaults (6 panels / 150 words ≈ one minute) no
    // matter what the operator chose. targetSeconds (designer-set) converts to
    // the scribe's real levers: spoken-word budget (~2.1 w/s at whiteboard
    // pacing incl. draw holds) + one panel per ~22s.
    const targetSeconds = Math.max(0, Number(ctx.params["targetSeconds"] ?? 0));
    const panels = targetSeconds > 0 ? Math.max(4, Math.min(16, Math.round(targetSeconds / 22))) : undefined;
    // Measured on the live probe: Fish narration ran ~3.1 spoken w/s — the 2.1
    // guess shipped a 2-min video for a 3-min target. 2.6 leaves pause/draw air.
    const targetWords = targetSeconds > 0 ? Math.round(targetSeconds * 2.6) : undefined;
    if (targetSeconds > 0) {
      ctx.log(`whiteboard_scribe: sized to ~${targetSeconds}s → ${panels} panels / ~${targetWords} words`);
    }

    // DETERMINISTIC dir (scoped): whiteboardSync's per-layer art cache is
    // path-keyed — a random mkdtemp meant every Trigger retry/self-heal
    // regenerated all 18-30 paid art layers from scratch.
    const runDir = await makeRunTempDir(ctx.runId, "whiteboard_scribe");
    const outPath = join(runDir, "final.mp4");
    ctx.log(`whiteboard_scribe: drawing synced explainer "${topic.slice(0, 60)}" @ ${width}x${height} (style ${styleId})…`);

    const countersBefore = { ...bananaCounters };
    const res = await castWhiteboardSync({
      brief: {
        topic, facts, styleId, header: visualBrief?.header, voiceId, width, height,
        ...(panels ? { panels } : {}),
        ...(targetWords ? { targetWords } : {}),
      },
      runDir,
      outPath,
      log: (m) => ctx.log(`wb: ${m}`),
    });
    // Real image spend from the banana counters (the flat $2 guess undercounted
    // Pro-heavy runs and overcounted cached re-runs alike).
    const genPro = bananaCounters.pro - countersBefore.pro;
    const genFlash = bananaCounters.flash - countersBefore.flash;
    const genFal = (bananaCounters.fal ?? 0) - (countersBefore.fal ?? 0);
    const artCost = genPro * PRICE.bananaProUsd + genFlash * PRICE.bananaFlashUsd + genFal * PRICE.bananaFalUsd;
    // Include the fal route — the all-fal path used to book the flat $2 guess,
    // which alone ate a $2 channel budget and aborted the run after this block.
    const scribeCost = genPro + genFlash + genFal > 0 ? artCost + 0.05 /* Fish TTS */ : SCRIBE_COST;
    ctx.log(`whiteboard_scribe: image spend ${genPro} pro + ${genFlash} flash + ${genFal} fal ≈ $${scribeCost.toFixed(2)}`);

    // MUSIC BED (P1-8): whiteboard-family pipelines generate a PAID music track
    // upstream (musicKey/musicUrl) that this engine never consumed — the bed
    // played in ZERO published videos. Read it straight from the store as an
    // OPTIONAL input (deliberately NOT in `consumes`: pipelines without a music
    // stage must still validate) and duck it under the narration. Failure is
    // non-fatal — ship the narration-only video rather than lose the run.
    let finalPath = res.outPath;
    const musicKey = ctx.store["musicKey"] as string | undefined;
    const musicUrl = ctx.store["musicUrl"] as string | undefined;
    if (musicKey || musicUrl) {
      try {
        const bed = join(runDir, "bed.mp3");
        // R2 copy wins (mastered mix, never expires); URL is the legacy fallback.
        if (musicKey) await writeFile(bed, await getObjectBytes(musicKey));
        else await downloadTo(musicUrl as string, bed);
        const withMusic = join(runDir, "final_music.mp4");
        // Loop the bed under the full narration, low (0.10) + normalize=0 so
        // amix doesn't halve the narration; duration=first keeps the narration
        // length authoritative; video stream copies untouched.
        await run("ffmpeg", [
          "-y", "-i", res.outPath, "-stream_loop", "-1", "-i", bed,
          "-filter_complex", "[1:a]volume=0.10[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[a]",
          "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", withMusic,
        ], (m) => ctx.log(`wb: ${m}`));
        finalPath = withMusic;
        ctx.log(`whiteboard_scribe: music bed muxed under narration (${musicKey ? "musicKey" : "musicUrl"})`);
      } catch (e) {
        ctx.log(`whiteboard_scribe: music bed mux FAILED (keeping narration-only video): ${e instanceof Error ? e.message : e}`);
      }
    }

    const videoKey = `${ctx.keyPrefix}runs/${ctx.runId}/final.mp4`;
    await putObject(videoKey, await readBytes(finalPath), { contentType: "video/mp4" });
    const videoDurationSec = Math.round(res.durationMs / 1000);
    await recordAsset(ctx, "video", videoKey, { durationSec: videoDurationSec, engine: "whiteboard_scribe", panels: res.panels.length });
    ctx.log(`whiteboard_scribe ✓ → ${videoKey} (${videoDurationSec}s, ${res.panels.length} panels)`);

    return {
      videoKey,
      videoLocalPath: finalPath,
      videoDurationSec,
      narrationText: res.narrationText,
      [COST_PATCH_KEY]: scribeCost,
    };
  },
};

export const whiteboardScribeBlocks: Block[] = [whiteboardScribe];
