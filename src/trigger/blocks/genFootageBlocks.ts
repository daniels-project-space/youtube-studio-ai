/**
 * gen_footage — GENERATED b-roll: the visual engine for channels whose world
 * CANNOT come from a stock library (whiteboard draw-ons, painted worlds,
 * signature scenes). Drop-in producer-compatible with stock_footage (same
 * `footageClips` contract → timeline_assemble just works), so the designer/
 * architect can SWAP stock for generation per channel identity.
 *
 * Per scene: a validated shared story plan → the admitted image/video route.
 * Fresh generic and source-bound Casefile scenes use native MiniMax H3.
 * Central runtime admission owns the concrete model identity; the historical
 * LTX adapter remains available only for explicitly retained legacy receipts.
 */
import type { Block } from "@/engine/types";
import { boundedInteger, boundedNumber } from "@/engine/boundedNumber";
import { join } from "node:path";
import {
  DURABLE_RENDER_OUTPUT_DOWNLOAD_TIMEOUT_MS,
  makeRunTempDir,
  downloadTo,
  readBytes,
  writeBytes,
} from "@/lib/files";
import { getObjectBytes, presignDownload, putObject } from "@/lib/storage";
import {
  renderNovitaGeneratedScenes,
  renderNovitaImage,
  type NovitaClipReviewCheckpoint,
  type NovitaGeneratedScene,
  type NovitaKeyframeReviewCheckpoint,
  type NovitaRenderedScene,
} from "@/lib/novitaMedia";
import { applyNameCardOverlay } from "@/lib/ffmpeg";
import { kenBurns, applyHyperframesOverlayClip } from "@/lib/ffmpeg";
import { probe } from "@/lib/ffmpeg";
import { searchWikimediaImage } from "@/lib/wikimedia";
import { renderOverlay, selectAutomaticEvidenceOverlayShots, type OverlayTemplateId } from "@/lib/hyperframesOverlay";
import { footageOnScreenTextCues } from "@/lib/footageOnScreenTextCues";
import { hasNonGoogleVisionKey } from "@/lib/vision";
import { requireNovitaStageBudget } from "@/lib/novitaCostEnvelope";
import { reviewCinematicKeyframe } from "@/lib/cinematicKeyframeGate";
import { reviewCinematicClip } from "@/lib/cinematicClipGate";
import { reviewCinematicTransition } from "@/lib/cinematicTransitionGate";
import { LtxCreativeAdapterInputSchema } from "@/lib/ltxCreativeAdapter";
import { resolveApprovedSourceProofMedia } from "@/lib/sourceProofMedia";
import { FAMILIES } from "@/engine/families";
import { selectLtxStyleForChannel } from "@/engine/ltxStylePresets";
import { SceneManifestSchema } from "@/engine/episodeGraph";
import { StorySpineSchema, type ShotPlan, validateStorySpine } from "@/engine/storySpine";
import { CinematicGeneratedScenePlanSchema } from "@/engine/cinematicCaseSequence";
import { assertCinematicFinalMasterQaAdmission } from "@/engine/cinematicFinalMasterQaAdmission";
import {
  createVisualArtifactAttempt,
  visualArtifactReviewRejectionFingerprint,
} from "@/engine/visualArtifactAttemptLedger";
import {
  CINEMATIC_KEYFRAME_REVIEW_VERSION,
} from "@/engine/cinematicKeyframeReview";
import {
  CINEMATIC_CLIP_REVIEW_VERSION,
  type MiniMaxH3OpeningMotionQaEvidence,
} from "@/engine/cinematicClipReview";
import {
  GENERATED_FOOTAGE_SCENE_MANIFEST_VERSION,
  GeneratedFootageSceneManifestSchema,
} from "@/engine/generatedFootageManifest";
import type {
  SourceProofMediaObligation,
  SourceProofMediaReceipt,
} from "@/engine/sourceProofMedia";
import {
  classifyVisualArtifactReviewOutcome,
  type VisualArtifactReviewRejection,
} from "@/engine/visualArtifactReviewOutcome";
import { COST_PATCH_KEY } from "@/engine/types";
import type { PlanWeekPreparedFootage } from "@/lib/planWeekPreparation";
import { sha256BytesHex, sha256Hex } from "@/lib/sha256";
import {
  MINIMAX_H3_MANIFEST_SHA256,
  MINIMAX_H3_PROFILE,
  MINIMAX_H3_RUNTIME_ID,
  assertMiniMaxH3R2ModelManifest,
  buildMiniMaxH3SceneRequest,
  minimaxH3Readiness,
  renderMiniMaxH3,
  type MiniMaxH3Execution,
  type MiniMaxH3Provider,
} from "@/lib/minimaxH3";
import {
  assertMiniMaxH3OpeningMotionQa,
  MiniMaxH3OpeningMotionRejectedError,
} from "@/lib/minimaxH3OpeningMotionQa";

/**
 * Generic and signature H3 clips do not run the source-bound Casefile visual
 * reviewer. They still need an independent check of the actual moving bytes:
 * a valid container and duration can conceal an initial conditioning-image
 * hold. The caller owns the one bounded repair take; this helper only proves
 * whether a specific delivered take is fit to enter an edit.
 */
async function materializeVerifiedMiniMaxH3Take(args: {
  label: string;
  outputBytes: Uint8Array;
  localPath: string;
  nativeDurationSec: number;
}): Promise<{ localPath: string; openingMotionQa: MiniMaxH3OpeningMotionQaEvidence }> {
  if (args.outputBytes.byteLength < 1_024) {
    throw new Error(`${args.label} returned an undersized native clip`);
  }
  const localPath = await writeBytes(args.localPath, args.outputBytes);
  const measured = await probe(localPath);
  if (
    !measured.hasVideo ||
    !Number.isFinite(measured.durationSec) ||
    Math.abs(measured.durationSec - args.nativeDurationSec) > 0.08
  ) {
    throw new Error(`${args.label} failed native video/duration verification`);
  }
  const openingMotionQa = assertMiniMaxH3OpeningMotionQa({
    videoPath: localPath,
    durationSec: measured.durationSec,
    fps: MINIMAX_H3_PROFILE.fps,
    label: args.label,
  });
  return { localPath, openingMotionQa };
}

