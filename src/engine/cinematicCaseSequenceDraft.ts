import { createHash } from "node:crypto";

import { z } from "zod";

import {
  CasefileEvidenceShotMapSchema,
  type CasefileEvidenceShotMap,
  type CasefileEvidenceShotMapTreatment,
} from "./casefileEvidenceShotMap";
import {
  CINEMATIC_CASE_SEQUENCE_VERSION,
  CinematicCaseSequenceInputSchema,
  CinematicMannequinSchema,
  CinematicSequenceEditorialReviewSchema,
  cinematicCaseSequenceContentFingerprint,
  type CinematicCaseSequenceContent,
  type CinematicCaseSequenceInput,
} from "./cinematicCaseSequence";
import { SceneManifestSchema } from "./episodeGraph";
import { ShotPlanSchema, type ShotPlan } from "./storySpine";

/**
 * A small human-authored direction card replaces hand-writing every LTX prompt.
 * It deliberately contains only original mannequin wardrobe/world locks and a
 * causal question; factual claims, source ids, timings, and allowable visual
 * treatments always come from the admitted Casefile plan.
 */
export const CINEMATIC_CASE_DIRECTION_VERSION = "cinematic-case-direction/v1" as const;
export const CINEMATIC_CASE_SEQUENCE_DRAFT_VERSION = "cinematic-case-sequence-draft/v1" as const;

const identifier = (prefix: string) =>
  z.string().regex(
    new RegExp(`^${prefix}-[a-z0-9][a-z0-9-]{1,119}$`),
    `expected ${prefix}- prefixed identifier`,
  );
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/, "expected sha256 fingerprint");
const text = (maximum: number) => z.string().trim().min(1).max(maximum);

export const CinematicCaseDirectionSchema = z
  .object({
    version: z.literal(CINEMATIC_CASE_DIRECTION_VERSION),
    sequenceId: identifier("cinematic-sequence"),
    caseId: identifier("case"),
    causalQuestion: text(400),
    visualWorld: text(500),
    cast: z.array(CinematicMannequinSchema).min(1).max(8),
  })
  .strict();
export type CinematicCaseDirection = z.infer<typeof CinematicCaseDirectionSchema>;

export const CinematicCaseSequenceDraftSchema = z
  .object({
    version: z.literal(CINEMATIC_CASE_SEQUENCE_DRAFT_VERSION),
    content: CinematicCaseSequenceInputSchema.omit({ editorialReview: true }),
    sequenceContentFingerprint: fingerprint,
    directionFingerprint: fingerprint,
    release: z.literal("private_human_editorial_review_required"),
    requiresHumanEditorialReview: z.literal(true),
  })
  .strict();
export type CinematicCaseSequenceDraft = z.infer<typeof CinematicCaseSequenceDraftSchema>;

type DraftCoverageShot = CinematicCaseSequenceContent["beats"][number]["shots"][number];
type DraftBeat = CinematicCaseSequenceContent["beats"][number];
type EvidenceBinding = CasefileEvidenceShotMap["claimMappings"][number]["bindings"][number];

// The locked LTX profile renders 3–10 second source clips. A Fern-style
// coverage beat therefore needs enough narrated runway for three purposeful
// shots; beats with twelve or more seconds earn a fourth consequence/reaction
// cut. Generating 1–2 second clips and trimming them in assembly is neither
// cinematic nor a truthful use of the approved cut plan.
const MIN_LTX_SHOT_SEC = 3;
const MIN_CINEMATIC_BEAT_SEC = MIN_LTX_SHOT_SEC * 3;
const FOUR_SHOT_CINEMATIC_BEAT_SEC = MIN_LTX_SHOT_SEC * 4;
const TARGET_CINEMATIC_BEAT_SEC = 12;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function directionFingerprint(direction: CinematicCaseDirection): string {
  return hash({
    version: direction.version,
    sequenceId: direction.sequenceId,
    caseId: direction.caseId,
    causalQuestion: direction.causalQuestion,
    visualWorld: direction.visualWorld,
    cast: direction.cast,
  });
}

function roleFor(index: number, total: number): DraftBeat["narrativeRole"] {
  if (index === 0) return "cold_open";
  if (index === total - 1) return "closing_residue";
  if (total >= 3 && index === Math.floor(total / 2)) return "reveal";
  return "investigation";
}

