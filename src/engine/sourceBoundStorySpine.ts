import { createHash } from "node:crypto";

import { z } from "zod";

import {
  CasefileEvidenceShotMapAdmissionReceiptSchema,
  CasefileEvidenceShotMapSchema,
  CasefileEvidenceShotMapTreatmentSchema,
  casefileEvidenceShotMapContentFingerprint,
  casefileShotPlanFingerprint,
} from "./casefileEvidenceShotMap";
import {
  CasefileSourceAdmissionReceiptSchema,
  assertCasefileSourcePacket,
} from "./sourceFirstAdmission";
import { StorySpineSchema, type StorySpine, validateStorySpine } from "./storySpine";

/**
 * A provider-free bridge between an already-admitted Casefile evidence map and
 * the generic timed Story Spine. It never writes narration, plans imagery, or
 * grants a channel/publish admission; it only freezes auditable claim bindings
 * that an editor has already reviewed upstream.
 */
export const SOURCE_BOUND_STORY_SPINE_VERSION = "source-bound-story-spine/v1" as const;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/, "expected sha256 fingerprint");
const claimId = z.string().regex(/^claim-[a-z0-9][a-z0-9-]{1,95}$/, "expected claim-prefixed stable id");
const sourceId = z.string().regex(/^source-[a-z0-9][a-z0-9-]{1,95}$/, "expected source-prefixed stable id");
const sceneId = z.string().regex(/^scene-[a-z0-9][a-z0-9-]{1,95}$/, "expected scene-prefixed stable id");
const shotId = z.string().regex(/^shot-[a-z0-9][a-z0-9-]{1,95}$/, "expected shot-prefixed stable id");

/** One reviewed evidence binding, projected onto exact timed Story Spine work. */
export const SourceBoundStorySpineClaimBindingSchema = z.object({
  claimId,
  sourceIds: z.array(sourceId).min(1).max(24),
  treatment: CasefileEvidenceShotMapTreatmentSchema,
  onScreenCitation: z.literal(true),
  reconstructionDisclosure: z.string().trim().min(1).max(180).optional(),
  evidenceSceneIds: z.array(sceneId).max(80),
  evidenceShotIds: z.array(shotId).min(1).max(80),
  storySpineShotIds: z.array(shotId).min(1).max(80),
  storySpineBeatIds: z.array(z.string().min(1)).min(1).max(80),
  storySpineSentenceIds: z.array(z.string().min(1)).min(1).max(160),
}).strict();

export const SourceBoundStorySpineHandoffSchema = z.object({
  version: z.literal(SOURCE_BOUND_STORY_SPINE_VERSION),
  caseId: z.string().regex(/^case-[a-z0-9][a-z0-9-]{1,95}$/, "expected case-prefixed stable id"),
  sourcePacketFingerprint: sha256,
  evidenceShotMapFingerprint: sha256,
  /** Exact canonical fingerprint of the full timed Story Spine, not only its shots. */
  storySpineFingerprint: sha256,
  /** Reasserts that the spine used the exact ShotPlan reviewed in the evidence map. */
  storySpineShotPlanFingerprint: sha256,
  storySpine: StorySpineSchema,
  claimBindings: z.array(SourceBoundStorySpineClaimBindingSchema).min(1).max(2_000),
  release: z.literal("private_human_editorial_review_only"),
  requiresHumanEditorialReview: z.literal(true),
}).strict();

