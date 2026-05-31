/**
 * Template C (Lofi) blocks — the 10-step pipeline that turns a channel topic
 * into a finished, looped lofi video uploaded as a YouTube PRIVATE draft.
 *
 * Data flow (store keys), in pipeline order:
 *   topic_select  → topic
 *   keyframes     → f1JobId f2JobId f1Url f2Url f1Key
 *   loop_clips    → clip1Key clip2Key clip1Url clip2Url
 *   upscale       → upscaledThumbUrl upscaledThumbKey
 *   music         → musicKey musicProvider musicUrl
 *   metadata      → title description tags
 *   assemble      → videoKey videoLocalPath videoDurationSec
 *   qa_light      → qaPassed qaReport
 *   thumbnail     → thumbnailKey
 *   upload_draft  → youtubeVideoId watchUrl youtubePrivacy
 *   notify        → notified
 *
 * Heavy blocks (keyframes/loop_clips/upscale/music/assemble) are gated and run
 * the REAL CLIs/APIs. Everything is addressed by R2 key + remote URL; ffmpeg
 * operates on per-run temp files. No mocks — failures are loud.
 *
 * FRUGALITY (M1): durations are short. The single param that scales to a 2-hour
 * production video is the channel pipeline's `assemble.params.durationSec`
 * (and `music.params.durationSec`) — set them to 7200 for a 2h render.
 */
import type { Block, StageContext } from "@/engine/types";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { generateKeyframe, generateClip } from "@/lib/higgsfield";
import { upscaleImage } from "@/lib/replicate";
import { generateMusic, type MusicProvider } from "@/lib/music";
import { uploadPrivateDraft } from "@/lib/youtube";
import { notifyDraftReady } from "@/lib/telegram";
import {
  concatClips,
  loopUnderAudio,
  grabFrame,
  titleCard,
  probe,
} from "@/lib/ffmpeg";
import {
  makeRunTempDir,
  downloadTo,
  readBytes,
} from "@/lib/files";
import { putObject } from "@/lib/storage";
import { join } from "node:path";

/* ----------------------------- helpers --------------------------------- */

function convex(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

function str(ctx: StageContext, key: string): string {
  const v = ctx.store[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`lofi: expected non-empty string store["${key}"], got ${JSON.stringify(v)}`);
  }
  return v;
}

function styleGrammar(ctx: StageContext): string {
  const sg = (ctx.store["styleGrammar"] as string | undefined) ?? "";
  return sg;
}