function modePlan(binding: EvidenceBinding, coverageCount: 3 | 4): {
  readonly modes: readonly DraftCoverageShot["visualMode"][];
  readonly abstractDisclosure?: string;
} {
  const withAftermath = (modes: readonly DraftCoverageShot["visualMode"][]) =>
    coverageCount === 4 ? [...modes, "atmosphere"] as const : modes;
  switch (binding.treatment) {
    case "map":
    case "timeline":
      return { modes: withAftermath(["spatial_reconstruction", "atmosphere", "source_proof"]) };
    case "document_abstraction":
      return { modes: withAftermath(["atmosphere", "atmosphere", "source_proof"]) };
    case "neutral_reenactment":
      if (!binding.reconstructionDisclosure) {
        throw new Error(
          "cinematic draft: neutral reenactment binding is missing its exact reconstruction disclosure; " +
            "repair the admitted Casefile evidence map before cinematic planning",
        );
      }
      return {
        // The second visual is the explicitly declared mannequin action.
        // Keeping it beside the matching coverage purpose makes wardrobe and
        // movement locks part of the action, rather than a decorative insert.
        modes: withAftermath(["spatial_reconstruction", "abstract_reenactment", "source_proof"]),
        abstractDisclosure: binding.reconstructionDisclosure,
      };
  }
}

function motivatedMove(
  parent: ShotPlan,
  slot: number,
  treatment: CasefileEvidenceShotMapTreatment,
  prior: readonly DraftCoverageShot[],
): DraftCoverageShot["cameraMove"] {
  const base: DraftCoverageShot["cameraMove"] = slot === 0
    ? parent.cameraMove
    : slot === 1
      ? treatment === "timeline" || treatment === "map" ? "truck_right" : treatment === "neutral_reenactment" ? "dolly_push" : "dolly_pull"
      : slot === 2
        // The evidence insert is held long enough to be understood, not swept
        // past as B-roll. The fourth cut, when the narration has earned it,
        // deliberately restores spatial consequence or emotional residue.
        ? "static"
        : treatment === "timeline" || treatment === "map" ? "truck_left" : "dolly_pull";
  const twoBefore = prior.at(-2)?.cameraMove;
  const oneBefore = prior.at(-1)?.cameraMove;
  if (twoBefore === base && oneBefore === base) {
    // This is a safety correction, not a camera carousel: a source document
    // cannot be the third visually identical take in the final edit.
    return base === "static" ? "dolly_pull" : "static";
  }
  return base;
}

function beatTension(
  role: DraftBeat["narrativeRole"],
  isFinalBeat: boolean,
  coverageCount: 3 | 4,
): readonly DraftCoverageShot["tensionState"][] {
  if (role === "cold_open") {
    return coverageCount === 4
      ? ["question", "pressure", "uncertainty", isFinalBeat ? "residue" : "pressure"]
      : ["question", "pressure", isFinalBeat ? "residue" : "uncertainty"];
  }
  if (role === "reveal") {
    return coverageCount === 4
      ? ["uncertainty", "pressure", "reversal", "release"]
      : ["reversal", "release", "release"];
  }
  if (role === "closing_residue") {
    return coverageCount === 4
      ? ["release", "uncertainty", "release", "residue"]
      : ["release", "residue", "residue"];
  }
  return coverageCount === 4
    ? ["orientation", "pressure", "uncertainty", "pressure"]
    : ["orientation", "pressure", "uncertainty"];
}

function beatCuts(
  role: DraftBeat["narrativeRole"],
  coverageCount: 3 | 4,
): readonly DraftCoverageShot["cutReason"][] {
  if (role === "reveal") {
    return coverageCount === 4
      ? ["new_relationship", "physical_action", "reveal", "breath"]
      : ["new_relationship", "reveal", "reveal"];
  }
  if (role === "closing_residue") {
    return coverageCount === 4
      ? ["new_fact", "new_relationship", "breath", "breath"]
      : ["new_fact", "breath", "breath"];
  }
  return coverageCount === 4
    ? ["new_location", "physical_action", "new_fact", "contradiction"]
    : ["new_location", "physical_action", "new_fact"];
}