function stableVisualAttemptToken(value: string): string {
  const token = value
    .replace(/[^A-Za-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  if (!token) throw new Error("visual artifact attempt requires a stable scene identifier");
  return token;
}

/** Ordered pool (same as narratedBlocks.mapPool — local copy, no cross-import). */
async function pool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
      for (;;) {
        const idx = next++;
        if (idx >= items.length) return;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

/**
 * Mark paid work that is not represented by the runner's model/image scopes.
 * The runner adds this amount after reconciling those scopes, exactly once.
 */
function withAdditionalObservedCost(error: unknown, costUsd: number): Error {
  const source = error instanceof Error ? error : new Error(String(error));
  if (!Number.isFinite(costUsd) || costUsd <= 0) return source;
  const target = Object.isExtensible(source)
    ? source
    : Object.assign(new Error(source.message), { cause: source });
  const previous = (target as { additionalObservedCostUsd?: unknown }).additionalObservedCostUsd;
  const previousCost = typeof previous === "number" && Number.isFinite(previous) && previous > 0
    ? previous
    : 0;
  return Object.assign(target, {
    additionalObservedCostUsd: previousCost + costUsd,
    // A whole-block retry would buy the accepted clips again. Recovery should
    // resume from persisted outputs instead of silently duplicating spend.
    retryable: false,
  });
}

/* ── SHARED SCENE-PLAN ADAPTER ───────────────────────────────────────────────
 *
 * This module is intentionally a renderer, not a free-form scene director.
 * It accepts only the already validated plans emitted by the reusable
 * `story_spine` or `episode_graph` modules. That keeps the prompts source- and
 * continuity-grounded, avoids a second model call that can drift from the
 * editor's timing, and means no paid image/video call can begin without a
 * durable planning receipt.
 */
export interface PlannedScene {
  id: string;
  still: string;
  /** Optional reviewed target for the H3 endpoint QA anchor. */
  terminalStill?: string;
  motion: string;
  /** Physical sound that belongs in this take; narration is mixed separately. */
  diegeticSoundscape?: string;
  durationSec: number;
  cameraMove: ShotPlan["cameraMove"];
  shotScale: ShotPlan["shotScale"];
  lens: string;
  negative?: string;
  /** Exact source timing exists only for a reviewed cinematic sequence. */
  t0?: number;
  t1?: number;
  /** Reused by the independent still gate to compare recurring mannequins. */
  continuityIds?: string[];
  /** Exact sealed cast allowed in a Casefile render; [] permits no people/mannequins. */
  expectedCastIds?: string[];
  /** Casefile scenes cannot add bystanders, background people, or mannequins. */
  forbidAdditionalPeople?: true;
  /** Stable image prior emitted from the reviewer-approved cinematic sequence. */
  continuitySeed?: number;
  /** Literal causal/camera obligations that the first frame must visibly meet. */
  keyframeRequirements?: string[];
  /** Incoming editorial reason/state for an adjacent source-bound cut. */
  cutReason?: string;
  tensionState?: string;
  /**
   * Automatic-path character-introduction name card (Story Spine's
   * `ShotPlanSchema.nameCardText`, src/engine/storySpine.ts). Only ever
   * populated from `source: "story_spine"` scenes — the Casefile
   * `cinematic_case_sequence` route carries its own name-card concept
   * end-to-end inside cinematicCaseSequence.ts and does not pass through
   * this field (its clip-order assembler does not exist yet; see
   * applyNameCardOverlay's doc comment in src/lib/ffmpeg.ts). Applied
   * directly to the rendered clip file below, once, before it ever reaches
   * timeline_assemble — no change to that block's proven concat/compose
   * graph is required.
   */
  nameCardText?: string;
  /**
   * REAL-IMAGE INSERT query (Phase 18 Part B; Story Spine's
   * `ShotPlanSchema.realImageInsertQuery`, src/engine/storySpine.ts). When
   * present, `genFootage.run`'s per-scene loop resolves a real photograph
   * via `searchWikimediaImage` (src/lib/wikimedia.ts) and substitutes a
   * short Ken Burns clip of it (`kenBurns`, src/lib/ffmpeg.ts) for this
   * scene's LTX-generated clip entirely, skipping the generated-clip
   * download for that one scene. Only ever populated from
   * `source: "story_spine"` scenes — same convention as `nameCardText`
   * above.
   */
  realImageInsertQuery?: string;
  /** Exact approved external evidence asset; never sent to LTX. */
  sourceProofMedia?: SourceProofMediaObligation;
  /**
   * EVIDENCE OVERLAY selection (Phase 18 Part A). Computed ONCE, up front,
   * across the whole shot list by `selectAutomaticEvidenceOverlayShots`
   * (src/lib/hyperframesOverlay.ts) inside `scenePlanFromStorySpine` below
   * — a budgeted, cross-shot decision (capped at 2/video by that function's
   * own `maxPerVideo`), not a per-shot flag an author sets directly. When
   * present, `genFootage.run` renders and composites a brief HyperFrames
   * case-file-stamp/evidence-tag accent onto this scene's finished clip via
   * `renderOverlay`/`applyHyperframesOverlayClip`. Only ever populated from
   * `source: "story_spine"` scenes — same convention as `nameCardText`
   * above.
   */
  evidenceOverlay?: { templateId: OverlayTemplateId; primary: string; secondary?: string };
}

interface CompositedFootageClip {
  path: string;
  nameCardText?: string;
  evidenceOverlay?: {
    text: string;
    durationSec: number;
  };
}

export interface ResolvedGeneratedFootageScenePlan {
  source: "story_spine" | "scene_manifest" | "cinematic_case_sequence";
  scenes: PlannedScene[];
  /** Binds the rendered clip order to the reviewed cinematic sequence. */
  sequenceFingerprint?: string;
}

/** Explicit renderer identity for consumers during the H3/LTX migration. */
export type GeneratedFootageRenderer =
  | { kind: "minimax-h3"; provider: MiniMaxH3Provider; execution: MiniMaxH3Execution; runtimeId: typeof MINIMAX_H3_RUNTIME_ID; profileId: typeof MINIMAX_H3_PROFILE.id; modelManifestSha256: typeof MINIMAX_H3_MANIFEST_SHA256 }
  | { kind: "novita-ltx"; styleId: string };

/** Prompts that ask for baked-in lettering fight the engine's own no-text clause. */
const TEXT_IN_IMAGE =
  /\b(text|caption|subtitle|title card|lettering|letters|typography|logo|watermark|signage|handwriting)\b/i;
const TEXT_FREE_INSTRUCTION =
  /\b(?:absolutely\s+)?(?:no|without|avoid)\s+(?:text|words?|letters?|captions?|logos?|watermarks?)[^.]*\.?/gi;

function withoutTextSafetyInstruction(value: string): string {
  return value.replace(TEXT_FREE_INSTRUCTION, " ").replace(/\s+/g, " ").trim();
}

function boundedSceneDuration(value: number, fallback: number): number {
  const seconds = Number.isFinite(value) ? value : fallback;
  return Math.min(10, Math.max(3, seconds));
}

function mergedNegativePrompt(...values: Array<string | undefined>): string | undefined {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const value of values) {
    for (const part of (value ?? "").split(",")) {
      const normalized = part.trim();
      if (!normalized || seen.has(normalized.toLowerCase())) continue;
      seen.add(normalized.toLowerCase());
      parts.push(normalized);
    }
  }
  return parts.join(", ") || undefined;
}

function storySpineFromStore(store: Readonly<Record<string, unknown>>) {
  const parsed = StorySpineSchema.safeParse({
    version: "1.0.0",
    timedScript: store["timedScript"],
    narrativeBeats: store["narrativeBeats"],
    continuityLedger: store["continuityLedger"],
    shotList: store["shotList"],
    dpVisualSpecs: store["dpVisualSpecs"],
    editorEdl: store["editorEdl"],
    coverage: store["storyCoverage"],
  });
  if (!parsed.success) return null;
  try {
    return validateStorySpine(parsed.data);
  } catch {
    return null;
  }
}

function scenePlanFromStorySpine(
  store: Readonly<Record<string, unknown>>,
  maxScenes: number,
  defaultDurationSec: number,
): PlannedScene[] | null {
  const spine = storySpineFromStore(store);
  if (!spine) return null;
  const visualSpecs = new Map(spine.dpVisualSpecs.map((spec) => [spec.shotId, spec]));
  const shots = spine.shotList.slice(0, maxScenes);
  // EVIDENCE OVERLAY selection (Phase 18 Part A) needs the FULL candidate
  // list at once — it is a budgeted, cross-shot decision (capped at
  // maxPerVideo, earliest-t0-wins; see selectAutomaticEvidenceOverlayShots's
  // own doc comment in src/lib/hyperframesOverlay.ts) — so it is computed
  // HERE, once, ahead of the per-shot map below, rather than inside it.
  const evidenceOverlayByShotId = new Map(
    selectAutomaticEvidenceOverlayShots(
      shots.map((shot) => ({ id: shot.id, coveragePurpose: shot.coveragePurpose, t0: shot.t0, t1: shot.t1 })),
    ).map((selection) => [selection.shotId, selection]),
  );
  return shots.map((shot) => {
    const spec = visualSpecs.get(shot.id);
    const overlaySelection = evidenceOverlayByShotId.get(shot.id);
    // Grounded in real ShotPlan fields, not invented case data: `section`
    // (e.g. "section-004") becomes a short exhibit-style tag, and `era` is
    // included only when the channel actually set one (its unset value is
    // the literal placeholder sentence assigned in planStorySpine above).
    const primary = shot.section.toUpperCase().replace("SECTION-", "SEC. ");
    const secondary =
      shot.era && shot.era !== "unspecified; obey source sentence" ? shot.era.slice(0, 40) : undefined;
    return {
      id: shot.id,
      still: withoutTextSafetyInstruction(spec?.keyframePrompt ?? shot.prompt),
      motion: spec?.motionPrompt ?? shot.motion,
      diegeticSoundscape: [
        `Only location tone and physical sounds motivated by the visible action: ${spec?.motionPrompt ?? shot.motion}.`,
        "No dialogue, narration, score, lyrics, or invented off-screen event.",
      ].join(" ").slice(0, 900),
      durationSec: boundedSceneDuration(shot.seconds, defaultDurationSec),
      cameraMove: shot.cameraMove,
      shotScale: shot.shotScale,
      lens: shot.lens,
      negative: mergedNegativePrompt(shot.negative, spec?.negativePrompt),
      nameCardText: shot.nameCardText,
      realImageInsertQuery: shot.realImageInsertQuery,
      evidenceOverlay: overlaySelection
        ? { templateId: overlaySelection.templateId, primary, secondary }
        : undefined,
    };
  });
}

const MANIFEST_CAMERA_MOVE: Record<"static" | "push" | "pull" | "pan" | "track" | "orbit", ShotPlan["cameraMove"]> = {
  static: "static",
  push: "dolly_push",
  pull: "dolly_pull",
  pan: "truck_left",
  track: "truck_right",
  orbit: "orbit_left",
};

function scenePlanFromManifest(
  store: Readonly<Record<string, unknown>>,
  maxScenes: number,
  defaultDurationSec: number,
): PlannedScene[] | null {
  const parsed = SceneManifestSchema.safeParse(store["sceneManifest"]);
  if (!parsed.success) return null;
  return parsed.data.scenes.slice(0, maxScenes).map((scene) => ({
    id: scene.id,
    still: [
      scene.label,
      scene.visualState.action,
      scene.visualState.props.length ? `with ${scene.visualState.props.join(", ")}` : "",
      `${scene.camera.framing} framing`,
      `${scene.visualState.mood} mood`,
    ].filter(Boolean).join(". "),
    motion: `${MANIFEST_CAMERA_MOVE[scene.camera.move].replaceAll("_", " ")} while ${scene.visualState.action}. Preserve the same setting, characters, props, and mood.`,
    diegeticSoundscape: [
      `Only location tone and physical sounds motivated by ${scene.visualState.action}`,
      scene.visualState.props.length ? `and the visible props ${scene.visualState.props.join(", ")}` : "",
      ". No dialogue, narration, score, lyrics, or invented off-screen event.",
    ].filter(Boolean).join(" ").slice(0, 900),
    durationSec: boundedSceneDuration(scene.t1 - scene.t0, defaultDurationSec),
    cameraMove: MANIFEST_CAMERA_MOVE[scene.camera.move],
    shotScale: scene.camera.framing,
    lens: scene.camera.framing === "close" ? "85mm portrait" : "35mm natural",
  }));
}

/**
 * Cinematic Case Sequence is deliberately preferred over the generic Story
 * Spine adapter.  It has already split each causal beat into reviewed coverage
 * shots, so truncating, reshuffling, or replacing it with the old modulo
 * camera plan would erase the actual editorial direction before render.
 */
function scenePlanFromCinematicCaseSequence(
  store: Readonly<Record<string, unknown>>,
  maxScenes: number,
): ResolvedGeneratedFootageScenePlan | undefined {
  const raw = store["cinematicGeneratedScenePlan"];
  if (raw === undefined) return undefined;
  const parsed = CinematicGeneratedScenePlanSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      "gen_footage: cinematicGeneratedScenePlan is present but invalid; " +
        "regenerate cinematic_case_sequence rather than falling back to an unrelated scene plan.",
    );
  }
  const plan = parsed.data;
  if (plan.scenes.length > maxScenes) {
    throw new Error(
      `gen_footage: reviewed cinematic sequence requires ${plan.scenes.length} shots, ` +
        `but this run allows ${maxScenes}. Raise maxCinematicClips deliberately with a sufficient Novita stage budget; scenes are never dropped.`,
    );
  }
  return {
    source: "cinematic_case_sequence",
    sequenceFingerprint: plan.sequenceFingerprint,
    scenes: plan.scenes.map((scene) => ({
      id: scene.id,
      still: withoutTextSafetyInstruction(scene.still),
      ...(scene.terminalStill ? { terminalStill: withoutTextSafetyInstruction(scene.terminalStill) } : {}),
      motion: scene.motion,
      diegeticSoundscape: scene.diegeticSoundscape,
      durationSec: scene.durationSec,
      cameraMove: scene.cameraMove,
      shotScale: scene.shotScale,
      lens: scene.lens,
      negative: scene.negative,
      t0: scene.t0,
      t1: scene.t1,
      continuityIds: scene.castIds,
      expectedCastIds: scene.castIds,
      forbidAdditionalPeople: true,
      continuitySeed: scene.continuitySeed,
      cutReason: scene.cutReason,
      tensionState: scene.tensionState,
      ...(scene.sourceProofMedia ? { sourceProofMedia: scene.sourceProofMedia } : {}),
      keyframeRequirements: [
        `treatment ${scene.visualMode}`,
        `coverage ${scene.coveragePurpose}`,
        `cut purpose ${scene.cutReason}; tension ${scene.tensionState}`,
        `camera ${scene.cameraMove}, ${scene.shotScale}, ${scene.lens}`,
        `source claim IDs ${scene.claimIds.join(", ")}`,
      ],
    })),
  };
}

/**
 * Casefile evidence makes the cinematic sequence mandatory.  Its reviewed
 * claim-to-shot map is meaningful only when the resulting multi-shot plan is
 * what reaches the renderer; falling back to a generic Story Spine here would
 * silently discard the approved mannequin, continuity, cut, and source locks.
 */
function hasCasefileCinematicEvidence(store: Readonly<Record<string, unknown>>): boolean {
  return [
    "casefileSourceAdmission",
    "casefileEvidenceShotMap",
    "casefileEvidenceShotMapAdmission",
    "cinematicCaseSequenceInput",
  ].some((key) => store[key] !== undefined);
}

function sharedScenePlanIssues(scenes: readonly PlannedScene[], minScenes: number, avoid: string): string[] {
  const issues: string[] = [];
  if (scenes.length < minScenes) {
    issues.push(`only ${scenes.length} validated scenes are available (need at least ${minScenes})`);
  }
  const banned = avoid.split(",").map((term) => term.trim().toLowerCase()).filter((term) => term.length > 3);
  scenes.forEach((scene, index) => {
    if (scene.still.trim().length < 25) {
      issues.push(`scene ${index + 1}'s still prompt is too thin to render a concrete frame`);
    }
    if (scene.motion.trim().length < 15) {
      issues.push(`scene ${index + 1}'s motion prompt is too thin to animate safely`);
    }
    if (TEXT_IN_IMAGE.test(scene.still)) {
      issues.push(`scene ${index + 1}'s still asks for baked-in text or lettering`);
    }
    const hit = banned.find((term) => scene.still.toLowerCase().includes(term));
    if (hit) issues.push(`scene ${index + 1} plans "${hit}", which this channel must never show`);
  });
  return issues.slice(0, 8);
}

/**
 * Resolve the single source of truth for legacy generated-footage prompts.
 * There is intentionally no free-form planner fallback: callers must add
 * `story_spine`/`episode_graph` upstream before paid generation can begin.
 */
export function resolveGeneratedFootageScenePlan(args: {
  store: Readonly<Record<string, unknown>>;
  label: string;
  maxScenes: number;
  minScenes: number;
  defaultDurationSec: number;
  avoid?: string;
}): ResolvedGeneratedFootageScenePlan {
  // The renderer itself executes only <=24-shot transactions.  Cinematic
  // sequences are batch-rendered below, so their admission limit is higher;
  // legacy callers still pass their existing <=24 caps.
  const maxScenes = Math.max(1, Math.min(240, Math.floor(args.maxScenes)));
  const cinematic = scenePlanFromCinematicCaseSequence(args.store, maxScenes);
  if (cinematic) {
    const issues = sharedScenePlanIssues(cinematic.scenes, args.minScenes, args.avoid ?? "");
    if (issues.length) {
      throw new Error(`${args.label}: cinematic sequence failed pre-render validation: ${issues.join("; ")}`);
    }
    return cinematic;
  }
  if (hasCasefileCinematicEvidence(args.store)) {
    throw new Error(
      `${args.label}: Casefile evidence is present but its admitted cinematic_case_sequence is missing. ` +
        "Do not fall back to generic Story Spine footage; regenerate and reviewer-approve the source-bound multi-shot sequence first.",
    );
  }
  const fromSpine = scenePlanFromStorySpine(args.store, maxScenes, args.defaultDurationSec);
  const source = fromSpine ? "story_spine" : "scene_manifest";
  const scenes = fromSpine ?? scenePlanFromManifest(args.store, maxScenes, args.defaultDurationSec);
  if (!scenes) {
    throw new Error(
      `${args.label}: requires an admitted cinematic_case_sequence, validated story_spine ` +
      `(shotList + dpVisualSpecs), or episode_graph (sceneManifest) before paid rendering; ` +
      "add that module upstream. Free-form planning is retired and there is no Gemini fallback.",
    );
  }
  const issues = sharedScenePlanIssues(scenes, args.minScenes, args.avoid ?? "");
  if (issues.length) {
    throw new Error(`${args.label}: shared scene plan failed pre-render validation: ${issues.join("; ")}`);
  }
  return { source, scenes };
}

function cinematicSceneLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      "gen_footage: reviewed cinematic sequences require an explicit maxCinematicClips and matching Novita stage budget; automatic scene-count/cost expansion is forbidden",
    );
  }
  return Math.max(2, Math.min(240, Math.floor(parsed)));
}

type NovitaGeneratedSceneInput = Parameters<typeof renderNovitaGeneratedScenes>[0]["scenes"][number];
type NovitaRenderLifecycle = Parameters<typeof renderNovitaGeneratedScenes>[0]["lifecycle"];

/**
 * The central Novita media primitive intentionally has a 24-scene transaction
 * cap.  A reviewed long-form cinematic sequence must not be silently sliced
 * to fit it, so we render ordered batches with a proportional, caller-owned
 * budget allocation and retain exact input order across batch boundaries.
 */
async function renderGeneratedScenePlanInBatches(args: {
  prefix: string;
  scenes: readonly NovitaGeneratedSceneInput[];
  maxCostUsd: number;
  maxConcurrent: number;
  lifecycle: NovitaRenderLifecycle;
  keyframeGate?: Parameters<typeof renderNovitaGeneratedScenes>[0]["keyframeGate"];
  clipGate?: Parameters<typeof renderNovitaGeneratedScenes>[0]["clipGate"];
  styleId?: Parameters<typeof renderNovitaGeneratedScenes>[0]["styleId"];
}): Promise<{ scenes: Awaited<ReturnType<typeof renderNovitaGeneratedScenes>>["scenes"]; costUsd: number }> {
  const batches: NovitaGeneratedSceneInput[][] = [];
  for (let start = 0; start < args.scenes.length; start += 24) {
    batches.push([...args.scenes.slice(start, start + 24)]);
  }
  let assignedBudgetUsd = 0;
  let observedCostUsd = 0;
  const renderedScenes: Awaited<ReturnType<typeof renderNovitaGeneratedScenes>>["scenes"] = [];
  try {
    for (const [index, batch] of batches.entries()) {
      const maxCostUsd = index === batches.length - 1
        ? args.maxCostUsd - assignedBudgetUsd
        : args.maxCostUsd * (batch.length / args.scenes.length);
      assignedBudgetUsd += maxCostUsd;
      const rendered = await renderNovitaGeneratedScenes({
        prefix: `${args.prefix}/batch-${String(index + 1).padStart(3, "0")}`,
        profileId: "production",
        styleId: args.styleId,
        maxCostUsd,
        maxConcurrent: args.maxConcurrent,
        lifecycle: args.lifecycle,
        keyframeGate: args.keyframeGate,
        clipGate: args.clipGate,
        scenes: batch,
      });
      observedCostUsd += rendered.costUsd;
      renderedScenes.push(...rendered.scenes);
    }
  } catch (error) {
    throw withAdditionalObservedCost(error, observedCostUsd);
  }
  return { scenes: renderedScenes, costUsd: observedCostUsd };
}

/**
 * Native H3 adapter for the non-Casefile generated-footage lanes. H3 consumes
 * an actual R2 still rather than a prompt-only image-to-video request, so the
 * still is rendered and digest-checked first, then passed to the H3 worker.
 * The local clip map lets the existing compositor apply name cards/evidence
 * without pretending that an H3 output is a legacy Novita URL.
 */
async function renderGeneratedScenePlanWithH3(args: {
  prefix: string;
  scenes: readonly PlannedScene[];
  maxCostUsd: number;
  lifecycle: NonNullable<NovitaRenderLifecycle>;
}): Promise<{
  scenes: NovitaRenderedScene[];
  costUsd: number;
  localClipPaths: Map<string, string>;
}> {
  const readiness = minimaxH3Readiness("novita");
  if (!readiness.admitted) {
    throw new Error(`gen_footage: MiniMax H3 Novita route is not admitted: ${readiness.blockers.join("; ")}`);
  }
  // This read is deliberately before the first still render. A missing or
  // changed model pack must not leave paid conditioning images with no motion
  // route available to consume them.
  await assertMiniMaxH3R2ModelManifest();
  const tmp = await makeRunTempDir(`${args.lifecycle.runId}-h3-generated-footage`);
  const nativeDurationSec = MINIMAX_H3_PROFILE.frames / MINIMAX_H3_PROFILE.fps;
  const scenes: NovitaRenderedScene[] = [];
  const localClipPaths = new Map<string, string>();
  let observedCostUsd = 0;
  try {
    for (const [index, scene] of args.scenes.entries()) {
      const remainingBeforeStill = args.maxCostUsd - observedCostUsd;
      if (!Number.isFinite(remainingBeforeStill) || remainingBeforeStill <= 0) {
        throw new Error(`gen_footage: H3 stage budget exhausted before scene ${index + 1}`);
      }
      const still = await renderNovitaImage({
        prefix: `${args.prefix}/h3-frames`,
        id: `scene-${index + 1}`,
        prompt: `${scene.still}. Absolutely NO text, NO words, NO letters, NO watermark.`,
        ...(scene.negative ? { negativePrompt: scene.negative } : {}),
        seed: scene.continuitySeed,
        profileId: "production",
        maxCostUsd: remainingBeforeStill,
        lifecycle: args.lifecycle,
      });
      observedCostUsd += still.costUsd;
      const firstFrameBytes = await getObjectBytes(still.key);
      const firstFrameSha256 = sha256BytesHex(firstFrameBytes);
      const remainingBeforeMotion = args.maxCostUsd - observedCostUsd;
      if (!Number.isFinite(remainingBeforeMotion) || remainingBeforeMotion <= 0) {
        throw new Error(`gen_footage: H3 stage budget exhausted after scene ${index + 1} conditioning still`);
      }
      const seed = scene.continuitySeed ?? Number.parseInt(
        sha256Hex(`${args.lifecycle.runId}:generated-h3:${scene.id}`).slice(0, 8),
        16,
      ) % 2_147_483_647;
      const clip = await renderMiniMaxH3(buildMiniMaxH3SceneRequest({
        provider: "novita",
        execution: "on-demand",
        prompt: `${scene.still}. Preserve the exact accepted first frame, recurring subject, setting, wardrobe, props, lighting, and channel identity.`,
        motionPrompt: scene.motion,
        cameraInstruction: `Use the authored ${scene.cameraMove} move with ${scene.shotScale} framing and ${scene.lens} lens; keep the action physically coherent and avoid a scene change.`,
        ...(scene.negative ? { negativePrompt: scene.negative } : {}),
        seed,
        firstFrame: { r2Key: still.key, sha256: firstFrameSha256 },
        output: { r2Key: `${args.prefix}/h3/clip-${String(index + 1).padStart(4, "0")}.mp4` },
        maxCostUsd: remainingBeforeMotion,
      }));
      observedCostUsd += clip.receipt.runtime.costUsd;
      let acceptedClip = clip;
      let acceptedTake: Awaited<ReturnType<typeof materializeVerifiedMiniMaxH3Take>>;
      try {
        acceptedTake = await materializeVerifiedMiniMaxH3Take({
          label: `gen_footage: H3 scene ${index + 1}`,
          outputBytes: clip.outputBytes,
          localPath: join(tmp, `clip_${index + 1}.mp4`),
          nativeDurationSec,
        });
      } catch (error) {
        if (!(error instanceof MiniMaxH3OpeningMotionRejectedError)) throw error;
        const retryRemaining = args.maxCostUsd - observedCostUsd;
        if (!Number.isFinite(retryRemaining) || retryRemaining <= 0) {
          throw new Error(`gen_footage: H3 opening-motion repair has no remaining budget for ${scene.id}`);
        }
        const retry = await renderMiniMaxH3(buildMiniMaxH3SceneRequest({
          provider: "novita",
          execution: "on-demand",
          prompt:
            `${scene.still}. Preserve the exact accepted first frame, recurring subject, setting, wardrobe, props, lighting, and channel identity. ` +
            "Do not hold the conditioning image: begin the authored action in the first decoded frame.",
          motionPrompt:
            `${scene.motion} Start visible subject or camera motion immediately; no static opening hold.`,
          cameraInstruction:
            `Use the authored ${scene.cameraMove} move with ${scene.shotScale} framing and ${scene.lens} lens; ` +
            "begin movement immediately, keep the action physically coherent, and avoid a scene change.",
          ...(scene.negative ? { negativePrompt: scene.negative } : {}),
          seed,
          firstFrame: { r2Key: still.key, sha256: firstFrameSha256 },
          output: { r2Key: `${args.prefix}/h3/clip-${String(index + 1).padStart(4, "0")}-retry-2.mp4` },
          maxCostUsd: retryRemaining,
        }));
        observedCostUsd += retry.receipt.runtime.costUsd;
        acceptedClip = retry;
        acceptedTake = await materializeVerifiedMiniMaxH3Take({
          label: `gen_footage: H3 scene ${index + 1} repair take`,
          outputBytes: retry.outputBytes,
          localPath: join(tmp, `clip_${index + 1}-retry-2.mp4`),
          nativeDurationSec,
        });
      }
      localClipPaths.set(scene.id, acceptedTake.localPath);
      scenes.push({
        id: scene.id,
        imagePrompt: scene.still,
        motionPrompt: scene.motion,
        ...(scene.negative ? { negativePrompt: scene.negative } : {}),
        durationSec: nativeDurationSec,
        cameraMove: scene.cameraMove,
        shotScale: scene.shotScale,
        lens: scene.lens,
        ...(scene.continuityIds?.length ? { continuityIds: scene.continuityIds } : {}),
        ...(scene.expectedCastIds ? { expectedCastIds: scene.expectedCastIds } : {}),
        ...(scene.forbidAdditionalPeople ? { forbidAdditionalPeople: true as const } : {}),
        ...(scene.continuitySeed !== undefined ? { seed: scene.continuitySeed } : { seed }),
        stillKey: still.key,
        stillUrl: still.url,
        clipKey: acceptedClip.receipt.output.r2Key,
        clipUrl: acceptedTake.localPath,
        openingMotionQa: acceptedTake.openingMotionQa,
      });
    }
  } catch (error) {
    throw withAdditionalObservedCost(error, observedCostUsd);
  }
  return { scenes, costUsd: observedCostUsd, localClipPaths };
}

/**
 * Native H3 adapter for the reviewed Casefile lane.  Casefile still has a
 * terminal-frame obligation, but H3 accepts one conditioning frame rather
 * than the retired LTX end-frame input.  The reviewed terminal image is
 * therefore retained as an independent QA anchor and its endpoint is stated
 * in the H3 motion contract; the actual moving take must still pass the same
 * pixel-level clip gate before it can enter the exact cinematic assembler.
 */
