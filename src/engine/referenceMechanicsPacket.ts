import { sha256Hex } from "@/lib/sha256";

import { z } from "zod";

import { casefileShotPlanFingerprint } from "./casefileEvidenceShotMap";
import type { ReferenceQualityContract, ReferenceQualitySource } from "./creative/types";
import { ShotPlanSchema } from "./storySpine";

/**
 * A review-only transfer of observable craft mechanics from an attributed
 * reference set. It is intentionally not a style prompt, a similarity score,
 * or permission to reproduce a source channel's expression.
 */
export const REFERENCE_MECHANICS_PACKET_VERSION = "reference-mechanics-packet/v1" as const;
export const REFERENCE_MECHANICS_PACKET_REVIEW_MAX_AGE_DAYS = 30;

const REVIEW_MAX_AGE_MS = REFERENCE_MECHANICS_PACKET_REVIEW_MAX_AGE_DAYS * 24 * 60 * 60 * 1_000;
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/, "expected sha256 fingerprint");
const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const identifier = (prefix: string) => z.string().regex(
  new RegExp(`^${prefix}-[a-z0-9][a-z0-9-]{1,119}$`),
  `expected ${prefix}- prefixed identifier`,
);

/** Exact attributed source metadata copied from the current ReferenceQuality contract. */
export const ReferenceMechanicsSourceSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: text(240),
  url: z.string().url().max(2_048),
  transferableMechanic: text(900),
  prohibitedImitation: text(900),
}).strict();
export type ReferenceMechanicsSource = z.infer<typeof ReferenceMechanicsSourceSchema>;

/** One attributable, original-expression instruction. */
export const ReferenceMechanicGuidanceSchema = z.object({
  guidance: text(480),
  sourceIds: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
}).strict();
export type ReferenceMechanicGuidance = z.infer<typeof ReferenceMechanicGuidanceSchema>;

/** Content excluding the human review signature which binds it. */
export const ReferenceMechanicsPacketContentSchema = z.object({
  version: z.literal(REFERENCE_MECHANICS_PACKET_VERSION),
  family: z.string().trim().min(1).max(120),
  referenceQualityFingerprint: sha256,
  /** Binds pacing/cut mechanics to this exact timed Story Spine ShotPlan. */
  storySpineShotPlanFingerprint: sha256,
  comparisonPolicy: z.literal("mechanics-only-no-automatic-comparison"),
  imitationPolicy: z.literal("original-expression-only"),
  sourceDocument: text(1_000),
  sources: z.array(ReferenceMechanicsSourceSchema).min(1).max(24),
  openingPromisePayoff: ReferenceMechanicGuidanceSchema,
  beatVisualRhythm: ReferenceMechanicGuidanceSchema,
  narrationPaceClarity: ReferenceMechanicGuidanceSchema,
  cutSceneFunction: ReferenceMechanicGuidanceSchema,
  audioRelationship: ReferenceMechanicGuidanceSchema,
  recurringIdentity: ReferenceMechanicGuidanceSchema,
  exclusions: ReferenceMechanicGuidanceSchema,
}).strict();
export type ReferenceMechanicsPacketContent = z.infer<typeof ReferenceMechanicsPacketContentSchema>;

export const ReferenceMechanicsEditorialReviewSchema = z.object({
  id: identifier("reference-mechanics-review"),
  decision: z.literal("approved"),
  reviewerId: identifier("reviewer"),
  reviewedAt: z.string().datetime({ offset: true }),
  reviewedReferenceQualityFingerprint: sha256,
  reviewedStorySpineShotPlanFingerprint: sha256,
  reviewedPacketFingerprint: sha256,
}).strict();
export type ReferenceMechanicsEditorialReview = z.infer<typeof ReferenceMechanicsEditorialReviewSchema>;

