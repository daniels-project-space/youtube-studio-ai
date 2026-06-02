/**
 * Template C (Lofi) blocks — the 10-step pipeline that turns a channel topic
 * into a finished, looped lofi video uploaded as a YouTube PRIVATE draft.
 *
 * Data flow (store keys), in pipeline order:
 *   topic_select  → topic
 *   scene_planner → scenes sceneMusicPrompt
 *   keyframes     → f1JobId f2JobId f1Url f2Url f1Key
 *   loop_clips    → clip1Key clip2Key clip1Url clip2Url
 *   upscale       → loopUnitKey loopUnitUrl loopUnitUpscaled loopUnitResolution
 *   music         → musicKey musicProvider musicUrl
 *   metadata      → title description tags
 *   assemble      → videoKey videoLocalPath videoDurationSec
 *   intro_card    → introApplied introMode (+ overrides videoKey/videoLocalPath)
 *   qa_light      → qaPassed qaReport
 *   thumbnail     → thumbnailKey
 *   upload_draft  → youtubeVideoId watchUrl youtubePrivacy
 *   notify        → notified
 *
 * The Kling prompt CONSTITUTION (src/engine/prompt/constitution.ts) is appended
 * to every i2v call via composeKlingPrompt; FLUX stills via composeFluxPrompt.
 * The REAL upscale (Topaz on the loop UNIT) lives in the upscale block; the
 * Remotion intro card (LofiIntroV2) is overlaid by intro_card.
 *
 * Heavy blocks (keyframes/loop_clips/upscale/music/assemble) are gated and run
 * the REAL CLIs/APIs. Everything is addressed by R2 key + remote URL; ffmpeg
 * operates on per-run temp files. No mocks — failures are loud.
 *
 * FRUGALITY (M1): durations are short. The single param that scales to a 2-hour
 * production video is the channel pipeline's `assemble.params.durationSec`
 * (and `music.params.durationSec`) — set them to 7200 for a 2h render.
 */
import { COST_PATCH_KEY, type Block, type StageContext } from "@/engine/types";
import { PRICE } from "@/engine/pricing";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { generateKeyframe, generateClip } from "@/lib/higgsfield";
import { upscaleLoopUnit } from "@/lib/replicate";
// (Real-ESRGAN image upscaler intentionally not used for video — Topaz only.)
import { generateMusic, type MusicProvider } from "@/lib/music";
import { uploadPrivateDraft } from "@/lib/youtube";
import { notifyDraftReady } from "@/lib/telegram";
import { concatClips, composeWithIntro, probe } from "@/lib/ffmpeg";
import { hasGeminiKey } from "@/lib/gemini";
import { hasAnthropicKey } from "@/lib/anthropic";
import { produceAndCritique } from "@/engine/critiqueLoop";
import { agentJson } from "@/agents/mastra";
import { z } from "zod";

/** Topic-chunk structured-output schemas (validated on both Mastra + REST). */
const producerTopicSchema = z.object({
  candidates: z
    .array(z.object({ topic: z.string(), angle: z.string().optional().default("") }))
    .optional()
    .default([]),
});
const directorScoreSchema = z.object({
  score: z.number().optional(),
  issues: z.array(z.string()).optional().default([]),
});
import {
  makeRunTempDir,
  downloadTo,
  readBytes,
  writeBytes,
} from "@/lib/files";
import { putObject, getObjectBytes } from "@/lib/storage";
import { join } from "node:path";
import { access } from "node:fs/promises";
import {
  composeKlingPrompt,
  composeFluxPrompt,
} from "@/engine/prompt/constitution";
import {
  planScenes,
  type SceneSpec,
  type SceneLibraryEntry,
} from "@/engine/prompt/scenePlanner";

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