async function renderCinematicScenePlanWithH3(args: {
  prefix: string;
  scenes: readonly PlannedScene[];
  maxCostUsd: number;
  lifecycle: NonNullable<NovitaRenderLifecycle>;
  keyframeGate?: Parameters<typeof renderNovitaGeneratedScenes>[0]["keyframeGate"];
  clipGate?: Parameters<typeof renderNovitaGeneratedScenes>[0]["clipGate"];
}): Promise<{
  scenes: NovitaRenderedScene[];
  costUsd: number;
  localClipPaths: Map<string, string>;
}> {
  const readiness = minimaxH3Readiness("novita");
  if (!readiness.admitted) {
    throw new Error(`gen_footage: MiniMax H3 Novita Casefile route is not admitted: ${readiness.blockers.join("; ")}`);
  }
  await assertMiniMaxH3R2ModelManifest();
  const tmp = await makeRunTempDir(`${args.lifecycle.runId}-h3-cinematic`);
  const nativeDurationSec = MINIMAX_H3_PROFILE.frames / MINIMAX_H3_PROFILE.fps;
  const scenes: NovitaRenderedScene[] = [];
  const localClipPaths = new Map<string, string>();
  let observedCostUsd = 0;

  const renderStill = async (scene: PlannedScene, id: string, prompt: string, seed: number | undefined, suffix: string) => {
    const remaining = args.maxCostUsd - observedCostUsd;
    if (!Number.isFinite(remaining) || remaining <= 0) {
      throw new Error(`gen_footage: H3 Casefile budget exhausted before ${id} conditioning still`);
    }
    const result = await renderNovitaImage({
      prefix: `${args.prefix}/h3-cinematic/${suffix}`,
      id,
      prompt: `${prompt}. Absolutely NO text, NO words, NO letters, NO watermark.`,
      ...(scene.negative ? { negativePrompt: scene.negative } : {}),
      ...(seed !== undefined ? { seed } : {}),
      profileId: "production",
      maxCostUsd: remaining,
      lifecycle: args.lifecycle,
    });
    observedCostUsd += result.costUsd;
    return result;
  };

  const gateScene = (scene: PlannedScene): NovitaGeneratedScene => ({
    id: scene.id,
    imagePrompt: scene.still,
    ...(scene.terminalStill ? { terminalImagePrompt: scene.terminalStill } : {}),
    motionPrompt: scene.motion,
    ...(scene.diegeticSoundscape ? { diegeticSoundscape: scene.diegeticSoundscape } : {}),
    durationSec: scene.durationSec,
    ...(scene.negative ? { negativePrompt: scene.negative } : {}),
    ...(scene.continuitySeed !== undefined ? { seed: scene.continuitySeed } : {}),
    cameraMove: scene.cameraMove,
    shotScale: scene.shotScale,
    lens: scene.lens,
    ...(scene.continuityIds?.length ? { continuityIds: scene.continuityIds } : {}),
    ...(scene.expectedCastIds ? { expectedCastIds: scene.expectedCastIds } : {}),
    ...(scene.forbidAdditionalPeople ? { forbidAdditionalPeople: true as const } : {}),
    ...(scene.keyframeRequirements?.length ? { keyframeRequirements: scene.keyframeRequirements } : {}),
  });

  const reviewStill = async (input: {
    scene: NovitaGeneratedScene;
    result: Awaited<ReturnType<typeof renderNovitaImage>>;
    attempt: number;
  }): Promise<{ review?: Awaited<ReturnType<NonNullable<NonNullable<Parameters<typeof renderNovitaGeneratedScenes>[0]["keyframeGate"]>["review"]>>>; result: Awaited<ReturnType<typeof renderNovitaImage>> }> => {
    if (!args.keyframeGate) return { result: input.result };
    try {
      const review = await args.keyframeGate.review({
        scene: input.scene,
        stillKey: input.result.key,
        stillUrl: input.result.url,
      });
      await args.keyframeGate.checkpointReview?.({
        scene: input.scene,
        stillKey: input.result.key,
        attempt: input.attempt,
        verdict: "accepted",
        review,
      });
      return { review, result: input.result };
    } catch (error) {
      const outcome = classifyVisualArtifactReviewOutcome(error, {
        gateId: "cinematic-keyframe",
        artifactKind: "image",
        subjectId: input.scene.id,
        reviewVersion: CINEMATIC_KEYFRAME_REVIEW_VERSION,
      });
      if (outcome.disposition !== "render_replacement" || input.attempt >= Math.max(1, Math.min(2, args.keyframeGate.maxImageAttempts ?? 1))) {
        throw error;
      }
      await args.keyframeGate.checkpointReview?.({
        scene: input.scene,
        stillKey: input.result.key,
        attempt: input.attempt,
        verdict: "rejected",
        rejection: outcome.rejection,
      });
      const remaining = args.maxCostUsd - observedCostUsd;
      if (!Number.isFinite(remaining) || remaining <= 0) {
        throw new Error(`gen_footage: H3 Casefile keyframe retry has no remaining budget for ${input.scene.id}`);
      }
      const replacement = await renderNovitaImage({
        prefix: `${args.prefix}/h3-cinematic/keyframe-retry`,
        id: `${input.scene.id}-keyframe-retry-${input.attempt + 1}`,
        prompt: `${input.scene.imagePrompt}. Independent keyframe correction ${input.attempt + 1}: preserve the sealed faceless cast, wardrobe, props, setting, camera, evidence treatment, and no-text lock. Resolve: ${error instanceof Error ? error.message.slice(0, 420) : String(error).slice(0, 420)}`,
        ...(input.scene.negativePrompt ? { negativePrompt: input.scene.negativePrompt } : {}),
        seed: Math.abs(((input.scene.seed ?? 4_242) + input.attempt * 104_729) % 2_147_483_647),
        profileId: "production",
        maxCostUsd: remaining,
        lifecycle: args.lifecycle,
      });
      observedCostUsd += replacement.costUsd;
      return reviewStill({ scene: input.scene, result: replacement, attempt: input.attempt + 1 });
    }
  };

  try {
    for (const [index, scene] of args.scenes.entries()) {
      if (!Array.isArray(scene.expectedCastIds) || scene.forbidAdditionalPeople !== true) {
        throw new Error(`gen_footage: H3 Casefile scene ${scene.id} is missing its sealed no-extra-people contract`);
      }
      const seed = scene.continuitySeed;
      const opening = await renderStill(scene, scene.id, scene.still, seed, "opening");
      const reviewedOpening = await reviewStill({ scene: gateScene(scene), result: opening, attempt: 1 });
      const terminalScene = scene.terminalStill
        ? { ...scene, id: `${scene.id}-terminal`, still: scene.terminalStill, terminalStill: undefined }
        : undefined;
      let terminal: Awaited<ReturnType<typeof renderNovitaImage>> | undefined;
      let terminalReview: Awaited<ReturnType<NonNullable<NonNullable<Parameters<typeof renderNovitaGeneratedScenes>[0]["keyframeGate"]>["review"]>>> | undefined;
      if (terminalScene) {
        terminal = await renderStill(terminalScene, terminalScene.id, terminalScene.still, seed, "terminal");
        const reviewedTerminal = await reviewStill({ scene: gateScene(terminalScene), result: terminal, attempt: 1 });
        terminal = reviewedTerminal.result;
        terminalReview = reviewedTerminal.review;
      }
      const remaining = args.maxCostUsd - observedCostUsd;
      if (!Number.isFinite(remaining) || remaining <= 0) {
        throw new Error(`gen_footage: H3 Casefile budget exhausted before scene ${index + 1} motion`);
      }
      const clip = await renderMiniMaxH3(buildMiniMaxH3SceneRequest({
        provider: "novita",
        execution: "on-demand",
        prompt: [
          `${scene.still}. Preserve the exact accepted first frame, sealed faceless cast, setting, wardrobe, props, lighting, evidence treatment, and channel identity.`,
          scene.terminalStill ? `Finish on the reviewed endpoint described here: ${scene.terminalStill}.` : undefined,
        ].filter(Boolean).join(" "),
        motionPrompt: scene.motion,
        cameraInstruction: `Use the authored ${scene.cameraMove} move with ${scene.shotScale} framing and ${scene.lens} lens; keep the causal action physically coherent and do not introduce a scene change.`,
        ...(scene.negative ? { negativePrompt: scene.negative } : {}),
        seed: seed ?? Number.parseInt(sha256Hex(`${args.lifecycle.runId}:h3-casefile:${scene.id}`).slice(0, 8), 16) % 2_147_483_647,
        firstFrame: { r2Key: reviewedOpening.result.key, sha256: sha256BytesHex(await getObjectBytes(reviewedOpening.result.key)) },
        output: { r2Key: `${args.prefix}/h3-cinematic/clip-${String(index + 1).padStart(4, "0")}.mp4` },
        maxCostUsd: remaining,
      }));
      observedCostUsd += clip.receipt.runtime.costUsd;
      if (clip.outputBytes.byteLength < 1_024) throw new Error(`gen_footage: H3 Casefile scene ${scene.id} returned an undersized clip`);
      const localPath = await writeBytes(join(tmp, `clip_${index + 1}.mp4`), clip.outputBytes);
      const measured = await probe(localPath);
      if (!measured.hasVideo || !Number.isFinite(measured.durationSec) || Math.abs(measured.durationSec - nativeDurationSec) > 0.08) {
        throw new Error(`gen_footage: H3 Casefile scene ${scene.id} failed native video/duration verification`);
      }
      let clipReview: Awaited<ReturnType<NonNullable<NonNullable<Parameters<typeof renderNovitaGeneratedScenes>[0]["clipGate"]>["review"]>>> | undefined;
      let acceptedClipKey = clip.receipt.output.r2Key;
      if (args.clipGate) {
        try {
          clipReview = await args.clipGate.review({
            scene: gateScene(scene),
            stillKey: reviewedOpening.result.key,
            stillUrl: reviewedOpening.result.url,
            ...(terminal ? { terminalStillKey: terminal.key, terminalStillUrl: terminal.url } : {}),
            clipKey: acceptedClipKey,
            clipUrl: await presignDownload(acceptedClipKey),
          });
          await args.clipGate.checkpointReview?.({ scene: gateScene(scene), clipKey: acceptedClipKey, attempt: 1, verdict: "accepted", review: clipReview });
        } catch (error) {
          const outcome = classifyVisualArtifactReviewOutcome(error, {
            gateId: "cinematic-clip",
            artifactKind: "video",
            subjectId: scene.id,
            reviewVersion: CINEMATIC_CLIP_REVIEW_VERSION,
          });
          const maxAttempts = Math.max(1, Math.min(2, args.clipGate.maxVideoAttempts ?? 1));
          if (outcome.disposition !== "render_replacement" || maxAttempts < 2) throw error;
          await args.clipGate.checkpointReview?.({ scene: gateScene(scene), clipKey: acceptedClipKey, attempt: 1, verdict: "rejected", rejection: outcome.rejection });
          const retryRemaining = args.maxCostUsd - observedCostUsd;
          if (!Number.isFinite(retryRemaining) || retryRemaining <= 0) throw new Error(`gen_footage: H3 Casefile motion retry has no remaining budget for ${scene.id}`);
          const retry = await renderMiniMaxH3(buildMiniMaxH3SceneRequest({
            provider: "novita",
            execution: "on-demand",
            prompt: `${scene.still}. Preserve the accepted first frame and finish on the reviewed endpoint: ${scene.terminalStill ?? scene.still}. Resolve this independent motion finding: ${error instanceof Error ? error.message.slice(0, 420) : String(error).slice(0, 420)}`,
            motionPrompt: scene.motion,
            cameraInstruction: `Correct the rejected take while preserving ${scene.cameraMove}, ${scene.shotScale}, ${scene.lens}, cast, props, setting, and evidence treatment.`,
            ...(scene.negative ? { negativePrompt: scene.negative } : {}),
            seed: Math.abs(((scene.continuitySeed ?? 8_686) + 15_485_863) % 2_147_483_647),
            firstFrame: { r2Key: reviewedOpening.result.key, sha256: sha256BytesHex(await getObjectBytes(reviewedOpening.result.key)) },
            output: { r2Key: `${args.prefix}/h3-cinematic/clip-${String(index + 1).padStart(4, "0")}-retry-2.mp4` },
            maxCostUsd: retryRemaining,
          }));
          observedCostUsd += retry.receipt.runtime.costUsd;
          acceptedClipKey = retry.receipt.output.r2Key;
          clipReview = await args.clipGate.review({
            scene: gateScene(scene),
            stillKey: reviewedOpening.result.key,
            stillUrl: reviewedOpening.result.url,
            ...(terminal ? { terminalStillKey: terminal.key, terminalStillUrl: terminal.url } : {}),
            clipKey: acceptedClipKey,
            clipUrl: await presignDownload(acceptedClipKey),
          });
          await args.clipGate.checkpointReview?.({ scene: gateScene(scene), clipKey: acceptedClipKey, attempt: 2, verdict: "accepted", review: clipReview });
        }
      }
      const finalBytes = acceptedClipKey === clip.receipt.output.r2Key
        ? clip.outputBytes
        : await getObjectBytes(acceptedClipKey);
      const finalLocalPath = acceptedClipKey === clip.receipt.output.r2Key
        ? localPath
        : await writeBytes(join(tmp, `clip_${index + 1}-retry.mp4`), finalBytes);
      const finalMeasured = await probe(finalLocalPath);
      if (!finalMeasured.hasVideo || !Number.isFinite(finalMeasured.durationSec) || Math.abs(finalMeasured.durationSec - nativeDurationSec) > 0.08) {
        throw new Error(`gen_footage: H3 Casefile scene ${scene.id} replacement failed native duration verification`);
      }
      localClipPaths.set(scene.id, finalLocalPath);
      scenes.push({
        ...gateScene(scene),
        stillKey: reviewedOpening.result.key,
        stillUrl: reviewedOpening.result.url,
        clipKey: acceptedClipKey,
        clipUrl: await presignDownload(acceptedClipKey),
        ...(reviewedOpening.review ? { keyframeReview: reviewedOpening.review } : {}),
        ...(terminal ? { terminalStillKey: terminal.key, terminalStillUrl: terminal.url } : {}),
        ...(terminalReview ? { terminalKeyframeReview: terminalReview } : {}),
        ...(clipReview ? { clipReview } : {}),
      });
    }
  } catch (error) {
    throw withAdditionalObservedCost(error, observedCostUsd);
  }
  return { scenes, costUsd: observedCostUsd, localClipPaths };
}

