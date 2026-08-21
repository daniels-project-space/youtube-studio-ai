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
import { getVisualBrief, getMusicBrief } from "@/engine/creative/brief";
import { PRICE } from "@/engine/pricing";
import { novitaCostEnvelope, requireNovitaStageBudget } from "@/lib/novitaCostEnvelope";
import { resolveContentLane } from "@/engine/contentLane";
import { assertChildContentRenderEvidence } from "@/trigger/blocks/childrenSafetyBlocks";
import { assessProductionEditorialAcceptance, QualityEvidenceSchema } from "@/engine/qualityEvidence";
import {
  assertFinalMasterReleaseCertificate,
  assertReleaseCertificateVisualReviewBindings,
  finalMasterReleaseCertificateKey,
  parseFinalMasterReleaseCertificateBytes,
  parseVisualReviewReleaseReceiptBytes,
  retainedFinalMasterReleaseObjectKeys,
} from "@/lib/finalMasterReleaseCertificate";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { renderNovitaI2V, renderNovitaImage } from "@/lib/novitaMedia";
import { LtxCreativeAdapterSelectionSchema } from "@/lib/ltxCreativeAdapter";
import {
  generateMureka,
  generateSuno,
  MusicError,
  selfLoopAudio,
  withMusicGenerationCost,
  type MusicProvider,
  type MusicTrack,
} from "@/lib/music";
import { requireInternalQuerySecret, requireYouTubeConnector } from "@/lib/youtubeConnector";
import { notifyDraftReady } from "@/lib/telegram";
import { seamlessLoopUnit, boomerangLoopUnit, composeWithIntro, composeMusicLoopDeblur, measureLoopSeamDiff, probe, makeVerticalClip, burnCaptions, captionCuesFromTimings, crossfadeConcatAudio, masterAudio } from "@/lib/ffmpeg";
import { hasAyrshareKey, crosspost as ayrCrosspost } from "@/lib/ayrshare";
import { parseJsonLoose } from "@/lib/gemini";
import { hasAnthropicKey } from "@/lib/anthropic";
import { hasNonGoogleVisionKey, visionLocal, VISION_GATE_MAX_TOKENS } from "@/lib/vision";
import { craftTopics, loadOutlierBank } from "@/lib/topicraft";
import { produceAndCritique } from "@/engine/critiqueLoop";
import { agentJson } from "@/agents/mastra";
import { loadPerformanceContext } from "@/lib/performance";
import { renderStoryStateForPrompt } from "@/lib/seriesStoryState";
import { z } from "zod";

/**
 * Topic-chunk structured-output schema (validated on both Mastra + REST).
 * The arcSummary/newPlotBeat/unresolvedThreads/entities fields are only
 * populated by the SERIES MODE continuation prompt (topic_select, below);
 * every other caller of this schema simply gets the zod defaults ("" / []).
 */
const producerTopicSchema = z.object({
  candidates: z
    .array(
      z.object({
        topic: z.string(),
        angle: z.string().optional().default(""),
        arcSummary: z.string().optional().default(""),
        newPlotBeat: z.string().optional().default(""),
        unresolvedThreads: z.array(z.string()).optional().default([]),
        entities: z
          .array(z.object({ name: z.string(), role: z.string() }))
          .optional()
          .default([]),
      }),
    )
    .optional()
    .default([]),
});
import {
  makeRunTempDir,
  downloadTo,
  readBytes,
  writeBytes,
} from "@/lib/files";
import { putObject, putObjectFromFile, getObjectBytes, listObjects, deleteObjects, publicUrl } from "@/lib/storage";
import { join } from "node:path";
import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  composeKlingPrompt,
  composeFluxPrompt,
} from "@/engine/prompt/constitution";
import {
  planScenes,
  type SceneSpec,
  type SceneLibraryEntry,
} from "@/engine/prompt/scenePlanner";
import { buildChapters } from "@/lib/metacraft";
import {
  bytesSha256,
  dispatchPublishIntent,
  fileSha256,
  publishMetadataSha256,
} from "@/lib/publishDispatcher";
import {
  buildPublishIdempotencyKey,
  YOUTUBE_UPLOAD_SCOPES,
} from "@/lib/publishingPolicy";
import {
  assertScheduledPublishIsFuture,
  resolveScheduledPublishAtMs,
} from "@/lib/scheduledPlanRuntime";
import { uploadDurableVideo } from "@/lib/youtubeDurableUpload";
import {
  evaluateChannelPublishAction,
  requireChannelPublishAction,
  type ChannelPublishDecision,
} from "@/lib/channelPublishPolicy";

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

/**
 * Record the chosen topic in topic memory — FATAL on failure. An unrecorded
 * topic silently breaks the no-repeat guarantee on every future run, so the
 * run must not proceed past selection without the write confirmed.
 */
async function recordTopicMemory(
  c: ConvexHttpClient,
  ctx: StageContext,
  topic: string,
): Promise<void> {
  await c.mutation(api.topicMemory.recordTopic, {
    ownerId: ctx.ownerId,
    channelId: ctx.channelId as Id<"channels">,
    key: topic,
  });
  ctx.log(`topic_select: recorded "${topic.slice(0, 80)}" in topic memory`);
}