export type SourceBoundStorySpineClaimBinding = z.infer<typeof SourceBoundStorySpineClaimBindingSchema>;
export type SourceBoundStorySpineHandoff = z.infer<typeof SourceBoundStorySpineHandoffSchema>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function assertMatchingAdmission(args: {
  sourcePacket: unknown;
  sourceAdmission: unknown;
  evidenceShotMap: unknown;
  evidenceShotMapAdmission: unknown;
  now?: Date;
}) {
  const sourcePacket = assertCasefileSourcePacket(args.sourcePacket, { now: args.now });
  const sourceAdmission = CasefileSourceAdmissionReceiptSchema.parse(args.sourceAdmission);
  const evidenceShotMap = CasefileEvidenceShotMapSchema.parse(args.evidenceShotMap);
  const evidenceShotMapAdmission = CasefileEvidenceShotMapAdmissionReceiptSchema.parse(
    args.evidenceShotMapAdmission,
  );

  if (
    sourceAdmission.caseId !== sourcePacket.casePacket.id ||
    sourceAdmission.sourcePacketFingerprint !== sourcePacket.receipt.sourcePacketFingerprint ||
    sourceAdmission.casePacketFingerprint !== sourcePacket.receipt.casePacketFingerprint ||
    sourceAdmission.evidenceGrammarFingerprint !== sourcePacket.receipt.evidenceGrammarFingerprint
  ) {
    throw new Error("source-bound Story Spine requires the current admitted source-packet receipt");
  }
  const evidenceFingerprint = casefileEvidenceShotMapContentFingerprint(evidenceShotMap);
  if (
    evidenceShotMap.contentFingerprint !== evidenceFingerprint ||
    evidenceShotMap.editorialReview.reviewedShotMapFingerprint !== evidenceFingerprint ||
    evidenceShotMapAdmission.evidenceShotMapFingerprint !== evidenceFingerprint
  ) {
    throw new Error("source-bound Story Spine requires an untampered reviewed evidence-shot map");
  }
  if (
    evidenceShotMap.caseId !== sourcePacket.casePacket.id ||
    evidenceShotMap.sourcePacketFingerprint !== sourcePacket.receipt.sourcePacketFingerprint ||
    evidenceShotMap.editorialReview.reviewedSourcePacketFingerprint !== sourcePacket.receipt.sourcePacketFingerprint ||
    evidenceShotMapAdmission.caseId !== sourcePacket.casePacket.id ||
    evidenceShotMapAdmission.sourcePacketFingerprint !== sourcePacket.receipt.sourcePacketFingerprint ||
    evidenceShotMapAdmission.editorialReview.reviewedShotMapFingerprint !== evidenceFingerprint
  ) {
    throw new Error("source-bound Story Spine source/evidence receipts do not describe the same reviewed Casefile");
  }
  if (
    evidenceShotMapAdmission.factualClaimCount !== sourcePacket.casePacket.claims.length ||
    evidenceShotMapAdmission.bindingCount !== evidenceShotMap.claimMappings.reduce(
      (count, mapping) => count + mapping.bindings.length,
      0,
    )
  ) {
    throw new Error("source-bound Story Spine evidence-shot-map receipt counts do not match its reviewed content");
  }
  return { sourcePacket, evidenceShotMap, evidenceShotMapAdmission };
}

/**
 * Validates a serialized handoff before it crosses a module boundary. External
 * source/evidence artifacts are intentionally not reconstructed here; callers
 * should use `createSourceBoundStorySpineHandoff` when deriving a new handoff.
 */
