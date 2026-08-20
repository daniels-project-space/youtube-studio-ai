/**
 * gen_footage â€” GENERATED b-roll: the visual engine for channels whose world
 * CANNOT come from a stock library (whiteboard draw-ons, painted worlds,
 * signature scenes). Drop-in producer-compatible with stock_footage (same
 * `footageClips` contract â†’ timeline_assemble just works), so the designer/
 * architect can SWAP stock for generation per channel identity.
 *
 * Per scene: a validated shared story plan â†’ the centrally attested Novita
 * image-to-video profile. This legacy adapter never chooses or advertises a
 * concrete video model: central runtime admission owns that decision.
 */
import type { Block } from "@/engine/types";
import { join } from "node:path";
import { makeRunTempDir, downloadTo, readBytes } from "@/lib/files";
import { putObject } from "@/lib/storage";
import { renderNovitaGeneratedScenes } from "@/lib/novitaMedia";
import { applyNameCardOverlay } from "@/lib/ffmpeg";
import { kenBurns, applyHyperframesOverlayClip } from "@/lib/ffmpeg";
import { searchWikimediaImage } from "@/lib/wikimedia";
import { renderOverlay, selectAutomaticEvidenceOverlayShots, type OverlayTemplateId } from "@/lib/hyperframesOverlay";
import { hasNonGoogleVisionKey } from "@/lib/vision";
import { requireNovitaStageBudget } from "@/lib/novitaCostEnvelope";
import { reviewCinematicKeyframe } from "@/lib/cinematicKeyframeGate";
import { reviewCinematicClip } from "@/lib/cinematicClipGate";
import { reviewCinematicTransition } from "@/lib/cinematicTransitionGate";
import { LtxCreativeAdapterSelectionSchema } from "@/lib/ltxCreativeAdapter";
import { resolveApprovedSourceProofMedia } from "@/lib/sourceProofMedia";
import { FAMILIES } from "@/engine/families";
import { SceneManifestSchema } from "@/engine/episodeGraph";
import { StorySpineSchema, type ShotPlan, validateStorySpine } from "@/engine/storySpine";
import { CinematicGeneratedScenePlanSchema } from "@/engine/cinematicCaseSequence";
import { assertCinematicFinalMasterQaAdmission } from "@/engine/cinematicFinalMasterQaAdmission";
import {
  GENERATED_FOOTAGE_SCENE_MANIFEST_VERSION,
  GeneratedFootageSceneManifestSchema,
} from "@/engine/generatedFootageManifest";
import type {
  SourceProofMediaObligation,
  SourceProofMediaReceipt,
} from "@/engine/sourceProofMedia";
import { COST_PATCH_KEY } from "@/engine/types";

/** Ordered pool (same as narratedBlocks.mapPool â€” local copy, no cross-import). */
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
  /** Optional reviewed target for LTX's final conditioned frame. */
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

export interface ResolvedGeneratedFootageScenePlan {
  source: "story_spine" | "scene_manifest" | "cinematic_case_sequence";
  scenes: PlannedScene[];
  /** Binds the rendered clip order to the reviewed cinematic sequence. */
  sequenceFingerprint?: string;
}

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
  // Signature clips are still LTX I2V takes. Keep the same sealed creative-
  // adapter route as the main generated-footage lane so a calibrated wardrobe
  // or material look cannot disappear just because a channel uses a hybrid
  // stock-plus-cinematic opening.
  const signatureCreativeAdapter = LtxCreativeAdapterSelectionSchema.optional().parse(
    ctx.params["ltxCreativeAdapter"],
  );
  ctx.log(`signature_clips: using ${plan.source} (${scenes.length} validated scene(s))`);
  const stageBudgetUsd = requireNovitaStageBudget(ctx.stageBudgetUsd, "signature_clips");
  const rendered = await renderNovitaGeneratedScenes({
    prefix: `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/signature-clips`,
    profileId: "production",
    // Signature clips render through the same cinematic-only gen_footage
    // path (see the styleId comment on the main render call above).
    styleId: FAMILIES.cinematic.styleId,
    maxCostUsd: stageBudgetUsd,
    maxConcurrent: Math.min(8, Math.max(1, scenes.length)),
    lifecycle: {
      ownerId: ctx.ownerId,
      channelId: ctx.channelId,
      runId: ctx.runId,
      blockId: "signature_clips",
    },
    scenes: scenes.map((scene, index) => ({
      id: `signature-${index + 1}`,
      imagePrompt: `${scene.still}. Absolutely NO text, NO words, NO letters.`,
      motionPrompt: scene.motion,
      ...(scene.negative ? { negativePrompt: scene.negative } : {}),
      durationSec: 5,
      cameraMove: scene.cameraMove,
      shotScale: scene.shotScale,
      lens: scene.lens,
      ...(signatureCreativeAdapter ? { creativeAdapter: signatureCreativeAdapter } : {}),
    })),
  });
  const tmp = await makeRunTempDir(ctx.runId);
  try {
    const clips = await pool(rendered.scenes, 3, (scene, index) =>
      downloadTo(scene.clipUrl, join(tmp, `sig_${index}.mp4`)));
    return { clips, cost: rendered.costUsd };
  } catch (error) {
    throw withAdditionalObservedCost(error, rendered.costUsd);
  }
}

