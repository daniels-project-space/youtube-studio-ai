/**
 * whiteboard_scribe — the DRAWN-CINEMA visual engine for the `whiteboard` family.
 *
 * Unlike footage engines (which produce `footageClips` for timeline_assemble),
 * this is SELF-CONTAINED: it writes its own layered storyboard + narration and
 * draws the whole video in time with the voice (src/lib/whiteboardSync.ts). It
 * therefore REPLACES the script→narration→footage→assemble chain and produces
 * the final `videoKey` directly (mirrors the lofi `assemble` block).
 *
 * Deterministic write-on reveal uses no video model; its bounded paid path is
 * per-layer attested Novita art plus TTS. Resolution-configurable (1080p
 * default, 2K via `width`).
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
import { createHash } from "node:crypto";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { COST_PATCH_KEY, type Block, type StageContext } from "@/engine/types";
import { getVisualBrief } from "@/engine/creative/brief";
import { makeRunTempDir, downloadTo } from "@/lib/files";
import { putObject, putObjectFromFile, getObjectBytes } from "@/lib/storage";
import {
  castWhiteboardSync,
  hasWhiteboardSync,
  whiteboardImageCallCeiling,
  planWhiteboardStoryboard,
  whiteboardPanelCount,
  type WhiteboardArtRequest,
  type WhiteboardStoryboard,
  type WhiteboardSyncBrief,
} from "@/lib/whiteboardSync";
import {
  assertStoryboardCritiqueApproved,
  critiqueStoryboardText,
  unavailableStoryboardCriticVerdict,
} from "@/lib/storyboardCritic";
import {
  produceAndCritique,
  type ChannelCritiqueContext,
} from "@/engine/critiqueLoop";
import { laneQualityPolicy } from "@/engine/contentLane";
import { createAttestedNovitaImageGenerator } from "@/lib/novitaMedia";
import { novitaCostEnvelope, type NovitaCostEnvelope } from "@/lib/novitaCostEnvelope";
import { hasNovitaRenderFarmConfig } from "@/lib/novitaRenderFarm";
import { PRICE } from "@/engine/pricing";

/**
 * Prove the complete bounded art sequence fits the signed compiler stage
 * reservation before a single direct worker can be provisioned. `budgetUsd`
 * is run-wide and must never be used as a substitute for this stage envelope.
 */
export function whiteboardNovitaImageStageEnvelope(
  panelCount: unknown,
  stageBudgetUsd: number | undefined,
): NovitaCostEnvelope {
  if (
    typeof stageBudgetUsd !== "number" ||
    !Number.isFinite(stageBudgetUsd) ||
    stageBudgetUsd <= 0
  ) {
    throw new Error("whiteboard_scribe requires a positive compiler-signed stage budget before Novita art can start");
  }
  const panels = whiteboardPanelCount(panelCount);
  return novitaCostEnvelope({
    label: "whiteboard_scribe",
    imageJobs: whiteboardImageCallCeiling(panels),
    maxCostUsd: stageBudgetUsd,
  });
}

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

/* ── PRODUCE → CRITIQUE → REGENERATE for the STORYBOARD (P1-4 follow-up) ──────
 *
 * This block used to hand ONE unreviewed Gemini storyboard straight into
 * castWhiteboardSync, which then bought 18-30 paid art layers and the whole
 * narration off the back of it. A weak or malformed board was only discoverable
 * AFTER the budget was spent.
 *
 * The loop sits on the STORYBOARD, never on rendered output:
 *   - Every iteration is a TEXT-only call (planWhiteboardStoryboard touches no
 *     image generator, no TTS, no python renderer), so a regeneration CANNOT
 *     re-purchase art or narration by construction.
 *   - castWhiteboardSync is invoked exactly ONCE, after the loop settles, with
 *     the accepted plan — a rejection costs a text call, never a second render.
 *   - The accepted storyboard is frozen into a content-addressed, immutable R2
 *     checkpoint keyed by a hash of every planning input, so a healer replay or
 *     Trigger retry reloads that exact board, runs ZERO critique calls, and
 *     re-uses the runDir's index-keyed art instead of buying it again.
 *   - Hard cap of 2 iterations (one informed retry), lane-tunable downward.
 *   - Critic outage gets only the bounded text retry, then blocks before paid rendering.
 */
const SCRIBE_STORYBOARD_CHECKPOINT_VERSION = "whiteboard-scribe-storyboard/v2";