export function assertCentralNovitaSelection(value: unknown, label: string): void {
  if (value === undefined || value === "novita" || value === "novita-ltx") return;
  throw new Error(
    `${label}: model-specific i2vModel ${JSON.stringify(value)} is retired; ` +
    "omit it and use the centrally attested Novita production profile.",
  );
}

/**
 * HYBRID helper: K signature establishing shots of the channel's canonical
 * world (DNA-locked), for mixing into a stock body. Returns paths + cost.
 */
export async function generateSignatureClips(
  ctx: Parameters<Block["run"]>[0],
  k: number,
): Promise<{ clips: string[]; cost: number }> {
  const dna = ctx.store["styleDNA"] as {
    recurringSubject?: string;
    setting?: string;
    colorGrade?: string;
    visualAvoid?: string[];
  } | null;
  if (k <= 0 || !dna?.recurringSubject) return { clips: [], cost: 0 };
  const avoid = (dna.visualAvoid ?? []).slice(0, 4).join(", ");
  const plan = resolveGeneratedFootageScenePlan({
    store: ctx.store,
    label: "signature_clips",
    // Signature shots are a fixed-size set: the caller prepends exactly k.
    maxScenes: k,
    minScenes: k,
    defaultDurationSec: 5,
    avoid,
  });
  const scenes = plan.scenes;
  // Signature clips are now native MiniMax H3 on-demand takes. Check the
  // route and immutable model pack before generating any conditioning still;
  // otherwise a missing H3 worker could leave paid stills with no usable
  // motion path behind them.
  const h3Readiness = minimaxH3Readiness("novita");
  if (!h3Readiness.admitted) {
    throw new Error(`signature_clips: MiniMax H3 Novita route is not admitted: ${h3Readiness.blockers.join("; ")}`);
  }
  await assertMiniMaxH3R2ModelManifest();
  ctx.log(`signature_clips: using ${plan.source} (${scenes.length} validated scene(s), MiniMax H3 on-demand)`);
  const stageBudgetUsd = requireNovitaStageBudget(ctx.stageBudgetUsd, "signature_clips");
  const tmp = await makeRunTempDir(ctx.runId);
  const prefix = `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/signature-clips`;
  const lifecycle = {
    ownerId: ctx.ownerId,
    channelId: ctx.channelId,
    runId: ctx.runId,
    blockId: "signature_clips",
  };
  let observedCostUsd = 0;
  try {
    const clips: string[] = [];
    const nativeDurationSec = MINIMAX_H3_PROFILE.frames / MINIMAX_H3_PROFILE.fps;
    for (const [index, scene] of scenes.entries()) {
      const remainingBeforeStill = stageBudgetUsd - observedCostUsd;
      if (!Number.isFinite(remainingBeforeStill) || remainingBeforeStill <= 0) {
        throw new Error(`signature_clips: stage budget exhausted before scene ${index + 1}`);
      }
      const still = await renderNovitaImage({
        prefix: `${prefix}/frames`,
        id: `signature-${index + 1}`,
        prompt: `${scene.still}. Absolutely NO text, NO words, NO letters, NO watermark.`,
        ...(scene.negative ? { negativePrompt: scene.negative } : {}),
        seed: scene.continuitySeed,
        profileId: "production",
        maxCostUsd: remainingBeforeStill,
        lifecycle,
      });
      observedCostUsd += still.costUsd;
      const firstFrameBytes = await getObjectBytes(still.key);
      const firstFrameSha256 = sha256BytesHex(firstFrameBytes);
      const remainingBeforeMotion = stageBudgetUsd - observedCostUsd;
      if (!Number.isFinite(remainingBeforeMotion) || remainingBeforeMotion <= 0) {
        throw new Error(`signature_clips: stage budget exhausted after conditioning still ${index + 1}`);
      }
      const seed = scene.continuitySeed ?? Number.parseInt(
        sha256Hex(`${ctx.runId}:signature-h3:${index + 1}`).slice(0, 8),
        16,
      ) % 2_147_483_647;
      const clip = await renderMiniMaxH3(buildMiniMaxH3SceneRequest({
        provider: "novita",
        execution: "on-demand",
        prompt: `${scene.still}. Preserve the exact accepted signature still, recurring subject, setting, wardrobe, props, lighting, and channel identity.`,
        motionPrompt: scene.motion,
        cameraInstruction: `Use the authored ${scene.cameraMove} move with ${scene.shotScale} framing and ${scene.lens} lens; keep the motion physically coherent and free of scene changes.`,
        ...(scene.negative ? { negativePrompt: scene.negative } : {}),
        seed,
        firstFrame: { r2Key: still.key, sha256: firstFrameSha256 },
        output: { r2Key: `${prefix}/h3/clip-${String(index + 1).padStart(3, "0")}.mp4` },
        maxCostUsd: remainingBeforeMotion,
      }));
      observedCostUsd += clip.receipt.runtime.costUsd;
      let acceptedTake: Awaited<ReturnType<typeof materializeVerifiedMiniMaxH3Take>>;
      try {
        acceptedTake = await materializeVerifiedMiniMaxH3Take({
          label: `signature_clips: MiniMax H3 scene ${index + 1}`,
          outputBytes: clip.outputBytes,
          localPath: join(tmp, `sig_${index}.mp4`),
          nativeDurationSec,
        });
      } catch (error) {
        if (!(error instanceof MiniMaxH3OpeningMotionRejectedError)) throw error;
        const retryRemaining = stageBudgetUsd - observedCostUsd;
        if (!Number.isFinite(retryRemaining) || retryRemaining <= 0) {
          throw new Error(`signature_clips: H3 opening-motion repair has no remaining budget for scene ${index + 1}`);
        }
        const retry = await renderMiniMaxH3(buildMiniMaxH3SceneRequest({
          provider: "novita",
          execution: "on-demand",
          prompt:
            `${scene.still}. Preserve the exact accepted signature still, recurring subject, setting, wardrobe, props, lighting, and channel identity. ` +
            "Do not hold the conditioning image: begin the authored action in the first decoded frame.",
          motionPrompt:
            `${scene.motion} Start visible subject or camera motion immediately; no static opening hold.`,
          cameraInstruction:
            `Use the authored ${scene.cameraMove} move with ${scene.shotScale} framing and ${scene.lens} lens; ` +
            "begin movement immediately, keep the motion physically coherent, and avoid scene changes.",
          ...(scene.negative ? { negativePrompt: scene.negative } : {}),
          seed,
          firstFrame: { r2Key: still.key, sha256: firstFrameSha256 },
          output: { r2Key: `${prefix}/h3/clip-${String(index + 1).padStart(3, "0")}-retry-2.mp4` },
          maxCostUsd: retryRemaining,
        }));
        observedCostUsd += retry.receipt.runtime.costUsd;
        acceptedTake = await materializeVerifiedMiniMaxH3Take({
          label: `signature_clips: MiniMax H3 scene ${index + 1} repair take`,
          outputBytes: retry.outputBytes,
          localPath: join(tmp, `sig_${index}-retry-2.mp4`),
          nativeDurationSec,
        });
      }
      clips.push(acceptedTake.localPath);
      ctx.log(`signature_clips: scene ${index + 1}/${scenes.length} H3 take accepted`);
    }
    return { clips, cost: observedCostUsd };
  } catch (error) {
    throw withAdditionalObservedCost(error, observedCostUsd);
  }
}