function opt(ctx: StageContext, key: string): string | undefined {
  const v = ctx.store[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Normalize a topic for hard duplicate detection (never trust the model). */
function normalizeTopic(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

async function recordTopicMemory(
  c: ConvexHttpClient,
  ctx: StageContext,
  topic: string,
): Promise<void> {
  try {
    await c.mutation(api.topicMemory.recordTopic, {
      ownerId: ctx.ownerId,
      channelId: ctx.channelId as Id<"channels">,
      key: topic,
    });
  } catch (e) {
    ctx.log(`topic_select: recordTopic failed (non-fatal): ${e instanceof Error ? e.message : e}`);
  }
}

function styleGrammar(ctx: StageContext): string {
  const sg = (ctx.store["styleGrammar"] as string | undefined) ?? "";
  return sg;
}

/** Channel visual-style preset key (drives the Kling/Flux constitution). */
function visualStyle(ctx: StageContext): string {
  return (
    (ctx.params["visualStyle"] as string | undefined) ??
    (ctx.store["visualStyle"] as string | undefined) ??
    "lofi"
  );
}

/** Read the planned scenes from the store (scene_planner output). */
function scenesFromStore(ctx: StageContext): SceneSpec[] {
  const s = ctx.store["scenes"] as SceneSpec[] | undefined;
  if (!Array.isArray(s) || s.length === 0) {
    throw new Error("lofi: store[\"scenes\"] missing — scene_planner must run first");
  }
  return s;
}

/** True if a local file path exists and is readable. */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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
    // Director-chosen, identity-aligned, non-repeating topic (Phase 1).
    // Producer (Gemini) proposes identity-fit candidates excluding history;
    // Director (Claude) ranks for fit/freshness/CTR; a HARD no-repeat check runs
    // in code (never trusted to the model). `policy` param:
    //   "no_repeat"     — must always be a brand-new topic (error if impossible)
    //   "prefer_fresh"  — dedup; may recycle the pool when exhausted (default)
    const c = convex();
    const channelId = ctx.channelId as Id<"channels">;
    const policy =
      (ctx.params["policy"] as string | undefined) === "no_repeat"
        ? "no_repeat"
        : "prefer_fresh";

    // Channel identity (store seeds first; fall back to the channel doc).
    const channel = await c
      .query(api.channels.getChannel, { channelId })
      .catch(() => null);
    const id = (channel?.identity ?? {}) as {
      persona?: string;
      niche?: string;
      styleGrammar?: string;
      topicPool?: string[];
      bannedWords?: string[];
    };
    const channelName = opt(ctx, "channelName") ?? channel?.name ?? "this channel";
    const persona = opt(ctx, "persona") ?? id.persona ?? "";
    const niche = opt(ctx, "niche") ?? id.niche ?? "";
    const style = (ctx.store["styleGrammar"] as string | undefined) ?? id.styleGrammar ?? "";
    const pool = (ctx.store["topicPool"] as string[] | undefined) ?? id.topicPool ?? [];
    const bannedWords = (id.bannedWords ?? []).filter(Boolean);

    // Used-topic history (hard dedup set + a recent list for prompts).
    let usedRows: Array<{ key: string }> = [];
    try {
      usedRows = (await c.query(api.topicMemory.listForChannel, {
        channelId,
      })) as Array<{ key: string }>;
    } catch (e) {
      ctx.log(`topic_select: history query failed (continuing): ${e instanceof Error ? e.message : e}`);
    }
    const usedNorm = new Set(usedRows.map((r) => normalizeTopic(r.key)));
    const recentList = usedRows.map((r) => r.key).slice(-40);

    // Degrade: no Gemini → legacy static-pool first-fresh pick.
    if (!hasGeminiKey()) {
      const fresh = pool.filter((t) => !usedNorm.has(normalizeTopic(t)));
      const topic = (fresh.length > 0 ? fresh : pool)[0];
      if (!topic) {
        throw new Error("topic_select: no Gemini key and empty topicPool");
      }
      await recordTopicMemory(c, ctx, topic);
      ctx.log(`topic_select (degraded, no Gemini): ${topic}`);
      return { topic };
    }

    const loop = await produceAndCritique<{ topic: string; angle: string }>({
      label: "topic_select",
      threshold: 0.8,
      maxIters: 3,
      log: ctx.log,
      produce: async (priorIssues) => {
        const out = await agentJson({
          role: "producer",
          schema: producerTopicSchema,
          log: ctx.log,
          prompt:
            `You are the topic PRODUCER for the YouTube channel "${channelName}".\n` +
            `Persona: ${persona || "n/a"}\nNiche: ${niche || "n/a"}\nStyle: ${style || "n/a"}\n` +
            (bannedWords.length ? `Avoid these words/themes: ${bannedWords.join(", ")}\n` : "") +
            (pool.length ? `Inspiration pool (NOT a limit): ${pool.slice(0, 30).join(" | ")}\n` : "") +
            `ALREADY USED — do NOT repeat or trivially rephrase any of these:\n${recentList.join("\n") || "(none yet)"}\n\n` +
            (policy === "no_repeat"
              ? "This channel must NEVER repeat a topic. Invent genuinely NEW, specific, on-identity video topics absent from the used list.\n"
              : "Prefer fresh topics not in the used list.\n") +
            (priorIssues.length ? `Fix these problems from the last attempt: ${priorIssues.join("; ")}\n` : "") +
            `Propose 5 DISTINCT candidate topics — each a specific, compelling video topic (not a broad category) plus a one-line unique ANGLE.\n` +
            `Return STRICT JSON {"candidates":[{"topic":string,"angle":string}]}.`,
          maxTokens: 700,
          temperature: 0.9,
        });
        const cands = (out.candidates ?? [])
          .map((x) => ({ topic: (x.topic ?? "").trim(), angle: (x.angle ?? "").trim() }))
          .filter((x) => x.topic.length > 0);
        if (cands.length === 0) {
          throw new Error("topic_select: producer returned no candidates");
        }
        // Prefer a candidate that is fresh at the code level.
        const fresh = cands.filter((x) => !usedNorm.has(normalizeTopic(x.topic)));
        return fresh[0] ?? cands[0];
      },
      critique: async (cand) => {
        const issues: string[] = [];
        // DETERMINISTIC gates (computed, not model-judged).
        const dup = usedNorm.has(normalizeTopic(cand.topic));
        if (dup) issues.push(`"${cand.topic}" duplicates an already-used topic — choose something genuinely new`);
        const banned = bannedWords.find((w) =>
          cand.topic.toLowerCase().includes(w.toLowerCase()),
        );
        if (banned) issues.push(`contains banned term "${banned}"`);

        // SUBJECTIVE: the Director scores fit / freshness / appeal.
        let dirScore = 0.7;
        let dirIssues: string[] = [];
        if (hasAnthropicKey()) {
          try {
            const v = await agentJson({
              role: "director",
              schema: directorScoreSchema,
              log: ctx.log,
              system: "You are the DIRECTOR: a YouTube content strategist. Return ONLY JSON.",
              prompt:
                `Channel "${channelName}" — persona: ${persona || "n/a"}; niche: ${niche || "n/a"}; style: ${style || "n/a"}.\n` +
                `Proposed topic: "${cand.topic}" (angle: ${cand.angle || "n/a"}).\n` +
                `Recently used:\n${recentList.slice(-20).join("\n") || "(none)"}\n\n` +
                `Score 0..1 on on-identity fit, distinctiveness vs used topics, and click/watch appeal. ` +
                `List concrete issues. Return JSON {"score":number,"issues":string[]}.`,
              maxTokens: 400,
              temperature: 0.3,
            });
            dirScore = typeof v.score === "number" ? Math.max(0, Math.min(1, v.score)) : 0.7;
            dirIssues = Array.isArray(v.issues) ? v.issues : [];
          } catch (e) {
            ctx.log(`topic_select: director failed (continuing): ${e instanceof Error ? e.message : e}`);
          }
        }
        const hardFail = dup || Boolean(banned);
        return {
          score: hardFail ? 0 : dirScore,
          pass: !hardFail && dirScore >= 0.8,
          issues: [...issues, ...dirIssues],
        };
      },
    });

    let topic = loop.value.topic;
    // FINAL hard guarantee (code, not model).
    if (usedNorm.has(normalizeTopic(topic))) {
      if (policy === "no_repeat") {
        throw new Error(
          `topic_select: could not produce a non-repeating topic for a no_repeat channel after ${loop.iterations} iters`,
        );
      }
      const fresh = pool.filter((t) => !usedNorm.has(normalizeTopic(t)));
      if (fresh.length) topic = fresh[0];
    }
    // dryRun = preview a topic without committing it to history (UI preview/tests).
    if (ctx.params["dryRun"] !== true) await recordTopicMemory(c, ctx, topic);
    ctx.log(
      `topic_select: "${topic}" (policy=${policy}, accepted=${loop.accepted}, score=${loop.critique.score.toFixed(2)}, angle="${loop.value.angle.slice(0, 60)}")`,
    );
    return { topic };
  },
};

/* -------------------------- 1b. scene_planner --------------------------- */

export const scenePlanner: Block = {
  id: "scene_planner",
  consumes: ["topic"],
  produces: ["scenes", "sceneMusicPrompt"],
  run: async (ctx) => {
    const topic = str(ctx, "topic");
    const style = styleGrammar(ctx);
    const vs = visualStyle(ctx);
    // Optional per-channel pre-authored library (locked consistency across a
    // series). Seeded from channel identity into the store by the runner, or
    // passed as a block param.
    const sceneLibrary =
      (ctx.params["sceneLibrary"] as Record<string, SceneLibraryEntry> | undefined) ??
      (ctx.store["sceneLibrary"] as Record<string, SceneLibraryEntry> | undefined);
    const defaultDurationSec = Number(ctx.params["clipDurationSec"] ?? 5);

    const plan = planScenes({
      topic,
      styleGrammar: style,
      visualStyle: vs,
      sceneLibrary,
      defaultDurationSec,
    });
    ctx.log(
      `scene_planner: ${plan.scenes.length} scene(s) (fromLibrary=${plan.fromLibrary}, style=${vs})`,
    );
    return {
      scenes: plan.scenes,
      sceneMusicPrompt: plan.musicPrompt ?? "",
    };
  },
};

/* ---------------------------- 2. keyframes ------------------------------ */

export const keyframes: Block = {
  id: "keyframes",
  consumes: ["scenes"],
  produces: ["f1JobId", "f2JobId", "f1Url", "f2Url", "f1Key"],
  paid: true,
  run: async (ctx) => {
    const style = styleGrammar(ctx);
    const vs = visualStyle(ctx);
    const scene = scenesFromStore(ctx)[0];
    const aspect = (ctx.params.aspectRatio as string) ?? "16:9";
    const resolution = (ctx.params.resolution as string) ?? "2k";

    // Compose the FULL flux still prompt via the constitution. Frame A is the
    // planned scene; Frame B is a gentle variation for the A→B→A loop.
    const f1Prompt = composeFluxPrompt({
      sceneDescription: `${scene.fluxPrompt}, frame A`,
      styleGrammar: style,
      visualStyle: vs,
    });
    const f2Prompt = composeFluxPrompt({
      sceneDescription: `${scene.fluxPrompt}, same scene with a gentle variation (drifting clouds / shifting light / subtle reflections), frame B`,
      styleGrammar: style,
      visualStyle: vs,
    });

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
      [COST_PATCH_KEY]: 2 * PRICE.fluxStillUsd, // two flux stills
    };
  },
};