/** The whiteboard renderer hand-letters every word; art asking for text fights it. */
const TEXT_IN_ART = /\b(text|caption|subtitle|title|lettering|letters|word|words|label|logo|watermark|signage|handwriting|number|numbers)\b/i;

/** The board's persistent title header owns the top strip — nothing may sit in it. */
const HEADER_FLOOR_Y = 0.17;

/** Channel doctrine + lane grounding for this block's critique (P1-1/P1-17). */
function scribeCritiqueChannel(ctx: StageContext): ChannelCritiqueContext {
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

function storyboardWords(plan: WhiteboardStoryboard): number {
  return plan.fullText.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * DETERMINISTIC defects, computed in code per critiqueLoop's design rule — the
 * Director is never asked to count panels, check box geometry or spot lettering.
 */
export function whiteboardStoryboardDefects(
  plan: WhiteboardStoryboard,
  wantPanels: number,
  targetWords: number,
): string[] {
  const issues: string[] = [];
  if (plan.panels.length < wantPanels) {
    issues.push(`only ${plan.panels.length} of the ${wantPanels} requested panels came back — return exactly ${wantPanels}`);
  }
  plan.panels.forEach((panel, index) => {
    const words = panel.narration.trim().split(/\s+/).filter(Boolean).length;
    if (words < 8) {
      issues.push(`panel ${index + 1}'s narration is only ${words} words — write ~2 full spoken sentences`);
    }
    const art = panel.layers.filter((layer) => layer.kind === "art");
    if (!art.length) {
      issues.push(`panel ${index + 1} has no art layers — the board would stay blank while the voice speaks`);
    }
    // The engine treats w >= 0.32 as the panel's hero SCENE; without one the
    // panel is only scattered small sketches with no composed visual.
    if (art.length && !art.some((layer) => Number(layer.box?.[2] ?? 0) >= 0.32)) {
      issues.push(`panel ${index + 1} has no hero scene — one art layer must be a larger composed scene (w between 0.34 and 0.52)`);
    }
    const inHeader = panel.layers.find((layer) => Number(layer.box?.[1] ?? 1) < HEADER_FLOOR_Y);
    if (inHeader) {
      issues.push(`panel ${index + 1} places a layer at y=${Number(inHeader.box?.[1] ?? 0).toFixed(2)}, under the title header — every box needs y >= ${HEADER_FLOOR_Y}`);
    }
    const lettered = art.find((layer) => TEXT_IN_ART.test(layer.draw ?? ""));
    if (lettered) {
      issues.push(`panel ${index + 1} asks the art to draw words ("${(lettered.draw ?? "").slice(0, 48)}") — the renderer is hard-instructed to omit text; use a label layer instead`);
    }
    const blankLabel = panel.layers.find((layer) => layer.kind === "label" && !layer.text?.trim());
    if (blankLabel) {
      issues.push(`panel ${index + 1} has a label layer with no text — every label must carry the exact words to hand-letter`);
    }
    // boundNarration DROPS any layer whose cue is not in the narration, so a
    // panel that lost most of its layers had bad cues upstream.
    if (panel.layers.length < 2 && words >= 8) {
      issues.push(`panel ${index + 1} only kept ${panel.layers.length} layer(s) — every "cue" must be an EXACT substring of that panel's narration`);
    }
  });
  for (let i = 1; i < plan.panels.length; i++) {
    if (plan.panels[i].narration.trim() === plan.panels[i - 1].narration.trim()) {
      issues.push(`panels ${i} and ${i + 1} repeat the same narration — each panel must advance the explanation`);
    }
  }
  if (targetWords > 0) {
    const got = storyboardWords(plan);
    if (got < targetWords * 0.65) {
      issues.push(`the whole script is only ~${got} spoken words but needs ~${targetWords} to hit the requested length — deepen each panel`);
    }
  }
  return issues.slice(0, 8);
}

/**
 * Subjective grade from the Director, grounded in this channel's doctrine.
 * Returns null when the critic is unavailable; the caller then retries only
 * text planning and blocks paid rendering unless an approval is obtained.
 */
async function gradeStoryboard(args: {
  plan: WhiteboardStoryboard;
  topic: string;
  channel: ChannelCritiqueContext;
}): Promise<{ score: number; pass: boolean; issues: string[] } | null> {
  return critiqueStoryboardText({
    label: "whiteboard-explainer storyboard",
    topic: args.topic,
    channel: args.channel,
    costWarning: "Drawing this board is expensive and irreversible — reject a board that would waste it.",
    candidate:
      `TITLE: ${args.plan.title}\n` +
      `THE STORYBOARD (${args.plan.panels.length} panels):\n` +
      args.plan.panels
        .map((panel, index) =>
          `${index + 1}. NARRATION: ${panel.narration}\n` +
          panel.layers
            .map((layer) =>
              layer.kind === "art"
                ? `   DRAW "${layer.draw}" @ cue "${layer.cue}"`
                : `   LETTER "${layer.text}" @ cue "${layer.cue}"`,
            )
            .join("\n"),
        )
        .join("\n"),
    rubric:
      "Judge only: (a) the panels build one coherent argument in order, each advancing it rather than restating; " +
      "(b) the narration is genuinely informative and accurate, not filler; " +
      "(c) each drawn layer illustrates the exact thing its cue names so the board stands on its own; " +
      "(d) each panel's hero scene is a concrete drawable composition, not an abstract idea; and " +
      "(e) labels letter the numbers, dates, and terms that actually matter.",
  });
}

function storyboardCheckpointKey(ctx: StageContext, inputs: unknown): string {
  const hash = createHash("sha256").update(JSON.stringify(inputs)).digest("hex").slice(0, 32);
  return `${ctx.keyPrefix}runs/${ctx.runId}/storyboards/whiteboard-scribe-${hash}.json`;
}

async function loadStoryboardCheckpoint(key: string): Promise<WhiteboardStoryboard | null> {
  try {
    const parsed = JSON.parse(Buffer.from(await getObjectBytes(key)).toString("utf8")) as {
      version?: unknown;
      storyboard?: unknown;
    };
    if (parsed.version !== SCRIBE_STORYBOARD_CHECKPOINT_VERSION) return null;
    const storyboard = parsed.storyboard as WhiteboardStoryboard | undefined;
    if (!storyboard || typeof storyboard.fullText !== "string" || !storyboard.fullText.trim()) return null;
    if (!Array.isArray(storyboard.panels) || !storyboard.panels.length) return null;
    if (storyboard.panels.some((panel) => typeof panel?.narration !== "string" || !Array.isArray(panel?.layers))) return null;
    return storyboard;
  } catch {
    return null;
  }
}

/**
 * Write the storyboard with the Director in the loop, then FREEZE it. The only
 * caller renders the returned storyboard exactly once and nothing else.
 */
async function planScribeWithCritique(
  ctx: StageContext,
  brief: WhiteboardSyncBrief,
): Promise<WhiteboardStoryboard> {
  const channel = scribeCritiqueChannel(ctx);
  const wantPanels = whiteboardPanelCount(brief.panels);
  const targetWords = Number(brief.targetWords ?? 0) || 0;
  const checkpointKey = storyboardCheckpointKey(ctx, {
    contract: SCRIBE_STORYBOARD_CHECKPOINT_VERSION,
    topic: brief.topic,
    facts: brief.facts ?? null,
    beats: brief.beats ?? null,
    panels: wantPanels,
    targetWords,
    styleId: brief.styleId ?? null,
    artStyle: brief.artStyle ?? null,
    criticDoctrine: channel.criticDoctrine ?? null,
    contentLaneKey: channel.contentLaneKey ?? null,
  });

  const cached = await loadStoryboardCheckpoint(checkpointKey);
  if (cached) {
    ctx.log(`whiteboard_scribe: reused the frozen storyboard (${cached.panels.length} panels) — no re-planning, no re-render`);
    return cached;
  }

  const laneQuality = laneQualityPolicy(ctx.store["contentLane"]);
  const maxIters = Math.max(1, Math.min(2, laneQuality.maxCritiqueIters));

  const loop = await produceAndCritique<WhiteboardStoryboard>({
    label: "whiteboard_scribe storyboard",
    threshold: laneQuality.critiqueThreshold,
    maxIters,
    log: (message) => ctx.log(message),
    channel,
    // TEXT ONLY. planWhiteboardStoryboard reaches no image or TTS provider, so
    // no iteration here can spend render money.
    produce: (priorIssues) => planWhiteboardStoryboard(brief, (m) => ctx.log(`wb-plan: ${m}`), priorIssues),
    critique: async (plan, iter) => {
      const hard = whiteboardStoryboardDefects(plan, wantPanels, targetWords);
      const graded = await gradeStoryboard({ plan, topic: brief.topic, channel });
      if (!graded) {
        ctx.log(`whiteboard_scribe: Claude storyboard critic unavailable — candidate ${iter} remains blocked before paid rendering`);
        return unavailableStoryboardCriticVerdict(hard);
      }
      const issues = [...hard, ...graded.issues].slice(0, 8);
      const pass = graded.pass && hard.length === 0;
      if (!pass) {
        ctx.log(
          `whiteboard_scribe: storyboard ${iter} REJECTED (${issues.slice(0, 2).join("; ").slice(0, 160)})` +
          (iter < maxIters ? " — rewriting with the defects fed back (text only, no render)" : " — iteration cap reached"),
        );
      }
      const score = Math.max(0, graded.score - Math.min(0.5, hard.length * 0.1));
      return { score, pass, issues };
    },
  });

  assertStoryboardCritiqueApproved({
    label: "whiteboard_scribe",
    accepted: loop.accepted,
    score: loop.critique.score,
    issues: loop.critique.issues,
  });
  const plan = loop.value;
  if (!plan.panels.length) throw new Error("whiteboard_scribe: storyboard writer returned no panels");
  ctx.log(
    `whiteboard_scribe: storyboard settled after ${loop.iterations} candidate(s) ` +
    `(${loop.accepted ? "accepted" : "best of the rejected set"}, score ${loop.critique.score.toFixed(2)}, ` +
    `${plan.panels.length} panels, ~${storyboardWords(plan)} spoken words)`,
  );
  await putObject(
    checkpointKey,
    Buffer.from(JSON.stringify({ version: SCRIBE_STORYBOARD_CHECKPOINT_VERSION, storyboard: plan })),
    { contentType: "application/json" },
  );
  return plan;
}

export const whiteboardScribe: Block = {
  id: "whiteboard_scribe",
  consumes: ["topic"],
  produces: ["videoKey", "videoLocalPath", "videoDurationSec", "narrationText"],
  paid: true,
  run: async (ctx) => {
    if (!hasWhiteboardSync() || !hasNovitaRenderFarmConfig()) {
      throw new Error("whiteboard_scribe: storyboard/TTS plus the attested Novita render farm are required (no fallback)");
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
    // IDENTITY WIRING: the designer threads the channel's cast ElevenLabs voice
    // + dark/chalk board mode + palette into these params (they used to be unset
    // → every scribe rendered the light "history" marker style in a Fish default
    // voice regardless of the channel's DNA and audition winner).
    const ttsProvider = String(ctx.params["ttsProvider"] ?? ctx.store["ttsProvider"] ?? "fish");
    const elevenVoiceId = ctx.params["elevenVoiceId"] as string | undefined;
    const boardMode = (ctx.params["boardMode"] as "white" | "chalk" | undefined) ?? undefined;
    const palette =
      (ctx.params["palette"] as string[] | undefined) ??
      (ctx.store["palette"] as string[] | undefined) ??
      undefined;
    const width = Math.max(1280, Math.min(2560, Number(ctx.params["width"] ?? 1920)));
    const height = Math.round((width * 9) / 16);
    // LENGTH: the wizard's lengthMinutes never reached this engine — it sized
    // itself from its own defaults (6 panels / 150 words ≈ one minute) no
    // matter what the operator chose. targetSeconds (designer-set) converts to
    // the scribe's real levers: spoken-word budget (~2.1 w/s at whiteboard
    // pacing incl. draw holds) + one panel per ~22s.
    const targetSeconds = Math.max(0, Number(ctx.params["targetSeconds"] ?? 0));
    const panels = targetSeconds > 0 ? Math.max(4, Math.min(16, Math.round(targetSeconds / 22))) : undefined;
    // Calibrated on TWO live renders: Fish speaks the scribe scripts at
    // ~3.7-3.9 w/s (468 words -> ~120s narration). 3.1 w/s budgets words so
    // narration + draw-holds lands ~95% of target instead of -30%.
    const targetWords = targetSeconds > 0 ? Math.round(targetSeconds * 3.1) : undefined;
    if (targetSeconds > 0) {
      ctx.log(`whiteboard_scribe: sized to ~${targetSeconds}s → ${panels} panels / ~${targetWords} words`);
    }

    // Prove the entire primary + recovery image envelope before planning or
    // rendering the first layer. A custom/legacy invocation with no signed
    // stage reservation now fails closed instead of consuming the run budget
    // one panel at a time.
    const novitaEnvelope = whiteboardNovitaImageStageEnvelope(
      panels ?? whiteboardPanelCount(undefined),
      ctx.stageBudgetUsd,
    );
    ctx.log(
      `whiteboard_scribe: admitted ${novitaEnvelope.imageJobs} bounded Novita image worker(s) ` +
      `($${novitaEnvelope.imageMaxCostUsd.toFixed(4)} within the signed stage budget)`,
    );

    // DETERMINISTIC dir (scoped): whiteboardSync's per-layer art cache is
    // path-keyed — a random mkdtemp meant every Trigger retry/self-heal
    // regenerated all 18-30 paid art layers from scratch.
    const runDir = await makeRunTempDir(ctx.runId, "whiteboard_scribe");
    const outPath = join(runDir, "final.mp4");
    ctx.log(`whiteboard_scribe: drawing synced explainer "${topic.slice(0, 60)}" @ ${width}x${height} (style ${styleId})…`);

    let novitaImageCostUsd = 0;
    const generateImage = createAttestedNovitaImageGenerator<WhiteboardArtRequest>({
      prefix: `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/whiteboard-art`,
      id: (request) => request.id,
      profileId: "production",
      // The aggregate admission above reserves the full sequence. Each
      // individual worker receives only its own conservative lifecycle cap.
      maxCostUsd: PRICE.novitaImageMaxUsd,
      lifecycle: {
        ownerId: ctx.ownerId,
        channelId: ctx.channelId,
        runId: ctx.runId,
        blockId: "whiteboard_scribe",
      },
      onReceipt: (receipt) => { novitaImageCostUsd += receipt.costUsd; },
    });
    const brief: WhiteboardSyncBrief = {
      topic, facts, styleId, artStyle: visualBrief?.promptStyle,
      header: visualBrief?.header, voiceId, width, height,
      ...(ttsProvider === "elevenlabs" && elevenVoiceId ? { ttsProvider, elevenVoiceId } : {}),
      ...(boardMode ? { boardMode } : {}),
      ...(palette ? { palette } : {}),
      ...(panels ? { panels } : {}),
      ...(targetWords ? { targetWords } : {}),
    };
    // QUALITY GATE — settle the storyboard with the Director FIRST, at text
    // prices. castWhiteboardSync below is then called exactly once with the
    // accepted board, so a rejected draft never costs a second paid render.
    const storyboard = await planScribeWithCritique(ctx, brief);
    const res = await castWhiteboardSync({
      brief,
      plan: storyboard,
      runDir,
      outPath,
      generateImage,
      log: (m) => ctx.log(`wb: ${m}`),
    });
    const artCost = ctx.imageUsageAccounting?.().costUsd ?? novitaImageCostUsd;
    const usedEleven = ttsProvider === "elevenlabs" && Boolean(elevenVoiceId);
    const ttsCost =
      (res.ttsCharactersGenerated / 1000) *
      (usedEleven ? PRICE.ttsElevenPerKCharUsd : PRICE.ttsPerKCharUsd);
    // Cache hits return zero generated characters/images: never book a phantom
    // fallback charge merely because this is a paid-capable block.
    const scribeCost = artCost + ttsCost;
    ctx.log(
      `whiteboard_scribe: attested Novita art $${artCost.toFixed(4)} + ` +
      `${res.ttsCharactersGenerated} TTS chars = $${scribeCost.toFixed(4)}`,
    );

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

    // FINAL LOUDNESS: the scribe mux shipped at ~-22 LUFS (quiet vs YT's -14
    // renorm). Audio-only measured loudnorm, video stream copied — same pass
    // the narrated assembler runs. Non-fatal on failure.
    try {
      const { normalizeAudioOnly } = await import("@/lib/ffmpeg");
      const norm = join(runDir, "final_norm.mp4");
      await normalizeAudioOnly(finalPath, norm, -14);
      finalPath = norm;
      ctx.log("whiteboard_scribe: final mix loudness-normalized to -14 LUFS");
    } catch (e) {
      ctx.log(`whiteboard_scribe: loudnorm skipped (non-fatal): ${e instanceof Error ? e.message : e}`);
    }

    const videoKey = `${ctx.keyPrefix}runs/${ctx.runId}/final.mp4`;
    await putObjectFromFile(videoKey, finalPath, { contentType: "video/mp4" });
    const videoDurationSec = Math.round(res.durationMs / 1000);
    await recordAsset(ctx, "video", videoKey, {
      durationSec: videoDurationSec,
      engine: "whiteboard_scribe",
      panels: res.panels.length,
      imageProvider: "novita-z-image-turbo-local",
    });
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
