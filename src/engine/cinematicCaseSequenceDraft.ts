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

function modePlan(binding: EvidenceBinding): {
  readonly modes: readonly DraftCoverageShot["visualMode"][];
  readonly abstractDisclosure?: string;
} {
  switch (binding.treatment) {
    case "map":
    case "timeline":
      return { modes: ["spatial_reconstruction", "atmosphere", "source_proof"] };
    case "document_abstraction":
      return { modes: ["atmosphere", "atmosphere", "source_proof"] };
    case "neutral_reenactment":
      if (!binding.reconstructionDisclosure) {
        throw new Error(
          "cinematic draft: neutral reenactment binding is missing its exact reconstruction disclosure; " +
            "repair the admitted Casefile evidence map before cinematic planning",
        );
      }
      return {
        modes: ["spatial_reconstruction", "atmosphere", "abstract_reenactment"],
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
      : "static";
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
): readonly DraftCoverageShot["tensionState"][] {
  if (role === "cold_open") return ["question", "pressure", isFinalBeat ? "residue" : "uncertainty"];
  if (role === "reveal") return ["reversal", "release", "release"];
  if (role === "closing_residue") return ["release", "residue", "residue"];
  return ["orientation", "pressure", "uncertainty"];
}

function beatCuts(role: DraftBeat["narrativeRole"]): readonly DraftCoverageShot["cutReason"][] {
  if (role === "reveal") return ["new_relationship", "reveal", "reveal"];
  if (role === "closing_residue") return ["new_fact", "breath", "breath"];
  return ["new_location", "physical_action", "new_fact"];
}

function causalQuestion(direction: CinematicCaseDirection, shot: ShotPlan, role: DraftBeat["narrativeRole"]): string {
  const evidence = shot.coveragePurpose.replace(/\s+/g, " ").trim().slice(0, 220);
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
 * Deterministically converts the admitted factual map + Story Spine into an
 * editor-ready, three-shot-per-beat Fern-style coverage draft. It never writes
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
  const beats: DraftBeat[] = orderedShots.map((parent, index) => {
    const role = roleFor(index, orderedShots.length);
    const related = map.claimMappings.flatMap((mapping) =>
      mapping.bindings
        .filter((binding) => binding.shotIds.includes(parent.id))
        .map((binding) => ({ claimId: mapping.claimId, binding })),
    );
    if (!related.length) {
      throw new Error(
        `cinematic draft: Story Spine shot ${parent.id} has no admitted factual claim binding; ` +
          "repair casefile_evidence_shot_map rather than inventing a visual",
      );
    }
    // Prefer a specifically admitted neutral reconstruction when it exists.
    // That is the only route that may place the original faceless mannequin
    // in the scene; otherwise we stay with the first cited documentary/map
    // treatment instead of inventing a dramatic reenactment.
    const binding = related.find(({ binding }) => binding.treatment === "neutral_reenactment")?.binding ?? related[0]!.binding;
    const modes = modePlan(binding);
    const duration = parent.t1 - parent.t0;
    if (!Number.isFinite(duration) || duration < 0.3) {
      throw new Error(`cinematic draft: Story Spine shot ${parent.id} has no usable narrated duration`);
    }
    const boundaries = [parent.t0, parent.t0 + duration / 3, parent.t0 + (duration * 2) / 3, parent.t1]
      .map((value) => Number(value.toFixed(3)));
    const tension = beatTension(role, index === orderedShots.length - 1);
    const cuts = beatCuts(role);
    const beatQuestion = causalQuestion(direction, parent, role);
    const coveragePurpose: readonly DraftCoverageShot["coveragePurpose"][] = [
      "spatial_anchor",
      modes.modes[1] === "abstract_reenactment" ? "mannequin_action" : "relationship",
      "evidence_insert",
    ];
    const coverage = modes.modes.map((visualMode, slot): DraftCoverageShot => {
      const usesCast = visualMode === "abstract_reenactment";
      const castIds = usesCast ? [direction.cast[0]!.id] : [];
      const cameraMove = motivatedMove(parent, slot, binding.treatment, cinematicShots);
      const scale: DraftCoverageShot["shotScale"][] = ["establishing", "medium", "close"];
      const label = coveragePurpose[slot]!;
      const movement = visualMode === "abstract_reenactment"
        ? `${direction.cast[0]!.movementProfile}; complete one restrained, source-bound action without revealing a face`
        : visualMode === "source_proof"
          ? "hold the cited factual artifact long enough to read its relationship to the narration; no invented event"
          : "move only through the already-cited space, relationship, or atmosphere; no new factual event";
      const shot: DraftCoverageShot = {
        id: `cinematic-shot-${parent.id.replace(/^shot-/, "")}-${slot + 1}`,
        t0: boundaries[slot]!,
        t1: boundaries[slot + 1]!,
        coveragePurpose: label,
        visualMode,
        castIds,
        cameraMove,
        shotScale: scale[slot]!,
        lens: slot === 0 ? "28mm" : slot === 1 ? "50mm" : "85mm",
        cutReason: cuts[slot]!,
        tensionState: tension[slot]!,
        cameraRationale: `${label.replace(/_/g, " ")} changes the audience's information: ${parent.coveragePurpose}`.slice(0, 360),
        narrationPurpose: `${role.replace(/_/g, " ")}: ${beatQuestion}`.slice(0, 360),
        still: [
          direction.visualWorld,
          parent.prompt,
          `Causal question: ${beatQuestion}`,
          `Coverage purpose: ${label.replace(/_/g, " ")}; treatment: ${binding.treatment}.`,
          usesCast
            ? `Original faceless mannequin: ${direction.cast[0]!.silhouette}; wardrobe ${direction.cast[0]!.wardrobeSignature}; palette ${direction.cast[0]!.palette.join(", ")}; key prop ${direction.cast[0]!.keyProp}.`
            : "No real-person likeness; show only the admitted evidence treatment and a visible citation overlay area.",
        ].join(" ").slice(0, 1_800),
        motion: [
          parent.motion,
          movement,
          `Motivated ${cameraMove.replace(/_/g, " ")} for ${label.replace(/_/g, " ")}; do not add a new factual claim.`,
        ].join(" ").slice(0, 1_200),
        negative: union([
          ...parent.negative.split(/,\s*/).filter(Boolean),
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
      id: `cinematic-beat-${parent.id.replace(/^shot-/, "")}`,
      narrativeRole: role,
      t0: parent.t0,
      t1: parent.t1,
      parentShotIds: [parent.id],
      claimIds: union(related.map((entry) => entry.claimId)),
      sourceIds: union(related.flatMap((entry) => entry.binding.sourceIds)),
      causalQuestion: beatQuestion,
      shots: coverage,
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