/** Record an asset row in Convex (best-effort metadata index). */
async function recordAsset(
  ctx: StageContext,
  kind: string,
  r2Key: string,
  meta?: Record<string, unknown>,
): Promise<void> {
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

/* --------------------------- 1. topic_select ---------------------------- */

export const topicSelect: Block = {
  id: "topic_select",
  consumes: [],
  produces: ["topic"],
  run: async (ctx) => {
    const pool = (ctx.store["topicPool"] as string[] | undefined) ?? [];
    if (pool.length === 0) {
      throw new Error("topic_select: channel topicPool is empty (seed it)");
    }
    // Dedup against topicMemory.
    let used = new Set<string>();
    try {
      const rows = (await convex().query(api.topicMemory.listForChannel, {
        channelId: ctx.channelId as Id<"channels">,
      })) as Array<{ key: string }>;
      used = new Set(rows.map((r) => r.key));
    } catch (e) {
      ctx.log(`topic_select: topicMemory query failed (continuing): ${e instanceof Error ? e.message : e}`);
    }
    const fresh = pool.filter((t) => !used.has(t));
    const topic = (fresh.length > 0 ? fresh : pool)[0];
    try {
      await convex().mutation(api.topicMemory.recordTopic, {
        ownerId: ctx.ownerId,
        channelId: ctx.channelId as Id<"channels">,
        key: topic,
      });
    } catch (e) {
      ctx.log(`topic_select: recordTopic failed (non-fatal): ${e instanceof Error ? e.message : e}`);
    }
    ctx.log(`topic_select chose: ${topic}`);
    return { topic };
  },
};

/* ---------------------------- 2. keyframes ------------------------------ */

export const keyframes: Block = {
  id: "keyframes",
  consumes: ["topic"],
  produces: ["f1JobId", "f2JobId", "f1Url", "f2Url", "f1Key"],
  paid: true,
  run: async (ctx) => {
    const topic = str(ctx, "topic");
    const style = styleGrammar(ctx);
    const aspect = (ctx.params.aspectRatio as string) ?? "16:9";
    const resolution = (ctx.params.resolution as string) ?? "2k";

    const f1Prompt = `${topic}. ${style}. Lofi aesthetic, cozy ambient scene, soft warm lighting, detailed background, cinematic, no people, frame A`;
    const f2Prompt = `${topic}. ${style}. Lofi aesthetic, same scene gentle variation (drifting clouds / shifting light), cinematic, no people, frame B`;

    ctx.log("keyframes: generating F1 (flux_2)…");
    const f1 = await generateKeyframe({ prompt: f1Prompt, aspectRatio: aspect, resolution });
    ctx.log("keyframes: generating F2 (flux_2)…");
    const f2 = await generateKeyframe({ prompt: f2Prompt, aspectRatio: aspect, resolution });

    if (!f1.url) throw new Error("keyframes: F1 produced no result URL");
    if (!f2.url) throw new Error("keyframes: F2 produced no result URL");

    // Persist F1 still to R2 (used for thumbnail + upscale).
    const tmp = await makeRunTempDir(ctx.runId);
    const f1Local = await downloadTo(f1.url, join(tmp, "f1.png"));
    const f1Key = `${ctx.keyPrefix}runs/${ctx.runId}/f1.png`;
    await putObject(f1Key, await readBytes(f1Local), { contentType: "image/png" });
    await recordAsset(ctx, "keyframe", f1Key, { jobId: f1.jobId, frame: "F1" });

    ctx.log(`keyframes ok: f1Job=${f1.jobId} f2Job=${f2.jobId}`);
    return {
      f1JobId: f1.jobId,
      f2JobId: f2.jobId,
      f1Url: f1.url,
      f2Url: f2.url,
      f1Key,
    };
  },
};

/* --------------------------- 3. loop_clips ------------------------------ */

export const loopClips: Block = {
  id: "loop_clips",
  consumes: ["f1JobId", "f2JobId"],
  produces: ["clip1Key", "clip2Key", "clip1Url", "clip2Url"],
  paid: true,
  run: async (ctx) => {
    // Pass the keyframe JOB IDS directly as Kling media flags (08c: no reupload).
    const f1 = str(ctx, "f1JobId");
    const f2 = str(ctx, "f2JobId");
    const topic = str(ctx, "topic");
    const dur = Number(ctx.params.clipDurationSec ?? 5);

    ctx.log("loop_clips: clip1 (F1→F2)…");
    const clip1 = await generateClip({
      prompt: `Slow gentle ambient motion, ${topic}, subtle drifting, static camera, seamless lofi loop`,
      startImage: f1,
      endImage: f2,
      durationSec: dur,
    });
    ctx.log("loop_clips: clip2 (F2→F1)…");
    const clip2 = await generateClip({
      prompt: `Slow gentle ambient motion returning to start, ${topic}, subtle drifting, static camera, seamless lofi loop`,
      startImage: f2,
      endImage: f1,
      durationSec: dur,
    });

    if (!clip1.url) throw new Error("loop_clips: clip1 produced no URL");
    if (!clip2.url) throw new Error("loop_clips: clip2 produced no URL");

    const tmp = await makeRunTempDir(ctx.runId);
    const c1Local = await downloadTo(clip1.url, join(tmp, "clip1.mp4"));
    const c2Local = await downloadTo(clip2.url, join(tmp, "clip2.mp4"));
    const clip1Key = `${ctx.keyPrefix}runs/${ctx.runId}/clip1.mp4`;
    const clip2Key = `${ctx.keyPrefix}runs/${ctx.runId}/clip2.mp4`;
    await putObject(clip1Key, await readBytes(c1Local), { contentType: "video/mp4" });
    await putObject(clip2Key, await readBytes(c2Local), { contentType: "video/mp4" });
    await recordAsset(ctx, "clip", clip1Key, { jobId: clip1.jobId });
    await recordAsset(ctx, "clip", clip2Key, { jobId: clip2.jobId });

    return {
      clip1Key,
      clip2Key,
      clip1Url: clip1.url,
      clip2Url: clip2.url,
    };
  },
};

/* ----------------------------- 4. upscale ------------------------------- */

export const upscale: Block = {
  id: "upscale",
  consumes: ["f1Url"],
  produces: ["upscaledThumbUrl", "upscaledThumbKey"],
  paid: true,
  run: async (ctx) => {
    // Higgsfield has no image upscaler → Real-ESRGAN on Replicate (08c spec).
    // We upscale the F1 still (thumbnail base). The upscaler only feeds the
    // thumbnail, never the video, so a hard shared-GPU OOM degrades to the
    // original still (logged loudly) rather than killing a finished video.
    const f1Url = str(ctx, "f1Url");
    const scale = Number(ctx.params.scale ?? 2);
    ctx.log("upscale: Real-ESRGAN on F1 still…");
    let upUrl: string;
    let upscaled = true;
    try {
      upUrl = await upscaleImage({ imageUrl: f1Url, scale });
    } catch (e) {
      ctx.log(
        `upscale: cloud upscaler exhausted (${e instanceof Error ? e.message : e}); degrading to original F1 still`,
      );
      upUrl = f1Url;
      upscaled = false;
    }

    const tmp = await makeRunTempDir(ctx.runId);
    const local = await downloadTo(upUrl, join(tmp, "f1_upscaled.png"));
    const key = `${ctx.keyPrefix}runs/${ctx.runId}/f1_upscaled.png`;
    await putObject(key, await readBytes(local), { contentType: "image/png" });
    await recordAsset(ctx, "upscaled", key, { scale, upscaled });

    return { upscaledThumbUrl: upUrl, upscaledThumbKey: key };
  },
};

/* ------------------------------ 5. music -------------------------------- */

export const music: Block = {
  id: "music",
  consumes: ["topic"],
  produces: ["musicKey", "musicProvider", "musicUrl"],
  paid: true,
  run: async (ctx) => {
    const topic = str(ctx, "topic");
    const provider = ((ctx.params.provider as MusicProvider) ?? "mureka");
    const prompt =
      (ctx.params.prompt as string) ??
      `calm lofi hip-hop instrumental for ${topic}, mellow piano, soft drums, vinyl crackle, rainy ambience, 70 bpm, no vocals`;

    ctx.log(`music: generating via ${provider}…`);
    const res = await generateMusic({ provider, prompt, timeoutMs: 600_000 });

    const tmp = await makeRunTempDir(ctx.runId);
    const local = await downloadTo(res.url, join(tmp, "music.mp3"));
    const musicKey = `${ctx.keyPrefix}runs/${ctx.runId}/music.mp3`;
    await putObject(musicKey, await readBytes(local), { contentType: "audio/mpeg" });
    await recordAsset(ctx, "music", musicKey, { provider: res.provider, jobId: res.jobId });

    return { musicKey, musicProvider: res.provider, musicUrl: res.url };
  },
};

/* ----------------------------- 6. metadata ------------------------------ */

export const metadata: Block = {
  id: "metadata",
  consumes: ["topic"],
  produces: ["title", "description", "tags"],
  run: async (ctx) => {
    const topic = str(ctx, "topic");
    const channelName = (ctx.store["channelName"] as string | undefined) ?? "Lofi";
    const title = `${topic} — Lofi Beats to Relax / Study To 🎧 ${channelName}`;
    const description =
      `${topic}.\n\nLofi beats to relax, study, and focus. Seamless ambient loop with calm instrumentals.\n\n` +
      `Generated by ${channelName}. New uploads regularly — subscribe for more.\n\n#lofi #studymusic #relax`;
    const tags = [
      "lofi",
      "lofi hip hop",
      "study music",
      "relaxing music",
      "focus music",
      "chill beats",
      "ambient",
      topic.toLowerCase(),
    ];
    ctx.log(`metadata: title="${title.slice(0, 60)}…"`);
    return { title, description, tags };
  },
};

/* ----------------------------- 7. assemble ------------------------------ */

export const assemble: Block = {
  id: "assemble",
  consumes: ["clip1Key", "clip2Key", "musicKey"],
  produces: ["videoKey", "videoLocalPath", "videoDurationSec"],
  run: async (ctx) => {
    // SHORT for M1; set durationSec=7200 in the channel pipeline for a 2h render.
    const durationSec = Number(ctx.params.durationSec ?? 90);
    const clip1Url = str(ctx, "clip1Url");
    const clip2Url = str(ctx, "clip2Url");
    const musicUrl = str(ctx, "musicUrl");

    const tmp = await makeRunTempDir(ctx.runId);
    const c1 = await downloadTo(clip1Url, join(tmp, "c1.mp4"));
    const c2 = await downloadTo(clip2Url, join(tmp, "c2.mp4"));
    const audio = await downloadTo(musicUrl, join(tmp, "music.mp3"));

    ctx.log("assemble: concat clip1+clip2 → loop unit (A→B→A)…");
    const loopUnit = await concatClips([c1, c2], join(tmp, "loopunit.mp4"));

    ctx.log(`assemble: stream_loop under music to ${durationSec}s…`);
    const finalPath = join(tmp, "final.mp4");
    await loopUnderAudio({
      loopUnitPath: loopUnit,
      audioPath: audio,
      outPath: finalPath,
      durationSec,
    });

    const videoKey = `${ctx.keyPrefix}runs/${ctx.runId}/final.mp4`;
    await putObject(videoKey, await readBytes(finalPath), { contentType: "video/mp4" });
    await recordAsset(ctx, "video", videoKey, { durationSec });

    return { videoKey, videoLocalPath: finalPath, videoDurationSec: durationSec };
  },
};

/* ----------------------------- 8. qa_light ------------------------------ */

export const qaLight: Block = {
  id: "qa_light",
  consumes: ["videoLocalPath", "videoDurationSec"],
  produces: ["qaPassed", "qaReport"],
  run: async (ctx) => {
    const path = str(ctx, "videoLocalPath");
    const target = Number(ctx.store["videoDurationSec"]);
    const tolerance = Number(ctx.params.toleranceSec ?? 5);

    const p = await probe(path);
    const failures: string[] = [];
    if (!p.hasVideo) failures.push("no video stream");
    if (!p.hasAudio) failures.push("no audio stream");
    if (Math.abs(p.durationSec - target) > tolerance) {
      failures.push(
        `duration ${p.durationSec.toFixed(1)}s off target ${target}s (>${tolerance}s)`,
      );
    }
    if ((p.width ?? 0) < 640 || (p.height ?? 0) < 360) {
      failures.push(`resolution too small: ${p.width}x${p.height}`);
    }

    const report = {
      durationSec: p.durationSec,
      target,
      width: p.width,
      height: p.height,
      videoCodec: p.videoCodec,
      audioCodec: p.audioCodec,
      failures,
    };
    if (failures.length > 0) {
      throw new Error(`qa_light FAILED: ${failures.join("; ")} | ${JSON.stringify(report)}`);
    }
    ctx.log(`qa_light passed: ${JSON.stringify(report)}`);
    return { qaPassed: true, qaReport: report };
  },
};

/* ----------------------------- 9. thumbnail ----------------------------- */

export const thumbnail: Block = {
  id: "thumbnail",
  consumes: ["upscaledThumbUrl", "title"],
  produces: ["thumbnailKey"],
  run: async (ctx) => {
    const baseUrl = str(ctx, "upscaledThumbUrl");
    const channelName = (ctx.store["channelName"] as string | undefined) ?? "Lofi";
    const topic = str(ctx, "topic");

    const tmp = await makeRunTempDir(ctx.runId);
    const base = await downloadTo(baseUrl, join(tmp, "thumb_base.png"));
    const outJpg = join(tmp, "thumbnail.jpg");
    await titleCard({
      basePath: base,
      outJpg,
      title: channelName,
      subtitle: topic,
    });

    const thumbnailKey = `${ctx.keyPrefix}runs/${ctx.runId}/thumbnail.jpg`;
    await putObject(thumbnailKey, await readBytes(outJpg), { contentType: "image/jpeg" });
    await recordAsset(ctx, "thumbnail", thumbnailKey);
    return { thumbnailKey };
  },
};

/* --------------------------- 10. upload_draft --------------------------- */

export const uploadDraft: Block = {
  id: "upload_draft",
  consumes: ["videoLocalPath", "title", "description", "tags", "qaPassed"],
  produces: ["youtubeVideoId", "watchUrl", "youtubePrivacy"],
  run: async (ctx) => {
    if (ctx.store["qaPassed"] !== true) {
      throw new Error("upload_draft: qa did not pass — refusing to upload");
    }
    const filePath = str(ctx, "videoLocalPath");
    const title = str(ctx, "title");
    const description = str(ctx, "description");
    const tags = (ctx.store["tags"] as string[]) ?? [];

    ctx.log("upload_draft: uploading PRIVATE draft to YouTube…");
    const res = await uploadPrivateDraft({
      filePath,
      title,
      description,
      tags,
      privacyStatus: "private",
    });
    // Persist the youtube id on the run.
    try {
      await convex().mutation(api.runs.updateRun, {
        runId: ctx.runId as Id<"runs">,
        youtubeVideoId: res.videoId,
      });
    } catch (e) {
      ctx.log(`upload_draft: updateRun failed (non-fatal): ${e instanceof Error ? e.message : e}`);
    }
    ctx.log(`upload_draft ok: ${res.watchUrl} (privacy=${res.privacyStatus})`);
    return {
      youtubeVideoId: res.videoId,
      watchUrl: res.watchUrl,
      youtubePrivacy: res.privacyStatus,
    };
  },
};

/* ------------------------------ 11. notify ------------------------------ */

export const notify: Block = {
  id: "notify",
  consumes: ["watchUrl", "title"],
  produces: ["notified"],
  run: async (ctx) => {
    const watchUrl = str(ctx, "watchUrl");
    const title = str(ctx, "title");
    await notifyDraftReady(title, watchUrl, {
      chatId: process.env.TELEGRAM_CHAT_ID ?? process.env.TELEGRAM_ADMIN_CHAT_ID,
    });
    ctx.log(`notify: telegram draft-ready sent for ${watchUrl}`);
    return { notified: true };
  },
};

/** All lofi blocks in canonical order. */
export const lofiBlocks: Block[] = [
  topicSelect,
  keyframes,
  loopClips,
  upscale,
  music,
  metadata,
  assemble,
  qaLight,
  thumbnail,
  uploadDraft,
  notify,
];

/** Canonical lofi pipeline (ordered block entries) for a channel. */
export const LOFI_PIPELINE = [
  { block: "topic_select" },
  { block: "keyframes", params: { aspectRatio: "16:9", resolution: "2k" } },
  { block: "loop_clips", params: { clipDurationSec: 5 } },
  { block: "upscale", params: { scale: 2 } },
  { block: "music", params: { provider: "mureka" } },
  { block: "metadata" },
  { block: "assemble", params: { durationSec: 90 } }, // ← set 7200 for 2h production
  { block: "qa_light", params: { toleranceSec: 5 } },
  { block: "thumbnail" },
  { block: "upload_draft" },
  { block: "notify" },
];
