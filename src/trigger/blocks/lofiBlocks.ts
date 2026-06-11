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
import { generateFalFluxProImage } from "@/lib/falImage";
import { generateFalI2V } from "@/lib/falVideo";
import { upscaleLoopUnit } from "@/lib/replicate";
// (Real-ESRGAN image upscaler intentionally not used for video — Topaz only.)
import { generateMusic, generateSuno, type MusicProvider, type MusicTrack } from "@/lib/music";
import { uploadPrivateDraft, setVideoThumbnail } from "@/lib/youtube";
import { notifyDraftReady } from "@/lib/telegram";
import { seamlessLoopUnit, boomerangLoopUnit, composeWithIntro, composeMusicLoopDeblur, probe, makeVerticalClip, burnCaptions, captionCuesFromTimings, crossfadeConcatAudio, masterAudio } from "@/lib/ffmpeg";
import { hasAyrshareKey, crosspost as ayrCrosspost } from "@/lib/ayrshare";
import { hasGeminiKey, geminiVisionLocal, parseJsonLoose } from "@/lib/gemini";
import { hasAnthropicKey } from "@/lib/anthropic";
import { produceAndCritique } from "@/engine/critiqueLoop";
import { agentJson } from "@/agents/mastra";
import { loadPerformanceContext } from "@/lib/performance";
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
import { putObject, getObjectBytes, listObjects, deleteObjects, publicUrl } from "@/lib/storage";
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
  // Cinematographer (crew) brief blends its look + motion language into every
  // keyframe/scene prompt so the visuals match the channel's vibe.
  const vb = ctx.store["visualBrief"] as { promptStyle?: string; motion?: string } | undefined;
  const extra = [vb?.promptStyle, vb?.motion].map((s) => (s ?? "").trim()).filter(Boolean).join(". ");
  return [sg, extra].filter(Boolean).join(". ");
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
    // RENDER-GROUP REUSE: a language sibling renders the SAME topic as the base
    // (shared video, different language) — skip selection + history recording.
    const reuseTopic = ctx.store["reuseTopic"] as string | undefined;
    if (typeof reuseTopic === "string" && reuseTopic.trim()) {
      ctx.log(`topic_select: REUSED base topic "${reuseTopic}"`);
      return { topic: reuseTopic };
    }
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
    // Phase 7: bias toward topics like past high-retention winners ("" until enough data).
    const perfCtx = await loadPerformanceContext(ctx.keyPrefix);

    // SERIES MODE — an ordered, numbered run (e.g. "7 Days of Stoic Calm"). The
    // episode number = how many of this series already exist + 1; each episode
    // gets a unique subtitle that continues the arc. When the series is finished
    // (epNum > seriesCount) we fall through to normal topic generation so the
    // channel keeps publishing. Episode order is encoded in the (clean) title.
    const seriesTitle = (ctx.params["seriesTitle"] as string | undefined)?.trim();
    const seriesCount = Number(ctx.params["seriesCount"] ?? 0) || 0;
    if (seriesTitle) {
      const doneCount = usedRows.filter((r) => r.key.includes(seriesTitle)).length;
      const epNum = doneCount + 1;
      if (!(seriesCount > 0 && epNum > seriesCount)) {
        const label = seriesCount > 0 ? `Part ${epNum} of ${seriesCount}` : `Part ${epNum}`;
        const prior = recentList.filter((t) => t.includes(seriesTitle));
        let subtitle = "";
        if (hasGeminiKey()) {
          try {
            const out = await agentJson({
              role: "producer",
              schema: producerTopicSchema,
              log: ctx.log,
              prompt:
                `You are planning episode ${epNum} of an ordered YouTube series titled "${seriesTitle}"` +
                (seriesCount > 0 ? ` (a ${seriesCount}-part series).` : ".") + "\n" +
                `Channel "${channelName}" — persona: ${persona || "n/a"}; niche: ${niche || "n/a"}; style: ${style || "n/a"}.\n` +
                `Episodes already published (CONTINUE the arc, do NOT repeat):\n${prior.join("\n") || "(none yet — this is episode 1)"}\n\n` +
                `Propose the SINGLE best focus for episode ${epNum}: a specific, compelling SUBTITLE (the episode's unique theme — not the series name) and a one-line angle. ` +
                `It must build on prior episodes and fit the whole series. Return STRICT JSON {"candidates":[{"topic":string,"angle":string}]}.`,
              maxTokens: 400,
              temperature: 0.8,
            });
            subtitle = (out.candidates?.[0]?.topic ?? "").trim().replace(/^["']|["']$/g, "");
          } catch (e) {
            ctx.log(`topic_select(series): subtitle gen failed (continuing): ${e instanceof Error ? e.message : e}`);
          }
        }
        const topic = subtitle
          ? `${seriesTitle} — ${label}: ${subtitle}`
          : `${seriesTitle} — ${label}`;
        if (ctx.params["dryRun"] !== true) await recordTopicMemory(c, ctx, topic);
        ctx.log(`topic_select(series): "${topic}" (episode ${epNum}${seriesCount ? `/${seriesCount}` : ""})`);
        return { topic };
      }
      ctx.log(`topic_select(series): "${seriesTitle}" complete (${doneCount}/${seriesCount}) — falling through to normal topics`);
    }

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
            (perfCtx ? perfCtx + "\n" : "") +
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

    // On-brand SETTING for the loop: cinematographer brief > channel param >
    // niche/persona. Drives WHAT is in the frame so the loop matches the channel
    // goal instead of a generic template.
    // The cinematographer brief's first footage query is the most concrete,
    // on-brand WORLD descriptor (e.g. "rain-soaked Tokyo street at night");
    // styleGrammar is the channel's synthesized visual descriptor. Either is a
    // far better scene setting than the bare niche label.
    const vb = ctx.store["visualBrief"] as { setting?: string; world?: string; footageQueries?: string[] } | undefined;
    const settingHint = [
      vb?.setting,
      vb?.world,
      vb?.footageQueries?.[0],
      ctx.params["setting"] as string | undefined,
      ctx.store["styleGrammar"] as string | undefined,
      ctx.store["niche"] as string | undefined,
    ].map((s) => (s ?? "").toString().trim()).find((s) => s.length > 0);

    // Phase 2 grounding: the frozen Style DNA renders the channel's LOCKED
    // identity (subject/setting/grade/motifs/allowed-motion) instead of a generic
    // cozy template, so every loop reads as the same channel.
    const styleDNA = (ctx.store["styleDNA"] as import("@/engine/creative/types").StyleDNA | null) ?? null;
    const plan = planScenes({
      topic,
      styleGrammar: style,
      visualStyle: vs,
      settingHint,
      styleDNA,
      sceneLibrary,
      defaultDurationSec,
    });
    const grounded = !!(styleDNA && styleDNA.recurringSubject && styleDNA.setting);
    ctx.log(
      `scene_planner: ${plan.scenes.length} scene(s) (fromLibrary=${plan.fromLibrary}, style=${vs}, ${grounded ? `DNA-grounded: "${styleDNA!.recurringSubject.slice(0, 50)}"` : `setting=${settingHint ? `"${settingHint.slice(0, 50)}"` : "generic"}`})`,
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
  produces: ["f1Url", "f1Key", "motionPrompt"],
  paid: true,
  run: async (ctx) => {
    // CLOUD REBUILD: a single FLUX-pro still via fal.ai (HTTP/key-based) replaces
    // the Higgsfield CLI (local binary + login session — impossible on Trigger).
    // We make ONE keyframe; the seamless loop is built from one forward i2v clip
    // (crossfade self-loop), so we never need a second "frame B" still.
    const style = styleGrammar(ctx);
    const vs = visualStyle(ctx);
    const scene = scenesFromStore(ctx)[0];
    const aspect = (ctx.params.aspectRatio as string) ?? "16:9";
    // 16:9 still sized for a 4K-bound loop (multiple of 16); portrait if asked.
    const portrait = aspect === "9:16";
    const W = portrait ? 768 : 1344;
    const H = portrait ? 1344 : 768;

    const baseFluxPrompt = composeFluxPrompt({
      sceneDescription: scene.fluxPrompt,
      styleGrammar: style,
      visualStyle: vs,
    });
    const dna = (ctx.store["styleDNA"] as import("@/engine/creative/types").StyleDNA | null) ?? null;
    const tmp = await makeRunTempDir(ctx.runId);

    // Per-block CREATIVE-DIRECTOR LOOP (Phase 2): generate the still → a vision
    // critic scores it against the channel's DNA identity → regenerate carrying the
    // critique forward. Keep the BEST attempt; NEVER fall back to a generic image.
    // The critic only runs with a grounded DNA + a Gemini key (else single-shot).
    const canCritique = hasGeminiKey() && !!(dna && dna.recurringSubject?.trim());
    let stills = 0;
    const loop = await produceAndCritique<{ url: string; local: string }>({
      label: "keyframe",
      threshold: 0.8,
      maxIters: canCritique ? 2 : 1,
      log: (m) => ctx.log(m),
      produce: async (priorIssues) => {
        const fix = priorIssues.length
          ? ` Correct these problems from the previous attempt: ${priorIssues.join("; ")}.`
          : "";
        stills++;
        ctx.log(`keyframes: generating still (fal flux-pro), attempt ${stills}…`);
        const url = await generateFalFluxProImage({ prompt: baseFluxPrompt + fix, width: W, height: H });
        if (!url) throw new Error("keyframes: fal flux-pro produced no URL");
        const local = await downloadTo(url, join(tmp, `f1_${stills}.jpg`));
        return { url, local };
      },
      critique: async (cand) => {
        if (!canCritique) return { score: 1, pass: true, issues: [] };
        try {
          const raw = await geminiVisionLocal({
            prompt: [
              "You are the channel's art director QA'ing a generated still against its LOCKED visual identity.",
              `RECURRING SUBJECT: ${dna!.recurringSubject}`,
              `SETTING: ${dna!.setting}`,
              dna!.colorGrade ? `COLOR GRADE: ${dna!.colorGrade}` : "",
              dna!.composition ? `COMPOSITION: ${dna!.composition}` : "",
              dna!.motifs?.length ? `MUST FEATURE motifs: ${dna!.motifs.join(", ")}` : "",
              dna!.visualAvoid?.length ? `MUST NOT contain: ${dna!.visualAvoid.slice(0, 6).join(", ")}` : "",
              "Score 0..1 how faithfully the image matches this identity (subject, setting, palette/grade, motifs, composition) AND is free of the forbidden elements and of any text/letters baked into the artwork.",
              'Return STRICT JSON {"score":number,"issues":[concrete visual fixes]}.',
            ].filter(Boolean).join("\n"),
            imagePaths: [cand.local],
            json: true,
            maxTokens: 600,
          });
          const v = parseJsonLoose<{ score?: number; issues?: string[] }>(raw);
          const score = Math.max(0, Math.min(1, Number(v.score) || 0));
          const issues = (v.issues ?? []).filter((s): s is string => typeof s === "string" && s.length > 0).slice(0, 5);
          return { score, pass: score >= 0.8, issues };
        } catch (e) {
          ctx.log(`keyframes: critic failed (${e instanceof Error ? e.message : e}) — accepting attempt`);
          return { score: 0.8, pass: true, issues: [] };
        }
      },
    });
    const f1Url = loop.value.url;
    const f1Local = loop.value.local;
    ctx.log(`keyframes: best still after ${stills} attempt(s) (score=${loop.critique.score.toFixed(2)}, accepted=${loop.accepted})`);

    // Persist the chosen still to R2 (thumbnail base + audit). The fal CDN url is
    // passed straight to i2v as the source image (fresh + publicly fetchable).
    const f1Key = `${ctx.keyPrefix}runs/${ctx.runId}/f1.jpg`;
    await putObject(f1Key, await readBytes(f1Local), { contentType: "image/jpeg" });
    await recordAsset(ctx, "keyframe", f1Key, { provider: "fal-flux-pro", attempts: stills, identityScore: loop.critique.score });

    // SCENE DIRECTOR (golden v1 mechanic) — Gemini Vision reads the ACTUAL still
    // and names the animatable elements + subtle motion (static camera), so i2v
    // animates what's really in the frame, not a templated guess.
    let motionPrompt = scene.klingMotionPrompt;
    if (hasGeminiKey()) {
      try {
        const raw = await geminiVisionLocal({
          prompt:
            "This is a still for a seamless lofi/ambient LOOP. Identify the elements that should " +
            "SUBTLY animate (e.g. drifting steam, swaying plants, flickering candle, rain on glass, " +
            "rippling water, twinkling lights, a breathing/blinking character) and where they are. " +
            "The CAMERA stays perfectly STATIC. Return STRICT JSON " +
            '{"motion":"one concise sentence describing only the subtle looping motion of the named elements"}.',
          imagePaths: [f1Local],
          json: true,
          maxTokens: 200,
        });
        const m = parseJsonLoose<{ motion?: string }>(raw).motion;
        if (m && m.length > 12) { motionPrompt = m; ctx.log(`keyframes: scene-director motion → "${m.slice(0, 90)}"`); }
      } catch (e) {
        ctx.log(`keyframes: scene-director failed (using template): ${e instanceof Error ? e.message : e}`);
      }
    }

    ctx.log(`keyframes ok: still=${f1Key}`);
    return {
      f1Url,
      f1Key,
      motionPrompt,
      [COST_PATCH_KEY]: PRICE.fluxStillUsd * stills, // one flux still per critique attempt
    };
  },
};

/* --------------------------- 3. loop_clips ------------------------------ */

export const loopClips: Block = {
  id: "loop_clips",
  consumes: ["f1Url"],
  produces: ["loopRawKey", "loopRawUrl"],
  paid: true,
  run: async (ctx) => {
    // CLOUD REBUILD: ONE forward i2v clip via fal.ai (Kling), then a SEAMLESS
    // crossfade self-loop (ffmpeg) — motion always plays forward, no ping-pong
    // reversal artifacts. Replaces the Higgsfield F1→F2 / F2→F1 start+end-image
    // pair (needs a local authed CLI). One generation per render (frugal +
    // honours the "≤2 renders" budget).
    const f1Url = str(ctx, "f1Url");
    const style = styleGrammar(ctx);
    const vs = visualStyle(ctx);
    const scene = scenesFromStore(ctx)[0];
    const dur = Number(ctx.params.clipDurationSec ?? scene.durationSec ?? 5);
    const aspect = (ctx.params.aspectRatio as string) ?? "16:9";
    const crossfadeSec = Number(ctx.params.crossfadeSec ?? 0.8);
    // "flf2v" (default) = first-frame==last-frame i2v: the animated clip RETURNS
    // to its start so the elements keep moving forward (waves foam, curtains
    // billow) AND it loops with no boomerang velocity-flip. A small crossfade is
    // applied as a safety net (invisible if FLF2V closed the loop; smooths the
    // seam if the model ignored the end frame). "boomerang" = forward+reversed.
    // "crossfade" = plain self-blend loop.
    const loopMode = (ctx.params.loopMode as string | undefined) ?? "flf2v";
    const flf = loopMode === "flf2v";

    // Prefer the Gemini scene-director motion (golden v1) over the template, and
    // push hard for a LOCKED camera + NON-directional ambient motion so the loop
    // (esp. the boomerang's reverse half) reads naturally with no scale/pan pop.
    const motion = (ctx.store["motionPrompt"] as string | undefined) || scene.klingMotionPrompt;
    const fwd = composeKlingPrompt({
      sceneDescription: `${motion}. Extremely subtle, slow, NON-directional ambient motion only ` +
        `(gentle shimmer, soft glow flicker, drifting steam, faint sway) — avoid strong directional ` +
        `movement. The camera is COMPLETELY LOCKED: absolutely no zoom, no push-in, no pan, no scale ` +
        `or framing change. Perfectly smooth, seamlessly loopable, no scene change.`,
      styleGrammar: style,
      visualStyle: vs,
      extraNegative: "zoom, push in, dolly, camera move, scale change, framing change, pan, tilt",
    });

    ctx.log(`loop_clips: i2v (fal, loop=${loopMode}${flf ? ", end frame=start" : ""}) — prompt: "${fwd.prompt.slice(0, 80)}…"`);
    const clip = await generateFalI2V({
      prompt: fwd.prompt,
      negativePrompt: fwd.negativePrompt,
      imageUrl: f1Url,
      // FLF2V: end frame = start frame → the animated clip returns to its start.
      tailImageUrl: flf ? f1Url : undefined,
      durationSec: dur,
      aspectRatio: aspect,
    });
    if (!clip.url) throw new Error("loop_clips: fal i2v produced no URL");

    const tmp = await makeRunTempDir(ctx.runId);
    const clipLocal = await downloadTo(clip.url, join(tmp, "clip.mp4"));
    ctx.log(`loop_clips: building ${loopMode} seamless loop unit…`);
    const loopRaw = flf
      // FLF2V already closes the loop; a short crossfade is the safety net and
      // keeps motion FORWARD (no reversal). Smaller default fade than plain mode.
      ? await seamlessLoopUnit(clipLocal, join(tmp, "loopraw.mp4"), { crossfadeSec: Number(ctx.params.crossfadeSec ?? 0.5) })
      : loopMode === "crossfade"
      ? await seamlessLoopUnit(clipLocal, join(tmp, "loopraw.mp4"), { crossfadeSec })
      : await boomerangLoopUnit(clipLocal, join(tmp, "loopraw.mp4"));

    const loopRawKey = `${ctx.keyPrefix}runs/${ctx.runId}/loopraw.mp4`;
    await putObject(loopRawKey, await readBytes(loopRaw), { contentType: "video/mp4" });
    await recordAsset(ctx, "clip", loopRawKey, { jobId: clip.jobId, model: clip.model });

    return {
      loopRawKey,
      loopRawUrl: loopRaw, // local path; upscale reads it directly
      [COST_PATCH_KEY]: PRICE.videoClipUsd, // one i2v clip
    };
  },
};

/* ----------------------------- 4. upscale ------------------------------- */

export const upscale: Block = {
  id: "upscale",
  consumes: ["loopRawUrl"],
  produces: [
    "loopUnitKey",
    "loopUnitUrl",
    "loopUnitUpscaled",
    "loopUnitResolution",
  ],
  paid: true,
  run: async (ctx) => {
    // THE REAL UPSCALE (legacy topaz.py): run Topaz `topazlabs/video-upscale` on
    // JUST the short seamless loop UNIT (built by loop_clips). assemble then
    // stream_loops the 4K unit under audio — so we never upscale the full render.
    // Bounds cost/time to ~$0.25 / ~1 min. Degrade-safe: a Topaz failure keeps
    // the native loop (the render still completes).
    const targetResolution = (ctx.params.targetResolution as string) ?? "4k";
    const targetFps = Number(ctx.params.targetFps ?? 30);

    const tmp = await makeRunTempDir(ctx.runId);
    // loop_clips stashed the local path in loopRawUrl; re-fetch from R2 on resume.
    const loopRawLocal = ctx.store["loopRawUrl"] as string | undefined;
    let loopUnit: string;
    if (loopRawLocal && (await fileExists(loopRawLocal))) {
      loopUnit = loopRawLocal;
    } else {
      const key = str(ctx, "loopRawKey");
      ctx.log(`upscale: loop-unit temp missing — re-fetching ${key} from R2`);
      loopUnit = await writeBytes(join(tmp, "loopraw.mp4"), await getObjectBytes(key));
    }

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
    // RENDER-GROUP REUSE: a language sibling reuses the base render's music track
    // (identical audio bed; only narration differs) — no Mureka/Suno generation.
    const reuseMusicKey = ctx.store["reuseMusicKey"] as string | undefined;
    if (reuseMusicKey) {
      ctx.log(`music: REUSED base music track ${reuseMusicKey} (no generation)`);
      let reuseUrl = "";
      try { reuseUrl = publicUrl(reuseMusicKey); } catch { reuseUrl = `r2://${reuseMusicKey}`; }
      return { musicKey: reuseMusicKey, musicProvider: "reuse", musicUrl: reuseUrl };
    }
    const provider = ((ctx.params.provider as MusicProvider) ?? "mureka");
    // Phase 2 grounding: "Suno generated by the STYLE OF THE CHANNEL" — the frozen
    // Style DNA audio spec (genre/instrumentation/textures/BPM/loop) is the
    // channel's locked SOUND and WINS. Priority: DNA spec > Composer crew brief
    // (per-video nuance, only when there is no DNA) > explicit param > default.
    const composerPrompt = (ctx.store["musicBrief"] as { musicPrompt?: string } | undefined)?.musicPrompt;
    const dna = (ctx.store["styleDNA"] as import("@/engine/creative/types").StyleDNA | null) ?? null;
    const a = dna?.audio;
    const dnaPrompt = a?.genre?.trim()
      ? [
          `${a.genre} instrumental to study and relax to, evoking "${topic}".`,
          a.instrumentation?.length ? `Instrumentation: ${a.instrumentation.join(", ")}.` : "",
          a.textures?.length ? `Texture: ${a.textures.join(", ")}.` : "",
          a.moodArc ? `Mood: ${a.moodArc.split(/[.;]/)[0]}.` : "",
          `${a.bpmRange?.[0] ?? 70}-${a.bpmRange?.[1] ?? 88} BPM, ${a.loopable ? "loop-friendly, resolves back to the tonic" : "natural ending"}, purely instrumental, no vocals, no lyrics.`,
        ].filter(Boolean).join(" ")
      : "";
    // BLEND, not override: the DNA is the channel's locked sound (identity
    // floor); the Composer's per-video brief carries THIS video's emotional
    // arc. DNA-only made every video's score near-identical — the staleness
    // the composer crew existed to prevent.
    const arcNote = composerPrompt?.trim()
      ? ` This video's emotional direction: ${composerPrompt.trim().slice(0, 220)}`
      : "";
    const prompt =
      (dnaPrompt && dnaPrompt.trim() ? `${dnaPrompt.trim()}${arcNote}` : "") ||
      (composerPrompt && composerPrompt.trim()) ||
      (ctx.params.prompt as string) ||
      `warm cozy lofi hip-hop instrumental to study/relax to, evoking "${topic}". ` +
      `mellow Rhodes piano, soft boom-bap drums, gentle bass, vinyl crackle, tape warmth, ` +
      `calm and nostalgic, ~72 bpm, purely instrumental, no vocals, no lyrics, loop-friendly`;
    ctx.log(`music: prompt source = ${dnaPrompt ? (arcNote ? "style DNA + composer arc" : "style DNA") : composerPrompt ? "composer brief" : "default"}`);

    // MULTI-TRACK MIX: a single looped 3-min track reads as stale on anything
    // longer than a few minutes. trackCount asks for N distinct clips that get
    // crossfade-concatenated (3s tri — the proven legacy-autostudio recipe)
    // into one continuous mix before looping. A Suno generation returns TWO
    // clips for one credit, so cost = ceil(N/2) generations. Default 2 = double
    // the unique audio at the old single-track price.
    const trackCount = Math.max(1, Math.min(8, Number(ctx.params.trackCount ?? 2)));
    const sunoModel = (ctx.params.model as string | undefined) ?? "V5";
    const mixTitle = (String(ctx.store["channelName"] ?? "") || topic).slice(0, 60);
    const tmp = await makeRunTempDir(ctx.runId);

    let tracks: MusicTrack[] = [];
    let jobIds: string[] = [];
    let generations = 0;
    let usedProvider: MusicProvider = provider;

    const generateWith = async (prov: MusicProvider): Promise<void> => {
      tracks = [];
      jobIds = [];
      generations = 0;
      if (prov === "suno") {
        const gens = Math.ceil(trackCount / 2);
        for (let g = 0; g < gens && tracks.length < trackCount; g++) {
          const varied =
            g === 0
              ? prompt
              : `${prompt} Part ${g + 1} of a continuous mix: same instrumentation, key family and mood, a different melodic progression.`;
          ctx.log(`music: suno ${sunoModel} generation ${g + 1}/${gens} (custom mode, WAV upgrade)…`);
          const res = await generateSuno({
            prompt: varied,
            model: sunoModel,
            title: mixTitle,
            // WAV upgrade only when EXPLICITLY requested (lofi sets it): a
            // narrated bed sits ducked -22dB under voice — inaudible benefit,
            // and a failed WAV poll burned up to 3 min/clip of pure waiting.
            wantClips: Math.min(2, trackCount - tracks.length),
            preferWav: ctx.params.preferWav === true,
            timeoutMs: 600_000,
          });
          generations++;
          jobIds.push(res.jobId);
          tracks.push(...res.tracks.slice(0, trackCount - tracks.length));
        }
      } else {
        ctx.log(`music: generating via ${prov}…`);
        const res = await generateMusic({ provider: prov, prompt, model: ctx.params.model as string | undefined, timeoutMs: 600_000 });
        generations = 1;
        jobIds = [res.jobId];
        tracks = res.tracks;
      }
    };

    // PROVIDER FAILOVER: a quota/billing-dead provider must not kill the render
    // when the alternate provider's key is present — both produce instrumental
    // beds from the same DNA prompt. (Live case: Mureka 429 "exceeded your
    // current quota" after two renders; Suno had credits.)
    const altProvider: MusicProvider = provider === "suno" ? "mureka" : "suno";
    const hasProviderKey = (p: MusicProvider) =>
      p === "suno" ? Boolean(process.env.SUNO_API_KEY) : Boolean(process.env.MUREKA_API_KEY);
    try {
      await generateWith(provider);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const quotaDead = /429|quota|billing|insufficient|credit/i.test(msg);
      if (quotaDead && hasProviderKey(altProvider)) {
        ctx.log(`music: ${provider} is quota/billing-dead (${msg.slice(0, 120)}) — FAILING OVER to ${altProvider}`);
        usedProvider = altProvider;
        await generateWith(altProvider);
      } else {
        throw e;
      }
    }
    if (!tracks.length) throw new Error("music: provider returned no tracks");
    const wavCount = tracks.filter((t) => t.wavUrl).length;
    ctx.log(`music: ${tracks.length} track(s) ready (${wavCount} lossless WAV) from ${generations} generation(s)`);

    // Download all clips, crossfade-concat into one mix, then MASTER to the
    // channel's LUFS target (DNA audio.loudnessLufs, default -14 = YouTube
    // reference) — the "Suno loudness mastering" step that previously existed
    // only as an unenforced DNA field.
    const locals: string[] = [];
    for (let i = 0; i < tracks.length; i++) {
      const ext = tracks[i].wavUrl ? "wav" : "mp3";
      locals.push(await downloadTo(tracks[i].url, join(tmp, `track_${i}.${ext}`)));
    }
    const mixPath =
      locals.length > 1 ? await crossfadeConcatAudio(locals, join(tmp, "mix.mp3"), 3) : locals[0];
    const targetLufs = Number(a?.loudnessLufs ?? -14);
    const local = await masterAudio(mixPath, join(tmp, "music.mp3"), { lufs: targetLufs });
    ctx.log(`music: mastered mix → loudnorm I=${targetLufs} LUFS, 320k`);

    const musicKey = `${ctx.keyPrefix}runs/${ctx.runId}/music.mp3`;
    await putObject(musicKey, await readBytes(local), { contentType: "audio/mpeg" });
    await recordAsset(ctx, "music", musicKey, {
      provider: usedProvider,
      jobId: jobIds.join(","),
      tracks: tracks.length,
      losslessTracks: wavCount,
      masteredLufs: targetLufs,
    });

    // Downstream consumers (assemble/timeline_assemble) PREFER musicKey — the
    // mastered R2 mix. musicUrl is only the legacy fallback; R2_PUBLIC_BASE_URL
    // may be unset on Trigger, so fall back to the first provider clip URL.
    let musicUrl: string;
    try {
      musicUrl = publicUrl(musicKey);
    } catch {
      musicUrl = tracks[0].url;
    }
    return {
      musicKey,
      musicProvider: usedProvider,
      musicUrl,
      [COST_PATCH_KEY]: PRICE.musicTrackUsd * generations,
    };
  },
};

/* ----------------------------- 7. assemble ------------------------------ */

export const assemble: Block = {
  id: "assemble",
  consumes: ["loopUnitKey", "musicUrl"],
  produces: ["videoKey", "videoLocalPath", "videoDurationSec", "introApplied"],
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
    // Music: prefer the R2 copy (musicKey) — it's the MASTERED multi-track mix
    // (loudnorm'd), and it never expires like a provider CDN link. The provider
    // URL is only the legacy fallback.
    let audio: string;
    const mk = opt(ctx, "musicKey");
    if (mk) {
      audio = await writeBytes(join(tmp, "music.mp3"), await getObjectBytes(mk));
    } else {
      audio = await downloadTo(musicUrl, join(tmp, "music.mp3"));
    }

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

    const fadeOutSec = Number(ctx.params.fadeOutSec ?? 0);
    const finalPath = join(tmp, "final.mp4");
    // GOLDEN: deblur intro (channel + title over the animated bg, 20-step deblur,
    // no separate card) — the v1 lofi look. Default ON for music loops.
    const deblurIntro = ctx.params["deblurIntro"] !== false;
    let introSec = 0;
    let videoDurationSec = durationSec;
    let introApplied = deblurIntro; // the deblur title IS the intro for lofi
    if (deblurIntro) {
      ctx.log(`assemble: deblur-intro music loop under music to ${durationSec}s @ ${W}x${H} (preset=${preset})…`);
      // On-screen title must be SHORT + legible (NOT the long SEO title). Take the
      // part before the first separator (": " / "|" / "–") and cap length.
      const fullTitle = opt(ctx, "title") || "";
      const shortTitle =
        ((fullTitle.split(/\s*[:|–—\-]\s*/)[0] || fullTitle).trim().slice(0, 34)) ||
        String(ctx.store["channelName"] ?? "");
      await composeMusicLoopDeblur({
        loopUnitPath, musicPath: audio, outPath: finalPath, durationSec,
        title: shortTitle,
        channel: String(ctx.store["channelName"] ?? ""),
        width: W, height: H, preset,
      });
    } else {
      const introCardPath = opt(ctx, "introCardPath"); // "" if the card render failed
      introSec = introCardPath ? Number(ctx.store["introSec"] ?? 5) : 0;
      introApplied = Boolean(introCardPath);
      videoDurationSec = introSec + durationSec;
      ctx.log(`assemble: prepend card (${introSec}s) + stream_loop 4K unit under music to ${durationSec}s @ ${W}x${H}…`);
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
    }

    const videoKey = `${ctx.keyPrefix}runs/${ctx.runId}/final.mp4`;
    await putObject(videoKey, await readBytes(finalPath), { contentType: "video/mp4" });
    await recordAsset(ctx, "video", videoKey, {
      durationSec: videoDurationSec,
      introSec,
      loopUnitResolution: ctx.store["loopUnitResolution"],
    });

    return { videoKey, videoLocalPath: finalPath, videoDurationSec, introApplied };
  },
};

/* --------------------------- 10. upload_draft --------------------------- */

export const uploadDraft: Block = {
  id: "upload_draft",
  consumes: ["videoLocalPath", "title", "description", "tags", "qaPassed", "thumbnailKey"],
  produces: ["youtubeVideoId", "watchUrl", "youtubePrivacy"],
  run: async (ctx) => {
    if (ctx.store["qaPassed"] !== true) {
      throw new Error("upload_draft: qa did not pass — refusing to upload");
    }
    const filePath = str(ctx, "videoLocalPath");
    const title = str(ctx, "title");
    const description = str(ctx, "description");
    const tags = (ctx.store["tags"] as string[]) ?? [];

    // Publish mode (per-channel pipeline param; default "draft" = private, human
    // approves). "scheduled" → drip-publish at now+offset (humanized jitter to
    // avoid a metronomic, auto-looking cadence). "public" → immediate.
    const publishMode = (ctx.params["publishMode"] as string | undefined) ?? "draft";
    let privacyStatus: "private" | "public" | "unlisted" = "private";
    let publishAt: string | undefined;
    if (publishMode === "public") {
      privacyStatus = "public";
    } else if (publishMode === "scheduled") {
      const offsetH = Number(ctx.params["publishOffsetHours"] ?? 6);
      const jitterH = Math.random() * Number(ctx.params["publishJitterHours"] ?? 4);
      publishAt = new Date(Date.now() + (offsetH + jitterH) * 3_600_000).toISOString();
    }

    // Per-channel YouTube token (uploads to THIS channel's own YouTube channel).
    // Falls back to the global YOUTUBE_REFRESH_TOKEN when the channel isn't linked.
    let refreshToken: string | undefined;
    try {
      const auth = await convex().query(api.youtubeAuth.getForChannel, {
        channelId: ctx.channelId as Id<"channels">,
      });
      if (auth?.refreshToken) {
        refreshToken = auth.refreshToken;
        ctx.log(`upload_draft: using linked YouTube channel "${auth.ytTitle ?? "?"}"`);
      } else {
        ctx.log("upload_draft: no per-channel token — using global token");
      }
    } catch (e) {
      ctx.log(`upload_draft: token lookup failed (using global): ${e instanceof Error ? e.message : e}`);
    }

    ctx.log(`upload_draft: uploading to YouTube (mode=${publishMode}${publishAt ? `, publishAt=${publishAt}` : ""})…`);
    const res = await uploadPrivateDraft({
      filePath,
      title,
      description,
      tags,
      privacyStatus,
      publishAt,
      refreshToken,
    });

    // Set the custom thumbnail (generated by thumbnail_gen, stored in R2).
    // Non-fatal: a 403 means the channel isn't verified for custom thumbnails —
    // the video still uploaded; the operator can verify the channel + re-run.
    const thumbKey = opt(ctx, "thumbnailKey");
    if (thumbKey) {
      try {
        const bytes = await getObjectBytes(thumbKey);
        await setVideoThumbnail(res.videoId, bytes, "image/jpeg", refreshToken);
        ctx.log(`upload_draft: custom thumbnail set (${thumbKey})`);
      } catch (e) {
        ctx.log(`upload_draft: thumbnail set FAILED (non-fatal): ${e instanceof Error ? e.message : e}`);
      }
    }

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

/* ------------------------------ 12. cleanup ----------------------------- */

/**
 * Storage minimiser — runs LAST (after a successful upload) and deletes every
 * intermediate artifact for the run, keeping ONLY the finished video + its
 * thumbnail. Removes the matching R2 objects (narration, music, pre-overlay
 * video, captions, stock segments, keyframes, loop unit, …) AND the intermediate
 * asset rows, so the library holds just the final video. Generic (uses
 * ctx.keyPrefix + runId) → reusable by EVERY channel/archetype. Non-fatal: a
 * cleanup failure never fails an already-uploaded run.
 */
export const cleanup: Block = {
  id: "cleanup",
  consumes: ["watchUrl"], // gated on a successful upload — never runs on a failed render
  produces: ["cleaned"],
  run: async (ctx) => {
    const prefix = `${ctx.keyPrefix}runs/${ctx.runId}/`;
    const keepNames = (ctx.params["keep"] as string[] | undefined) ?? ["final.mp4", "thumbnail.jpg"];
    const keep = new Set(keepNames.map((n) => `${prefix}${n}`));
    let removed = 0;
    try {
      const all = await listObjects(prefix);
      const del = all.filter((k) => !keep.has(k));
      removed = await deleteObjects(del);
      ctx.log(`cleanup: removed ${removed} intermediate object(s); kept ${all.length - del.length} (${keepNames.join(", ")})`);
    } catch (e) {
      ctx.log(`cleanup: R2 prune failed (non-fatal): ${e instanceof Error ? e.message : e}`);
    }
    try {
      const n = await convex().mutation(api.assets.pruneRun, {
        runId: ctx.runId as Id<"runs">,
        keepKinds: ["video", "thumbnail"],
      });
      ctx.log(`cleanup: pruned ${n} intermediate asset row(s)`);
    } catch (e) {
      ctx.log(`cleanup: asset prune failed (non-fatal): ${e instanceof Error ? e.message : e}`);
    }
    return { cleaned: true, removedObjects: removed };
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
/* ------------------------- shorts spinoff ------------------------- */

/**
 * `shorts_spinoff` — turn the finished long-form into a vertical 9:16 Short: take
 * the engineered HOOK window, reframe to 1080x1920, burn word-level captions, store
 * in R2, and upload as a PRIVATE YouTube Short (private-first). Optionally crosspost
 * the Short to TikTok/Reels/etc. via Ayrshare (param-gated — never auto-publishes
 * private brand content). Gated on `watchUrl` so it only runs after a successful
 * main upload. Best-effort: any failure is non-fatal to the run.
 */
export const shortsSpinoff: Block = {
  id: "shorts_spinoff",
  consumes: ["videoLocalPath", "sentenceTimings", "title", "watchUrl"],
  produces: ["shortKey", "shortVideoId"],
  run: async (ctx) => {
    const src = str(ctx, "videoLocalPath");
    const title = str(ctx, "title");
    const timings = (ctx.store["sentenceTimings"] as { text: string; start: number; end: number }[] | undefined) ?? [];
    if (timings.length === 0) {
      ctx.log("shorts_spinoff: no sentenceTimings — skipping");
      return { shortKey: "", shortVideoId: "" };
    }
    const targetDur = Number(ctx.params["shortDurSec"] ?? 45);

    // Window = the hook: accumulate opening sentences up to ~targetDur seconds.
    const startSec = Math.max(0, timings[0].start);
    let endSec = startSec;
    const windowTimings: { text: string; start: number; end: number }[] = [];
    for (const t of timings) {
      if (t.start < startSec) continue;
      windowTimings.push(t);
      endSec = t.end;
      if (endSec - startSec >= targetDur) break;
    }
    const durSec = Math.max(8, Math.min(endSec - startSec, targetDur + 12));

    const tmp = await makeRunTempDir(ctx.runId);
    const raw = join(tmp, "short_raw.mp4");
    const final = join(tmp, "short.mp4");
    await makeVerticalClip(src, raw, { startSec, durSec });
    const cues = captionCuesFromTimings(windowTimings, -startSec);
    await burnCaptions(raw, cues, final, { tmpDir: tmp, width: 1080, height: 1920 });

    const shortKey = `${ctx.keyPrefix}runs/${ctx.runId}/short.mp4`;
    await putObject(shortKey, await readBytes(final), { contentType: "video/mp4" });
    ctx.log(`shorts_spinoff: built 9:16 short (${durSec.toFixed(0)}s) → ${shortKey}`);

    // Upload as a YouTube Short (PRIVATE unless the param opts into public).
    let shortVideoId = "";
    let refreshToken: string | undefined;
    try {
      const auth = await convex().query(api.youtubeAuth.getForChannel, { channelId: ctx.channelId as Id<"channels"> });
      if (auth?.refreshToken) refreshToken = auth.refreshToken;
    } catch { /* fall back to global token */ }
    try {
      const desc = (ctx.store["description"] as string | undefined) ?? "";
      const res = await uploadPrivateDraft({
        filePath: final,
        title: `${title} #Shorts`.slice(0, 100),
        description: `#Shorts\n\n${desc}`.slice(0, 4900),
        tags: ((ctx.store["tags"] as string[]) ?? []).slice(0, 15),
        privacyStatus: ctx.params["publishShort"] === "public" ? "public" : "private",
        refreshToken,
      });
      shortVideoId = res.videoId;
      ctx.log(`shorts_spinoff: uploaded Short ${res.watchUrl} (privacy=${res.privacyStatus})`);
    } catch (e) {
      ctx.log(`shorts_spinoff: Short upload failed (non-fatal): ${e instanceof Error ? e.message : e}`);
    }

    // Optional multi-platform crosspost of the SHORT via Ayrshare — explicit opt-in
    // only (so private brand content is never auto-published off-platform).
    if (ctx.params["crosspostShort"] === true && hasAyrshareKey()) {
      try {
        const platforms = (ctx.params["platforms"] as string[] | undefined) ?? ["tiktok", "instagram"];
        const r = await ayrCrosspost({ mediaUrl: publicUrl(shortKey), caption: title.slice(0, 2000), platforms });
        ctx.log(`shorts_spinoff: crosspost ${r.ok ? "ok" : "failed"} → ${r.ids.join(", ") || "(none)"}`);
      } catch (e) {
        ctx.log(`shorts_spinoff: crosspost failed (non-fatal): ${e instanceof Error ? e.message : e}`);
      }
    }
    return { shortKey, shortVideoId };
  },
};

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
  cleanup,
  shortsSpinoff,
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
  { block: "keyframes", params: { aspectRatio: "16:9", visualStyle: "lofi" } },
  { block: "loop_clips", params: { clipDurationSec: 10, visualStyle: "lofi", crossfadeSec: 2.5 } },
  { block: "upscale", params: { targetResolution: "4k", targetFps: 30 } },
  { block: "music", params: { provider: "suno" } },
  { block: "metadata" },
  { block: "assemble", params: { durationSec: 180 } }, // ← raise (e.g. 7200) for a 2h production loop
  { block: "thumbnail_gen" },
  { block: "qa_visual" },
  { block: "upload_draft" },
  { block: "notify" },
  { block: "cleanup" },
];