function coveragePlan(
  role: DraftBeat["narrativeRole"],
  duration: number,
): {
  coverageCount: 3 | 4;
  purposes: readonly DraftCoverageShot["coveragePurpose"][];
  scales: readonly DraftCoverageShot["shotScale"][];
} {
  const coverageCount: 3 | 4 = duration >= FOUR_SHOT_CINEMATIC_BEAT_SEC ? 4 : 3;
  const finalPurpose: DraftCoverageShot["coveragePurpose"] = role === "reveal"
    ? "consequence"
    : role === "closing_residue"
      ? "aftermath"
      : "reaction";
  return {
    coverageCount,
    purposes: coverageCount === 4
      ? ["spatial_anchor", "mannequin_action", "evidence_insert", finalPurpose]
      : ["spatial_anchor", "mannequin_action", "evidence_insert"],
    scales: coverageCount === 4
      ? ["establishing", "medium", "close", "wide"]
      : ["establishing", "medium", "close"],
  };
}

/**
 * Divide a narration window into renderable takes without a blind equal split.
 * The evidence insert gets a controlled readable hold; the consequence cut
 * receives the remaining visual breath. At exactly twelve seconds every take
 * remains the locked three-second LTX minimum.
 */
function coverageBoundaries(t0: number, t1: number, coverageCount: 3 | 4): number[] {
  const duration = t1 - t0;
  const flexibleDuration = duration - MIN_LTX_SHOT_SEC * coverageCount;
  const weights = coverageCount === 4
    ? [0.22, 0.31, 0.21, 0.26]
    : [0.29, 0.38, 0.33];
  const boundaries = [t0];
  let cursor = t0;
  for (let slot = 0; slot < coverageCount - 1; slot++) {
    cursor += MIN_LTX_SHOT_SEC + flexibleDuration * weights[slot]!;
    boundaries.push(Number(cursor.toFixed(3)));
  }
  boundaries.push(t1);
  return boundaries;
}