export function validateSourceBoundStorySpineHandoff(value: unknown): SourceBoundStorySpineHandoff {
  const handoff = SourceBoundStorySpineHandoffSchema.parse(value);
  const storySpine = validateStorySpine(handoff.storySpine);
  if (handoff.storySpineFingerprint !== fingerprint(storySpine)) {
    throw new Error("source-bound Story Spine fingerprint does not match the timed Story Spine");
  }
  if (handoff.storySpineShotPlanFingerprint !== casefileShotPlanFingerprint(storySpine.shotList)) {
    throw new Error("source-bound Story Spine shot-plan fingerprint does not match its timed shots");
  }
  const knownShots = new Set(storySpine.shotList.map((shot) => shot.id));
  const knownBeats = new Set(storySpine.narrativeBeats.map((beat) => beat.id));
  const knownSentences = new Set(storySpine.timedScript.sentences.map((sentence) => sentence.id));
  const boundShots = new Set<string>();
  for (const binding of handoff.claimBindings) {
    if (binding.storySpineShotIds.some((id) => !knownShots.has(id))) {
      throw new Error(`source-bound Story Spine binding ${binding.claimId} references an unknown Story Spine shot`);
    }
    if (binding.storySpineBeatIds.some((id) => !knownBeats.has(id))) {
      throw new Error(`source-bound Story Spine binding ${binding.claimId} references an unknown Story Spine beat`);
    }
    if (binding.storySpineSentenceIds.some((id) => !knownSentences.has(id))) {
      throw new Error(`source-bound Story Spine binding ${binding.claimId} references an unknown Story Spine sentence`);
    }
    if (!sameSet(unique(binding.evidenceShotIds), unique(binding.storySpineShotIds))) {
      throw new Error(`source-bound Story Spine binding ${binding.claimId} does not preserve its reviewed evidence shot IDs`);
    }
    const bindingShots = binding.storySpineShotIds.map((id) => {
      const shot = storySpine.shotList.find((candidate) => candidate.id === id);
      if (!shot) throw new Error(`source-bound Story Spine binding ${binding.claimId} references an unknown Story Spine shot`);
      return shot;
    });
    if (!sameSet(unique(binding.storySpineBeatIds), unique(bindingShots.map((shot) => shot.beatId)))) {
      throw new Error(`source-bound Story Spine binding ${binding.claimId} does not preserve exact Story Spine beats`);
    }
    if (!sameSet(
      unique(binding.storySpineSentenceIds),
      unique(bindingShots.flatMap((shot) => shot.sourceSentenceIds)),
    )) {
      throw new Error(`source-bound Story Spine binding ${binding.claimId} does not preserve exact Story Spine sentences`);
    }
    for (const id of binding.storySpineShotIds) boundShots.add(id);
  }
  if (storySpine.shotList.some((shot) => !boundShots.has(shot.id))) {
    throw new Error("source-bound Story Spine requires every timed Story Spine shot to carry a reviewed claim binding");
  }
  return handoff;
}

/**
 * Final narration must remain the exact timed argument the reviewed Casefile
 * coverage was designed around.  Generic transcript QA can prove that a TTS
 * take matches its own stored transcript; it cannot prove that a substituted
 * transcript still matches this source-bound Story Spine.
 */
export function assertSourceBoundNarrationAlignment(args: {
  sourceBoundStorySpine: unknown;
  sentenceTimings: unknown;
  narrationDurationSec: unknown;
  timingToleranceSec?: number;
}): SourceBoundStorySpineHandoff {
  const handoff = validateSourceBoundStorySpineHandoff(args.sourceBoundStorySpine);
  const sentenceTimings = z.array(z.object({
    text: z.string().trim().min(1).max(4_000),
    start: z.number().finite().min(0),
    end: z.number().finite().positive(),
  }).strict().refine((timing) => timing.end > timing.start, "narration sentence must end after it starts"))
    .min(1)
    .max(2_000)
    .parse(args.sentenceTimings);
  const narrationDurationSec = z.number().finite().positive().max(86_400).parse(args.narrationDurationSec);
  const tolerance = Number.isFinite(args.timingToleranceSec)
    ? Math.max(0.01, Math.min(0.75, Number(args.timingToleranceSec)))
    : 0.12;
  const expected = handoff.storySpine.timedScript;
  if (Math.abs(expected.narrationDurationSec - narrationDurationSec) > tolerance) {
    throw new Error(
      "source-bound narration duration does not match the reviewed timed Story Spine; regenerate the cinematic sequence from the current narration",
    );
  }
  if (expected.sentences.length !== sentenceTimings.length) {
    throw new Error(
      "source-bound narration sentence count does not match the reviewed timed Story Spine; do not substitute a new narration after cinematic approval",
    );
  }
  for (let index = 0; index < expected.sentences.length; index++) {
    const planned = expected.sentences[index]!;
    const actual = sentenceTimings[index]!;
    if (planned.text.trim() !== actual.text.trim()) {
      throw new Error(
        `source-bound narration sentence ${index + 1} text does not match the reviewed timed Story Spine`,
      );
    }
    if (Math.abs(planned.t0 - actual.start) > tolerance || Math.abs(planned.t1 - actual.end) > tolerance) {
      throw new Error(
        `source-bound narration sentence ${index + 1} timing does not match the reviewed timed Story Spine`,
      );
    }
  }
  return handoff;
}

/**
 * Derives a private, source-bound handoff from already-admitted artifacts. No
 * new facts, prompts, or render decisions are generated. Every claim mapping
 * must project to one or more exact Story Spine shots, so a stale or
 * scene-only map cannot be silently treated as narrated evidence coverage.
 */
