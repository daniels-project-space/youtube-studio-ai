/**
 * lore_short — the LORE MICRO-DOC visual engine for the `loreshort` family.
 *
 * SELF-CONTAINED, structural twin of whiteboard_scribe and motion_comic: it
 * writes its own first-person narration arc, paints each beat, animates a real
 * 3D depth camera move over the painting, and cuts the whole video to the
 * voice. It therefore REPLACES the script → narration → footage → assemble
 * chain and produces the final `videoKey` directly.
 *
 * WHAT THIS WRAPPER OWNS (the engine at src/lib/loreshort.ts owns none of it):
 *  - PROVIDERS. The engine's standalone defaults are FAL image art, Replicate
 *    (LTX/Seedance + Real-ESRGAN) and a hardcoded ElevenLabs voice — none attested,
 *    none budgeted. This block injects the attested Novita render farm for BOTH
 *    art (createAttestedNovitaImageGenerator, per-call signed receipts) and the
 *    i2v camera move (generateI2V → renderNovitaI2V), and accumulates every
 *    receipt with `+=` so a retry can never overwrite prior spend.
 *  - UPSCALE. Real-ESRGAN is NOT used: the engine already has a free ffmpeg
 *    lanczos+unsharp 2K lane (LORESHORT_PATHS.budget), so this block runs at 2K
 *    for $0 of upscale spend rather than paying per clip for 4K.
 *  - VOICE. The channel's cast voice + provider (the same params narration_tts
 *    and whiteboard_scribe read), not the engine's hardcoded ElevenLabs id.
 *  - PUBLICATION. putObjectFromFile → R2 `videoKey`, not an nginx docroot copy
 *    behind a hardcoded IP (Trigger.dev cloud workers have neither).
 *  - QUALITY. A produce→critique loop on the STORY, settled at text prices and
 *    frozen into a content-addressed R2 checkpoint, so a rejected draft never
 *    costs a paid render and a replay never re-buys one.
 */
import { createHash } from "node:crypto";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { COST_PATCH_KEY, type Block, type StageContext } from "@/engine/types";
import { getVisualBrief } from "@/engine/creative/brief";
import { makeRunTempDir } from "@/lib/files";
import { putObject, putObjectFromFile, getObjectBytes } from "@/lib/storage";
import {
  craftLoreShort,
  hasLoreShort,
  loreStoryDefects,
  planLoreShortStory,
  SUB_STYLES,
  type LoreArtRequest,
  type LoreClipRequest,
  type LorePlan,
} from "@/lib/loreshort";
import {
  assertStoryboardCritiqueApproved,
  critiqueStoryboardText,
  unavailableStoryboardCriticVerdict,
} from "@/lib/storyboardCritic";
import { synthNarration } from "@/lib/tts";
import {
  produceAndCritique,
  type ChannelCritiqueContext,
} from "@/engine/critiqueLoop";
import { laneQualityPolicy } from "@/engine/contentLane";
import { createAttestedNovitaImageGenerator } from "@/lib/novitaMedia";
import { hasNovitaRenderFarmConfig } from "@/lib/novitaRenderFarm";
import { generateI2V } from "@/lib/i2v";
import { PRICE } from "@/engine/pricing";
import { novitaCostEnvelope, requireNovitaStageBudget } from "@/lib/novitaCostEnvelope";

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

const LORE_STORY_CHECKPOINT_VERSION = "lore-short-story/v2";

/** ~6s of screen time per beat is the engine's own pacing (145 LTX frames @ 24fps). */
export const LORE_SECONDS_PER_BEAT = 6;
/** Beat count bounds. The floor keeps an arc; the ceiling caps paid clip count. */
export const LORE_MIN_BEATS = 6;
export const LORE_MAX_BEATS = 16;

export function loreBeatCount(targetSeconds: number): number {
  if (!Number.isFinite(targetSeconds) || targetSeconds <= 0) return 9; // engine default
  return Math.max(LORE_MIN_BEATS, Math.min(LORE_MAX_BEATS, Math.round(targetSeconds / LORE_SECONDS_PER_BEAT)));
}