export const genFootage: Block = {
  id: "gen_footage",
  // The engine's Block ABI has only an all-of `consumes` list, while this
  // renderer deliberately accepts either a Story Spine or Scene Manifest.
  // Both alternatives are declared as optional manifest inputs; the resolver
  // below validates the complete handoff and fails before paid work if absent.
  consumes: [],
  produces: ["footageClips", "footageKeys", "generatedFootageSceneManifest"],
  paid: true,
  run: async (ctx) => {
    assertCentralNovitaSelection(ctx.params["i2vModel"], "gen_footage");
    const dna = ctx.store["styleDNA"] as {
      visualAvoid?: string[];
      palette?: string[];
      colorGrade?: string;
    } | null;
    const narrationSec = Number(ctx.store["narrationDurationSec"] ?? 0) || 300;
    const clipSec = Math.min(10, Math.max(5, Number(ctx.params["clipSec"] ?? 5)));
    const genericMaxClips = Math.max(
      6,
      Math.min(24, Number(ctx.params["maxClips"] ?? Math.ceil(narrationSec / 22))),
    );
    const hasCinematicSequence = ctx.store["cinematicGeneratedScenePlan"] !== undefined;
    // Cinematic keyframe, take, and cut gates are independent visual evidence,
    // not an optional after-spend review. Fail before the first Novita request
    // when no eligible non-Google reviewer can attest the sequence.
    if (hasCinematicSequence && !hasNonGoogleVisionKey()) {
      throw new Error(
        "gen_footage: admitted cinematic_case_sequence requires OPENROUTER_API_KEY for independent non-Google visual gates before Novita rendering",
      );
    }
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
    const creativeAdapter = LtxCreativeAdapterSelectionSchema.optional().parse(
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
          ctx.log(`gen_footage: ${scene.id} resolved approved source-proof asset ${sourceProof.receipt.obligation.assetId}; LTX bypassed`);
        },
      );
    }
    const ltxScenes = scenes.filter((scene) => scene.sourceProofMedia === undefined);
    if (plan.source === "cinematic_case_sequence") {
      for (const scene of ltxScenes) {
        if (!Array.isArray(scene.expectedCastIds) || scene.forbidAdditionalPeople !== true) {
          throw new Error(
            `gen_footage: cinematic scene ${scene.id} is missing its sealed no-extra-people contract; refusing any LTX render`,
          );
        }
      }
    }

    const requestedConcurrency = Number(ctx.params["maxConcurrent"] ?? 3);
    const maxConcurrent = Math.min(8, Math.max(1, Math.floor(requestedConcurrency)));
    const stageBudgetUsd = ltxScenes.length > 0
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
    // contract before LTX spends, and fails rather than pretending text alone
    // can establish character consistency.
    const cinematicKeyframeTmp = hasCinematicSequence
      ? await makeRunTempDir(`${ctx.runId}-cinematic-keyframes`)
      : undefined;
    const cinematicClipTmp = hasCinematicSequence
      ? await makeRunTempDir(`${ctx.runId}-cinematic-clips`)
      : undefined;
    const acceptedReferenceByCastId = new Map<string, { sceneId: string; path: string }>();
    const keyframeGate = hasCinematicSequence
      ? {
          // One replacement is the only automatic recovery. More retries hide
          // a broken prompt behind unbounded spend instead of surfacing it.
          maxImageAttempts: 2 as const,
          review: async ({ scene, stillUrl }: Parameters<NonNullable<Parameters<typeof renderNovitaGeneratedScenes>[0]["keyframeGate"]>["review"]>[0]) => {
          const candidatePath = await downloadTo(
            stillUrl,
            join(cinematicKeyframeTmp!, `${scene.id.replace(/[^a-z0-9_-]/gi, "_")}.png`),
          );
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
          for (const castId of continuityIds) {
            if (!acceptedReferenceByCastId.has(castId)) {
              acceptedReferenceByCastId.set(castId, { sceneId: scene.id, path: candidatePath });
            }
          }
          return review;
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
            const stillPath = await downloadTo(stillUrl, join(cinematicClipTmp!, `${safeSceneId}-source.png`));
            const terminalStillPath = terminalStillUrl
              ? await downloadTo(terminalStillUrl, join(cinematicClipTmp!, `${safeSceneId}-terminal.png`))
              : undefined;
            const clipPath = await downloadTo(clipUrl, join(cinematicClipTmp!, `${safeSceneId}-candidate.mp4`));
            return await reviewCinematicClip({
              scene,
              stillPath,
              ...(terminalStillPath && terminalStillKey ? { terminalStillPath, terminalStillKey } : {}),
              clipPath,
              workDir: cinematicClipTmp!,
            });
          },
        }
      : undefined;
    const rendered = ltxScenes.length > 0
      ? await renderGeneratedScenePlanInBatches({
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
      // gen_footage is reached only via the cinematic family's "ai_scenes"
      // visual engine (see src/engine/families.ts) — no channel-level style
      // override exists yet, so every run gets that family's default look.
      styleId: FAMILIES.cinematic.styleId,
      scenes: ltxScenes.map((scene) => ({
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
      rendered.scenes.length !== ltxScenes.length ||
      rendered.scenes.some((scene, index) => scene.id !== ltxScenes[index]?.id)
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
      const clips = await pool(scenes, 3, async (plannedScene, index) => {
        const sourceProof = sourceProofBySceneId.get(plannedScene.id);
        if (sourceProof) {
          ctx.log(`gen_footage: scene ${index + 1}/${scenes.length} using approved source-proof media; no LTX output exists for this shot`);
          return sourceProof.localPath;
        }
        const scene = renderedBySceneId.get(plannedScene.id);
        if (!scene) {
          throw new Error(`gen_footage: missing LTX result for admitted scene ${plannedScene.id}`);
        }
        // REAL-IMAGE INSERT (Phase 18 Part B, automatic path only). Resolved
        // BEFORE any LTX download: when this scene carries
        // ShotPlanSchema.realImageInsertQuery (src/engine/storySpine.ts), a
        // real Wikimedia Commons photograph replaces the generated clip
        // entirely for this one scene — the generated-clip download is
        // skipped outright. Gated to plan.source === "story_spine" like the
        // name-card/evidence-overlay passes below; every shot without this
        // field downloads the generated clip exactly as before (default
        // behavior unchanged).
        const realImageInsertQuery = plan.source === "story_spine" ? plannedScene.realImageInsertQuery : undefined;
        let rawPath: string;
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
            rawPath = await downloadTo(scene.clipUrl, join(tmp, `gen_${index}.mp4`));
          }
        } else {
          rawPath = await downloadTo(scene.clipUrl, join(tmp, `gen_${index}.mp4`));
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
            ctx.log(`gen_footage: scene ${index + 1}/${scenes.length} complete (name card applied)`);
          } catch (e) {
            ctx.log(
              `gen_footage: name-card overlay failed on scene ${index + 1} (${e instanceof Error ? e.message : e}) — using the clip without it`,
            );
          }
        }
        // EVIDENCE OVERLAY (Phase 18 Part A, automatic path only). Selected
        // once, up front, across the whole shot list by
        // selectAutomaticEvidenceOverlayShots inside scenePlanFromStorySpine
        // (capped at 2/video — see that function's own doc comment). An
        // independent finishing pass from the name card above, applied
        // after it so both can stack on the same clip. Gated the same way;
        // graceful degrade on failure, same as the name-card pass.
        const evidenceOverlay = plan.source === "story_spine" ? scenes[index]?.evidenceOverlay : undefined;
        if (!evidenceOverlay) return namedPath;
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
          return overlaidPath;
        } catch (e) {
          ctx.log(
            `gen_footage: evidence overlay failed on scene ${index + 1} (${e instanceof Error ? e.message : e}) — using the clip without it`,
          );
          return namedPath;
        }
      });
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
        `gen_footage: ${ltxScenes.length} Novita Z-Image/LTX clip(s) + ${sourceProofBySceneId.size} approved source-proof clip(s), ` +
        `provider receipt $${rendered.costUsd.toFixed(4)}`,
      );
      return {
        footageClips: clips,
        footageKeys,
        generatedFootageSceneManifest,
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
    const k = Math.max(0, Math.min(6, Number(ctx.params["count"] ?? ctx.params["signatureGenClips"] ?? 0)));
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