export const ReferenceMechanicsPacketSchema = ReferenceMechanicsPacketContentSchema.extend({
  contentFingerprint: sha256,
  editorialReview: ReferenceMechanicsEditorialReviewSchema,
  release: z.literal("private_human_editorial_review_only"),
  requiresHumanEditorialReview: z.literal(true),
}).strict();
export type ReferenceMechanicsPacket = z.infer<typeof ReferenceMechanicsPacketSchema>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function fingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/** The exact, stable fingerprint of an upstream channel-quality contract. */
export function referenceQualityContractFingerprint(referenceQuality: ReferenceQualityContract): string {
  return fingerprint(referenceQuality);
}

/** Review signatures never sign themselves. */
export function referenceMechanicsPacketContentFingerprint(
  value: ReferenceMechanicsPacketContent | ReferenceMechanicsPacket,
): string {
  const content = "editorialReview" in value
    ? (({ contentFingerprint: _contentFingerprint, editorialReview: _editorialReview, release: _release, requiresHumanEditorialReview: _requiresHumanEditorialReview, ...packet }) => packet)(value)
    : value;
  return fingerprint(ReferenceMechanicsPacketContentSchema.parse(content));
}

function sourceProjection(source: ReferenceQualitySource): ReferenceMechanicsSource {
  return ReferenceMechanicsSourceSchema.parse(source);
}

function exactJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function parseReviewedAt(value: string): Date | undefined {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : undefined;
}

function allGuidance(packet: ReferenceMechanicsPacketContent): ReferenceMechanicGuidance[] {
  return [
    packet.openingPromisePayoff,
    packet.beatVisualRhythm,
    packet.narrationPaceClarity,
    packet.cutSceneFunction,
    packet.audioRelationship,
    packet.recurringIdentity,
    packet.exclusions,
  ];
}

/**
 * Validates the packet's own immutable provenance and human review. It does
 * not contact or compare against a reference video; current-contract checking
 * happens separately at the consuming quality gate.
 */
export function validateReferenceMechanicsPacket(
  value: unknown,
  options: { now?: Date } = {},
): ReferenceMechanicsPacket {
  const packet = ReferenceMechanicsPacketSchema.parse(value);
  if (packet.contentFingerprint !== referenceMechanicsPacketContentFingerprint(packet)) {
    throw new Error("reference mechanics packet content fingerprint does not match its reviewed mechanics");
  }
  const sourceIds = new Set(packet.sources.map((source) => source.id));
  if (sourceIds.size !== packet.sources.length) {
    throw new Error("reference mechanics packet has duplicate attributed source ids");
  }
  for (const guidance of allGuidance(packet)) {
    if (guidance.sourceIds.some((sourceId) => !sourceIds.has(sourceId))) {
      throw new Error("reference mechanics guidance cites a source absent from the attributed packet");
    }
  }
  const review = packet.editorialReview;
  if (
    review.reviewedReferenceQualityFingerprint !== packet.referenceQualityFingerprint ||
    review.reviewedStorySpineShotPlanFingerprint !== packet.storySpineShotPlanFingerprint ||
    review.reviewedPacketFingerprint !== packet.contentFingerprint
  ) {
    throw new Error("reference mechanics editor approval does not bind this exact quality contract, Story Spine, and mechanics packet");
  }
  const now = options.now ?? new Date();
  const reviewedAt = parseReviewedAt(review.reviewedAt);
  if (
    !reviewedAt ||
    reviewedAt.getTime() > now.getTime() + FUTURE_CLOCK_SKEW_MS ||
    now.getTime() - reviewedAt.getTime() > REVIEW_MAX_AGE_MS
  ) {
    throw new Error(
      `reference mechanics review must be valid, non-future, and no older than ${REFERENCE_MECHANICS_PACKET_REVIEW_MAX_AGE_DAYS} days`,
    );
  }
  return packet;
}

/**
 * Rechecks a review-only packet against the exact current channel contract and
 * timed Story Spine. A reference update or new narration/shot plan invalidates
 * the packet instead of silently applying stale pacing advice.
 */