function styleGrammar(ctx: StageContext): string {
  const sg = (ctx.store["styleGrammar"] as string | undefined) ?? "";
  // Cinematographer (crew) brief blends its look + motion language into every
  // keyframe/scene prompt so the visuals match the channel's vibe.
  const vb = getVisualBrief(ctx.store);
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
  produces: ["topic", "topicBet"],
  run: async (ctx) => {
    // A scheduler-claimed plan item is committed intent, not a candidate to
    // exclude. Use it verbatim without another model call; completion records
    // topic memory only after the full pipeline succeeds.
    const plannedTopic = ctx.store["plannedTopic"] as string | undefined;
    if (typeof plannedTopic === "string" && plannedTopic.trim()) {
      ctx.log(`topic_select: CLAIMED plan topic "${plannedTopic}"`);
      return { topic: plannedTopic };
    }
    // RENDER-GROUP REUSE: a language sibling renders the SAME topic as the base
    // (shared video, different language) — skip selection + history recording.
    const reuseTopic = ctx.store["reuseTopic"] as string | undefined;
    if (typeof reuseTopic === "string" && reuseTopic.trim()) {
      ctx.log(`topic_select: REUSED base topic "${reuseTopic}"`);
      return { topic: reuseTopic };
    }
    // Director-chosen, identity-aligned, non-repeating topic (Phase 1).
    // The non-Google creative planner proposes and ranks evidence-backed
    // candidates; a HARD no-repeat check runs
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

    // Used-topic history — FATAL if unreadable: selecting blind against an
    // unknown history is how channels repeat themselves. The content plan
    // (plan-week-ahead queue) is committed intent and counts as taken too.
    const [usedRows, planRows] = await Promise.all([
      c.query(api.topicMemory.listForChannel, { channelId }) as Promise<Array<{ key: string }>>,
      c
        .query(api.contentPlan.listPlan, { ownerId: ctx.ownerId, channelId })
        .catch((e) => {
          ctx.log(`topic_select: plan query failed (continuing without plan): ${e instanceof Error ? e.message : e}`);
          return [] as Array<{ topic: string }>;
        }),
    ]);
    const plannedTopics = (planRows as Array<{ topic: string }>).map((p) => p.topic);
    const usedNorm = new Set([
      ...usedRows.map((r) => normalizeTopic(r.key)),
      ...plannedTopics.map(normalizeTopic),
    ]);
    const recentList = usedRows.map((r) => r.key).slice(-40);
    // Phase 7: bias toward topics like past high-retention winners ("" until enough data).
    const perfCtx = await loadPerformanceContext(ctx.keyPrefix);

    // SERIES MODE — an ordered, numbered run (e.g. "7 Days of Stoic Calm"). The
    // episode number = how many of this series already exist + 1; each episode
    // gets a unique subtitle that continues the arc. When the series is finished
    // (epNum > seriesCount) we fall through to normal topic generation so the
    // channel keeps publishing. Episode order is encoded in the (clean) title.
    //
    // Phase 4 (episodic continuity): beyond avoiding title repetition, the
    // continuation call is now grounded in REAL prior plot content — a running
    // arc summary, unresolved narrative threads, and known entities (name +
    // one-line ROLE, never wardrobe/appearance) — read from the Convex
    // `seriesStoryState` table. The SAME LLM call that proposes the next
    // subtitle also proposes the updated story state, written back immediately
    // alongside the existing topic-memory commit — so the write never depends
    // on a downstream "finalization" step that doesn't exist for every family
    // sharing this block. A series with no seriesStoryState row yet (first
    // episode, or a non-series channel) behaves exactly as before: the prompt
    // simply omits the "story so far" section and the write below just starts
    // one.
    const seriesTitle = (ctx.params["seriesTitle"] as string | undefined)?.trim();
    const seriesCount = Number(ctx.params["seriesCount"] ?? 0) || 0;
    if (seriesTitle) {
      const doneCount = usedRows.filter((r) => r.key.includes(seriesTitle)).length;
      const epNum = doneCount + 1;
      if (!(seriesCount > 0 && epNum > seriesCount)) {
        const label = seriesCount > 0 ? `Part ${epNum} of ${seriesCount}` : `Part ${epNum}`;
        const prior = recentList.filter((t) => t.includes(seriesTitle));
        const existingStoryState = await c
          .query(api.seriesStoryState.getForSeries, { channelId, seriesTitle })
          .catch((e) => {
            ctx.log(`topic_select(series): story-state read failed (continuing without it): ${e instanceof Error ? e.message : e}`);
            return null;
          });
        const storyContext = renderStoryStateForPrompt(existingStoryState);
        let subtitle = "";
        let angle = "";
        let arcSummaryOut = "";
        let newPlotBeatOut = "";
        let unresolvedThreadsOut: string[] = [];
        let entitiesOut: { name: string; role: string }[] = [];
        if (hasAnthropicKey()) {
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
                (storyContext
                  ? `STORY SO FAR (use this — not just the titles above — to continue REAL plot/thematic content):\n${storyContext}\n\n`
                  : "") +
                `Propose the SINGLE best focus for episode ${epNum}: a specific, compelling SUBTITLE (the episode's unique theme — not the series name) and a one-line angle. ` +
                `It must build on prior episodes and fit the whole series. ` +
                `Also update the running story state: a short 2-4 sentence ARC SUMMARY covering everything through THIS episode, ` +
                `a one-line PLOT BEAT capturing what this specific episode adds, the UPDATED list of unresolved narrative threads ` +
                `(open questions/promises still to pay off), and any newly introduced entities (name + one-line ROLE only — never wardrobe or appearance). ` +
                `Return STRICT JSON {"candidates":[{"topic":string,"angle":string,"arcSummary":string,"newPlotBeat":string,"unresolvedThreads":string[],"entities":[{"name":string,"role":string}]}]}.`,
              maxTokens: 600,
              temperature: 0.8,
            });
            const cand = out.candidates?.[0];
            subtitle = (cand?.topic ?? "").trim().replace(/^["']|["']$/g, "");
            angle = (cand?.angle ?? "").trim();
            arcSummaryOut = (cand?.arcSummary ?? "").trim();
            newPlotBeatOut = (cand?.newPlotBeat ?? "").trim();
            unresolvedThreadsOut = (cand?.unresolvedThreads ?? []).map((t) => t.trim()).filter(Boolean);
            entitiesOut = (cand?.entities ?? [])
              .map((e) => ({ name: (e.name ?? "").trim(), role: (e.role ?? "").trim() }))
              .filter((e) => e.name);
          } catch (e) {
            ctx.log(`topic_select(series): subtitle gen failed (continuing): ${e instanceof Error ? e.message : e}`);
          }
        }
        const topic = subtitle
          ? `${seriesTitle} — ${label}: ${subtitle}`
          : `${seriesTitle} — ${label}`;
        if (ctx.params["dryRun"] !== true) {
          await recordTopicMemory(c, ctx, topic);
          // Best-effort write-back: a failed story-state write must never break
          // topic selection — the no-repeat guarantee (topicMemory, above) is
          // the only FATAL write on this path.
          const hasUpdate =
            subtitle || arcSummaryOut || newPlotBeatOut || unresolvedThreadsOut.length > 0 || entitiesOut.length > 0;
          if (hasUpdate) {
            await c
              .mutation(api.seriesStoryState.recordEpisodeBeat, {
                ownerId: ctx.ownerId,
                channelId,
                seriesTitle,
                episode: epNum,
                arcSummary: arcSummaryOut || undefined,
                newPlotBeat:
                  newPlotBeatOut || (subtitle ? `${label}: ${subtitle}${angle ? ` — ${angle}` : ""}` : undefined),
                unresolvedThreads: unresolvedThreadsOut.length ? unresolvedThreadsOut : undefined,
                newEntities: entitiesOut.length ? entitiesOut : undefined,
              })
              .catch((e) => {
                ctx.log(`topic_select(series): story-state write-back failed (non-fatal): ${e instanceof Error ? e.message : e}`);
              });
          }
        }
        ctx.log(`topic_select(series): "${topic}" (episode ${epNum}${seriesCount ? `/${seriesCount}` : ""})`);
        return { topic };
      }
      ctx.log(`topic_select(series): "${seriesTitle}" complete (${doneCount}/${seriesCount}) — falling through to normal topics`);
    }

    // TOPICRAFT — the golden topic-intel engine: metadata-evidenced, judged
    // bets. No silent pool fallback: a missing permitted creative provider
    // fails loud (the recovery loop's job).
    if (!hasAnthropicKey()) {
      throw new Error("topic_select: ANTHROPIC_API_KEY missing — refusing silent pool fallback");
    }
    const competitorRows = niche
      ? await c.query(api.competitors.listCompetitors, { ownerId: ctx.ownerId, niche }).catch(() => [])
      : [];
    const competitorTitles = (competitorRows as { topVideos?: { title: string; views: number }[] }[])
      .flatMap((r) => r.topVideos ?? [])
      .sort((a, b) => b.views - a.views)
      .slice(0, 12)
      .map((v) => ({ title: v.title, views: v.views }));
    const outliers = niche
      ? await loadOutlierBank({
          convex: c,
          ownerId: ctx.ownerId,
          niche,
          query: [niche, ...pool.slice(0, 2)].filter(Boolean).join(" "),
          log: (m) => ctx.log(m),
        })
      : [];

    const crafted = await craftTopics({
      channelName,
      niche,
      persona,
      styleGrammar: style,
      topicPool: pool,
      bannedWords,
      targetSeconds: Number(ctx.params["targetSeconds"] ?? 0) || undefined,
      count: 1,
      avoid: [...usedRows.map((r) => r.key), ...plannedTopics],
      perfContext: perfCtx || undefined,
      competitorTitles,
      outliers,
      log: ctx.log,
    });
    const bet = crafted.bets[0];

    let topic = bet.topic;
    // FINAL hard guarantee (code, not model).
    if (usedNorm.has(normalizeTopic(topic))) {
      if (policy === "no_repeat") {
        throw new Error(
          "topic_select: could not produce a non-repeating topic for a no_repeat channel",
        );
      }
      const fresh = pool.filter((t) => !usedNorm.has(normalizeTopic(t)));
      if (fresh.length) topic = fresh[0];
    }
    // dryRun = preview a topic without committing it to history (UI preview/tests).
    if (ctx.params["dryRun"] !== true) await recordTopicMemory(c, ctx, topic);
    ctx.log(
      `topic_select: "${topic}" [${bet.betType}] title="${bet.provisionalTitle}" ` +
        `evidence=${bet.evidence.slice(0, 90)}`,
    );
    // The full bet rides the store: provisionalTitle/thumbnailMoment/hookPromise
    // are judged warm starts for metacraft, banana and hookcraft downstream.
    return { topic, topicBet: bet };
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
    const vb = getVisualBrief(ctx.store);
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
    // CLOUD REBUILD: one attested Novita still replaces the old local/Higgsfield
    // path, retaining a durable receipt and a bounded direct-worker envelope.
    // We make ONE keyframe; the seamless loop is built from one forward i2v clip
    // (crossfade self-loop), so we never need a second "frame B" still.
    const style = styleGrammar(ctx);
    const vs = visualStyle(ctx);
    const scene = scenesFromStore(ctx)[0];
    const aspect = (ctx.params.aspectRatio as string) ?? "16:9";
    if (aspect !== "16:9") {
      throw new Error(`keyframes: ${aspect} is not covered by the pinned Novita production profile`);
    }

    const baseFluxPrompt = composeFluxPrompt({
      sceneDescription: scene.fluxPrompt,
      styleGrammar: style,
      visualStyle: vs,
    });
    const dna = (ctx.store["styleDNA"] as import("@/engine/creative/types").StyleDNA | null) ?? null;
    const tmp = await makeRunTempDir(ctx.runId);
    const productionVisualQa = ctx.params["qaProfile"] !== "draft" && ctx.params["qualityProfile"] !== "draft";
    const hasGroundedIdentity = !!(dna?.recurringSubject?.trim() && dna.setting?.trim());

    // Per-block CREATIVE-DIRECTOR LOOP (Phase 2): generate the still → a vision
    // critic scores it against the channel's DNA identity → regenerate carrying the
    // critique forward. Keep the BEST attempt; NEVER fall back to a generic image.
    // Production loops need a concrete identity lock and an independent,
    // non-Google reviewer before a paid keyframe is admitted. A successful
    // render log cannot prove a loop is on-brand or free of baked-in text.
    if (productionVisualQa && !hasGroundedIdentity) {
      throw new Error("keyframes: production loop requires a grounded Style DNA subject and setting before image generation");
    }
    if (productionVisualQa && !hasNonGoogleVisionKey()) {
      throw new Error("keyframes: production loop requires a configured non-Google OpenRouter vision reviewer (OPENROUTER_API_KEY)");
    }
    const canCritique = hasNonGoogleVisionKey() && hasGroundedIdentity;
    const maximumImageAttempts = canCritique ? 2 : 1;
    // The director loop is deliberately bounded. Admit its complete possible
    // still fanout before the first worker so a retry can never borrow the
    // run-wide budget or leave a partially regenerated visual behind.
    novitaCostEnvelope({
      label: "keyframes",
      imageJobs: maximumImageAttempts,
      maxCostUsd: ctx.stageBudgetUsd,
    });
    let stills = 0;
    let imageCostUsd = 0;
    const loop = await produceAndCritique<{ url: string; local: string; key: string; jobId: string; model: string }>({
      label: "keyframe",
      threshold: 0.8,
      maxIters: maximumImageAttempts,
      log: (m) => ctx.log(m),
      produce: async (priorIssues) => {
        const fix = priorIssues.length
          ? ` Correct these problems from the previous attempt: ${priorIssues.join("; ")}.`
          : "";
        stills++;
        ctx.log(`keyframes: generating still (Novita local Z-Image Turbo), attempt ${stills}…`);
        const rendered = await renderNovitaImage({
          prefix: `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/lofi-keyframe`,
          id: `keyframe-${stills}`,
          prompt: baseFluxPrompt + fix,
          profileId: "production",
          maxCostUsd: PRICE.novitaImageMaxUsd,
          lifecycle: {
            ownerId: ctx.ownerId,
            channelId: ctx.channelId,
            runId: ctx.runId,
            blockId: "keyframes",
          },
        });
        imageCostUsd += rendered.costUsd;
        const local = await downloadTo(rendered.url, join(tmp, `f1_${stills}.png`));
        return { url: rendered.url, local, key: rendered.key, jobId: rendered.jobId, model: rendered.model };
      },
      critique: async (cand) => {
        if (!canCritique) return { score: 1, pass: true, issues: [] };
        try {
          const raw = await visionLocal({
            prompt: [
              "You are the channel's art director QA'ing a generated still against its LOCKED visual identity.",
              `RECURRING SUBJECT: ${dna!.recurringSubject}`,
              `SETTING: ${dna!.setting}`,
              dna!.colorGrade ? `COLOR GRADE: ${dna!.colorGrade}` : "",
              dna!.composition ? `COMPOSITION: ${dna!.composition}` : "",
              dna!.motifs?.length ? `MUST FEATURE motifs: ${dna!.motifs.join(", ")}` : "",
              dna!.visualAvoid?.length ? `MUST NOT contain: ${dna!.visualAvoid.slice(0, 6).join(", ")}` : "",
              // Legacy NO_RAIN_INSIDE physics gate, now enforced by the critic too:
              // Flux happily paints rain over interiors and the loop repeats the
              // defect forever, so a wet interior is an automatic fail.
              "HARD PHYSICS CHECK: if the scene is indoor/covered, is any rain, snow, mist or wet surface rendered INSIDE the room (not seen through a window)? If yes → this is an automatic FAIL: score 0 and name it in issues (weather belongs OUTSIDE the glass only).",
              "Score 0..1 how faithfully the image matches this identity (subject, setting, palette/grade, motifs, composition) AND is free of the forbidden elements and of any text/letters baked into the artwork.",
              'Return STRICT JSON {"score":number,"issues":[concrete visual fixes]}.',
            ].filter(Boolean).join("\n"),
            imagePaths: [cand.local],
            json: true,
            maxTokens: VISION_GATE_MAX_TOKENS,
            providers: ["openrouter"], tier: "final",
          });
          const v = parseJsonLoose<{ score?: number; issues?: string[] }>(raw);
          const score = Math.max(0, Math.min(1, Number(v.score) || 0));
          const issues = (v.issues ?? []).filter((s): s is string => typeof s === "string" && s.length > 0).slice(0, 5);
          return { score, pass: score >= 0.8, issues };
        } catch (e) {
          if (productionVisualQa) {
            throw new Error(`keyframes: independent art-direction review failed: ${e instanceof Error ? e.message : e}`);
          }
          ctx.log(`keyframes: critic failed (${e instanceof Error ? e.message : e}) — accepting draft attempt`);
          return { score: 0.8, pass: true, issues: [] };
        }
      },
    });
    const f1Url = loop.value.url;
    const f1Local = loop.value.local;
    ctx.log(`keyframes: best still after ${stills} attempt(s) (score=${loop.critique.score.toFixed(2)}, accepted=${loop.accepted})`);

    const f1Key = loop.value.key;
    await recordAsset(ctx, "keyframe", f1Key, {
      provider: "novita-z-image-turbo-local",
      jobId: loop.value.jobId,
      model: loop.value.model,
      attempts: stills,
      identityScore: loop.critique.score,
    });

    // SCENE DIRECTOR reads the actual accepted still through the same independent
    // reviewer and names animatable elements, so I2V moves real pixels rather
    // than relying on a generic template motion guess.
    let motionPrompt = scene.klingMotionPrompt;
    if (canCritique) {
      try {
        const raw = await visionLocal({
          prompt:
            "This is a still for a seamless lofi/ambient LOOP. Identify the elements that should " +
            "SUBTLY animate (e.g. drifting steam, swaying plants, flickering candle, rain on glass, " +
            "rippling water, twinkling lights, a breathing/blinking character) and where they are. " +
            "The CAMERA stays perfectly STATIC. Return STRICT JSON " +
            '{"motion":"one concise sentence describing only the subtle looping motion of the named elements"}.',
          imagePaths: [f1Local],
          json: true,
          maxTokens: VISION_GATE_MAX_TOKENS,
          providers: ["openrouter"], tier: "final",
        });
        const m = parseJsonLoose<{ motion?: string }>(raw).motion;
        if (m && m.length > 12) { motionPrompt = m; ctx.log(`keyframes: scene-director motion → "${m.slice(0, 90)}"`); }
      } catch (e) {
        if (productionVisualQa) {
          throw new Error(`keyframes: independent motion-direction review failed: ${e instanceof Error ? e.message : e}`);
        }
        ctx.log(`keyframes: scene-director failed (using draft template): ${e instanceof Error ? e.message : e}`);
      }
    }

    ctx.log(`keyframes ok: still=${f1Key}`);
    return {
      f1Url,
      f1Key,
      motionPrompt,
      [COST_PATCH_KEY]: imageCostUsd,
    };
  },
};

