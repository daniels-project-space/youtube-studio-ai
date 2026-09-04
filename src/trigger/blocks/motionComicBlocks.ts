/**
 * motion_comic — the DRAWN-COMIC visual engine (src/lib/motionComic.ts) as a
 * pipeline block, structural twin of whiteboard_scribe.
 *
 * SELF-CONTAINED like whiteboard_scribe: it writes its own storyboard (Claude),
 * renders character-consistent panel art through bounded attested Novita workers, voices every
 * line (ElevenLabs v3 dialogue), lays a Suno bed, and draws the page with the
 * deterministic python renderer — so it REPLACES the script→narration→footage→
 * assemble chain and produces the final `videoKey` directly.
 *
 * Deterministic draw + camera use no video model; spend is bounded per-panel
 * art + ElevenLabs voices + one music track.
 *
 * RUNTIME NOTE: the renderer shells out to python3 (scripts/mc_page_render.py,
 * which imports scripts/mc_textplace.py) with numpy/Pillow/scikit-image/scipy.
 * Both scripts are baked into the Trigger image via additionalFiles and the
 * pip deps install lazily — castMotionComic preflights ALL of it at $0 spend
 * (src/lib/pydeps.ts) before any paid generation.
 */
import { join } from "node:path";
import { createHash } from "node:crypto";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { COST_PATCH_KEY, type Block, type StageContext } from "@/engine/types";
import { getVisualBrief } from "@/engine/creative/brief";
import { makeRunTempDir } from "@/lib/files";
import { putObject, putObjectFromFile, getObjectBytes } from "@/lib/storage";
import {
  castMotionComic,
  hasMotionComic,
  motionComicImageCallCeiling,
  motionComicOpeningPanelDefect,
  motionComicPanelCount,
  planMotionComicStoryboard,
  type MotionComicBrief,
  type MotionComicImageRequest,
  type MotionComicStoryboard,
} from "@/lib/motionComic";
import type { VisualAtlasIdentityAnchor } from "@/engine/visualAtlasExperiment";
import {
  assertStoryboardCritiqueApproved,
  critiqueStoryboardText,
  unavailableStoryboardCriticVerdict,
} from "@/lib/storyboardCritic";
import {
  channelCritiqueBrief,
  produceAndCritique,
  type ChannelCritiqueContext,
} from "@/engine/critiqueLoop";
import { laneQualityPolicy } from "@/engine/contentLane";
import {
  selfContainedStoryReceiptBindingFromRoute,
  selfContainedStoryReceiptRequiredForRoute,
} from "@/engine/selfContainedStoryReceipt";
import type { CritiquedSelfContainedStory } from "@/engine/selfContainedStoryPlanning";
import { createAttestedNovitaImageGenerator } from "@/lib/novitaMedia";
import { novitaCostEnvelope, type NovitaCostEnvelope } from "@/lib/novitaCostEnvelope";
import { hasNovitaRenderFarmConfig } from "@/lib/novitaRenderFarm";
import { PRICE } from "@/engine/pricing";
import { preflightNarrationPerformance } from "@/lib/narrationPerformance";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { fallbackComicStyle } from "@/lib/identitySpread";

/**
 * Checks the complete primary + bounded-recovery art envelope before the
 * motion-comic engine can provision any direct Novita worker.
 */