function causalQuestion(
  direction: CinematicCaseDirection,
  shots: readonly ShotPlan[],
  role: DraftBeat["narrativeRole"],
): string {
  const evidence = shots
    .map((shot) => shot.coveragePurpose.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("; ")
    .slice(0, 220);
  if (role === "cold_open") return direction.causalQuestion;
  if (role === "reveal") {
    return `What changes in the answer to "${direction.causalQuestion}" when this cited evidence is understood: ${evidence}?`;
  }
  return `How does this cited beat advance the answer to "${direction.causalQuestion}"?`;
}

function union<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

/**
 * Story Spine is sentence-aligned and can therefore contain very short
 * windows. LTX is not. Form a causal beat from contiguous source shots before
 * assigning the spatial/action/evidence coverage grammar, then merge a short
 * tail back into its predecessor. This preserves exact narration boundaries
 * without manufacturing sub-three-second LTX clips.
 */
function causalBeatWindows(orderedShots: readonly ShotPlan[]): ShotPlan[][] {
  const windows: ShotPlan[][] = [];
  let current: ShotPlan[] = [];
  let currentDuration = 0;

  for (const shot of orderedShots) {
    current.push(shot);
    currentDuration += shot.t1 - shot.t0;
    if (currentDuration >= TARGET_CINEMATIC_BEAT_SEC) {
      windows.push(current);
      current = [];
      currentDuration = 0;
    }
  }
  if (current.length) windows.push(current);

  const durationOf = (shots: readonly ShotPlan[]) =>
    shots.reduce((total, shot) => total + (shot.t1 - shot.t0), 0);
  if (windows.length >= 2 && durationOf(windows.at(-1)!) < MIN_CINEMATIC_BEAT_SEC) {
    windows[windows.length - 2]!.push(...windows.pop()!);
  }
  if (windows.some((window) => durationOf(window) < MIN_CINEMATIC_BEAT_SEC)) {
    throw new Error(
      `cinematic draft: each causal beat needs at least ${MIN_CINEMATIC_BEAT_SEC}s of contiguous narration ` +
        `for three ${MIN_LTX_SHOT_SEC}s LTX coverage shots; merge or extend the source Story Spine before cinematic planning`,
    );
  }
  return windows;
}

/**
 * Deterministically converts the admitted factual map + Story Spine into an
 * editor-ready, three-or-four-shot-per-beat Fern-style coverage draft. It never writes
 * an editorial approval and it fails if upstream proof cannot support every
 * narrated story shot, which prevents a generic prompt fallback from inventing
 * a crime reconstruction.
 */
export function planCinematicCaseSequenceDraft(args: {
  direction: unknown;
  evidenceShotMap: unknown;
  sceneManifest: unknown;
  shotList: unknown;
}): CinematicCaseSequenceDraft {
  const direction = CinematicCaseDirectionSchema.parse(args.direction);
  const map = CasefileEvidenceShotMapSchema.parse(args.evidenceShotMap);
  const manifest = SceneManifestSchema.parse(args.sceneManifest);
  const shots = z.array(ShotPlanSchema).min(1).max(2_000).parse(args.shotList);
  if (direction.caseId !== map.caseId) {
    throw new Error("cinematic draft: direction caseId does not match the admitted Casefile evidence map");
  }
  if (map.sceneManifestFingerprint !== manifest.fingerprint) {
    throw new Error("cinematic draft: evidence map is not bound to the supplied Scene Manifest");
  }
  const orderedShots = [...shots].sort((left, right) => left.t0 - right.t0 || left.id.localeCompare(right.id));
  const cinematicShots: DraftCoverageShot[] = [];
  const causalWindows = causalBeatWindows(orderedShots);
  const beats: DraftBeat[] = causalWindows.map((parents, index) => {
    const role = roleFor(index, causalWindows.length);
    const related = map.claimMappings.flatMap((mapping) =>
      mapping.bindings
        .filter((binding) => binding.shotIds.some((shotId) => parents.some((parent) => parent.id === shotId)))
        .map((binding) => ({ claimId: mapping.claimId, binding })),
    );
    if (!related.length) {
      throw new Error(
        `cinematic draft: Story Spine beat ${parents.map((parent) => parent.id).join(", ")} has no admitted factual claim binding; ` +
          "repair casefile_evidence_shot_map rather than inventing a visual",
      );
    }
    // Prefer a specifically admitted neutral reconstruction when it exists.
    // That is the only route that may place the original faceless mannequin
    // in the scene; otherwise we stay with the first cited documentary/map
    // treatment instead of inventing a dramatic reenactment.
    const binding = related.find(({ binding }) => binding.treatment === "neutral_reenactment")?.binding ?? related[0]!.binding;
    const t0 = parents[0]!.t0;
    const t1 = parents.at(-1)!.t1;
    const duration = t1 - t0;
    if (!Number.isFinite(duration) || duration < MIN_CINEMATIC_BEAT_SEC) {
      throw new Error(`cinematic draft: source beat ${parents.map((parent) => parent.id).join(", ")} has no usable renderable narration duration`);
    }
    const coverage = coveragePlan(role, duration);
    const modes = modePlan(binding, coverage.coverageCount);
    const boundaries = coverageBoundaries(t0, t1, coverage.coverageCount);
    const tension = beatTension(role, index === causalWindows.length - 1, coverage.coverageCount);
    const cuts = beatCuts(role, coverage.coverageCount);
    const beatQuestion = causalQuestion(direction, parents, role);
    const primaryParent = parents[0]!;
    const sourceMoments = parents
      .map((parent) => `Narrated source moment: ${parent.literalContent}`)
      .join(" ")
      .slice(0, 900);
    const coverageShots = modes.modes.map((visualMode, slot): DraftCoverageShot => {
      const usesCast = visualMode === "abstract_reenactment";
      const castIds = usesCast ? [direction.cast[0]!.id] : [];
      const cameraMove = motivatedMove(primaryParent, slot, binding.treatment, cinematicShots);
      const label = coverage.purposes[slot]!;
      const movement = visualMode === "abstract_reenactment"
        ? `${direction.cast[0]!.movementProfile}; complete one restrained, source-bound action without revealing a face`
        : visualMode === "source_proof"
          ? "hold the cited factual artifact long enough to read its relationship to the narration; no invented event"
          : "move only through the already-cited space, relationship, or atmosphere; no new factual event";
      const shot: DraftCoverageShot = {
        id: `cinematic-shot-${primaryParent.id.replace(/^shot-/, "")}-${slot + 1}`,
        t0: boundaries[slot]!,
        t1: boundaries[slot + 1]!,
        coveragePurpose: label,
        visualMode,
        castIds,
        cameraMove,
        shotScale: coverage.scales[slot]!,
        lens: slot === 0 ? "28mm" : slot === 1 ? "50mm" : slot === 2 ? "85mm" : "35mm",
        cutReason: cuts[slot]!,
        tensionState: tension[slot]!,
        cameraRationale: `${label.replace(/_/g, " ")} changes the audience's information: ${parents.map((parent) => parent.coveragePurpose).join("; ")}`.slice(0, 360),
        narrationPurpose: `${role.replace(/_/g, " ")}: ${beatQuestion} Source window: ${sourceMoments}`.slice(0, 720),
        still: [
          direction.visualWorld,
          sourceMoments,
          `Causal question: ${beatQuestion}`,
          `Coverage purpose: ${label.replace(/_/g, " ")}; treatment: ${binding.treatment}.`,
          usesCast
            ? `Original faceless mannequin: ${direction.cast[0]!.silhouette}; wardrobe ${direction.cast[0]!.wardrobeSignature}; palette ${direction.cast[0]!.palette.join(", ")}; key prop ${direction.cast[0]!.keyProp}.`
            : "No real-person likeness; show only the admitted evidence treatment and a visible citation overlay area.",
        ].join(" ").slice(0, 1_800),
        motion: [
          parents.map((parent) => parent.motion).join(" ").slice(0, 800),
          movement,
          `Motivated ${cameraMove.replace(/_/g, " ")} for ${label.replace(/_/g, " ")}; do not add a new factual claim.`,
        ].join(" ").slice(0, 1_200),
        negative: union([
          ...parents.flatMap((parent) => parent.negative.split(/,\s*/).filter(Boolean)),
          "real-person likeness",
          "visible mannequin face",
          "gore",
          "unsupported reconstruction",
          "watermark",
        ]).join(", ").slice(0, 700),
        firstFrameConstraint: "Start from the exact cited story state at this narration boundary; preserve approved wardrobe, location, prop, lighting, and evidence treatment.",
        lastFrameConstraint: "End only after the motivated action or evidence relationship advances; preserve continuity for the next approved cut.",
        onScreenCitation: true,
        ...(visualMode === "abstract_reenactment" ? { reconstructionDisclosure: modes.abstractDisclosure } : {}),
      };
      cinematicShots.push(shot);
      return shot;
    });
    return {
      id: `cinematic-beat-${primaryParent.id.replace(/^shot-/, "")}`,
      narrativeRole: role,
      t0,
      t1,
      parentShotIds: parents.map((parent) => parent.id),
      claimIds: union(related.map((entry) => entry.claimId)),
      sourceIds: union(related.flatMap((entry) => entry.binding.sourceIds)),
      causalQuestion: beatQuestion,
      shots: coverageShots,
    };
  });
  const content: CinematicCaseSequenceContent = {
    version: CINEMATIC_CASE_SEQUENCE_VERSION,
    sequenceId: direction.sequenceId,
    caseId: direction.caseId,
    sourcePacketFingerprint: map.sourcePacketFingerprint,
    evidenceShotMapFingerprint: map.contentFingerprint,
    sceneManifestFingerprint: manifest.fingerprint,
    shotPlanFingerprint: map.shotPlanFingerprint,
    cast: direction.cast,
    beats,
  };
  const sequenceContentFingerprint = cinematicCaseSequenceContentFingerprint(content);
  return CinematicCaseSequenceDraftSchema.parse({
    version: CINEMATIC_CASE_SEQUENCE_DRAFT_VERSION,
    content,
    sequenceContentFingerprint,
    directionFingerprint: directionFingerprint(direction),
    release: "private_human_editorial_review_required",
    requiresHumanEditorialReview: true,
  });
}

/** Adds a real human signature to an unchanged draft; it cannot mint one. */
export function finalizeCinematicCaseSequenceDraft(args: {
  draft: unknown;
  editorialReview: unknown;
}): CinematicCaseSequenceInput {
  const draft = CinematicCaseSequenceDraftSchema.parse(args.draft);
  const review = CinematicSequenceEditorialReviewSchema.parse(args.editorialReview);
  const contentFingerprint = cinematicCaseSequenceContentFingerprint(draft.content);
  if (contentFingerprint !== draft.sequenceContentFingerprint) {
    throw new Error("cinematic draft: stored content fingerprint does not match the reviewer-ready sequence content");
  }
  if (
    review.reviewedSourcePacketFingerprint !== draft.content.sourcePacketFingerprint ||
    review.reviewedEvidenceShotMapFingerprint !== draft.content.evidenceShotMapFingerprint ||
    review.reviewedSequenceFingerprint !== contentFingerprint
  ) {
    throw new Error(
      "cinematic draft: editorial review is not bound to this exact source packet, evidence map, and sequence content; obtain a fresh human review",
    );
  }
  return CinematicCaseSequenceInputSchema.parse({ ...draft.content, editorialReview: review });
}