/* --------------------------- 3. loop_clips ------------------------------ */

export const loopClips: Block = {
  id: "loop_clips",
  consumes: ["f1Key"],
  produces: ["loopRawKey", "loopRawUrl"],
  paid: true,
  run: async (ctx) => {
    // CLOUD REBUILD: ONE forward i2v clip via fal.ai (Kling), then a SEAMLESS
    // crossfade self-loop (ffmpeg) — motion always plays forward, no ping-pong
    // reversal artifacts. Replaces the Higgsfield F1→F2 / F2→F1 start+end-image
    // pair (needs a local authed CLI). One generation per render (frugal +
    // honours the "≤2 renders" budget).
    const f1Key = str(ctx, "f1Key");
    const style = styleGrammar(ctx);
    const vs = visualStyle(ctx);
    const scene = scenesFromStore(ctx)[0];
    const dur = Number(ctx.params.clipDurationSec ?? scene.durationSec ?? 5);
    const crossfadeSec = Number(ctx.params.crossfadeSec ?? 0.8);
    // "flf2v" (default) = first-frame==last-frame i2v: the animated clip RETURNS
    // to its start so the elements keep moving forward (waves foam, curtains
    // billow) AND it loops with no boomerang velocity-flip. A small crossfade is
    // applied as a safety net (invisible if FLF2V closed the loop; smooths the
    // seam if the model ignored the end frame). "boomerang" = forward+reversed.
    // "crossfade" = plain self-blend loop.
    const loopMode = (ctx.params.loopMode as string | undefined) ?? "flf2v";
    const flf = loopMode === "flf2v";
    // PARAM SPLIT: flf's safety-net fade used to read the SHARED `crossfadeSec`
    // (pipeline: 2.5s — tuned for the plain-crossfade mode where the blend IS
    // the loop mechanism), double-exposing 2.5s of every loop into a visible
    // ghost over a seam that FLF2V had already closed. flf gets its OWN small
    // param, hard-capped: anything longer than ~0.6s reads as a double exposure.
    const flfCrossfadeSec = Math.min(0.6, Math.max(0, Number(ctx.params.flfCrossfadeSec ?? 0.4)));
    // This optional adapter travels through the same sealed direct-worker path
    // as cinematic I2V: base/revision, benchmark, strength and trigger tokens
    // are validated there before a GPU job starts. Do not flatten it into text.
    const creativeAdapter = LtxCreativeAdapterSelectionSchema.optional().parse(
      ctx.params["ltxCreativeAdapter"],
    );

    // Prefer the independently reviewed scene-director motion over the template, and
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

    ctx.log(`loop_clips: Novita LTX-2.5 distilled x2 (loop=${loopMode}) — prompt: "${fwd.prompt.slice(0, 80)}…"`);
    const stageBudgetUsd = requireNovitaStageBudget(ctx.stageBudgetUsd, "loop_clips");
    const clip = await renderNovitaI2V({
      prefix: `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/lofi-loop`,
      id: "loop-clip",
      prompt: fwd.prompt,
      negativePrompt: fwd.negativePrompt,
      imageKey: f1Key,
      // The actual worker receives the first still again at the final frame.
      // This makes FLF2V a real image-conditioned loop closure, rather than a
      // prompt-only request followed by a crossfade that hides a seam.
      ...(flf ? { endImageKey: f1Key } : {}),
      durationSec: dur,
      profileId: "production",
      creativeAdapter,
      maxCostUsd: stageBudgetUsd,
      lifecycle: {
        ownerId: ctx.ownerId,
        channelId: ctx.channelId,
        runId: ctx.runId,
        blockId: "loop_clips",
      },
    });
    if (!clip.url) throw new Error("loop_clips: Novita i2v produced no URL");

    const tmp = await makeRunTempDir(ctx.runId);
    const clipLocal = await downloadTo(clip.url, join(tmp, "clip.mp4"));
    ctx.log(`loop_clips: building ${loopMode} seamless loop unit…`);
    const loopRaw = flf
      // FLF2V already closes the loop; a short crossfade is the safety net and
      // keeps motion FORWARD (no reversal). Own capped param — see flfCrossfadeSec.
      ? await seamlessLoopUnit(clipLocal, join(tmp, "loopraw.mp4"), { crossfadeSec: flfCrossfadeSec })
      : loopMode === "crossfade"
      ? await seamlessLoopUnit(clipLocal, join(tmp, "loopraw.mp4"), { crossfadeSec })
      : await boomerangLoopUnit(clipLocal, join(tmp, "loopraw.mp4"));

    const loopRawKey = `${ctx.keyPrefix}runs/${ctx.runId}/loopraw.mp4`;
    await putObject(loopRawKey, await readBytes(loopRaw), { contentType: "video/mp4" });
    await recordAsset(ctx, "clip", loopRawKey, { jobId: clip.jobId, model: clip.model });

    return {
      loopRawKey,
      loopRawUrl: loopRaw, // local path; upscale reads it directly
      [COST_PATCH_KEY]: clip.costUsd,
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
  paid: false,
  run: async (ctx) => {
    // The generative pixels already came from the attested Novita LTX-2.5
    // distilled two-stage latent x2 pipeline and its pinned spatial upscaler. This finishing
    // stage performs only deterministic local Lanczos scaling on the short loop
    // unit; no Replicate/Topaz provider or hidden fallback can re-render it.
    const targetResolution = (ctx.params.targetResolution as string) ?? "4k";
    const targetFps = Number(ctx.params.targetFps ?? 30);
    const dimensions: Record<string, [number, number]> = {
      "2k": [2560, 1440],
      "4k": [3840, 2160],
      "1080p": [1920, 1080],
    };
    const target = dimensions[targetResolution];
    if (!target) throw new Error(`upscale: unsupported target resolution ${targetResolution}`);
    if (!Number.isFinite(targetFps) || targetFps < 24 || targetFps > 60) {
      throw new Error(`upscale: target fps ${targetFps} is outside 24..60`);
    }

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

    const finalLoopPath = join(tmp, `loopunit_${targetResolution}.mp4`);
    const [width, height] = target;
    ctx.log(`upscale: deterministic local Lanczos finish → ${width}x${height}@${targetFps}fps…`);
    await promisify(execFile)(process.env.FFMPEG_BIN ?? "ffmpeg", [
      "-y", "-i", loopUnit,
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,fps=${Math.round(targetFps)}`,
      "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "17",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", finalLoopPath,
    ], { maxBuffer: 4 * 1024 * 1024 });
    const resolution = targetResolution;
    const upscaled = true;
    ctx.log(`upscale: local finish complete — ${resolution}`);

    const loopUnitKey = `${ctx.keyPrefix}runs/${ctx.runId}/loopunit_${resolution}.mp4`;
    await putObjectFromFile(loopUnitKey, finalLoopPath, {
      contentType: "video/mp4",
    });
    await recordAsset(ctx, "loop_unit", loopUnitKey, {
      upscaled,
      resolution,
      targetFps,
      sourceRender: "novita-ltx-distilled-two-stage-x2",
      finish: "local-lanczos",
    });

    // Stash the local path so assemble can stream_loop without re-downloading.
    return {
      loopUnitKey,
      loopUnitUrl: finalLoopPath, // local path; assemble reads it directly
      loopUnitUpscaled: upscaled,
      loopUnitResolution: resolution,
      [COST_PATCH_KEY]: 0,
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
      return {
        musicKey: reuseMusicKey,
        musicProvider: "reuse",
        musicUrl: reuseUrl,
        [COST_PATCH_KEY]: 0,
      };
    }
    const provider = ((ctx.params.provider as MusicProvider) ?? "mureka");
    // Phase 2 grounding: "Suno generated by the STYLE OF THE CHANNEL" — the frozen
    // Style DNA audio spec (genre/instrumentation/textures/BPM/loop) is the
    // channel's locked SOUND and WINS. Priority: DNA spec > Composer crew brief
    // (per-video nuance, only when there is no DNA) > explicit param > default.
    const composerPrompt = getMusicBrief(ctx.store)?.musicPrompt;
    const dna = (ctx.store["styleDNA"] as import("@/engine/creative/types").StyleDNA | null) ?? null;
    const a = dna?.audio;
    const dnaPrompt = a?.genre?.trim()
      ? [
          `${a.genre} instrumental to study and relax to, evoking "${topic}".`,
          a.instrumentation?.length ? `Instrumentation: ${a.instrumentation.join(", ")}.` : "",
          a.textures?.length ? `Texture: ${a.textures.join(", ")}.` : "",
          // Neither Mureka nor Suno exposes a structural/section parameter
          // (verified against both providers' actual request shapes in
          // src/lib/music.ts — `duration` is the only real metadata either
          // returns; BPM only ever appears as OUTBOUND prompt text). Prose is
          // the only lever these providers expose for mood movement across a
          // track, so carry the DNA's full mood-arc sentence (not just its
          // first clause) — an author who wrote "opens tense, resolves
          // warmer" wants that shift reaching the model, not truncated away.
          a.moodArc ? `Emotional arc across the track: ${a.moodArc.trim().slice(0, 240)}.` : "",
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
    let billedGenerations = 0;
    let usedProvider: MusicProvider = provider;

    try {
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
          billedGenerations++;
          jobIds.push(res.jobId);
          tracks.push(...res.tracks.slice(0, trackCount - tracks.length));
        }
      } else {
        ctx.log(`music: generating via ${prov}…`);
        const res = await generateMureka({
          prompt,
          model: ctx.params.model as string | undefined,
          timeoutMs: 600_000,
        });
        generations = 1;
        billedGenerations++;
        usedProvider = res.provider;
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
      const admissionRejected =
        e instanceof MusicError &&
        e.safeToFallback &&
        e.acceptedUnits === 0 &&
        billedGenerations === 0;
      if (admissionRejected && hasProviderKey(altProvider)) {
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
    let local = await masterAudio(mixPath, join(tmp, "music.mp3"), { lufs: targetLufs });
    ctx.log(`music: mastered mix → loudnorm I=${targetLufs} LUFS, 320k`);
    // SELF-LOOPING FOLD: assemble stream_loops this mix for the whole render, and
    // a hard splice at every loop point was audible every N minutes for hours.
    // One tail→head acrossfade makes end==start. Runs AFTER mastering so any
    // loudnorm gain drift at the edges is smoothed by the fold itself.
    // Degrade-safe: a failed polish pass must not kill a paid render.
    try {
      local = await selfLoopAudio(local, join(tmp, "music_loop.mp3"), { log: (m) => ctx.log(`music: ${m}`) });
    } catch (e) {
      ctx.log(`music: !!! self-loop fold FAILED (${e instanceof Error ? e.message : e}) — shipping the plain mix (loop splices will be hard)`);
    }

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
      // Keep spend from successful generations made before provider failover;
      // resetting the selected provider's tracks must not erase paid work.
      [COST_PATCH_KEY]: PRICE.musicTrackUsd * billedGenerations,
    };
    } catch (error) {
      // Preserve every confirmed accepted generation if a later generation,
      // download, mix, or R2 write fails. This also makes the failure terminal,
      // preventing the runner from buying the completed jobs again.
      throw withMusicGenerationCost(error, billedGenerations, PRICE.musicTrackUsd);
    }
  },
};

/* ----------------------------- 7. assemble ------------------------------ */

export const assemble: Block = {
  id: "assemble",
  consumes: ["loopUnitKey", "musicUrl"],
  produces: ["videoKey", "videoLocalPath", "videoDurationSec", "introApplied", "loopSeamDiff"],
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

    // The seamless unit is the actual repeated visual artifact. Measure its
    // first/last-frame SSIM before it is streamed under the full music bed so
    // a critic that requests a loop-seam assertion gets a real deterministic
    // value rather than an unmeasured, silently skipped assertion.
    let loopSeamDiff: number | undefined;
    try {
      loopSeamDiff = await measureLoopSeamDiff(loopUnitPath, tmp);
      ctx.log(`assemble: loop seam diff=${loopSeamDiff.toFixed(4)} (0=perfect)`);
    } catch (e) {
      // Draft exploration can still surface the render. Production QA will
      // fail closed if its critic requires this metric and it remains absent.
      ctx.log(`assemble: loop seam metric unavailable: ${e instanceof Error ? e.message : e}`);
    }

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
    await putObjectFromFile(videoKey, finalPath, { contentType: "video/mp4" });
    await recordAsset(ctx, "video", videoKey, {
      durationSec: videoDurationSec,
      introSec,
      loopUnitResolution: ctx.store["loopUnitResolution"],
      ...(loopSeamDiff === undefined ? {} : { loopSeamDiff }),
    });

    return {
      videoKey,
      videoLocalPath: finalPath,
      videoDurationSec,
      introApplied,
      ...(loopSeamDiff === undefined ? {} : { loopSeamDiff }),
    };
  },
};

/* --------------------------- 10. upload_draft --------------------------- */

/**
 * Reload the release certificate from R2 and bind it to the exact local bytes
 * the connector is about to upload. This is intentionally before connector
 * lookup/dispatch: a stale, deleted, or mismatched QA receipt must never reach
 * the external publishing path.
 */
async function verifyFinalMasterReleaseEvidenceForUpload(
  ctx: StageContext,
  filePath: string,
  videoKey: string,
) {
  const certificateKey = str(ctx, "finalMasterReleaseCertificateKey");
  const stagedCertificate = assertFinalMasterReleaseCertificate(
    ctx.store["finalMasterReleaseCertificate"],
  );
  const expectedCertificateKey = finalMasterReleaseCertificateKey(
    ctx.keyPrefix,
    ctx.runId,
    stagedCertificate.certificateFingerprint,
  );
  if (certificateKey !== expectedCertificateKey) {
    throw new Error("upload_draft: final-master release certificate key does not match the staged certificate");
  }
  const durableCertificate = parseFinalMasterReleaseCertificateBytes(
    await getObjectBytes(certificateKey),
  );
  if (durableCertificate.certificateFingerprint !== stagedCertificate.certificateFingerprint) {
    throw new Error("upload_draft: durable final-master release certificate differs from the staged QA certificate");
  }
  // Validate the certificate and every retained evidence key in the same
  // bounded namespace cleanup will later use. This also rejects a receipt key
  // that is not derived from its content fingerprint before any connector work.
  retainedFinalMasterReleaseObjectKeys({
    keyPrefix: ctx.keyPrefix,
    runId: ctx.runId,
    certificateKey,
    certificate: durableCertificate,
  });
  if (durableCertificate.finalMaster.r2Key !== videoKey) {
    throw new Error("upload_draft: final-master release certificate belongs to a different video object");
  }
  const [receiptBytes, evidenceManifestBytes] = await Promise.all([
    getObjectBytes(durableCertificate.visualReview.receiptKey),
    getObjectBytes(durableCertificate.visualReview.evidenceManifestKey),
  ]);
  let evidenceManifest: unknown;
  try {
    evidenceManifest = JSON.parse(Buffer.from(evidenceManifestBytes).toString("utf8"));
  } catch {
    throw new Error("upload_draft: durable visual-review evidence manifest is not valid JSON");
  }
  assertReleaseCertificateVisualReviewBindings({
    certificate: durableCertificate,
    receipt: parseVisualReviewReleaseReceiptBytes(receiptBytes),
    evidenceManifest,
  });
  const localMasterSha256 = await fileSha256(filePath);
  if (localMasterSha256 !== durableCertificate.finalMaster.sha256) {
    throw new Error("upload_draft: local final master no longer matches its durable release certificate");
  }
  return durableCertificate;
}

export const uploadDraft: Block = {
  id: "upload_draft",
  consumes: [
    "videoKey", "videoLocalPath", "title", "description", "tags", "qaPassed",
    "qualityEvidence", "thumbnailKey", "thumbnailPublishable",
    "finalMasterReleaseCertificate", "finalMasterReleaseCertificateKey",
  ],
  produces: ["youtubeVideoId", "watchUrl", "youtubePrivacy"],
  run: async (ctx) => {
    if (ctx.store["qaPassed"] !== true) {
      throw new Error("upload_draft: qa did not pass — refusing to upload");
    }
    const quality = QualityEvidenceSchema.safeParse(ctx.store["qualityEvidence"]);
    if (!quality.success) {
      throw new Error("upload_draft: final quality evidence is missing or malformed — refusing to upload");
    }
    if (!quality.data.release.hardGateReady) {
      throw new Error(
        `upload_draft: final quality evidence did not clear its hard gates — ${quality.data.release.blockers.join("; ")}`,
      );
    }
    const lane = resolveContentLane({ stored: ctx.store["contentLane"], pipeline: [] });
    if (
      quality.data.episode.lane.key !== lane.key ||
      (quality.data.episode.lane.renderer !== undefined &&
        quality.data.episode.lane.renderer !== lane.primaryRenderer)
    ) {
      throw new Error("upload_draft: final quality evidence belongs to a different content lane — refusing to upload");
    }
    // `hardGateReady` is intentionally a narrow raw-receipt signal. Publishing
    // needs the lane's full editorial contract: a real passing evaluator for
    // every required axis, and a source-backed story receipt where the format
    // exposes one. Unknown/legacy lanes have no such contract and fail closed
    // here until migration supplies one.
    const editorialAcceptance = assessProductionEditorialAcceptance(quality.data);
    if (!editorialAcceptance.ready) {
      throw new Error(
        `upload_draft: final editorial acceptance did not pass — ${editorialAcceptance.blockers.join("; ")}`,
      );
    }
    if (!quality.data.release.calibrationComplete) {
      ctx.log(`upload_draft: quality calibration gaps retained for review: ${quality.data.calibrationGaps.join(" | ")}`);
    }
    if (ctx.store["thumbnailPublishable"] !== true) {
      throw new Error("upload_draft: thumbnail is a nonpublishable draft preview — refusing to upload");
    }
    const filePath = str(ctx, "videoLocalPath");
    const videoKey = str(ctx, "videoKey");
    const title = str(ctx, "title");
    let description = str(ctx, "description");
    // LAST-HOP SANITIZE: performed [audio tags] must never reach a public
    // surface — a resume once shipped a CACHED pre-sanitize description
    // ("[softly]" in the hook quote) straight to a YouTube draft. The upload
    // is the final gate, so it strips regardless of upstream cache state.
    description = description.replace(/\[(?:softly|whispers?|pause|long pause|sighs?|exhales?|inhales? deeply|laughs?|chuckles?|seriously|slowly|thoughtful|curious|emphatic|excited|sarcastic|appalled|surprised)\]/gi, "").replace(/ {2,}/g, " ");
    const tags = (ctx.store["tags"] as string[]) ?? [];

    // AUTO-CHAPTERS (metacraft.buildChapters): the chapterPlan knows exactly
    // when each section card lands — write the timestamped list into the
    // description (YouTube key-moments indexing). Skipped when the description
    // already carries timestamps or there are <2 chapters.
    const plan = ctx.store["chapterPlan"] as { kind: string; durSec: number; heading?: string }[] | undefined;
    const chapters = buildChapters(plan);
    if (chapters && !/^\d{1,2}:\d{2}\s/m.test(description)) {
      description = `${description}\n\nChapters:\n${chapters}`;
      ctx.log(`upload_draft: appended ${chapters.split("\n").length} chapters to the description`);
    }

    const client = convex();
    const internalSecret = requireInternalQuerySecret();
    const channelId = ctx.channelId as Id<"channels">;
    const [channel, run] = await Promise.all([
      client.query(api.channels.getChannel, { channelId }),
      client.query(api.runs.getRun, { runId: ctx.runId as Id<"runs"> }),
    ]);
    if (!channel || channel.ownerId !== ctx.ownerId || !run?.startedAt) {
      throw new Error("upload_draft: run/channel tenancy could not be verified");
    }
    const finalMasterReleaseCertificate = await verifyFinalMasterReleaseEvidenceForUpload(
      ctx,
      filePath,
      videoKey,
    );
    ctx.log(
      `upload_draft: revalidated final-master release evidence (${finalMasterReleaseCertificate.certificateFingerprint.slice(0, 12)})`,
    );

    // Publish mode (per-channel pipeline param; default "draft" = private, human
    // approves). A scheduled timestamp is reused from the durable upload row so
    // a worker retry cannot change metadata and accidentally create a duplicate.
    const publishMode = (ctx.params["publishMode"] as string | undefined) ?? "draft";
    const isSupervisedChildrenLane = lane.key === "children_learning_supervised";
    const childSafety = ctx.store["childContentSafety"] as
      | {
          pass?: unknown;
          madeForKids?: unknown;
          release?: unknown;
          allowedPublishMode?: unknown;
          sceneManifestFingerprint?: unknown;
        }
      | undefined;
    if (isSupervisedChildrenLane) {
      if (
        childSafety?.pass !== true ||
        childSafety.madeForKids !== true ||
        childSafety.release !== "human-editorial-approval-required" ||
        childSafety.allowedPublishMode !== "draft"
      ) {
        throw new Error("upload_draft: children-learning lane lacks its mandatory human-review safety receipt");
      }
      assertChildContentRenderEvidence({
        childSafety,
        sceneCompilerReceipt: ctx.store["sceneCompilerReceipt"],
      });
      if (publishMode !== "draft") {
        throw new Error("upload_draft: children-learning episodes may only create private drafts; public/scheduled release is human-gated");
      }
    }
    const dispatchRequestedAt = Date.now();
    let privacyStatus: "private" | "public" | "unlisted" = "private";
    let publishAt: string | undefined;
    let publishAtMs: number | undefined;
    if (publishMode === "public") {
      privacyStatus = "public";
    } else if (publishMode === "scheduled") {
      publishAtMs = resolveScheduledPublishAtMs({
        publishMode,
        pinnedScheduledAt: typeof ctx.store["scheduledPublishAt"] === "number"
          ? ctx.store["scheduledPublishAt"] as number
          : undefined,
        runStartedAt: run.startedAt,
        runId: ctx.runId,
        publishOffsetHours: Number(ctx.params["publishOffsetHours"] ?? 6),
        publishJitterHours: Number(ctx.params["publishJitterHours"] ?? 4),
      });
      if (publishAtMs === undefined) throw new Error("upload_draft: scheduled publish time is missing");
      assertScheduledPublishIsFuture(publishAtMs, dispatchRequestedAt);
      publishAt = new Date(publishAtMs).toISOString();
    }

    // Every write is bound to this exact app owner/channel connector. Missing,
    // mismatched, legacy-unmigrated, or undecryptable credentials stop the run.
    const connector = await requireYouTubeConnector(client, {
      channelId,
      ownerId: ctx.ownerId,
      requiredScopes: YOUTUBE_UPLOAD_SCOPES,
    });
    ctx.log(
      `upload_draft: using linked YouTube channel "${connector.ytTitle ?? connector.ytChannelId ?? "?"}" (${connector.storage})`,
    );

    if (publishAt && !Number.isFinite(publishAtMs)) {
      throw new Error("upload_draft: invalid scheduled publish timestamp");
    }
    let policyDecision: ChannelPublishDecision | undefined;
    if (publishMode === "public" || publishMode === "scheduled") {
      policyDecision = await evaluateChannelPublishAction({
        ownerId: ctx.ownerId,
        channelId,
        action: publishMode === "public" ? "youtube_public" : "youtube_scheduled",
        channel,
        convex: client,
      });
      if (!policyDecision.authorized) {
        ctx.log(
          `upload_draft: channel policy did not authorize ${publishMode} (${policyDecision.reason}); creating an awaiting-approval intent`,
        );
      }
    }
    const madeForKids =
      typeof ctx.params["madeForKids"] === "boolean"
        ? (ctx.params["madeForKids"] as boolean)
        : (channel.schedule?.madeForKids ?? false);
    if (isSupervisedChildrenLane && !madeForKids) {
      throw new Error("upload_draft: children-learning lane must set madeForKids=true");
    }
    const metadata = {
      title,
      description,
      tags,
      categoryId: String(ctx.params["categoryId"] ?? "10"),
      privacyStatus,
      publishAt: publishAtMs,
      containsSyntheticMedia: true,
      madeForKids,
    } as const;
    const videoSha256 = finalMasterReleaseCertificate.finalMaster.sha256;
    const videoArtifactId = `sha256:${videoSha256}`;
    const intentVersion = Number(ctx.params["intentVersion"] ?? 1);
    const idempotencyKey = buildPublishIdempotencyKey({
      connectorId: String(connector.connectorId),
      videoArtifactId,
      intentVersion,
    });
    const thumbKey = opt(ctx, "thumbnailKey");
    const thumbnailSha256 = thumbKey
      ? bytesSha256(await getObjectBytes(thumbKey))
      : undefined;
    const intent = await client.mutation(api.publishIntents.createOrGet, {
      secret: internalSecret,
      ownerId: ctx.ownerId,
      channelId,
      connectorId: connector.connectorId,
      connectorVersion: connector.tokenVersion,
      runId: ctx.runId as Id<"runs">,
      videoArtifactId,
      videoArtifactKey: videoKey,
      videoSha256,
      thumbnailArtifactKey: thumbKey,
      thumbnailSha256,
      intentVersion,
      idempotencyKey,
      metadataSha256: publishMetadataSha256(metadata),
      ...metadata,
      approvedForPublish:
        privacyStatus === "private" && publishAtMs === undefined
          ? true
          : policyDecision?.authorized === true,
      approvedBy: policyDecision?.authorized ? policyDecision.approvedBy : undefined,
      approvalEvidence: policyDecision?.authorized
        ? policyDecision.approvalEvidence
        : undefined,
      approvalPolicyVersion: policyDecision?.authorized
        ? policyDecision.policyVersion
        : undefined,
      approvalPolicyFingerprint: policyDecision?.authorized
        ? policyDecision.pipelineFingerprint
        : undefined,
      hypothesis:
        typeof ctx.params["experimentHypothesis"] === "string"
          ? (ctx.params["experimentHypothesis"] as string)
          : undefined,
      hookVariant:
        typeof ctx.params["hookVariant"] === "string"
          ? (ctx.params["hookVariant"] as string)
          : undefined,
      visualVariant:
        typeof ctx.params["visualVariant"] === "string"
          ? (ctx.params["visualVariant"] as string)
          : undefined,
      dispatchRequestedAt,
      createdAt: run.startedAt,
    });
    if (!intent) throw new Error("upload_draft: publish intent was not persisted");

    ctx.log(
      `upload_draft: dispatching intent ${intent._id} (mode=${publishMode}${publishAt ? `, publishAt=${publishAt}` : ""})…`,
    );
    const dispatched = await dispatchPublishIntent({
      intentId: intent._id,
      workerId: `pipeline:${ctx.runId}`,
      preferredLocalFilePath: filePath,
      log: ctx.log,
    });
    if (dispatched.kind !== "uploaded") {
      throw new Error(
        `upload_draft: publish intent deferred (${dispatched.reason}, status=${dispatched.status})`,
      );
    }
    ctx.log(
      `upload_draft ok: ${dispatched.watchUrl} (privacy=${dispatched.privacyStatus})`,
    );
    return {
      youtubeVideoId: dispatched.videoId,
      watchUrl: dispatched.watchUrl,
      youtubePrivacy: dispatched.privacyStatus,
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
 * intermediate artifact for the run, keeping the finished video + thumbnail
 * and the content-addressed final-master release evidence. Removes the matching
 * R2 objects (narration, music, pre-overlay video, captions, stock segments,
 * keyframes, loop unit, …) AND the intermediate asset rows, so the library
 * keeps the final video and auditable proof of its QA. Generic (uses
 * ctx.keyPrefix + runId) → reusable by EVERY channel/archetype. Non-fatal: a
 * cleanup failure never fails an already-uploaded run.
 */
export const cleanup: Block = {
  id: "cleanup",
  consumes: [
    "watchUrl",
    "finalMasterReleaseCertificate",
    "finalMasterReleaseCertificateKey",
  ], // gated on a successful upload — never runs on a failed render
  produces: ["cleaned", "removedObjects"],
  run: async (ctx) => {
    const prefix = `${ctx.keyPrefix}runs/${ctx.runId}/`;
    const keepNames = (ctx.params["keep"] as string[] | undefined) ?? ["final.mp4", "thumbnail.jpg"];
    let retainedReleaseEvidence: string[];
    try {
      retainedReleaseEvidence = retainedFinalMasterReleaseObjectKeys({
        keyPrefix: ctx.keyPrefix,
        runId: ctx.runId,
        certificateKey: str(ctx, "finalMasterReleaseCertificateKey"),
        certificate: assertFinalMasterReleaseCertificate(ctx.store["finalMasterReleaseCertificate"]),
      });
    } catch (error) {
      // Upload already revalidated this certificate, so a failure here is an
      // unexpected persistence fault. Preserve everything rather than deleting
      // the only auditable final-master evidence after a successful upload.
      ctx.log(
        `cleanup: release evidence retention failed; preserving all run objects: ${error instanceof Error ? error.message : error}`,
      );
      return { cleaned: false, removedObjects: 0 };
    }
    const keep = new Set([
      ...keepNames.map((n) => `${prefix}${n.replace(/^\/+/, "")}`),
      ...retainedReleaseEvidence,
    ]);
    let removed = 0;
    try {
      const all = await listObjects(prefix);
      const del = all.filter((k) => !keep.has(k));
      removed = await deleteObjects(del);
      ctx.log(
        `cleanup: removed ${removed} intermediate object(s); kept ${all.length - del.length} ` +
          `(${keepNames.join(", ")}; ${retainedReleaseEvidence.length} final-master evidence object(s))`,
      );
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
 * `thumbnailGen` (id "thumbnail_gen", banana engine), both registered via
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
    await putObjectFromFile(shortKey, final, { contentType: "video/mp4" });
    ctx.log(`shorts_spinoff: built 9:16 short (${durSec.toFixed(0)}s) → ${shortKey}`);

    // Upload as a YouTube Short (PRIVATE unless the param opts into public).
    let shortVideoId = "";
    const client = convex();
    const channelId = ctx.channelId as Id<"channels">;
    const connector = await requireYouTubeConnector(client, {
      channelId,
      ownerId: ctx.ownerId,
      requiredScopes: YOUTUBE_UPLOAD_SCOPES,
    });
    const desc = (ctx.store["description"] as string | undefined) ?? "";
    const publishShort = ctx.params["publishShort"] === "public";
    if (publishShort) {
      await requireChannelPublishAction({
        ownerId: ctx.ownerId,
        channelId,
        action: "youtube_short_public",
        convex: client,
      });
    }
    const res = await uploadDurableVideo({
      convex: client,
      ownerId: ctx.ownerId,
      channelId,
      uploadKey: `${ctx.runId}:short-video:${connector.connectorId}:v${connector.tokenVersion}`,
      upload: {
        filePath: final,
        title: `${title} #Shorts`.slice(0, 100),
        description: `#Shorts\n\n${desc}`.slice(0, 4900),
        tags: ((ctx.store["tags"] as string[]) ?? []).slice(0, 15),
        privacyStatus: publishShort ? "public" : "private",
        refreshToken: connector.refreshToken,
        containsSyntheticMedia: true,
      },
      log: ctx.log,
    });
    shortVideoId = res.videoId;
    ctx.log(`shorts_spinoff: uploaded Short ${res.watchUrl} (privacy=${res.privacyStatus})`);

    // Optional multi-platform crosspost of the SHORT via Ayrshare — explicit opt-in
    // only (so private brand content is never auto-published off-platform).
    if (ctx.params["crosspostShort"] === true && hasAyrshareKey()) {
      await requireChannelPublishAction({
        ownerId: ctx.ownerId,
        channelId,
        action: "crosspost",
        convex: client,
      });
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
 *   → thumbnail_gen(banana) → upload_draft → notify
 *
 * `competitor_research` runs first (consumes []) so nicheIntelligence /
 * seoDatabank / competitors are in the store before `metadata` optimises the
 * title and `thumbnail_gen` designs the thumbnail (real-scene/banana).
 *
 * We upscale the ~10-30s loop UNIT (not the full render), then stream_loop the
 * 4K unit to length — so length is just a duration param, never extra GPU cost.
 */
export const LOFI_PIPELINE = [
  { block: "competitor_research" },
  { block: "topic_select" },
  { block: "scene_planner", params: { visualStyle: "lofi", clipDurationSec: 5 } },
  { block: "keyframes", params: { aspectRatio: "16:9", visualStyle: "lofi" } },
  // crossfadeSec 2.5 only applies to loopMode:"crossfade" (the blend IS the loop
  // there); the default flf2v path uses the capped flfCrossfadeSec safety net.
  { block: "loop_clips", params: { clipDurationSec: 10, visualStyle: "lofi", crossfadeSec: 2.5, flfCrossfadeSec: 0.4 } },
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