/** Channel doctrine + lane grounding for this block's critique. */
function loreCritiqueChannel(ctx: StageContext): ChannelCritiqueContext {
  const lane = ctx.store["contentLane"];
  const laneKey = typeof (lane as { key?: unknown } | null)?.key === "string"
    ? String((lane as { key?: unknown }).key)
    : undefined;
  const text = (key: string): string | undefined => {
    const value = ctx.store[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  return {
    ...(text("channelName") ? { channelName: text("channelName")! } : {}),
    ...(text("persona") ? { persona: text("persona")! } : {}),
    ...(text("styleGrammar") ? { styleGrammar: text("styleGrammar")! } : {}),
    ...(text("criticDoctrine") ? { criticDoctrine: text("criticDoctrine")! } : {}),
    ...(laneKey ? { contentLaneKey: laneKey } : {}),
    laneEmphasis: laneQualityPolicy(lane).emphasis,
  };
}

/**
 * Subjective grade from the Director. Returns null when the grader is
 * unavailable so the caller retries only text planning and fails closed before
 * any paid render is authorized.
 */
async function gradeLoreStory(args: {
  plan: LorePlan;
  topic: string;
  narrator: string;
  channel: ChannelCritiqueContext;
}): Promise<{ score: number; pass: boolean; issues: string[] } | null> {
  const scenes = args.plan.scenes ?? [];
  return critiqueStoryboardText({
    label: "first-person lore micro-documentary beat sheet",
    topic: args.topic,
    channel: args.channel,
    costWarning: "Every beat costs a painting and an AI camera move — reject a beat sheet that would waste them.",
    candidate:
      `NARRATOR: ${args.narrator}\n` +
      `THE BEAT SHEET (${scenes.length} beats):\n` +
      scenes
        .map((scene, index) =>
          `${index + 1}. SAYS: ${scene.line}\n   SHOT: ${scene.shot ?? "(unset)"}\n   PAINTS: ${scene.visual}\n   CAMERA: ${scene.camera}`,
        )
        .join("\n"),
    rubric:
      "Judge only: (a) the beats form one arc that builds through opening, rising tension, climax, and cold resolution rather than a list of facts; " +
      "(b) narration remains genuinely first person in the named narrator's voice; " +
      "(c) every PAINTS field describes a concrete drawable moment in three separated depth planes so the camera has depth to travel through; " +
      "(d) CAMERA moves genuinely travel through that depth and vary across beats; and " +
      "(e) wording stays generic and non-trademarked so it will not waste an image render.",
  });
}

function storyCheckpointKey(ctx: StageContext, inputs: unknown): string {
  const hash = createHash("sha256").update(JSON.stringify(inputs)).digest("hex").slice(0, 32);
  return `${ctx.keyPrefix}runs/${ctx.runId}/storyboards/lore-short-${hash}.json`;
}

async function loadStoryCheckpoint(key: string): Promise<LorePlan | null> {
  try {
    const parsed = JSON.parse(Buffer.from(await getObjectBytes(key)).toString("utf8")) as {
      version?: unknown;
      story?: unknown;
    };
    if (parsed.version !== LORE_STORY_CHECKPOINT_VERSION) return null;
    const story = parsed.story as LorePlan | undefined;
    if (!story || !Array.isArray(story.scenes) || !story.scenes.length) return null;
    if (story.scenes.some((scene) => typeof scene?.line !== "string" || typeof scene?.visual !== "string")) return null;
    return story;
  } catch {
    return null;
  }
}

/**
 * Settle the story with the Director in the loop, then FREEZE it. The only
 * caller renders the returned plan exactly once and nothing else. Every
 * iteration is a TEXT call (planLoreShortStory touches no image, TTS or video
 * provider), so a rejection cannot re-purchase a render by construction.
 */
async function planLoreWithCritique(
  ctx: StageContext,
  brief: { topic: string; narrator: string; nScenes: number },
  channel: ChannelCritiqueContext,
): Promise<LorePlan> {
  const checkpointKey = storyCheckpointKey(ctx, {
    contract: LORE_STORY_CHECKPOINT_VERSION,
    topic: brief.topic,
    narrator: brief.narrator,
    nScenes: brief.nScenes,
    criticDoctrine: channel.criticDoctrine ?? null,
    contentLaneKey: channel.contentLaneKey ?? null,
  });

  const cached = await loadStoryCheckpoint(checkpointKey);
  if (cached) {
    ctx.log(`lore_short: reused the frozen beat sheet (${cached.scenes?.length ?? 0} beats) — no re-planning, no re-render`);
    return cached;
  }

  const laneQuality = laneQualityPolicy(ctx.store["contentLane"]);
  const maxIters = Math.max(1, Math.min(2, laneQuality.maxCritiqueIters));

  const loop = await produceAndCritique<LorePlan>({
    label: "lore_short story",
    threshold: laneQuality.critiqueThreshold,
    maxIters,
    log: (message) => ctx.log(message),
    channel,
    produce: (priorIssues) => planLoreShortStory(brief, (m) => ctx.log(`lore-plan: ${m}`), priorIssues),
    critique: async (plan, iter) => {
      const hard = loreStoryDefects(plan, brief.nScenes);
      const graded = await gradeLoreStory({ plan, topic: brief.topic, narrator: brief.narrator, channel });
      if (!graded) {
        ctx.log(`lore_short: Claude story critic unavailable — candidate ${iter} remains blocked before paid rendering`);
        return unavailableStoryboardCriticVerdict(hard);
      }
      const issues = [...hard, ...graded.issues].slice(0, 8);
      const pass = graded.pass && hard.length === 0;
      if (!pass) {
        ctx.log(
          `lore_short: story ${iter} REJECTED (${issues.slice(0, 2).join("; ").slice(0, 160)})` +
          (iter < maxIters ? " — rewriting with the defects fed back (text only, no render)" : " — iteration cap reached"),
        );
      }
      const score = Math.max(0, graded.score - Math.min(0.5, hard.length * 0.1));
      return { score, pass, issues };
    },
  });

  assertStoryboardCritiqueApproved({
    label: "lore_short",
    accepted: loop.accepted,
    score: loop.critique.score,
    issues: loop.critique.issues,
  });
  const plan = loop.value;
  if (!plan.scenes?.length) throw new Error("lore_short: story writer returned no beats");
  ctx.log(
    `lore_short: story settled after ${loop.iterations} candidate(s) ` +
    `(${loop.accepted ? "accepted" : "best of the rejected set"}, score ${loop.critique.score.toFixed(2)}, ` +
    `${plan.scenes.length} beats)`,
  );
  await putObject(
    checkpointKey,
    Buffer.from(JSON.stringify({ version: LORE_STORY_CHECKPOINT_VERSION, story: plan })),
    { contentType: "application/json" },
  );
  return plan;
}

export const loreShort: Block = {
  id: "lore_short",
  consumes: ["topic"],
  produces: ["videoKey", "videoLocalPath", "videoDurationSec", "narrationText"],
  paid: true,
  run: async (ctx) => {
    if (!hasLoreShort() || !hasNovitaRenderFarmConfig()) {
      throw new Error("lore_short: the configured Claude lore planner plus the attested Novita LTX render farm are required (no fallback)");
    }
    const topic = String(ctx.store["topic"] ?? "");
    if (!topic) throw new Error("lore_short: no topic in store");

    const visualBrief = getVisualBrief(ctx.store);
    const subStyle = String(ctx.params["subStyle"] ?? "cinematic");
    if (!SUB_STYLES[subStyle]) {
      throw new Error(`lore_short: unknown subStyle ${JSON.stringify(subStyle)} (have: ${Object.keys(SUB_STYLES).join(", ")})`);
    }
    // WHO narrates, first person. The channel's persona is the honest source;
    // a generic fallback keeps the block runnable on a bare pipeline.
    const narrator =
      (ctx.params["narrator"] as string | undefined)?.trim() ||
      (ctx.store["persona"] as string | undefined)?.trim() ||
      "a weathered chronicler who witnessed these events first-hand and speaks of them plainly, without boast";

    const targetSeconds = Math.max(0, Number(ctx.params["targetSeconds"] ?? 0));
    const nScenes = loreBeatCount(targetSeconds);
    const stageBudgetUsd = requireNovitaStageBudget(ctx.stageBudgetUsd, "lore_short");
    if (targetSeconds > 0) ctx.log(`lore_short: sized to ~${targetSeconds}s → ${nScenes} beats`);
    // Check the whole bounded image+motion sequence before buying its first
    // still. Individual workers remain capped at $0.35 below; this prevents a
    // malformed beat count from spending a partial story and discovering the
    // stage reservation was too small halfway through.
    novitaCostEnvelope({
      label: "lore_short",
      imageJobs: nScenes,
      videoJobs: nScenes,
      maxCostUsd: stageBudgetUsd,
    });

    // VOICE CASTING — the same params narration_tts and whiteboard_scribe read,
    // instead of the engine's hardcoded ElevenLabs id.
    const ttsProvider = String(ctx.params["ttsProvider"] ?? ctx.store["ttsProvider"] ?? "fish");
    const elevenVoiceId = ctx.params["elevenVoiceId"] as string | undefined;
    const castVoiceId =
      (ctx.store["voiceId"] as string | undefined) ??
      (ctx.params["voiceId"] as string | undefined) ??
      "sleepless_historian";
    const selectedVoiceId = ttsProvider === "elevenlabs" ? (elevenVoiceId ?? castVoiceId) : castVoiceId;

    // DETERMINISTIC dir (scoped): the engine caches EVERY stage by path, so a
    // random mkdtemp would make each Trigger retry re-buy all the art and clips.
    const runDir = await makeRunTempDir(ctx.runId, "lore_short");
    const prefix = `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/lore-short`;

    const channel = loreCritiqueChannel(ctx);
    // QUALITY GATE — settle the beat sheet at TEXT prices first. craftLoreShort
    // below is called exactly once with the accepted plan and does zero planning.
    const plan = await planLoreWithCritique(ctx, { topic, narrator, nScenes }, channel);

    let imageCostUsd = 0;
    let clipCostUsd = 0;
    let ttsCharacters = 0;
    let clipCalls = 0;
    let visionCalls = 0;
    const generateImage = createAttestedNovitaImageGenerator<LoreArtRequest & { prompt: string }>({
      prefix: `${prefix}/art`,
      id: (request) => request.id,
      profileId: "production",
      maxCostUsd: PRICE.novitaImageMaxUsd,
      lifecycle: {
        ownerId: ctx.ownerId,
        channelId: ctx.channelId,
        runId: ctx.runId,
        blockId: "lore_short",
      },
      onReceipt: (receipt) => { imageCostUsd += receipt.costUsd; },
    });

    let videoKey = "";
    let videoLocalPath = "";
    const result = await craftLoreShort(
      {
        slug: `run-${ctx.runId}`,
        title: String(ctx.store["title"] ?? topic).slice(0, 90),
        kicker: visualBrief?.header?.slice(0, 90) || String(ctx.store["channelName"] ?? "Histories & Lore").slice(0, 90),
        topic,
        narrator,
        nScenes,
        subStyle,
        // BUDGET LANE, deliberately: LTX-class clips + the engine's FREE ffmpeg
        // lanczos+unsharp 2K finish. Real-ESRGAN would add a paid upscale per
        // clip for a resolution nobody asked for.
        model: "ltx",
        frames: 145,
        upscale: "ffmpeg",
        upscaleRes: "2k",
      },
      {
        plan,
        workDir: runDir,
        log: (m) => ctx.log(`lore: ${m}`),
        // The engine's own per-beat motion-analysis vision pass. Counted only
        // when it actually fires, so a resumed run (cached motion_*.json) books
        // nothing rather than re-charging for work it skipped.
        onVisionCall: () => { visionCalls += 1; },
        generateImage: (request) => generateImage(request),
        // ATTESTED i2v. The still is staged in R2 first so the farm reads it by
        // key (no public URL, no nginx) and every clip's signed cost lands in
        // clipCostUsd with `+=` — a Trigger retry accumulates, never overwrites.
        generateClip: async (request: LoreClipRequest) => {
          const imageKey = `${prefix}/stills/${request.id}.jpg`;
          await putObjectFromFile(imageKey, request.imagePath, { contentType: "image/jpeg" });
          const clip = await generateI2V({
            prompt: request.prompt,
            negativePrompt: request.negativePrompt,
            imageKey,
            durationSec: request.durationSec,
            provider: "novita-ltx",
            model: "ltx-2.5-distilled-x2",
            aspectRatio: "16:9",
            maxCostUsd: PRICE.novitaVideoMaxUsd,
            runId: ctx.runId,
            keyPrefix: ctx.keyPrefix,
            lifecycle: {
              ownerId: ctx.ownerId,
              channelId: ctx.channelId,
              runId: ctx.runId,
              blockId: "lore_short",
            },
            log: (m) => ctx.log(`lore-i2v: ${m}`),
          });
          clipCostUsd += clip.costUsd;
          clipCalls += 1;
          return Buffer.from(await getObjectBytes(clip.key));
        },
        synthLine: async (request) =>
          Buffer.from(
            await synthNarration({
              text: request.text,
              provider: ttsProvider,
              voiceId: selectedVoiceId,
              elevenVoiceId: selectedVoiceId,
              speed: request.speed,
              onBillableCharacters: (characters) => { ttsCharacters += characters; },
            }),
          ),
        // R2 SINK replaces the nginx docroot copy + hardcoded IP URL.
        publish: async ({ localPath }) => {
          videoLocalPath = localPath;
          videoKey = `${ctx.keyPrefix}runs/${ctx.runId}/final.mp4`;
          await putObjectFromFile(videoKey, localPath, { contentType: "video/mp4" });
          return { videoPath: videoKey, url: videoKey };
        },
      },
    );

    const artCost = ctx.imageUsageAccounting?.().costUsd ?? imageCostUsd;
    const ttsCost =
      (ttsCharacters / 1000) *
      (ttsProvider === "elevenlabs" ? PRICE.ttsElevenPerKCharUsd : PRICE.ttsPerKCharUsd);
    // Cache hits generate zero characters, images and clips: never book a
    // phantom fallback charge merely because this block is paid-capable.
    const visionCost = visionCalls * PRICE.visionGraderUsd;
    const loreCost = artCost + clipCostUsd + ttsCost + visionCost;
    ctx.log(
      `lore_short: attested Novita art $${artCost.toFixed(4)} + ${clipCalls} i2v clip(s) $${clipCostUsd.toFixed(4)} + ` +
      `${ttsCharacters} TTS chars $${ttsCost.toFixed(4)} + ${visionCalls} motion-analysis call(s) $${visionCost.toFixed(4)} ` +
      `= $${loreCost.toFixed(4)}`,
    );

    const narrationText = result.scenes.map((scene) => scene.line).join(" ").trim();
    const videoDurationSec = Math.round(result.durationSec);
    await recordAsset(ctx, "video", videoKey, {
      durationSec: videoDurationSec,
      engine: "lore_short",
      beats: result.scenes.length,
      width: result.width,
      height: result.height,
      imageProvider: "novita-z-image-turbo-local",
      videoProvider: "novita-ltx-2.5-distilled-x2",
    });
    ctx.log(`lore_short ✓ → ${videoKey} (${videoDurationSec}s, ${result.scenes.length} beats, ${result.width}x${result.height})`);

    return {
      videoKey,
      videoLocalPath,
      videoDurationSec,
      narrationText,
      [COST_PATCH_KEY]: loreCost,
    };
  },
};

export const loreShortBlocks: Block[] = [loreShort];