/* --------------------------- 3. loop_clips ------------------------------ */

export const loopClips: Block = {
  id: "loop_clips",
  consumes: ["f1JobId", "f2JobId", "scenes"],
  produces: ["clip1Key", "clip2Key", "clip1Url", "clip2Url"],
  paid: true,
  run: async (ctx) => {
    // Pass the keyframe JOB IDS directly as Kling media flags (08c: no reupload).
    const f1 = str(ctx, "f1JobId");
    const f2 = str(ctx, "f2JobId");
    const style = styleGrammar(ctx);
    const vs = visualStyle(ctx);
    const scene = scenesFromStore(ctx)[0];
    const dur = Number(ctx.params.clipDurationSec ?? scene.durationSec ?? 5);

    // Compose the FULL Kling i2v prompt: motion-only scene description + style
    // grammar + the locked-camera constitution (+ negative prompt). This is the
    // gap the first M1 had — Kling now receives the full scene+camera+style
    // instruction, not a one-liner.
    const fwd = composeKlingPrompt({
      sceneDescription: scene.klingMotionPrompt,
      styleGrammar: style,
      visualStyle: vs,
    });
    const rev = composeKlingPrompt({
      sceneDescription: `${scene.klingMotionPrompt}, motion gently reversing back to the starting state`,
      styleGrammar: style,
      visualStyle: vs,
    });

    ctx.log(`loop_clips: clip1 (F1→F2) — kling prompt: "${fwd.prompt.slice(0, 90)}…"`);
    const clip1 = await generateClip({
      prompt: fwd.prompt,
      negativePrompt: fwd.negativePrompt,
      startImage: f1,
      endImage: f2,
      durationSec: dur,
    });
    ctx.log("loop_clips: clip2 (F2→F1)…");
    const clip2 = await generateClip({
      prompt: rev.prompt,
      negativePrompt: rev.negativePrompt,
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
      [COST_PATCH_KEY]: 2 * PRICE.videoClipUsd, // two i2v clips
    };
  },
};

/* ----------------------------- 4. upscale ------------------------------- */

export const upscale: Block = {
  id: "upscale",
  consumes: ["clip1Url", "clip2Url", "f1Url"],
  produces: [
    "loopUnitKey",
    "loopUnitUrl",
    "loopUnitUpscaled",
    "loopUnitResolution",
  ],
  paid: true,
  run: async (ctx) => {
    // THE REAL UPSCALE (legacy topaz.py): build the short A→B→A loop UNIT, then
    // run Topaz `topazlabs/video-upscale` on JUST that ~10-30s unit. assemble
    // then stream_loops the 4K unit under audio — so we never upscale the full
    // render. Bounds cost/time to ~$0.25 / ~1 min. Real-ESRGAN-on-full-video is
    // removed entirely (it was the OOM + "no upscale" bug).
    const clip1Url = str(ctx, "clip1Url");
    const clip2Url = str(ctx, "clip2Url");
    const targetResolution = (ctx.params.targetResolution as string) ?? "4k";
    const targetFps = Number(ctx.params.targetFps ?? 30);

    const tmp = await makeRunTempDir(ctx.runId);
    const c1 = await downloadTo(clip1Url, join(tmp, "c1.mp4"));
    const c2 = await downloadTo(clip2Url, join(tmp, "c2.mp4"));

    ctx.log("upscale: concat clip1+clip2 → loop unit (A→B→A)…");
    const loopUnit = await concatClips([c1, c2], join(tmp, "loopunit.mp4"));

    let finalLoopPath = loopUnit;
    let upscaled = true;
    let resolution = targetResolution;
    try {
      ctx.log(
        `upscale: Topaz video-upscale on loop unit → ${targetResolution}@${targetFps}fps…`,
      );
      const upUrl = await upscaleLoopUnit({
        inputPath: loopUnit,
        targetResolution,
        targetFps,
      });
      finalLoopPath = await downloadTo(upUrl, join(tmp, "loopunit_4k.mp4"));
      ctx.log(`upscale: Topaz complete — ${targetResolution}`);
    } catch (e) {
      // HONEST degrade: keep the native loop unit, log LOUDLY (legacy parity).
      resolution = "native";
      upscaled = false;
      ctx.log(
        `upscale: !!! TOPAZ UPSCALE FAILED (${e instanceof Error ? e.message : e}) — DEGRADING to native loop unit (NOT 4K)`,
      );
    }

    const loopUnitKey = `${ctx.keyPrefix}runs/${ctx.runId}/loopunit_${resolution}.mp4`;
    await putObject(loopUnitKey, await readBytes(finalLoopPath), {
      contentType: "video/mp4",
    });
    await recordAsset(ctx, "loop_unit", loopUnitKey, {
      upscaled,
      resolution,
      targetFps,
    });

    // Stash the local path so assemble can stream_loop without re-downloading.
    return {
      loopUnitKey,
      loopUnitUrl: finalLoopPath, // local path; assemble reads it directly
      loopUnitUpscaled: upscaled,
      loopUnitResolution: resolution,
      // Topaz only billed when the upscale actually ran (degrade path is free).
      [COST_PATCH_KEY]: upscaled ? PRICE.topazUpscaleUsd : 0,
    };
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

    return {
      musicKey,
      musicProvider: res.provider,
      musicUrl: res.url,
      [COST_PATCH_KEY]: PRICE.musicTrackUsd,
    };
  },
};

/* ----------------------------- 7. assemble ------------------------------ */

export const assemble: Block = {
  id: "assemble",
  consumes: ["loopUnitKey", "musicUrl", "introCardPath"],
  produces: ["videoKey", "videoLocalPath", "videoDurationSec"],
  run: async (ctx) => {
    // SHORT for M1; set durationSec=7200 in the channel pipeline for a 2h render.
    // The loop UNIT is already upscaled (Topaz) by the upscale block; assemble
    // PREPENDS the Remotion title card (music-only intro, no narration), then
    // stream_loops that 4K unit under the full music track → the cost of length
    // is just ffmpeg time, not another upscale. Lofi has no narration so the
    // music plays at full volume the whole way (composeWithIntro skips ducking).
    const durationSec = Number(ctx.params.durationSec ?? 90);
    const musicUrl = str(ctx, "musicUrl");
    // upscale stashed the loop-unit local path in loopUnitUrl; if absent (e.g.
    // resumed run), fall back to the R2 key via a fresh download.
    const loopUnitLocal = ctx.store["loopUnitUrl"] as string | undefined;

    const tmp = await makeRunTempDir(ctx.runId);
    const audio = await downloadTo(musicUrl, join(tmp, "music.mp3"));

    let loopUnitPath: string;
    if (loopUnitLocal && (await fileExists(loopUnitLocal))) {
      loopUnitPath = loopUnitLocal;
    } else {
      // Re-fetch the upscaled loop unit from R2 if the local temp is gone
      // (e.g. a resumed run on a fresh worker).
      const key = str(ctx, "loopUnitKey");
      ctx.log(`assemble: loop-unit temp missing — re-fetching ${key} from R2`);
      const bytes = await getObjectBytes(key);
      loopUnitPath = await writeBytes(join(tmp, "loopunit.mp4"), bytes);
    }

    // Cap delivery height (default UHD 2160) so a true-4K Topaz unit stays
    // CPU-encodable; the upscale detail is preserved, the pixel count is sane.
    // The card (rendered 1080p) is scaled up to match this canvas.
    const maxHeight = Number(ctx.params.maxHeight ?? 2160);
    const p = await probe(loopUnitPath);
    const ih = p.height && p.height > 0 ? p.height : 1080;
    const iw = p.width && p.width > 0 ? p.width : 1920;
    let H = Math.min(maxHeight, ih);
    H -= H % 2;
    let W = Math.round(iw * (H / ih));
    W -= W % 2;
    const preset = (ctx.params.encodePreset as string) ?? "veryfast";

    const introCardPath = opt(ctx, "introCardPath"); // "" if the card render failed
    const introSec = introCardPath ? Number(ctx.store["introSec"] ?? 5) : 0;
    const fadeOutSec = Number(ctx.params.fadeOutSec ?? 0);
    const videoDurationSec = introSec + durationSec;

    ctx.log(
      `assemble: prepend card (${introSec}s) + stream_loop 4K unit under music to ${durationSec}s @ ${W}x${H} (preset=${preset})…`,
    );
    const finalPath = join(tmp, "final.mp4");
    await composeWithIntro({
      introCardPath: introCardPath || undefined,
      loopBodyPath: loopUnitPath,
      musicPath: audio,
      outPath: finalPath,
      introSec,
      bodySec: durationSec,
      tailSec: 0,
      fadeOutSec,
      width: W,
      height: H,
      preset,
    });

    const videoKey = `${ctx.keyPrefix}runs/${ctx.runId}/final.mp4`;
    await putObject(videoKey, await readBytes(finalPath), { contentType: "video/mp4" });
    await recordAsset(ctx, "video", videoKey, {
      durationSec: videoDurationSec,
      introSec,
      loopUnitResolution: ctx.store["loopUnitResolution"],
    });

    return { videoKey, videoLocalPath: finalPath, videoDurationSec };
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

/**
 * All lofi blocks (registration order; pipeline order is set by LOFI_PIPELINE).
 *
 * NOTE: the legacy `metadata` and `thumbnail` blocks are intentionally OMITTED
 * from registration. The competitor-intelligence engine supersedes them with
 * `metadataOptimized` (same id "metadata", title-optimised + view estimate) and
 * `thumbnailGen` (id "thumbnail_gen", claude_flux), both registered via
 * `intelligenceBlocks` in src/engine/blocks.ts. Registering both copies of the
 * "metadata" id would throw a duplicate-id error. The legacy exports remain for
 * reference but are no longer wired into the registry or LOFI_PIPELINE.
 */
export const lofiBlocks: Block[] = [
  topicSelect,
  scenePlanner,
  keyframes,
  loopClips,
  upscale,
  music,
  assemble,
  uploadDraft,
  notify,
];

/**
 * Canonical lofi pipeline (ordered block entries) for a channel.
 *
 * Order (faithful to legacy lofi sequence + competitor-intelligence engine):
 *   competitor_research → scene_planner → keyframes → loop_clips
 *   → upscale(LOOP UNIT, Topaz 4K) → music → metadata(title-optimised)
 *   → assemble(stream_loop 4K unit + mux) → intro_card(overlay) → qa_light
 *   → thumbnail_gen(claude_flux) → upload_draft → notify
 *
 * `competitor_research` runs first (consumes []) so nicheIntelligence /
 * seoDatabank / competitors are in the store before `metadata` optimises the
 * title and `thumbnail_gen` designs the claude_flux thumbnail.
 *
 * We upscale the ~10-30s loop UNIT (not the full render), then stream_loop the
 * 4K unit to length — so length is just a duration param, never extra GPU cost.
 */
export const LOFI_PIPELINE = [
  { block: "competitor_research" },
  { block: "topic_select" },
  { block: "scene_planner", params: { visualStyle: "lofi", clipDurationSec: 5 } },
  { block: "keyframes", params: { aspectRatio: "16:9", resolution: "2k", visualStyle: "lofi" } },
  { block: "loop_clips", params: { clipDurationSec: 5, visualStyle: "lofi" } },
  { block: "upscale", params: { targetResolution: "4k", targetFps: 30 } },
  { block: "music", params: { provider: "mureka" } },
  { block: "metadata" },
  { block: "intro_card", params: { introSec: 5 } },
  { block: "assemble", params: { durationSec: 90 } }, // ← set 7200 for 2h production
  { block: "thumbnail_gen" },
  { block: "qa_visual" },
  { block: "upload_draft" },
  { block: "notify" },
];