export function assertCurrentReferenceMechanicsPacket(args: {
  packet: unknown;
  referenceQuality: ReferenceQualityContract;
  shotList: unknown;
  now?: Date;
}): ReferenceMechanicsPacket {
  const packet = validateReferenceMechanicsPacket(args.packet, { now: args.now });
  const expectedSources = args.referenceQuality.sources.map(sourceProjection);
  if (
    packet.family !== args.referenceQuality.family ||
    packet.sourceDocument !== args.referenceQuality.sourceDocument ||
    packet.referenceQualityFingerprint !== referenceQualityContractFingerprint(args.referenceQuality) ||
    !exactJson(packet.sources, expectedSources)
  ) {
    throw new Error("reference mechanics packet does not bind the current attributed ReferenceQuality contract");
  }
  const shotList = ShotPlanSchema.array().min(1).max(2_000).parse(args.shotList);
  if (packet.storySpineShotPlanFingerprint !== casefileShotPlanFingerprint(shotList)) {
    throw new Error("reference mechanics packet does not bind the current timed Story Spine ShotPlan");
  }
  return packet;
}

/** Provider-free construction after a human editor has reviewed the supplied mechanics. */
export function createReferenceMechanicsPacket(args: {
  referenceQuality: ReferenceQualityContract;
  shotList: unknown;
  mechanics: Omit<
    ReferenceMechanicsPacketContent,
    | "version"
    | "family"
    | "referenceQualityFingerprint"
    | "storySpineShotPlanFingerprint"
    | "comparisonPolicy"
    | "imitationPolicy"
    | "sourceDocument"
    | "sources"
  >;
  review: Pick<ReferenceMechanicsEditorialReview, "id" | "reviewerId" | "reviewedAt">;
  now?: Date;
}): ReferenceMechanicsPacket {
  const shotList = ShotPlanSchema.array().min(1).max(2_000).parse(args.shotList);
  const content = ReferenceMechanicsPacketContentSchema.parse({
    version: REFERENCE_MECHANICS_PACKET_VERSION,
    family: args.referenceQuality.family,
    referenceQualityFingerprint: referenceQualityContractFingerprint(args.referenceQuality),
    storySpineShotPlanFingerprint: casefileShotPlanFingerprint(shotList),
    comparisonPolicy: "mechanics-only-no-automatic-comparison",
    imitationPolicy: "original-expression-only",
    sourceDocument: args.referenceQuality.sourceDocument,
    sources: args.referenceQuality.sources.map(sourceProjection),
    ...args.mechanics,
  });
  const contentFingerprint = referenceMechanicsPacketContentFingerprint(content);
  return validateReferenceMechanicsPacket({
    ...content,
    contentFingerprint,
    editorialReview: {
      ...args.review,
      decision: "approved",
      reviewedReferenceQualityFingerprint: content.referenceQualityFingerprint,
      reviewedStorySpineShotPlanFingerprint: content.storySpineShotPlanFingerprint,
      reviewedPacketFingerprint: contentFingerprint,
    },
    release: "private_human_editorial_review_only",
    requiresHumanEditorialReview: true,
  }, { now: args.now });
}

/**
 * Compact original-expression guidance safe to carry into a cinematic prompt.
 * Source labels/URLs are deliberately excluded: the renderer gets mechanics,
 * never a competitor identity to reproduce or compare against.
 */
export function referenceMechanicsPromptGuidance(
  value: ReferenceMechanicsPacket,
  options: { now?: Date } = {},
): string {
  const packet = validateReferenceMechanicsPacket(value, options);
  const compact = (guidance: ReferenceMechanicGuidance) => guidance.guidance.slice(0, 120);
  return [
    "Mechanics-only original expression: never imitate, copy, compare to, or name a reference channel, video, person, voice, footage, or composition.",
    `Opening promise/payoff: ${compact(packet.openingPromisePayoff)}`,
    `Beat/visual rhythm: ${compact(packet.beatVisualRhythm)}`,
    `Narration pace/clarity: ${compact(packet.narrationPaceClarity)}`,
    `Cut/scene function: ${compact(packet.cutSceneFunction)}`,
    `Audio relationship: ${compact(packet.audioRelationship)}`,
    `Recurring identity: ${compact(packet.recurringIdentity)}`,
    `Exclusions: ${compact(packet.exclusions)}`,
  ].join(" ").slice(0, 1_100);
}