export function motionComicNovitaImageStageEnvelope(
  panelCount: unknown,
  stageBudgetUsd: number | undefined,
): NovitaCostEnvelope {
  if (
    typeof stageBudgetUsd !== "number" ||
    !Number.isFinite(stageBudgetUsd) ||
    stageBudgetUsd <= 0
  ) {
    throw new Error("motion_comic requires a positive compiler-signed stage budget before Novita art can start");
  }
  const panels = motionComicPanelCount(panelCount);
  return novitaCostEnvelope({
    label: "motion_comic",
    imageJobs: motionComicImageCallCeiling(panels),
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

/** Fallback per-video spend when counters are unavailable (art + voices + music). */

/**
 * The no-text guard baked into motionComic's DEFAULT_STYLE. A channel style
 * (param or visual brief) REPLACES the default wholesale — without re-adding
 * this clause the model happily bakes lettering into the art, which then
 * collides with the engine's own overlay bubbles.
 */
const NO_TEXT_GUARD =
  "ABSOLUTELY NO speech bubbles, NO captions, NO lettering, NO text of any kind anywhere in the image.";

/* ── PRODUCE → CRITIQUE → REGENERATE for the STORYBOARD (P1-4 follow-up) ──────
 *
 * This block used to hand ONE unreviewed Gemini storyboard straight into
 * castMotionComic, which then bought every panel's art, every dialogue line's
 * ElevenLabs voice and a Suno bed off the back of it. A weak story was only
 * discoverable AFTER the whole budget was spent.
 *
 * The loop sits on the STORYBOARD, never on rendered output — the same reason
 * gen_footage critiques its shot plan:
 *   - Every iteration is a TEXT-only call (planMotionComicStoryboard touches no
 *     image generator, no TTS, no music, no renderer), so a regeneration
 *     CANNOT re-purchase art/voices/music by construction.
 *   - castMotionComic is invoked exactly ONCE, after the loop settles, with the
 *     accepted plan — so a rejection costs a text call, never a second render.
 *   - The accepted storyboard is frozen into a content-addressed, immutable R2
 *     checkpoint keyed by a hash of every planning input. A healer replay or
 *     Trigger retry reloads that exact story, runs ZERO critique calls, and
 *     re-derives byte-identical art prompts, whose content-hash cache then
 *     returns the already-paid-for panels instead of buying them again.
 *   - Hard cap of 2 iterations (one informed retry), lane-tunable downward.
 *   - Critic outage gets only the bounded text retry, then blocks before paid
 *     rendering; deterministic checks still run unconditionally.
 */
const COMIC_STORYBOARD_CHECKPOINT_VERSION = "motion-comic-storyboard/v3";
const MOTION_COMIC_STORYBOARD_PLANNER = {
  id: "motion-comic-structured-storyboard-producer/v1",
  provenance: "Studio non-Google structured producer plus bounded storyboard critic",
} as const;

export type CritiquedMotionComicStoryboard = CritiquedSelfContainedStory & {
  readonly story: MotionComicStoryboard;
};

/** Channel doctrine + lane grounding for this block's critique (P1-1/P1-17). */
function comicCritiqueChannel(ctx: StageContext): ChannelCritiqueContext {
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

function motionComicAtlasIdentity(
  ctx: StageContext,
  resolvedStyle: string | undefined,
): {
  readonly channelIdentityFingerprint: string;
  readonly identityAnchors: readonly VisualAtlasIdentityAnchor[];
} {
  const dna = (ctx.store["styleDNA"] as Partial<import("@/engine/creative/types").StyleDNA> | null | undefined) ?? null;
  const identitySource = {
    channelId: ctx.channelId,
    styleDNA: dna,
    styleGrammar: ctx.store["styleGrammar"] ?? null,
    visualStyle: ctx.store["visualStyle"] ?? null,
    resolvedStyle: resolvedStyle ?? null,
  };
  const channelIdentityFingerprint = sha256Hex(canonicalJson(identitySource));
  const candidates: Array<{ role: VisualAtlasIdentityAnchor["role"]; instruction: string }> = [
    {
      role: "line_language",
      instruction:
        `Every frame uses one identical channel drawing language: ${resolvedStyle?.trim() || String(ctx.store["styleGrammar"] ?? ctx.store["visualStyle"] ??
      // Spread by channel: one hard-coded phrase made every undeclared comic
      // channel draw in an identical hand. Every option is still comic
      // illustration, so the range widens inside the format.
      fallbackComicStyle(String(ctx.store["channelName"] ?? "")))}.`,
    },
    ...(dna?.palette?.length ? [{
      role: "palette" as const,
      instruction: `Every frame preserves the channel palette in this order: ${dna.palette.join(", ")}.`,
    }] : []),
    ...(dna?.recurringSubject?.trim() ? [{
      role: "recurring_subject" as const,
      instruction: `When the recurring subject appears, preserve this exact channel identity without substitution: ${dna.recurringSubject.trim()}.`,
    }] : []),
    ...(dna?.setting?.trim() ? [{
      role: "setting" as const,
      instruction: `All locations remain recognizably inside this channel world and material grammar: ${dna.setting.trim()}.`,
    }] : []),
    ...(dna?.colorGrade?.trim() ? [{
      role: "color_grade" as const,
      instruction: `Apply the same color grade to every frame: ${dna.colorGrade.trim()}.`,
    }] : []),
    ...(dna?.motifs?.length ? [{
      role: "motif" as const,
      instruction: `Carry the channel motifs contextually through the full sequence, not only the opening frames: ${dna.motifs.join(", ")}.`,
    }] : []),
  ];
  const identityAnchors = candidates.slice(0, 32).map((candidate, index): VisualAtlasIdentityAnchor => {
    const instruction = candidate.instruction.replace(/\s+/gu, " ").trim().slice(0, 1_600);
    const sourceFingerprint = sha256Hex(canonicalJson({
      channelIdentityFingerprint,
      role: candidate.role,
      instruction,
    }));
    return {
      id: `${candidate.role}-${String(index + 1).padStart(2, "0")}-${sourceFingerprint.slice(0, 16)}`,
      role: candidate.role,
      instruction,
      sourceFingerprint,
    };
  });
  return Object.freeze({ channelIdentityFingerprint, identityAnchors });
}

function storyboardWords(plan: MotionComicStoryboard): number {
  return plan.panels.reduce(
    (total, panel) => total + panel.lines.reduce((n, line) => n + line.text.trim().split(/\s+/).filter(Boolean).length, 0),
    0,
  );
}

/**
 * DETERMINISTIC defects, computed in code per critiqueLoop's design rule — the
 * Director is never asked to count panels, words or duplicate shots.
 */
export function motionComicStoryboardDefects(
  plan: MotionComicStoryboard,
  wantPanels: number,
  targetSeconds: number,
): string[] {
  const issues: string[] = [];
  if (plan.panels.length < wantPanels) {
    issues.push(`only ${plan.panels.length} of the ${wantPanels} requested panels came back — write exactly ${wantPanels}`);
  }
  if (plan.characters.length < 2) {
    issues.push(`only ${plan.characters.length} named character(s) were cast — cast 2-4 so the panels can hold real dialogue`);
  }
  const openingDefect = motionComicOpeningPanelDefect(plan);
  if (openingDefect) issues.push(openingDefect);
  const castIds = new Set(plan.characters.map((character) => character.id));
  plan.panels.forEach((panel, index) => {
    if (!panel.lines.length) {
      issues.push(`panel ${index + 1} has no lines — every panel needs at least a narrator beat`);
      return;
    }
    // An unknown speaker is silently re-voiced as the narrator by the engine,
    // so the character's bubble is bought in the wrong voice. Catch it here.
    const stray = panel.lines.find((line) => line.speaker !== "narrator" && !castIds.has(line.speaker));
    if (stray) {
      issues.push(`panel ${index + 1} gives a line to "${stray.speaker}", who is not in the cast — use "narrator" or a cast character id`);
    }
    const longBubble = panel.lines.find(
      (line) => line.speaker !== "narrator" && line.text.trim().split(/\s+/).filter(Boolean).length > 12,
    );
    if (longBubble) {
      issues.push(`panel ${index + 1}'s "${longBubble.speaker}" bubble is over 12 words — speech bubbles must stay short or they cover the art`);
    }
  });
  // Shot variety: a story drawn entirely in one shot scale reads as a slideshow.
  const shots = new Set(plan.panels.map((panel) => panel.shot));
  if (plan.panels.length >= 4 && shots.size < 2) {
    issues.push(`every panel is a "${plan.panels[0]?.shot}" shot — vary wide/medium/close so the page has rhythm`);
  }
  // Consecutive panels that share environment + action + mood produce two
  // near-identical paid images.
  for (let i = 1; i < plan.panels.length; i++) {
    const previous = plan.panels[i - 1].visual;
    const current = plan.panels[i].visual;
    if (
      previous.environment === current.environment &&
      previous.action === current.action &&
      previous.mood === current.mood &&
      plan.panels[i - 1].shot === plan.panels[i].shot
    ) {
      issues.push(`panels ${i} and ${i + 1} share the same environment, action, mood AND shot — they will render as duplicate art`);
    }
  }
  // Length: the storyboard prompt asks for ~2.6 spoken words/second. A plan far
  // under target renders a video far shorter than the operator asked for.
  if (targetSeconds > 0) {
    const want = targetSeconds * 2.6;
    const got = storyboardWords(plan);
    if (got < want * 0.65) {
      issues.push(`the whole story is only ~${got} spoken words but needs ~${Math.round(want)} to run ${targetSeconds}s — give the narrator more vivid prose per panel`);
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
  plan: MotionComicStoryboard;
  topic: string;
  channel: ChannelCritiqueContext;
}): Promise<{ score: number; pass: boolean; issues: string[] } | null> {
  return critiqueStoryboardText({
    label: "comic-book storyboard",
    topic: args.topic,
    costWarning: "Producing this storyboard is expensive and irreversible — reject a story that would waste it.",
    candidate:
      channelCritiqueBrief(args.channel) +
      `\nTITLE: ${args.plan.title}\nLOGLINE: ${args.plan.logline}\n` +
      `CAST: ${args.plan.characters.map((character) => `${character.id} (${character.name})`).join(", ") || "none"}\n` +
      `THE STORYBOARD (${args.plan.panels.length} panels):\n` +
      args.plan.panels
        .map((panel, index) =>
          `${index + 1}. [${panel.shot}] ${panel.visual.environment}/${panel.visual.action}/${panel.visual.mood}\n` +
          panel.lines.map((line) => `   ${line.speaker}: ${line.text}`).join("\n"),
        )
        .join("\n"),
    rubric:
      "Judge only: (a) a real dramatic arc with a strong hook, rising tension, a turn, and a resonant ending; " +
      "(b) every panel advances the story rather than restating the previous one; " +
      "(c) narrator prose carries a coherent through-line and character bubbles sound like people, not exposition; " +
      "(d) every visual is a concrete drawable moment matching its lines; and " +
      "(e) the story is accurate to the topic and would hold a viewer to the last panel.",
  });
}

function storyboardCheckpointKey(ctx: StageContext, inputs: unknown): string {
  const hash = createHash("sha256").update(JSON.stringify(inputs)).digest("hex").slice(0, 32);
  return `${ctx.keyPrefix}runs/${ctx.runId}/storyboards/motion-comic-${hash}.json`;
}

async function loadStoryboardCheckpoint(key: string): Promise<CritiquedMotionComicStoryboard | null> {
  try {
    const parsed = JSON.parse(Buffer.from(await getObjectBytes(key)).toString("utf8")) as {
      version?: unknown;
      outcome?: Partial<CritiquedMotionComicStoryboard>;
    };
    if (parsed.version !== COMIC_STORYBOARD_CHECKPOINT_VERSION) return null;
    const outcome = parsed.outcome;
    const storyboard = outcome?.story as MotionComicStoryboard | undefined;
    if (!storyboard || !Array.isArray(storyboard.panels) || !storyboard.panels.length) return null;
    if (!Array.isArray(storyboard.characters)) return null;
    if (storyboard.panels.some((panel) => !Array.isArray(panel.lines) || !panel.lines.length)) return null;
    const critique = outcome?.critique;
    if (
      critique?.accepted !== true
      || !Number.isFinite(critique.score)
      || !Number.isInteger(critique.iterations)
      || critique.iterations < 1
      || !Array.isArray(critique.issues)
      || typeof outcome?.planner?.id !== "string"
      || !outcome.planner.id.trim()
      || typeof outcome.planner.provenance !== "string"
      || !outcome.planner.provenance.trim()
    ) return null;
    return {
      story: storyboard,
      planner: { id: outcome.planner.id, provenance: outcome.planner.provenance },
      critique: {
        accepted: true,
        score: critique.score,
        iterations: critique.iterations,
        issues: critique.issues.filter((issue): issue is string => typeof issue === "string"),
      },
    };
  } catch {
    return null;
  }
}

/**
 * Write the storyboard with the Director in the loop, then FREEZE it. The only
 * caller renders the returned storyboard exactly once and nothing else.
 */
export async function planComicWithCritique(
  ctx: StageContext,
  brief: MotionComicBrief,
): Promise<CritiquedMotionComicStoryboard> {
  const channel = comicCritiqueChannel(ctx);
  const wantPanels = motionComicPanelCount(brief.panels);
  const targetSeconds = Number(brief.targetSeconds ?? 0) || 0;
  const checkpointKey = storyboardCheckpointKey(ctx, {
    contract: COMIC_STORYBOARD_CHECKPOINT_VERSION,
    topic: brief.topic,
    facts: brief.facts ?? null,
    panels: wantPanels,
    style: brief.style ?? null,
    targetSeconds,
    criticDoctrine: channel.criticDoctrine ?? null,
    contentLaneKey: channel.contentLaneKey ?? null,
  });

  const cached = await loadStoryboardCheckpoint(checkpointKey);
  if (cached) {
    ctx.log(`motion_comic: reused the frozen storyboard (${cached.story.panels.length} panels) — no re-planning, no re-render`);
    return cached;
  }

  const laneQuality = laneQualityPolicy(ctx.store["contentLane"]);
  const maxIters = Math.max(1, Math.min(2, laneQuality.maxCritiqueIters));

  const loop = await produceAndCritique<MotionComicStoryboard>({
    label: "motion_comic storyboard",
    threshold: laneQuality.critiqueThreshold,
    maxIters,
    log: (message) => ctx.log(message),
    channel,
    // TEXT ONLY. planMotionComicStoryboard reaches no image/voice/music
    // provider, so no iteration here can spend render money.
    produce: (priorIssues) => planMotionComicStoryboard(brief, (m) => ctx.log(`mc-plan: ${m}`), priorIssues),
    critique: async (plan, iter) => {
      const hard = motionComicStoryboardDefects(plan, wantPanels, targetSeconds);
      const graded = await gradeStoryboard({ plan, topic: brief.topic, channel });
      if (!graded) {
        ctx.log(`motion_comic: creative-text storyboard critic unavailable — candidate ${iter} remains blocked before paid rendering`);
        return unavailableStoryboardCriticVerdict(hard);
      }
      const issues = [...hard, ...graded.issues].slice(0, 8);
      const pass = graded.pass && hard.length === 0;
      if (!pass) {
        ctx.log(
          `motion_comic: storyboard ${iter} REJECTED (${issues.slice(0, 2).join("; ").slice(0, 160)})` +
          (iter < maxIters ? " — rewriting with the defects fed back (text only, no render)" : " — iteration cap reached"),
        );
      }
      const score = Math.max(0, graded.score - Math.min(0.5, hard.length * 0.1));
      return { score, pass, issues };
    },
  });

  assertStoryboardCritiqueApproved({
    label: "motion_comic",
    accepted: loop.accepted,
    score: loop.critique.score,
    issues: loop.critique.issues,
  });
  const story = loop.value;
  if (!story.panels.length) throw new Error("motion_comic: storyboard writer returned no panels");
  ctx.log(
    `motion_comic: storyboard settled after ${loop.iterations} candidate(s) ` +
    `(${loop.accepted ? "accepted" : "best of the rejected set"}, score ${loop.critique.score.toFixed(2)}, ` +
    `${story.panels.length} panels, ~${storyboardWords(story)} spoken words)`,
  );
  const outcome: CritiquedMotionComicStoryboard = {
    story,
    planner: MOTION_COMIC_STORYBOARD_PLANNER,
    critique: {
      accepted: true,
      score: loop.critique.score,
      iterations: loop.iterations,
      issues: loop.critique.issues,
    },
  };
  await putObject(
    checkpointKey,
    Buffer.from(JSON.stringify({ version: COMIC_STORYBOARD_CHECKPOINT_VERSION, outcome })),
    { contentType: "application/json" },
  );
  return outcome;
}

export const motionComicBlock: Block = {
  id: "motion_comic",
  consumes: ["topic"],
  produces: [
    "videoKey", "videoLocalPath", "videoDurationSec", "narrationText", "motionComicTimeline",
    "narrationKey", "narrationLocalPath", "narrationDurationSec", "narrationTranscriptText",
    "narrationPerformanceEvidence", "sentenceTimings", "narrationStartSec",
    "motionComicVisualAtlasPlanKey", "motionComicVisualAtlasPlanFingerprint",
  ],
  paid: true,
  run: async (ctx) => {
    const topic = String(ctx.store["topic"] ?? "");
    if (!topic) throw new Error("motion_comic: no topic in store");
    // Bind a supplied approved story before any capability check, cache, or
    // legacy planning branch. A receipt can never degrade into a new comic
    // storyboard if its frozen route/topic is invalid.
    const approvedStoryReceipt = ctx.store["selfContainedStoryReceipt"];
    if (
      approvedStoryReceipt === undefined &&
      ctx.store["channelProgramRoute"] !== undefined &&
      selfContainedStoryReceiptRequiredForRoute({
        family: "comic",
        route: ctx.store["channelProgramRoute"],
        topic,
      })
    ) {
      throw new Error("motion_comic: this route requires its sealed self-contained story receipt before planning or rendering");
    }
    const receiptInput = approvedStoryReceipt === undefined
      ? {}
      : {
          approvedStoryReceipt,
          storyReceiptBinding: selfContainedStoryReceiptBindingFromRoute({
            family: "comic",
            route: ctx.store["channelProgramRoute"],
            topic,
          }),
        };
    if (!hasMotionComic({ requiresStoryboard: approvedStoryReceipt === undefined }) || !hasNovitaRenderFarmConfig()) {
      throw new Error("motion_comic: required voice and attested Novita render capabilities are unavailable");
    }

    // Grounding facts: prefer real research notes; else the channel's fact sheet.
    const facts =
      (ctx.store["researchNotes"] as string | undefined) ||
      (ctx.store["factSheet"] as string | undefined) ||
      undefined;
    const visualBrief = getVisualBrief(ctx.store);

    const panels = motionComicPanelCount(ctx.params["panels"]);
    // A full panel sequence is an all-or-nothing visual story. Admit every
    // primary/recovery worker before the text storyboard or first paid frame,
    // so malformed/direct invocations cannot strand a partial comic.
    const novitaEnvelope = motionComicNovitaImageStageEnvelope(
      panels,
      ctx.stageBudgetUsd,
    );
    ctx.log(
      `motion_comic: admitted ${novitaEnvelope.imageJobs} bounded Novita image worker(s) ` +
      `($${novitaEnvelope.imageMaxCostUsd.toFixed(4)} within the signed stage budget)`,
    );
    // Style: explicit param wins; else the DP's promptStyle; else the engine's
    // curated default (undefined → motionComic's DEFAULT_STYLE). Any custom
    // style gets the no-text guard re-appended.
    const styleParam = typeof ctx.params["style"] === "string" ? (ctx.params["style"] as string).trim() : "";
    const styleBase = (styleParam || visualBrief?.promptStyle || "").replace(/[.\s]+$/, "");
    const style = styleBase ? `${styleBase}. ${NO_TEXT_GUARD}` : undefined;
    const width = Math.max(1280, Math.min(2560, Number(ctx.params["width"] ?? 1920)));
    const layoutRepair = Array.isArray(ctx.store["visualRepair"])
      ? ctx.store["visualRepair"].flatMap((signal) => {
          if (!signal || typeof signal !== "object") return [];
          const repair = signal as {
            owner?: unknown;
            action?: unknown;
            targetId?: unknown;
            forbiddenRects?: unknown;
          };
          if (repair.owner !== "motion_comic" || repair.action !== "reflow_bubble") return [];
          const forbiddenRects = Array.isArray(repair.forbiddenRects)
            ? repair.forbiddenRects.flatMap((rect) => Array.isArray(rect) && rect.length >= 4
              ? [rect.slice(0, 4).map(Number) as [number, number, number, number]]
              : [])
            : [];
          const panelMatch = typeof repair.targetId === "string" ? repair.targetId.match(/^p(\d+)-b\d+$/) : null;
          return [{
            action: "reflow_bubble" as const,
            ...(panelMatch ? { panelIndex: Number(panelMatch[1]) } : {}),
            ...(typeof repair.targetId === "string" ? { targetId: repair.targetId } : {}),
            forbiddenRects,
          }];
        })
      : [];
    if (layoutRepair.length) {
      ctx.log(`motion_comic: layout-only repair for ${layoutRepair.length} reviewed bubble(s); reusing cached art, voices, and music`);
    }

    // DETERMINISTIC dir (scoped): motionComic's plan/sheet/panel/line caches
    // are path-keyed — a random mkdtemp would make every Trigger retry
    // regenerate all paid art + voices from scratch.
    const runDir = await makeRunTempDir(ctx.runId, "motion_comic");
    const outPath = join(runDir, "final.mp4");
    ctx.log(`motion_comic: drawing "${topic.slice(0, 60)}" — ${panels} panels @ ${width}w…`);

    let novitaImageCostUsd = 0;
    const generateImage = createAttestedNovitaImageGenerator<MotionComicImageRequest>({
      prefix: `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/motion-comic-art`,
      id: (request) => request.id,
      profileId: "production",
      // The aggregate admission above proves the whole comic fits. A worker
      // itself must still never receive the unrelated whole-stage/run budget.
      maxCostUsd: PRICE.novitaImageMaxUsd,
      lifecycle: {
        ownerId: ctx.ownerId,
        channelId: ctx.channelId,
        runId: ctx.runId,
        blockId: "motion_comic",
      },
      onReceipt: (receipt) => { novitaImageCostUsd += receipt.costUsd; },
    });
    const brief: MotionComicBrief = {
      topic,
      facts,
      panels,
      style,
      width,
      targetSeconds: Number(ctx.params["targetSeconds"] ?? 0) || undefined,
      ...(layoutRepair.length ? { layoutRepair } : {}),
    };
    const atlasIdentity = motionComicAtlasIdentity(ctx, style);
    let motionComicVisualAtlasPlanKey: string | undefined;
    let motionComicVisualAtlasPlanFingerprint: string | undefined;
    // QUALITY GATE — settle the storyboard with the Director FIRST, at text
    // prices. castMotionComic below is then called exactly once with the
    // accepted story, so a rejected draft never costs a second paid render.
    const storyboard = approvedStoryReceipt === undefined
      ? (await planComicWithCritique(ctx, brief)).story
      : undefined;
    const res = await castMotionComic({
      brief,
      ...(storyboard === undefined ? {} : { plan: storyboard }),
      ...receiptInput,
      runDir,
      outPath,
      generateImage,
      visualAtlasExperiment: {
        ownerId: ctx.ownerId,
        channelId: ctx.channelId,
        channelIdentityFingerprint: atlasIdentity.channelIdentityFingerprint,
        identityAnchors: atlasIdentity.identityAnchors,
      },
      onVisualAtlasExperimentPlan: async (plan) => {
        const key = `${ctx.keyPrefix}runs/${ctx.runId}/experiments/motion-comic-visual-atlas-${plan.fingerprint}.json`;
        await putObject(key, Buffer.from(JSON.stringify(plan)), { contentType: "application/json" });
        await recordAsset(ctx, "visual_atlas_experiment_plan", key, {
          fingerprint: plan.fingerprint,
          useCase: plan.useCase,
          frameCount: plan.frameCount,
          variants: plan.variants.map((variant) => ({
            gridSize: variant.gridSize,
            tilePixels: variant.tilePixels,
            geometryStatus: variant.geometryStatus,
            plannedProviderCalls: variant.plannedProviderCalls,
          })),
          providerSpend: 0,
          productionRouteChanged: false,
        });
        motionComicVisualAtlasPlanKey = key;
        motionComicVisualAtlasPlanFingerprint = plan.fingerprint;
        ctx.log(`motion_comic: persisted zero-spend visual-atlas experiment plan ${plan.fingerprint.slice(0, 12)}`);
      },
      log: (m) => ctx.log(`mc: ${m}`),
    });
    const narrationPerformanceEvidence = await preflightNarrationPerformance({
      audioPath: res.narrationPath,
      text: res.narrationText,
      speed: 1,
    });
    const narrationKey = `${ctx.keyPrefix}runs/${ctx.runId}/motion-comic-narration.mp3`;
    await putObjectFromFile(narrationKey, res.narrationPath, { contentType: "audio/mpeg" });
    await recordAsset(ctx, "narration", narrationKey, {
      durationSec: narrationPerformanceEvidence.durationSec,
      engine: "motion_comic",
      source: "pre-mix voice-only master",
    });
    const artCost = ctx.imageUsageAccounting?.().costUsd ?? novitaImageCostUsd;
    const ttsCost =
      (res.ttsCharactersGenerated / 1000) * PRICE.ttsElevenPerKCharUsd;
    const musicCost = res.musicGenerations * PRICE.musicTrackUsd;
    const graderCost = res.visionGraderCalls * PRICE.visionGraderUsd;
    // Every component is invocation-local. A fully cached resume is exactly
    // zero instead of the old phantom $0.10 fallback charge.
    const comicCost = artCost + ttsCost + musicCost + graderCost;
    ctx.log(
      `motion_comic: attested Novita art $${artCost.toFixed(4)}, ` +
      `${res.ttsCharactersGenerated} TTS chars, ${res.musicGenerations} music, ` +
      `${res.visionGraderCalls} graders = $${comicCost.toFixed(4)}`,
    );

    const videoKey = `${ctx.keyPrefix}runs/${ctx.runId}/final.mp4`;
    await putObjectFromFile(videoKey, res.outPath, { contentType: "video/mp4" });
    const videoDurationSec = Math.round(res.durationMs / 1000);
    await recordAsset(ctx, "video", videoKey, {
      durationSec: videoDurationSec,
      engine: "motion_comic",
      panels: res.panels,
      imageProvider: "novita-z-image-turbo-local",
    });
    ctx.log(`motion_comic ✓ → ${videoKey} (${videoDurationSec}s, ${res.panels} panels)`);

    return {
      videoKey,
      videoLocalPath: res.outPath,
      videoDurationSec,
      narrationText: res.narrationText,
      narrationKey,
      narrationLocalPath: res.narrationPath,
      narrationDurationSec: narrationPerformanceEvidence.durationSec,
      narrationTranscriptText: res.narrationText,
      narrationPerformanceEvidence,
      sentenceTimings: res.sentenceTimings,
      narrationStartSec: res.narrationStartSec,
      motionComicTimeline: res.reviewTimeline,
      ...(motionComicVisualAtlasPlanKey ? { motionComicVisualAtlasPlanKey } : {}),
      ...(motionComicVisualAtlasPlanFingerprint ? { motionComicVisualAtlasPlanFingerprint } : {}),
      [COST_PATCH_KEY]: comicCost,
    };
  },
};

export const motionComicBlocks: Block[] = [motionComicBlock];