export const genFootage: Block = {
  id: "gen_footage",
  // The engine's Block ABI has only an all-of `consumes` list, while this
  // renderer deliberately accepts either a Story Spine or Scene Manifest.
  // Both alternatives are declared as optional manifest inputs; the resolver
  // below validates the complete handoff and fails before paid work if absent.
  consumes: [],
  produces: [
    "footageClips",
    "footageKeys",
    "generatedFootageSceneManifest",
    "footageOnScreenTextCues",
    "footageRenderer",
    "ltxStyleId",
    "ltxStyleSelection",
  ],
  paid: true,
  run: async (ctx) => {
    assertCentralNovitaSelection(ctx.params["i2vModel"], "gen_footage");
    const dna = ctx.store["styleDNA"] as {
      visualAvoid?: string[];
      palette?: string[];
      colorGrade?: string;
      composition?: string;
      motifs?: string[];
      motionDiscipline?: string;
    } | null;
    const ltxStyleSelection = selectLtxStyleForChannel({
      explicitStyleId: ctx.store["ltxStyleId"],
      familyDefaultStyleId: FAMILIES.cinematic.styleId,
      styleDNA: dna,
      visualBrief: ctx.store["visualBrief"] as {
        promptStyle?: string;
        look?: string;
        setting?: string;
        world?: string;
      } | null | undefined,
    });
    ctx.log(
      `gen_footage: visual treatment ${ltxStyleSelection.styleId} (${ltxStyleSelection.source})` +
      (ltxStyleSelection.matchedSignals.length
        ? ` from ${ltxStyleSelection.matchedSignals.length} sealed channel-identity signal(s)`
        : ""),
    );
    const narrationSec = Number(ctx.store["narrationDurationSec"] ?? 0) || 300;
    // Both of these size PAID Novita renders. `clipSec` is also the fallback
    // passed to boundedSceneDuration, and a fallback that is itself NaN cannot
    // do the one job a fallback has; `maxClips` becomes maxScenes, where NaN
    // means `slice(0, NaN)` — an empty plan rather than a capped one.
    const clipSec = boundedNumber(ctx.params["clipSec"], 5, 5, 10);
    const genericMaxClips = boundedInteger(
      ctx.params["maxClips"],
      Math.ceil(narrationSec / 22),
      6,
      24,
    );
    const hasCinematicSequence = ctx.store["cinematicGeneratedScenePlan"] !== undefined;
    const maxClips = hasCinematicSequence
      ? cinematicSceneLimit(ctx.params["maxCinematicClips"])
      : genericMaxClips;
    const avoid = (dna?.visualAvoid ?? []).slice(0, 6).join(", ");
    if (ctx.params["dpCoverage"] === true) {
      ctx.log("gen_footage: dpCoverage is retired; using the required shared scene plan");
    }
    const plan = resolveGeneratedFootageScenePlan({
      store: ctx.store,
      label: "gen_footage",
      maxScenes: maxClips,
      minScenes: hasCinematicSequence ? 2 : 4,
      defaultDurationSec: clipSec,
      avoid,
    });
    const scenes = plan.scenes;
    // A week-ahead footage receipt is a fully reviewed ordered render result,
    // not the language-sibling reuse shortcut. Verify it against the exact
    // current frozen scene plan and actual retained bytes before any visual
    // provider/reviewer work is allowed to start.
    const preparedFootage = ctx.store["preparedFootage"] as PlanWeekPreparedFootage | undefined;
    if (preparedFootage !== undefined) {
      if (!preparedFootage || typeof preparedFootage !== "object") {
        throw new Error("gen_footage: prepared weekly footage is invalid");
      }
      const preparedManifest = preparedFootage.generatedFootageSceneManifest;
      if (preparedFootage.renderer?.kind === "minimax-h3") {
        const nativeDurationSec = 124 / 24;
        const timingMatches = scenes.length === preparedFootage.clips.length && scenes.every((scene, index) => {
          const clip = preparedFootage.clips[index];
          const authoredDuration = plan.source === "cinematic_case_sequence"
            ? ((scene.t1 ?? 0) - (scene.t0 ?? 0))
            : scene.durationSec;
          // H3 emits one fixed native 124-frame take. The authored scene may
          // be shorter or longer; timeline_assemble retimes it (rather than
          // freezing a tail) while the immutable provider clip remains
          // receipt-bound at its native duration.
          return Boolean(clip) && Number.isFinite(authoredDuration) && authoredDuration >= 3 &&
            Math.abs(clip.durationSec - nativeDurationSec) <= 0.08;
        });
        if (
          !timingMatches ||
          preparedManifest.source !== plan.source ||
          preparedManifest.sequenceFingerprint !== plan.sequenceFingerprint ||
          preparedManifest.items.length !== scenes.length
        ) {
          throw new Error("gen_footage: prepared H3 footage does not match the native 5.17s scene plan or its admitted authored timing");
        }
        const preparedTmp = await makeRunTempDir(`${ctx.runId}-prepared-h3-footage`);
        const footageClips = await pool(preparedFootage.clips, 4, async (clip, index) => {
          const bytes = await getObjectBytes(clip.r2Key);
          if (bytes.byteLength !== clip.byteLength || sha256BytesHex(bytes) !== clip.sha256) {
            throw new Error(`gen_footage: prepared H3 clip ${index + 1} bytes do not match its immutable receipt`);
          }
          const local = await writeBytes(join(preparedTmp, `clip_${index + 1}.mp4`), bytes);
          const measured = await probe(local);
          if (!measured.hasVideo || !Number.isFinite(measured.durationSec) || Math.abs(measured.durationSec - nativeDurationSec) > 0.08) {
            throw new Error(`gen_footage: prepared H3 clip ${index + 1} failed native duration verification`);
          }
          return local;
        });
        ctx.log(
          `gen_footage: consumed ${footageClips.length} prepared MiniMax H3 clip(s) ` +
          "after receipt, hash, and native-duration verification (no provider spend)",
        );
        return {
          footageClips,
          footageKeys: preparedFootage.clips.map((clip) => clip.r2Key),
          generatedFootageSceneManifest: preparedManifest,
          footageOnScreenTextCues: footageOnScreenTextCues(scenes.map((scene) => ({
            sceneId: scene.id,
            durationSec: scene.durationSec,
          }))),
          footageRenderer: {
            kind: "minimax-h3" as const,
            provider: preparedFootage.renderer.provider,
            execution: preparedFootage.renderer.execution,
            runtimeId: MINIMAX_H3_RUNTIME_ID,
            profileId: MINIMAX_H3_PROFILE.id,
            modelManifestSha256: MINIMAX_H3_MANIFEST_SHA256,
          },
          // This field is a visual-treatment style ABI used by downstream
          // editor code; the explicit renderer identity lives on the receipt.
          ltxStyleId: ltxStyleSelection.styleId,
          ltxStyleSelection,
          [COST_PATCH_KEY]: 0,
        };
      }
      const expectedDurationSec = plan.source === "cinematic_case_sequence"
        ? (scenes.at(-1)?.t1 ?? 0)
        : scenes.reduce((total, scene) => total + scene.durationSec, 0);
      if (
        preparedFootage.ltxStyleId !== ltxStyleSelection.styleId ||
        preparedManifest.source !== plan.source ||
        preparedManifest.sequenceFingerprint !== plan.sequenceFingerprint ||
        preparedManifest.items.length !== scenes.length ||
        Math.abs(preparedManifest.durationSec - expectedDurationSec) > 0.05 ||
        preparedManifest.items.some((item, index) => {
          const scene = scenes[index];
          return !scene || item.sceneId !== scene.id ||
            (scene.t0 !== undefined && item.t0 !== scene.t0) ||
            (scene.t1 !== undefined && item.t1 !== scene.t1) ||
            (scene.continuitySeed !== undefined && item.continuitySeed !== scene.continuitySeed);
        })
      ) {
        throw new Error("gen_footage: prepared weekly footage does not match the frozen scene plan or renderer");
      }
      const preparedTmp = await makeRunTempDir(`${ctx.runId}-prepared-footage`);
      const footageClips = await pool(preparedFootage.clips, 4, async (clip, index) => {
        const scene = scenes[index];
        const expectedSceneDurationSec = plan.source === "cinematic_case_sequence"
          ? ((scene?.t1 ?? 0) - (scene?.t0 ?? 0))
          : scene?.durationSec;
        if (
          typeof expectedSceneDurationSec !== "number" ||
          !Number.isFinite(expectedSceneDurationSec) ||
          expectedSceneDurationSec <= 0 ||
          Math.abs(clip.durationSec - expectedSceneDurationSec) > 0.08
        ) {
          throw new Error(`gen_footage: prepared weekly clip ${index + 1} timing does not match the frozen scene plan`);
        }
        const bytes = await getObjectBytes(clip.r2Key);
        if (bytes.byteLength !== clip.byteLength || sha256BytesHex(bytes) !== clip.sha256) {
          throw new Error(`gen_footage: prepared weekly clip ${index + 1} bytes do not match its immutable receipt`);
        }
        const local = await writeBytes(join(preparedTmp, `clip_${index + 1}.mp4`), bytes);
        const measured = await probe(local);
        const measuredDurationSec = measured.durationSec;
        if (
          !Number.isFinite(measuredDurationSec) ||
          measuredDurationSec <= 0 ||
          !measured.hasVideo ||
          Math.abs(measuredDurationSec - clip.durationSec) > 0.08
        ) {
          throw new Error(`gen_footage: prepared weekly clip ${index + 1} video duration does not match its immutable receipt`);
        }
        return local;
      });
      const preparedFootageTextCues = footageOnScreenTextCues(
        scenes.map((scene) => ({
          sceneId: scene.id,
          durationSec: scene.durationSec,
          ...(scene.nameCardText ? { nameCardText: scene.nameCardText } : {}),
          ...(scene.evidenceOverlay
            ? {
                evidenceOverlay: {
                  text: [scene.evidenceOverlay.primary, scene.evidenceOverlay.secondary].filter(Boolean).join(" "),
                  durationSec: Math.max(1.2, Math.min(2.2, scene.durationSec - 0.3)),
                },
              }
            : {}),
        })),
      );
      ctx.log(
        `gen_footage: consumed ${footageClips.length} prepared weekly clips ` +
        "after scene-manifest, hash, and duration verification (no Novita spend)",
      );
      return {
        footageClips,
        footageKeys: preparedFootage.clips.map((clip) => clip.r2Key),
        generatedFootageSceneManifest: preparedManifest,
        footageOnScreenTextCues: preparedFootageTextCues,
        footageRenderer: { kind: "novita-ltx", styleId: ltxStyleSelection.styleId },
        ltxStyleId: ltxStyleSelection.styleId,
        ltxStyleSelection,
        [COST_PATCH_KEY]: 0,
      };
    }
    // Cinematic keyframe, take, and cut gates are independent visual evidence,
    // not an optional after-spend review. The prepared branch above carries
    // its already admitted records; only a fresh Novita render needs a new
    // reviewer credential.
    if (hasCinematicSequence && !hasNonGoogleVisionKey()) {
      throw new Error(
        "gen_footage: admitted cinematic_case_sequence requires OPENROUTER_API_KEY for independent non-Google visual gates before Novita rendering",
      );
    }
    // The existing runArtifacts checkpoint is intentionally record-only. It
    // captures the exact independently reviewed Casefile candidate before a
    // bounded replacement render, without becoming a release or retry input.
    const casefileRejectedAttemptBySubject = new Map<
      string,
      { attemptFingerprint: string; rejectionFingerprint: string }
    >();
    let casefileVisualAttemptOrdinal = 0;
    const checkpointCasefileVisualAttempt = async (input: {
      phase: "keyframe" | "clip";
      sceneId: string;
      candidateKey: string;
      attempt: number;
      verdict: "accepted" | "rejected";
      notes: readonly string[];
      rejection?: VisualArtifactReviewRejection;
    }): Promise<void> => {
      if (plan.source !== "cinematic_case_sequence" || !plan.sequenceFingerprint) {
        throw new Error("gen_footage visual attempt checkpoint requires a cinematic sequence fingerprint");
      }
      if (!ctx.checkpointVisualArtifactAttempts) {
        throw new Error("gen_footage visual attempt checkpoint requires the runner durable artifact sink");
      }
      const lineageKey = `${input.phase}:${input.sceneId}`;
      const parent = casefileRejectedAttemptBySubject.get(lineageKey);
      const gate = input.phase === "keyframe"
        ? {
            gateId: "cinematic-keyframe",
            reviewVersion: CINEMATIC_KEYFRAME_REVIEW_VERSION,
            artifactKind: "image" as const,
          }
        : {
            gateId: "cinematic-clip",
            reviewVersion: CINEMATIC_CLIP_REVIEW_VERSION,
            artifactKind: "video" as const,
          };
      const repair = parent
        ? {
            kind: "replacement" as const,
            parentAttemptFingerprint: parent.attemptFingerprint,
            parentRejectionFingerprint: parent.rejectionFingerprint,
          }
        : { kind: "initial" as const };
      const token = stableVisualAttemptToken(input.sceneId);
      const review = input.verdict === "accepted"
        ? {
            verdict: "accepted" as const,
            gateId: gate.gateId,
            reviewVersion: gate.reviewVersion,
            notes: input.notes,
          }
        : {
            verdict: "rejected" as const,
            gateId: gate.gateId,
            reviewVersion: gate.reviewVersion,
            notes: input.notes,
            rejection: input.rejection,
          };
      const record = createVisualArtifactAttempt({
        adapterId: "casefile_cinematic",
        scopeFingerprint: plan.sequenceFingerprint,
        attemptId: `casefile-${input.phase}-${token}-${input.attempt}`,
        ordinal: ++casefileVisualAttemptOrdinal,
        artifact: {
          kind: gate.artifactKind,
          subjectId: input.sceneId,
          candidate: {
            id: `casefile-${input.phase}-${token}-candidate-${input.attempt}`,
            r2Key: input.candidateKey,
          },
        },
        review,
        repair,
      });
      await ctx.checkpointVisualArtifactAttempts([record]);
      if (record.review.verdict === "rejected") {
        casefileRejectedAttemptBySubject.set(lineageKey, {
          attemptFingerprint: record.attemptFingerprint,
          rejectionFingerprint: visualArtifactReviewRejectionFingerprint(record.review.rejection),
        });
      }
    };
    const creativeAdapter = LtxCreativeAdapterInputSchema.optional().parse(
      ctx.params["ltxCreativeAdapter"],
    );
    ctx.log(`gen_footage: using ${plan.source} (${scenes.length} validated scene(s))`);

    // Source-proof scenes are not generated visual prompts. Resolve their
    // approved bytes before Novita is even considered, so a missing/changed
    // source asset fails without buying a synthetic substitute.
    const tmp = await makeRunTempDir(ctx.runId);
    const sourceProofBySceneId = new Map<string, { localPath: string; receipt: SourceProofMediaReceipt }>();
    if (plan.source === "cinematic_case_sequence") {
      await pool(
        scenes.filter((scene) => scene.sourceProofMedia !== undefined),
        2,
        async (scene) => {
          const safeSceneId = scene.id.replace(/[^a-z0-9_-]/gi, "_");
          const sourceProof = await resolveApprovedSourceProofMedia({
            sceneId: scene.id,
            sequenceFingerprint: plan.sequenceFingerprint!,
            obligation: scene.sourceProofMedia,
            durationSec: boundedSceneDuration(scene.durationSec, clipSec),
            assetPath: join(tmp, `${safeSceneId}-source-proof-asset`),
            clipPath: join(tmp, `${safeSceneId}-source-proof.mp4`),
            clipKey: `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/generated-footage/source-proof/${safeSceneId}.mp4`,
            downloadAsset: downloadTo,
            readBytes,
            createEvidenceClip: kenBurns,
            putEvidenceClip: async (key, bytes) => {
              await putObject(key, bytes, { contentType: "video/mp4" });
              return key;
            },
          });
          sourceProofBySceneId.set(scene.id, sourceProof);
          ctx.log(`gen_footage: ${scene.id} resolved approved source-proof asset ${sourceProof.receipt.obligation.assetId}; generated motion bypassed`);
        },
      );
    }
    const generatedScenes = scenes.filter((scene) => scene.sourceProofMedia === undefined);
    // Every fresh generated scene now uses the native H3 adapter. Casefile's
    // source-bound terminal-frame and transition evidence is carried by the
    // dedicated H3 cinematic adapter below; no active scene silently falls
    // back to the retired LTX motion route.
    const useH3ForFreshGeneratedScenes = generatedScenes.length > 0;
    const h3LocalClipPaths = new Map<string, string>();
    if (plan.source === "cinematic_case_sequence") {
      for (const scene of generatedScenes) {
        if (!Array.isArray(scene.expectedCastIds) || scene.forbidAdditionalPeople !== true) {
          throw new Error(
            `gen_footage: cinematic scene ${scene.id} is missing its sealed no-extra-people contract; refusing any generated render`,
          );
        }
      }
    }

    const requestedConcurrency = Number(ctx.params["maxConcurrent"] ?? 3);
    const maxConcurrent = Math.min(8, Math.max(1, Math.floor(requestedConcurrency)));
    const stageBudgetUsd = generatedScenes.length > 0
      ? requireNovitaStageBudget(ctx.stageBudgetUsd, "gen_footage")
      : 0;
    if (plan.source === "cinematic_case_sequence") {
      const finalMasterQaAdmission = assertCinematicFinalMasterQaAdmission({
        admission: ctx.store["cinematicFinalMasterQaAdmission"],
        creativeLocks: ctx.store["cinematicCreativeLocks"],
        editDecisionList: ctx.store["cinematicEditDecisionList"],
      });
      if (!ctx.assertRemainingBudgetReservation) {
        throw new Error(
          "gen_footage: cinematic final-master QA requires the runner's remaining-budget reservation rail before Novita rendering",
        );
      }
      const reservation = ctx.assertRemainingBudgetReservation({
        reason:
          `cinematic final-master QA (${finalMasterQaAdmission.reviewCallCount} non-Google lock/cut review calls, ` +
          `$${finalMasterQaAdmission.reviewCostUsd.toFixed(2)} receipt)`,
        requiredFuturePaidBlockIds: ["qa_visual"],
      });
      ctx.log(
        `gen_footage: reserved $${reservation.reservedMaxCostUsd.toFixed(2)} for all pending paid stages ` +
          `including final-master cinematic QA before Novita starts`,
      );
    }
    // Keep the first accepted still for each recurring mannequin cast as
    // independent visual evidence. It is deliberately not a hidden generation
    // input: the gate proves a candidate matches the source-bound continuity
    // contract before H3 spends, and fails rather than pretending text alone
    // can establish character consistency.
    const cinematicKeyframeTmp = hasCinematicSequence
      ? await makeRunTempDir(`${ctx.runId}-cinematic-keyframes`)
      : undefined;
    const cinematicClipTmp = hasCinematicSequence
      ? await makeRunTempDir(`${ctx.runId}-cinematic-clips`)
      : undefined;
    const acceptedReferenceByCastId = new Map<string, { sceneId: string; path: string }>();
    const keyframeCandidatePathByKey = new Map<string, string>();
    const keyframeGate = hasCinematicSequence
      ? {
          // One replacement is the only automatic recovery. More retries hide
          // a broken prompt behind unbounded spend instead of surfacing it.
          maxImageAttempts: 2 as const,
          review: async ({ scene, stillKey, stillUrl }: Parameters<NonNullable<Parameters<typeof renderNovitaGeneratedScenes>[0]["keyframeGate"]>["review"]>[0]) => {
          const candidatePath = await downloadTo(
            stillUrl,
            join(cinematicKeyframeTmp!, `${scene.id.replace(/[^a-z0-9_-]/gi, "_")}.png`),
            { timeoutMs: DURABLE_RENDER_OUTPUT_DOWNLOAD_TIMEOUT_MS },
          );
          keyframeCandidatePathByKey.set(stillKey, candidatePath);
          const continuityIds = scene.continuityIds ?? [];
          const references = continuityIds
            .map((castId) => acceptedReferenceByCastId.get(castId))
            .filter((reference): reference is { sceneId: string; path: string } => Boolean(reference))
            .filter((reference, index, all) => all.findIndex((other) => other.sceneId === reference.sceneId) === index)
            .slice(0, 2);
          const review = await reviewCinematicKeyframe({
            scene,
            candidatePath,
            referencePaths: references.map((reference) => reference.path),
            reviewedAgainstSceneIds: references.map((reference) => reference.sceneId),
          });
          return review;
          },
          checkpointReview: async (event: NovitaKeyframeReviewCheckpoint) => {
            await checkpointCasefileVisualAttempt({
              phase: "keyframe",
              sceneId: event.scene.id,
              candidateKey: event.stillKey,
              attempt: event.attempt,
              verdict: event.verdict,
              notes: event.verdict === "accepted" ? event.review.notes : event.rejection.notes,
              ...(event.verdict === "rejected" ? { rejection: event.rejection } : {}),
            });
            if (event.verdict === "accepted") {
              const candidatePath = keyframeCandidatePathByKey.get(event.stillKey);
              if (!candidatePath) {
                throw new Error(`gen_footage keyframe checkpoint lost local candidate path for ${event.scene.id}`);
              }
              for (const castId of event.scene.continuityIds ?? []) {
                if (!acceptedReferenceByCastId.has(castId)) {
                  acceptedReferenceByCastId.set(castId, {
                    sceneId: event.scene.id,
                    path: candidatePath,
                  });
                }
              }
            }
          },
        }
      : undefined;
    const clipGate = hasCinematicSequence
      ? {
          // One replacement take is the only automatic motion recovery. It
          // preserves the accepted keyframe; a bad second take stays blocked.
          maxVideoAttempts: 2 as const,
          review: async ({ scene, stillUrl, terminalStillKey, terminalStillUrl, clipUrl }: Parameters<NonNullable<Parameters<typeof renderNovitaGeneratedScenes>[0]["clipGate"]>["review"]>[0]) => {
            const safeSceneId = scene.id.replace(/[^a-z0-9_-]/gi, "_");
            const stillPath = await downloadTo(stillUrl, join(cinematicClipTmp!, `${safeSceneId}-source.png`), {
              timeoutMs: DURABLE_RENDER_OUTPUT_DOWNLOAD_TIMEOUT_MS,
            });
            const terminalStillPath = terminalStillUrl
              ? await downloadTo(terminalStillUrl, join(cinematicClipTmp!, `${safeSceneId}-terminal.png`), {
                  timeoutMs: DURABLE_RENDER_OUTPUT_DOWNLOAD_TIMEOUT_MS,
                })
              : undefined;
            const clipPath = await downloadTo(clipUrl, join(cinematicClipTmp!, `${safeSceneId}-candidate.mp4`), {
              timeoutMs: DURABLE_RENDER_OUTPUT_DOWNLOAD_TIMEOUT_MS,
            });
            return await reviewCinematicClip({
              scene,
              stillPath,
              ...(terminalStillPath && terminalStillKey ? { terminalStillPath, terminalStillKey } : {}),
              clipPath,
              workDir: cinematicClipTmp!,
            });
          },
          checkpointReview: async (event: NovitaClipReviewCheckpoint) => {
            await checkpointCasefileVisualAttempt({
              phase: "clip",
              sceneId: event.scene.id,
              candidateKey: event.clipKey,
              attempt: event.attempt,
              verdict: event.verdict,
              notes: event.verdict === "accepted" ? event.review.notes : event.rejection.notes,
              ...(event.verdict === "rejected" ? { rejection: event.rejection } : {}),
            });
          },
        }
      : undefined;
    const rendered = generatedScenes.length > 0
      ? useH3ForFreshGeneratedScenes
        ? plan.source === "cinematic_case_sequence"
          ? await renderCinematicScenePlanWithH3({
            prefix: `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/generated-footage`,
            maxCostUsd: stageBudgetUsd,
            lifecycle: {
              ownerId: ctx.ownerId,
              channelId: ctx.channelId,
              runId: ctx.runId,
              blockId: "gen_footage",
            },
            keyframeGate,
            clipGate,
            scenes: generatedScenes,
          }).then((result) => {
            for (const [sceneId, localPath] of result.localClipPaths) h3LocalClipPaths.set(sceneId, localPath);
            return result;
          })
          : await renderGeneratedScenePlanWithH3({
          prefix: `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/generated-footage`,
          maxCostUsd: stageBudgetUsd,
          lifecycle: {
            ownerId: ctx.ownerId,
            channelId: ctx.channelId,
            runId: ctx.runId,
            blockId: "gen_footage",
          },
          scenes: generatedScenes,
        }).then((result) => {
          for (const [sceneId, localPath] of result.localClipPaths) h3LocalClipPaths.set(sceneId, localPath);
          return result;
        })
        : await renderGeneratedScenePlanInBatches({
      prefix: `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/generated-footage`,
      maxCostUsd: stageBudgetUsd,
      maxConcurrent,
      lifecycle: {
        ownerId: ctx.ownerId,
        channelId: ctx.channelId,
        runId: ctx.runId,
        blockId: "gen_footage",
      },
      keyframeGate,
      clipGate,
      // A persisted selection wins on retry; otherwise a unique sealed
      // Style-DNA/Visual-Brief treatment is used. Ambiguous DNA stays on the
      // family's proven default rather than guessing an aesthetic mid-run.
      styleId: ltxStyleSelection.styleId,
      scenes: generatedScenes.map((scene) => ({
        // Preserve the admitted id: timeline_assemble later verifies that the
        // R2 clip order still matches this exact cinematic cut plan.
        id: scene.id,
        imagePrompt: `${scene.still}. Absolutely NO text, NO words, NO letters, NO watermark.`,
        ...(scene.terminalStill
          ? {
              terminalImagePrompt:
                `${scene.terminalStill}. Absolutely NO text, NO words, NO letters, NO watermark.`,
              terminalKeyframeRequirements: [
                ...(scene.keyframeRequirements ?? []),
                "terminal frame must fulfill the reviewed reveal/consequence endpoint without changing mannequin identity, wardrobe, props, era, or evidence treatment",
              ],
            }
          : {}),
        motionPrompt: scene.motion,
        ...(scene.diegeticSoundscape ? { diegeticSoundscape: scene.diegeticSoundscape } : {}),
        ...(scene.negative ? { negativePrompt: scene.negative } : {}),
        durationSec: scene.durationSec,
        cameraMove: scene.cameraMove,
        shotScale: scene.shotScale,
        lens: scene.lens,
        ...(scene.continuityIds?.length ? { continuityIds: scene.continuityIds } : {}),
        ...(scene.expectedCastIds ? { expectedCastIds: scene.expectedCastIds } : {}),
        ...(scene.forbidAdditionalPeople ? { forbidAdditionalPeople: true as const } : {}),
        ...(scene.continuitySeed !== undefined ? { seed: scene.continuitySeed } : {}),
        ...(scene.keyframeRequirements?.length ? { keyframeRequirements: scene.keyframeRequirements } : {}),
        ...(creativeAdapter ? { creativeAdapter } : {}),
      })),
      })
      : { scenes: [] as Awaited<ReturnType<typeof renderNovitaGeneratedScenes>>["scenes"], costUsd: 0 };
    if (
      rendered.scenes.length !== generatedScenes.length ||
      rendered.scenes.some((scene, index) => scene.id !== generatedScenes[index]?.id)
    ) {
      throw new Error("gen_footage: Novita completion no longer matches the admitted non-source-proof scene order");
    }
    // Theme-consistent accent color for the name-card overlay below: the
    // channel's own locked Style DNA palette/color-grade, the same source
    // storySpine.ts already reads for its `styleLock` prompt clause. Neither
    // ltxStylePresets.ts's getLtxStyle nor docuStyles.ts's DocuTheme carry a
    // live per-channel id anywhere in this pipeline today (grep-verified: no
    // block ever writes ctx.store["ltxStyleId"] or a "docuStyleId" key), so
    // resolving through either here would always just return their hardcoded
    // defaults — not an actually "consistent" per-channel color. Style DNA is
    // the real signal already available at this exact call site.
    const nameCardAccentColor = dna?.palette?.[0] || dna?.colorGrade || undefined;
    try {
      const renderedBySceneId = new Map(rendered.scenes.map((scene) => [scene.id, scene]));
      const clipResults = await pool<PlannedScene, CompositedFootageClip>(scenes, 3, async (plannedScene, index) => {
        const sourceProof = sourceProofBySceneId.get(plannedScene.id);
        if (sourceProof) {
          ctx.log(`gen_footage: scene ${index + 1}/${scenes.length} using approved source-proof media; no generated output exists for this shot`);
          return { path: sourceProof.localPath };
        }
        const scene = renderedBySceneId.get(plannedScene.id);
        if (!scene) {
          throw new Error(`gen_footage: missing generated result for admitted scene ${plannedScene.id}`);
        }
        // REAL-IMAGE INSERT (Phase 18 Part B, automatic path only). Resolved
        // BEFORE any generated-clip download: when this scene carries
        // ShotPlanSchema.realImageInsertQuery (src/engine/storySpine.ts), a
        // real Wikimedia Commons photograph replaces the generated clip
        // entirely for this one scene — the generated-clip download is
        // skipped outright. Gated to plan.source === "story_spine" like the
        // name-card/evidence-overlay passes below; every shot without this
        // field downloads the generated clip exactly as before (default
        // behavior unchanged).
        const realImageInsertQuery = plan.source === "story_spine" ? plannedScene.realImageInsertQuery : undefined;
        let rawPath: string;
        const h3LocalPath = h3LocalClipPaths.get(plannedScene.id);
        if (realImageInsertQuery) {
          try {
            const image = await searchWikimediaImage(realImageInsertQuery);
            if (!image) {
              throw new Error(`no Wikimedia Commons image found for "${realImageInsertQuery}"`);
            }
            const stillPath = await downloadTo(image.url, join(tmp, `gen_${index}_realimage.jpg`));
            rawPath = await kenBurns(
              stillPath,
              join(tmp, `gen_${index}_realimage.mp4`),
              boundedSceneDuration(plannedScene.durationSec, clipSec),
            );
            ctx.log(
              `gen_footage: scene ${index + 1}/${scenes.length} used a real Wikimedia image for ` +
              `"${realImageInsertQuery}" instead of the generated clip (${image.attribution})`,
            );
          } catch (e) {
            ctx.log(
              `gen_footage: real-image insert failed on scene ${index + 1} (${e instanceof Error ? e.message : e}) — using the generated clip instead`,
            );
            rawPath = h3LocalPath ?? await downloadTo(scene.clipUrl, join(tmp, `gen_${index}.mp4`), {
              timeoutMs: DURABLE_RENDER_OUTPUT_DOWNLOAD_TIMEOUT_MS,
            });
          }
        } else if (h3LocalPath) {
          rawPath = h3LocalPath;
        } else {
          rawPath = await downloadTo(scene.clipUrl, join(tmp, `gen_${index}.mp4`), {
            timeoutMs: DURABLE_RENDER_OUTPUT_DOWNLOAD_TIMEOUT_MS,
          });
        }
        // Character-introduction NAME CARD (automatic path only). Applied
        // here, once, directly to the already-rendered clip file — the exact
        // usage applyNameCardOverlay's own doc comment anticipates
        // (src/lib/ffmpeg.ts) — so timeline_assemble's proven concat/compose
        // graph needs no change at all: the overlay travels with the clip
        // through whichever assembly branch downstream picks it up. Gated to
        // plan.source === "story_spine": the Casefile cinematic_case_sequence
        // route has its own narrativeRole/nameCardText validation
        // (cinematicCaseSequence.ts) and is untouched here.
        const nameCardText = plan.source === "story_spine" ? scenes[index]?.nameCardText : undefined;
        let namedPath = rawPath;
        let nameCardApplied = false;
        if (!nameCardText) {
          ctx.log(`gen_footage: scene ${index + 1}/${scenes.length} complete`);
        } else {
          try {
            const cardPath = join(tmp, `gen_${index}_namecard.mp4`);
            await applyNameCardOverlay(rawPath, cardPath, {
              text: nameCardText,
              // `scene` here is the Novita render RESPONSE (clipUrl/clipKey/
              // reviews) — the authored duration lives on the matching
              // PlannedScene input this response was rendered from.
              durationSec: plannedScene.durationSec,
              accentColor: nameCardAccentColor,
            });
            namedPath = cardPath;
            nameCardApplied = true;
            ctx.log(`gen_footage: scene ${index + 1}/${scenes.length} complete (name card applied)`);
          } catch (e) {
            throw new Error(
              `gen_footage: required name-card overlay failed on scene ${index + 1}: ${e instanceof Error ? e.message : e}`,
            );
          }
        }
        // EVIDENCE OVERLAY (Phase 18 Part A, automatic path only). Selected
        // once, up front, across the whole shot list by
        // selectAutomaticEvidenceOverlayShots inside scenePlanFromStorySpine
        // (capped at 2/video — see that function's own doc comment). An
        // independent finishing pass from the name card above, applied
        // after it so both can stack on the same clip. A planned overlay is
        // required: failure stops the run so QA never certifies a master that
        // silently lost authored evidence text.
        const evidenceOverlay = plan.source === "story_spine" ? scenes[index]?.evidenceOverlay : undefined;
        if (!evidenceOverlay) {
          return {
            path: namedPath,
            ...(nameCardApplied ? { nameCardText } : {}),
          };
        }
        try {
          const overlayDurationSec = Math.max(
            1.2,
            Math.min(2.2, plannedScene.durationSec - 0.3),
          );
          const overlayClipPath = await renderOverlay({
            spec: {
              templateId: evidenceOverlay.templateId,
              primary: evidenceOverlay.primary,
              secondary: evidenceOverlay.secondary,
              accent: nameCardAccentColor,
              durationSec: overlayDurationSec,
            },
            projectDir: join(tmp, `gen_${index}_overlay`),
            log: ctx.log,
          });
          const overlaidPath = join(tmp, `gen_${index}_evidence.mp4`);
          await applyHyperframesOverlayClip(namedPath, overlayClipPath, overlaidPath, {
            durationSec: overlayDurationSec,
          });
          ctx.log(
            `gen_footage: scene ${index + 1}/${scenes.length} evidence overlay applied (${evidenceOverlay.templateId})`,
          );
          return {
            path: overlaidPath,
            ...(nameCardApplied ? { nameCardText } : {}),
            evidenceOverlay: {
              text: [evidenceOverlay.primary, evidenceOverlay.secondary].filter(Boolean).join(" "),
              durationSec: overlayDurationSec,
            },
          };
        } catch (e) {
          throw new Error(
            `gen_footage: required evidence overlay failed on scene ${index + 1}: ${e instanceof Error ? e.message : e}`,
          );
        }
      });
      const clips = clipResults.map((result) => result.path);
      const footageTextCues = footageOnScreenTextCues(
        scenes.map((scene, index) => ({
          sceneId: scene.id,
          durationSec: scene.durationSec,
          ...(clipResults[index]?.nameCardText ? { nameCardText: clipResults[index]!.nameCardText } : {}),
          ...(clipResults[index]?.evidenceOverlay ? { evidenceOverlay: clipResults[index]!.evidenceOverlay } : {}),
        })),
      );
      const transitionToNextReviewByIndex = new Map<number, Awaited<ReturnType<typeof reviewCinematicTransition>>>();
      if (plan.source === "cinematic_case_sequence") {
        for (let index = 0; index < scenes.length - 1; index++) {
          const fromScene = scenes[index]!;
          const toScene = scenes[index + 1]!;
          if (!toScene.cutReason || !toScene.tensionState) {
            throw new Error(`gen_footage: cinematic scene ${toScene.id} is missing its reviewed incoming cut rationale`);
          }
          const transition = await reviewCinematicTransition({
            fromScene: {
              id: fromScene.id,
              imagePrompt: fromScene.still,
              motionPrompt: fromScene.motion,
              ...(fromScene.continuityIds?.length ? { continuityIds: fromScene.continuityIds } : {}),
            },
            toScene: {
              id: toScene.id,
              imagePrompt: toScene.still,
              motionPrompt: toScene.motion,
              ...(toScene.continuityIds?.length ? { continuityIds: toScene.continuityIds } : {}),
            },
            previousClipPath: clips[index]!,
            nextClipPath: clips[index + 1]!,
            cutReason: toScene.cutReason,
            tensionState: toScene.tensionState,
            workDir: cinematicClipTmp!,
          });
          transitionToNextReviewByIndex.set(index, transition);
        }
        ctx.log(`gen_footage: ${transitionToNextReviewByIndex.size} actual cinematic cut transition(s) accepted`);
      }
      const generatedFootageSceneManifest = GeneratedFootageSceneManifestSchema.parse({
        version: GENERATED_FOOTAGE_SCENE_MANIFEST_VERSION,
        source: plan.source,
        ...(plan.sequenceFingerprint ? { sequenceFingerprint: plan.sequenceFingerprint } : {}),
        exactOrder: true,
        durationSec: plan.source === "cinematic_case_sequence"
          ? (scenes.at(-1)?.t1 ?? 0)
          : scenes.reduce((sum, scene) => sum + scene.durationSec, 0),
        items: scenes.map((plannedScene, index) => {
          const sourceProof = sourceProofBySceneId.get(plannedScene.id);
          const renderedScene = renderedBySceneId.get(plannedScene.id);
          if (!sourceProof && !renderedScene) {
            throw new Error(`gen_footage: manifest cannot find rendered output for ${plannedScene.id}`);
          }
          return {
            sceneId: plannedScene.id,
            clipKey: sourceProof?.receipt.clipKey ?? renderedScene!.clipKey,
            ...(sourceProof ? { sourceProofMediaReceipt: sourceProof.receipt } : {}),
            ...(renderedScene?.keyframeReview ? { keyframeReview: renderedScene.keyframeReview } : {}),
            ...(renderedScene?.terminalStillKey ? { terminalStillKey: renderedScene.terminalStillKey } : {}),
            ...(renderedScene?.terminalKeyframeReview
              ? { terminalKeyframeReview: renderedScene.terminalKeyframeReview }
              : {}),
            ...(renderedScene?.clipReview ? { clipReview: renderedScene.clipReview } : {}),
            ...(renderedScene?.openingMotionQa ? { openingMotionQa: renderedScene.openingMotionQa } : {}),
            ...(transitionToNextReviewByIndex.has(index)
              ? { transitionToNextReview: transitionToNextReviewByIndex.get(index)! }
              : {}),
            ...(plannedScene.t0 !== undefined ? { t0: plannedScene.t0 } : {}),
            ...(plannedScene.t1 !== undefined ? { t1: plannedScene.t1 } : {}),
            ...(plannedScene.continuitySeed !== undefined ? { continuitySeed: plannedScene.continuitySeed } : {}),
          };
        }),
      });
      const footageKeys = scenes.map((scene) => {
        const sourceProof = sourceProofBySceneId.get(scene.id);
        const renderedScene = renderedBySceneId.get(scene.id);
        if (!sourceProof && !renderedScene) throw new Error(`gen_footage: missing durable footage key for ${scene.id}`);
        return sourceProof?.receipt.clipKey ?? renderedScene!.clipKey;
      });
      ctx.log(
        `gen_footage: ${generatedScenes.length} MiniMax H3 clip(s) + ${sourceProofBySceneId.size} approved source-proof clip(s), ` +
        `provider receipt $${rendered.costUsd.toFixed(4)}`,
      );
      const renderer: GeneratedFootageRenderer = useH3ForFreshGeneratedScenes
        ? {
            kind: "minimax-h3",
            provider: "novita",
            execution: "on-demand",
            runtimeId: MINIMAX_H3_RUNTIME_ID,
            profileId: MINIMAX_H3_PROFILE.id,
            modelManifestSha256: MINIMAX_H3_MANIFEST_SHA256,
          }
        : { kind: "novita-ltx", styleId: ltxStyleSelection.styleId };
      return {
        footageClips: clips,
        footageKeys,
        generatedFootageSceneManifest,
        footageOnScreenTextCues: footageTextCues,
        footageRenderer: renderer,
        ltxStyleId: ltxStyleSelection.styleId,
        ltxStyleSelection,
        [COST_PATCH_KEY]: rendered.costUsd,
      };
    } catch (error) {
      throw withAdditionalObservedCost(error, rendered.costUsd);
    }
  },
};