export function createSourceBoundStorySpineHandoff(args: {
  sourcePacket: unknown;
  sourceAdmission: unknown;
  evidenceShotMap: unknown;
  evidenceShotMapAdmission: unknown;
  storySpine: unknown;
  now?: Date;
}): SourceBoundStorySpineHandoff {
  const { sourcePacket, evidenceShotMap, evidenceShotMapAdmission } = assertMatchingAdmission(args);
  const storySpine = validateStorySpine(StorySpineSchema.parse(args.storySpine));
  const storySpineShotPlanFingerprint = casefileShotPlanFingerprint(storySpine.shotList);
  if (
    evidenceShotMap.shotPlanFingerprint !== storySpineShotPlanFingerprint ||
    evidenceShotMapAdmission.shotPlanFingerprint !== storySpineShotPlanFingerprint
  ) {
    throw new Error("source-bound Story Spine requires the exact ShotPlan reviewed by the evidence-shot map");
  }

  const shotById = new Map(storySpine.shotList.map((shot) => [shot.id, shot]));
  const primarySourceIdsByClaim = new Map<string, Set<string>>();
  for (const primary of sourcePacket.packet.claimPrimarySources) {
    const sourceIds = primarySourceIdsByClaim.get(primary.claimId) ?? new Set<string>();
    sourceIds.add(primary.sourceId);
    primarySourceIdsByClaim.set(primary.claimId, sourceIds);
  }

  const claimBindings: SourceBoundStorySpineClaimBinding[] = [];
  for (const claimMapping of evidenceShotMap.claimMappings) {
    const primarySourceIds = primarySourceIdsByClaim.get(claimMapping.claimId);
    if (!primarySourceIds) {
      throw new Error(`source-bound Story Spine claim ${claimMapping.claimId} has no admitted primary source`);
    }
    for (const evidenceBinding of claimMapping.bindings) {
      if (!evidenceBinding.shotIds.length) {
        throw new Error(
          `source-bound Story Spine evidence binding for ${claimMapping.claimId} has no timed Story Spine shot; ` +
            "add reviewed shot coverage before using this source-led handoff",
        );
      }
      const storyShots = evidenceBinding.shotIds.map((id) => shotById.get(id)).filter(
        (shot): shot is StorySpine["shotList"][number] => Boolean(shot),
      );
      if (storyShots.length !== evidenceBinding.shotIds.length) {
        throw new Error(
          `source-bound Story Spine evidence binding for ${claimMapping.claimId} references a shot outside the timed Story Spine`,
        );
      }
      if (!evidenceBinding.sourceIds.some((id) => primarySourceIds.has(id))) {
        throw new Error(`source-bound Story Spine evidence binding for ${claimMapping.claimId} lacks an admitted primary source`);
      }
      claimBindings.push({
        claimId: claimMapping.claimId,
        sourceIds: evidenceBinding.sourceIds,
        treatment: evidenceBinding.treatment,
        onScreenCitation: evidenceBinding.onScreenCitation,
        reconstructionDisclosure: evidenceBinding.reconstructionDisclosure,
        evidenceSceneIds: evidenceBinding.sceneIds,
        evidenceShotIds: evidenceBinding.shotIds,
        storySpineShotIds: storyShots.map((shot) => shot.id),
        storySpineBeatIds: unique(storyShots.map((shot) => shot.beatId)),
        storySpineSentenceIds: unique(storyShots.flatMap((shot) => shot.sourceSentenceIds)),
      });
    }
  }

  return validateSourceBoundStorySpineHandoff({
    version: SOURCE_BOUND_STORY_SPINE_VERSION,
    caseId: sourcePacket.casePacket.id,
    sourcePacketFingerprint: sourcePacket.receipt.sourcePacketFingerprint,
    evidenceShotMapFingerprint: evidenceShotMap.contentFingerprint,
    storySpineFingerprint: fingerprint(storySpine),
    storySpineShotPlanFingerprint,
    storySpine,
    claimBindings,
    release: "private_human_editorial_review_only",
    requiresHumanEditorialReview: true,
  });
}