/**
 * SIGNATURE CLIPS — the channel's canonical, DNA-locked establishing shots
 * (Flux still → i2v), generated to PREPEND to the stock body. Extracted from
 * stock_footage so footage SELECTION and signature GENERATION are separate
 * single-responsibility blocks. Produces `signatureClips`; stock_footage (the
 * next block) prepends them. Default count 0 → no-op (produces []).
 */
export const signatureClipsBlock: Block = {
  id: "signature_clips",
  // See gen_footage: a validated plan is an alternative input contract, so it
  // cannot be represented as a single all-of legacy `consumes` requirement.
  consumes: [],
  produces: ["signatureClips", "signatureKeys"],
  paid: true,
  run: async (ctx) => {
    // boundedInteger, not a raw clamp: Math.max(0, Math.min(6, NaN)) is NaN, and
    // NaN <= 0 is false, so a malformed count slipped past this block's guard AND
    // the generator's into a PAID path. A bad param now resolves to the
    // documented default of 0, which returns early as intended.
    const k = boundedInteger(ctx.params["count"] ?? ctx.params["signatureGenClips"], 0, 0, 6);
    if (k <= 0) return { signatureClips: [], signatureKeys: [], [COST_PATCH_KEY]: 0 };
    const sig = await generateSignatureClips(ctx, k);
    // R2-back for resume: without keys, any retry/heal re-SPENT the generation.
    const signatureKeys: string[] = [];
    for (let i = 0; i < sig.clips.length; i++) {
      const key = `${ctx.keyPrefix}footage/run/${ctx.runId}/sig_${i}.mp4`;
      await putObject(key, await readBytes(sig.clips[i]), { contentType: "video/mp4" });
      signatureKeys.push(key);
    }
    ctx.log(`signature_clips: ${sig.clips.length} DNA-locked establishing shot(s) (~$${sig.cost.toFixed(2)})`);
    return { signatureClips: sig.clips, signatureKeys, [COST_PATCH_KEY]: sig.cost };
  },
};

export const genFootageBlocks: Block[] = [genFootage, signatureClipsBlock];
