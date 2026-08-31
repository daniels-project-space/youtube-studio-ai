/**
 * Provider-free, immutable owner-scoped evidence handoff.
 *
 * A Reviewed Evidence Pack is deliberately *not* an automation admission,
 * render request, release certificate, or publish instruction.  It seals an
 * already human-reviewed factual authority to a frozen channel route and
 * Show Profile before any downstream consumer chooses to use it.  A frozen
 * Story Spine / Episode Graph is optional: packs may be admitted before a
 * story is planned, while a later plan can be attached only as an exact
 * ReviewedEvidenceRouteBinding match.
 */
import { z } from "zod";

import {
  ChannelProgramRouteRunSeedSchema,
  channelProgramRouteRunSeedFingerprint,
  parseChannelProgramRouteRunSeed,
} from "@/engine/channelProgramRoute";
import {
  parseChannelShowProfileReceipt,
  type ChannelShowProfile,
} from "@/engine/channelShowProfileCodec";
import {
  dataStorySourceLedgerFingerprint,
  evaluateDataStorySourceLedger,
  type DataStorySourceLedger,
} from "@/engine/dataStorySourceLedger";
import {
  assertEditorialEvidencePacket,
  editorialEvidencePacketContentFingerprint,
  editorialEvidencePacketFromDataStoryLedger,
  type EditorialEvidencePacket,
} from "@/engine/editorialEvidencePacket";
import {
  assertEvidenceVisualManifest,
  assertEvidenceVisualManifestCollection,
  type EvidenceVisualManifest,
} from "@/engine/evidenceVisualManifest";
import {
  assertReviewedEvidenceRouteBindingMatches,
  createReviewedEvidenceRouteBinding,
  reviewedEvidenceRouteTopicFingerprint,
  type ReviewedEvidenceRouteBinding,
} from "@/engine/reviewedEvidenceRouteBinding";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export const REVIEWED_EVIDENCE_PACK_VERSION = "reviewed-evidence-pack/v1" as const;
export const REVIEWED_EVIDENCE_PACK_REVIEW_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

const REVIEWED_EVIDENCE_PACK_RELEASE = "private_reviewed_evidence_pack_only" as const;
const REVIEW_CLOCK_SKEW_MS = 5 * 60_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const sha256 = z.string().regex(SHA256_PATTERN, "expected SHA-256 fingerprint");
const identifier = z.string().trim().min(2).max(160).regex(
  /^[A-Za-z0-9._:-]+$/,
  "expected stable identifier",
);
const topic = z.string().trim().min(1).max(1_200);
const requiredUnknown = z.unknown().refine((value) => value !== undefined, "value is required");

const ReviewedEvidencePackReviewDraftSchema = z.object({
  reviewerId: identifier,
  reviewId: identifier,
  reviewedAt: z.string().datetime(),
}).strict();

export const ReviewedEvidencePackReviewSchema = ReviewedEvidencePackReviewDraftSchema.extend({
  decision: z.literal("approved"),
  reviewedPackFingerprint: sha256,
}).strict();
export type ReviewedEvidencePackReview = z.infer<typeof ReviewedEvidencePackReviewSchema>;

/**
 * This is a compact projection of an already sealed Show Profile. The exact
 * receipt is retained separately and replayed on every parse, so neither a
 * self-fingerprinted projection nor a mutable capability list can relabel a
 * pack after human review.
 */
export const ReviewedEvidencePackShowProfileBindingSchema = z.object({
  showProfileFingerprint: sha256,
  programBriefFingerprint: sha256,
  routeKey: z.string().trim().min(1).max(160),
  routeFingerprint: sha256,
  family: z.string().trim().min(1).max(80),
  contentLaneKey: z.string().trim().min(1).max(120),
  selectedCapabilityKeys: z.array(identifier).max(48),
  capabilityFingerprint: sha256,
}).strict();
export type ReviewedEvidencePackShowProfileBinding = z.infer<
  typeof ReviewedEvidencePackShowProfileBindingSchema
>;

/** Only reviewed packet/ledger receipts may carry facts into this core. */
export const ReviewedEvidencePackSourceAuthoritySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("editorial_evidence_packet"),
    editorialEvidencePacket: requiredUnknown,
  }).strict(),
  z.object({
    kind: z.literal("data_story_source_ledger"),
    dataStorySourceLedger: requiredUnknown,
    /** Must be the deterministic adaptation of this exact ledger when present. */
    derivedEditorialEvidencePacket: requiredUnknown.optional(),
  }).strict(),
]);
export type ReviewedEvidencePackSourceAuthority =
  | {
    readonly kind: "editorial_evidence_packet";
    readonly editorialEvidencePacket: EditorialEvidencePacket;
  }
  | {
    readonly kind: "data_story_source_ledger";
    readonly dataStorySourceLedger: DataStorySourceLedger;
    readonly derivedEditorialEvidencePacket?: EditorialEvidencePacket;
  };

const ReviewedEvidencePackPlanDraftSchema = z.object({
  storySpine: requiredUnknown,
  episodeGraph: requiredUnknown.optional(),
  reviewedEvidenceRouteBinding: requiredUnknown.optional(),
}).strict();

/**
 * Optional by design. A provider-free evidence pack must be persistable
 * before a story plan exists; when one is attached it is an exact route
 * binding rather than a new planning mechanism.
 */
export const ReviewedEvidencePackPlanSchema = z.object({
  storySpine: requiredUnknown,
  episodeGraph: requiredUnknown.optional(),
  reviewedEvidenceRouteBinding: requiredUnknown,
}).strict();
export interface ReviewedEvidencePackPlan {
  readonly storySpine: unknown;
  readonly episodeGraph?: unknown;
  readonly reviewedEvidenceRouteBinding: ReviewedEvidenceRouteBinding;
}

export const ReviewedEvidencePackContentSchema = z.object({
  version: z.literal(REVIEWED_EVIDENCE_PACK_VERSION),
  release: z.literal(REVIEWED_EVIDENCE_PACK_RELEASE),
  requiresHumanEditorialReview: z.literal(true),
  /** Full immutable run seed; never a mutable route-catalog lookup. */
  route: ChannelProgramRouteRunSeedSchema,
  routeSeedFingerprint: sha256,
  topic,
  topicFingerprint: sha256,
  /** Exact sealed profile receipt; parsed by the codec before any projection is trusted. */
  showProfileReceipt: requiredUnknown,
  showProfile: ReviewedEvidencePackShowProfileBindingSchema,
  sourceAuthority: ReviewedEvidencePackSourceAuthoritySchema,
  /** Exact content identity of the concrete packet or ledger carried above. */
  authorityContentFingerprint: sha256,
  /** Reviewed source-bound visual manifests, not browser output or render artifacts. */
  evidenceVisualManifests: z.array(requiredUnknown).max(48),
  reviewedPlan: ReviewedEvidencePackPlanSchema.optional(),
}).strict();

export const ReviewedEvidencePackSchema = ReviewedEvidencePackContentSchema.extend({
  contentFingerprint: sha256,
  review: ReviewedEvidencePackReviewSchema,
}).strict();
type ReviewedEvidencePackSchemaOutput = z.infer<typeof ReviewedEvidencePackSchema>;
export type ReviewedEvidencePack = Omit<
  ReviewedEvidencePackSchemaOutput,
  "showProfileReceipt" | "sourceAuthority" | "evidenceVisualManifests" | "reviewedPlan"
> & {
  readonly showProfileReceipt: ChannelShowProfile;
  readonly sourceAuthority: ReviewedEvidencePackSourceAuthority;
  readonly evidenceVisualManifests: readonly EvidenceVisualManifest[];
  readonly reviewedPlan?: ReviewedEvidencePackPlan;
};

export interface CreateReviewedEvidencePackInput {
  route: unknown;
  topic: unknown;
  /** Existing sealed Show Profile receipt. New packs require its route projection. */
  showProfile: unknown;
  /** Exactly one primary factual authority is required. */
  editorialEvidencePacket?: unknown;
  dataStorySourceLedger?: unknown;
  /** Optional only for a data ledger and must be its exact deterministic adaptation. */
  derivedEditorialEvidencePacket?: unknown;
  evidenceVisualManifests?: unknown;
  /**
   * Optional frozen plan. Its existing binding is re-verified if supplied; if
   * omitted, a pack remains a pre-plan private evidence handoff.
   */
  reviewedPlan?: unknown;
  review: z.input<typeof ReviewedEvidencePackReviewDraftSchema>;
  /** Injectable only for deterministic review-freshness checks. */
  now?: number;
}

interface ValidatedAuthority {
  readonly authority: ReviewedEvidencePackSourceAuthority;
  readonly editorialEvidencePacket?: EditorialEvidencePacket;
  readonly dataStorySourceLedger?: DataStorySourceLedger;
}

function nowMs(value: unknown = Date.now()): number {
  return z.number().finite().parse(value);
}

function contentPayload(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { contentFingerprint: _contentFingerprint, review: _review, ...content } = value as Record<string, unknown>;
  void _contentFingerprint;
  void _review;
  return content;
}

function sortedUniqueCapabilityKeys(keys: readonly string[]): readonly string[] {
  for (let index = 1; index < keys.length; index += 1) {
    const previous = keys[index - 1]!;
    const current = keys[index]!;
    if (previous === current) throw new Error(`reviewed evidence pack repeats capability ${current}`);
    if (previous > current) throw new Error("reviewed evidence pack capability keys must be sorted");
  }
  return keys;
}

function routeProjection(route: ReturnType<typeof parseChannelProgramRouteRunSeed>) {
  return {
    routeKey: route.routeKey,
    routeFingerprint: route.routeFingerprint,
    family: route.family,
    contentLaneKey: route.contentLaneKey,
    programBriefFingerprint: route.programBriefFingerprint,
    directives: route.directives,
    requiredBlocks: route.requiredBlocks,
    ...(route.quizProfile ? { quizProfile: route.quizProfile } : {}),
    ...(route.syntheticScenarioProfile ? { syntheticScenarioProfile: route.syntheticScenarioProfile } : {}),
    ...(route.serializedProgram ? { serializedProgram: route.serializedProgram } : {}),
  };
}

function profileRouteProjection(profile: ChannelShowProfile) {
  const route = profile.programRoute;
  if (!route) {
    throw new Error(
      "reviewed evidence packs require a Show Profile with its exact admitted program route; historical route-less profiles cannot authorize a new pack",
    );
  }
  return {
    routeKey: route.routeKey,
    routeFingerprint: route.fingerprint,
    family: route.family,
    contentLaneKey: route.contentLaneKey,
    programBriefFingerprint: route.programBriefFingerprint,
    directives: route.directives,
    requiredBlocks: route.requiredBlocks,
    ...(route.quizProfile ? { quizProfile: route.quizProfile } : {}),
    ...(route.syntheticScenarioProfile ? { syntheticScenarioProfile: route.syntheticScenarioProfile } : {}),
    ...(route.serializedProgram ? { serializedProgram: route.serializedProgram } : {}),
  };
}

function createShowProfileBinding(
  value: unknown,
  route: ReturnType<typeof parseChannelProgramRouteRunSeed>,
): ReviewedEvidencePackShowProfileBinding {
  const profile = parseChannelShowProfileReceipt(value);
  if (canonicalJson(profileRouteProjection(profile)) !== canonicalJson(routeProjection(route))) {
    throw new Error("reviewed evidence pack Show Profile does not exactly match the frozen route seed");
  }
  const selectedCapabilityKeys = [...profile.selectedCapabilityKeys];
  sortedUniqueCapabilityKeys(selectedCapabilityKeys);
  return ReviewedEvidencePackShowProfileBindingSchema.parse({
    showProfileFingerprint: profile.fingerprint,
    programBriefFingerprint: profile.programBriefFingerprint,
    routeKey: route.routeKey,
    routeFingerprint: route.routeFingerprint,
    family: route.family,
    contentLaneKey: route.contentLaneKey,
    selectedCapabilityKeys,
    capabilityFingerprint: sha256Hex(canonicalJson(selectedCapabilityKeys)),
  });
}

function assertShowProfileBinding(
  value: unknown,
  route: ReturnType<typeof parseChannelProgramRouteRunSeed>,
): ReviewedEvidencePackShowProfileBinding {
  const binding = ReviewedEvidencePackShowProfileBindingSchema.parse(value);
  sortedUniqueCapabilityKeys(binding.selectedCapabilityKeys);
  if (binding.capabilityFingerprint !== sha256Hex(canonicalJson(binding.selectedCapabilityKeys))) {
    throw new Error("reviewed evidence pack capability fingerprint does not match selected capabilities");
  }
  const expected = {
    programBriefFingerprint: route.programBriefFingerprint,
    routeKey: route.routeKey,
    routeFingerprint: route.routeFingerprint,
    family: route.family,
    contentLaneKey: route.contentLaneKey,
  };
  if (
    binding.programBriefFingerprint !== expected.programBriefFingerprint ||
    binding.routeKey !== expected.routeKey ||
    binding.routeFingerprint !== expected.routeFingerprint ||
    binding.family !== expected.family ||
    binding.contentLaneKey !== expected.contentLaneKey
  ) {
    throw new Error("reviewed evidence pack Show Profile binding does not match the frozen route seed");
  }
  return binding;
}

function assertAuthorityTopic(authorityTopic: unknown, expectedTopic: unknown, label: string): void {
  if (reviewedEvidenceRouteTopicFingerprint(authorityTopic) !== reviewedEvidenceRouteTopicFingerprint(expectedTopic)) {
    throw new Error(`reviewed evidence pack ${label} does not match the pack topic`);
  }
}

function validatedLedger(value: unknown, now: number): DataStorySourceLedger {
  const report = evaluateDataStorySourceLedger(value, undefined, now);
  if (!report.safe || !report.ledger) {
    throw new Error(`reviewed evidence pack data-story ledger rejected: ${report.issues.map((issue) => issue.message).join("; ")}`);
  }
  return report.ledger;
}

function assertDerivedPacket(
  ledger: DataStorySourceLedger,
  value: unknown,
  now: number,
): EditorialEvidencePacket {
  const packet = assertEditorialEvidencePacket(value, now);
  const expected = editorialEvidencePacketFromDataStoryLedger(ledger, now);
  if (canonicalJson(packet) !== canonicalJson(expected)) {
    throw new Error("reviewed evidence pack derived editorial evidence packet is not the exact adaptation of its data-story ledger");
  }
  return packet;
}

function authorityContentFingerprint(authority: ValidatedAuthority): string {
  if (authority.editorialEvidencePacket !== undefined) {
    return editorialEvidencePacketContentFingerprint(authority.editorialEvidencePacket);
  }
  if (authority.dataStorySourceLedger === undefined) {
    throw new Error("reviewed evidence pack is missing its concrete primary authority");
  }
  return dataStorySourceLedgerFingerprint(authority.dataStorySourceLedger);
}

function createAuthority(input: CreateReviewedEvidencePackInput, expectedTopic: unknown, now: number): ValidatedAuthority {
  const hasPacket = input.editorialEvidencePacket !== undefined;
  const hasLedger = input.dataStorySourceLedger !== undefined;
  if (hasPacket === hasLedger) {
    throw new Error("reviewed evidence pack requires exactly one primary authority: editorial evidence packet XOR data-story source ledger");
  }
  if (hasPacket) {
    if (input.derivedEditorialEvidencePacket !== undefined) {
      throw new Error("reviewed evidence pack only permits a derived editorial packet with a data-story ledger authority");
    }
    const packet = assertEditorialEvidencePacket(input.editorialEvidencePacket, now);
    assertAuthorityTopic(packet.subject, expectedTopic, "editorial evidence packet subject");
    return {
      authority: { kind: "editorial_evidence_packet", editorialEvidencePacket: packet },
      editorialEvidencePacket: packet,
    };
  }
  const ledger = validatedLedger(input.dataStorySourceLedger, now);
  assertAuthorityTopic(ledger.topic, expectedTopic, "data-story source ledger topic");
  const derivedEditorialEvidencePacket = input.derivedEditorialEvidencePacket === undefined
    ? undefined
    : assertDerivedPacket(ledger, input.derivedEditorialEvidencePacket, now);
  return {
    authority: {
      kind: "data_story_source_ledger",
      dataStorySourceLedger: ledger,
      ...(derivedEditorialEvidencePacket ? { derivedEditorialEvidencePacket } : {}),
    },
    dataStorySourceLedger: ledger,
  };
}

function assertAuthority(value: unknown, expectedTopic: unknown, now: number): ValidatedAuthority {
  const authority = ReviewedEvidencePackSourceAuthoritySchema.parse(value);
  if (authority.kind === "editorial_evidence_packet") {
    const packet = assertEditorialEvidencePacket(authority.editorialEvidencePacket, now);
    assertAuthorityTopic(packet.subject, expectedTopic, "editorial evidence packet subject");
    return {
      authority: { kind: "editorial_evidence_packet", editorialEvidencePacket: packet },
      editorialEvidencePacket: packet,
    };
  }
  const ledger = validatedLedger(authority.dataStorySourceLedger, now);
  assertAuthorityTopic(ledger.topic, expectedTopic, "data-story source ledger topic");
  const derivedEditorialEvidencePacket = authority.derivedEditorialEvidencePacket === undefined
    ? undefined
    : assertDerivedPacket(ledger, authority.derivedEditorialEvidencePacket, now);
  return {
    authority: {
      kind: "data_story_source_ledger",
      dataStorySourceLedger: ledger,
      ...(derivedEditorialEvidencePacket ? { derivedEditorialEvidencePacket } : {}),
    },
    dataStorySourceLedger: ledger,
  };
}

function normalizedEvidenceVisualManifests(value: unknown, now: number): EvidenceVisualManifest[] {
  const manifests = assertEvidenceVisualManifestCollection(value === undefined ? [] : value)
    .map((manifest) => assertEvidenceVisualManifest(manifest, { now }));
  return [...manifests].sort((left, right) => left.id.localeCompare(right.id));
}

function routeBindingInput(input: {
  route: unknown;
  topic: unknown;
  storySpine: unknown;
  episodeGraph?: unknown;
  authority: ValidatedAuthority;
  evidenceVisualManifests: readonly EvidenceVisualManifest[];
  now: number;
}) {
  return {
    route: input.route,
    topic: input.topic,
    storySpine: input.storySpine,
    ...(input.episodeGraph === undefined ? {} : { episodeGraph: input.episodeGraph }),
    ...(input.authority.editorialEvidencePacket === undefined
      ? { dataStorySourceLedger: input.authority.dataStorySourceLedger }
      : { editorialEvidencePacket: input.authority.editorialEvidencePacket }),
    evidenceVisualManifests: input.evidenceVisualManifests,
    now: input.now,
  };
}

function createReviewedPlan(input: {
  value: unknown;
  route: unknown;
  topic: unknown;
  authority: ValidatedAuthority;
  evidenceVisualManifests: readonly EvidenceVisualManifest[];
  now: number;
}): ReviewedEvidencePackPlan | undefined {
  if (input.value === undefined) return undefined;
  const draft = ReviewedEvidencePackPlanDraftSchema.parse(input.value);
  const matchInput = routeBindingInput({
    route: input.route,
    topic: input.topic,
    storySpine: draft.storySpine,
    ...(draft.episodeGraph === undefined ? {} : { episodeGraph: draft.episodeGraph }),
    authority: input.authority,
    evidenceVisualManifests: input.evidenceVisualManifests,
    now: input.now,
  });
  const reviewedEvidenceRouteBinding = draft.reviewedEvidenceRouteBinding === undefined
    ? createReviewedEvidenceRouteBinding(matchInput)
    : assertReviewedEvidenceRouteBindingMatches(draft.reviewedEvidenceRouteBinding, matchInput);
  return ReviewedEvidencePackPlanSchema.parse({
    storySpine: draft.storySpine,
    ...(draft.episodeGraph === undefined ? {} : { episodeGraph: draft.episodeGraph }),
    reviewedEvidenceRouteBinding,
  }) as ReviewedEvidencePackPlan;
}

function assertReviewedPlan(input: {
  value: unknown;
  route: unknown;
  topic: unknown;
  authority: ValidatedAuthority;
  evidenceVisualManifests: readonly EvidenceVisualManifest[];
  now: number;
}): ReviewedEvidencePackPlan | undefined {
  if (input.value === undefined) return undefined;
  const plan = ReviewedEvidencePackPlanSchema.parse(input.value);
  const reviewedEvidenceRouteBinding = assertReviewedEvidenceRouteBindingMatches(
    plan.reviewedEvidenceRouteBinding,
    routeBindingInput({
      route: input.route,
      topic: input.topic,
      storySpine: plan.storySpine,
      ...(plan.episodeGraph === undefined ? {} : { episodeGraph: plan.episodeGraph }),
      authority: input.authority,
      evidenceVisualManifests: input.evidenceVisualManifests,
      now: input.now,
    }),
  );
  return ReviewedEvidencePackPlanSchema.parse({
    storySpine: plan.storySpine,
    ...(plan.episodeGraph === undefined ? {} : { episodeGraph: plan.episodeGraph }),
    reviewedEvidenceRouteBinding,
  }) as ReviewedEvidencePackPlan;
}

function assertFreshApprovedReview(review: ReviewedEvidencePackReview, now: number): void {
  const reviewedAt = Date.parse(review.reviewedAt);
  if (!Number.isFinite(reviewedAt) || reviewedAt > now + REVIEW_CLOCK_SKEW_MS) {
    throw new Error("reviewed evidence pack approval timestamp is invalid or in the future");
  }
  if (now - reviewedAt > REVIEWED_EVIDENCE_PACK_REVIEW_MAX_AGE_MS) {
    throw new Error("reviewed evidence pack approval is older than 30 days");
  }
}

/** Canonical content identity; review metadata is deliberately excluded. */
export function reviewedEvidencePackContentFingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(ReviewedEvidencePackContentSchema.parse(contentPayload(value))));
}

/**
 * Builds a new immutable private handoff. It has no network, provider, render,
 * run, admission, or publishing side effect.
 */
export function createReviewedEvidencePack(input: CreateReviewedEvidencePackInput): ReviewedEvidencePack {
  const now = nowMs(input.now);
  const route = parseChannelProgramRouteRunSeed(input.route);
  const normalizedTopic = topic.parse(input.topic);
  const authority = createAuthority(input, normalizedTopic, now);
  const evidenceVisualManifests = normalizedEvidenceVisualManifests(input.evidenceVisualManifests, now);
  const reviewedPlan = createReviewedPlan({
    value: input.reviewedPlan,
    route,
    topic: normalizedTopic,
    authority,
    evidenceVisualManifests,
    now,
  });
  const showProfileReceipt = parseChannelShowProfileReceipt(input.showProfile);
  const content = ReviewedEvidencePackContentSchema.parse({
    version: REVIEWED_EVIDENCE_PACK_VERSION,
    release: REVIEWED_EVIDENCE_PACK_RELEASE,
    requiresHumanEditorialReview: true,
    route,
    routeSeedFingerprint: channelProgramRouteRunSeedFingerprint(route),
    topic: normalizedTopic,
    topicFingerprint: reviewedEvidenceRouteTopicFingerprint(normalizedTopic),
    showProfileReceipt,
    showProfile: createShowProfileBinding(showProfileReceipt, route),
    sourceAuthority: authority.authority,
    authorityContentFingerprint: authorityContentFingerprint(authority),
    evidenceVisualManifests,
    ...(reviewedPlan ? { reviewedPlan } : {}),
  });
  const contentFingerprint = reviewedEvidencePackContentFingerprint(content);
  const review = ReviewedEvidencePackReviewDraftSchema.parse(input.review);
  return assertReviewedEvidencePack({
    ...content,
    contentFingerprint,
    review: {
      ...review,
      decision: "approved",
      reviewedPackFingerprint: contentFingerprint,
    },
  }, now);
}

/**
 * Parses a persisted pack and replays all intrinsic and authority-aware
 * joins. This remains private provenance validation only; it intentionally
 * does not produce any run/admission/publish token.
 */
export function assertReviewedEvidencePack(value: unknown, suppliedNow = Date.now()): ReviewedEvidencePack {
  const now = nowMs(suppliedNow);
  const pack = ReviewedEvidencePackSchema.parse(value);
  const route = parseChannelProgramRouteRunSeed(pack.route);
  if (pack.routeSeedFingerprint !== channelProgramRouteRunSeedFingerprint(route)) {
    throw new Error("reviewed evidence pack route seed fingerprint does not match its full frozen route seed");
  }
  if (pack.topicFingerprint !== reviewedEvidenceRouteTopicFingerprint(pack.topic)) {
    throw new Error("reviewed evidence pack topic fingerprint does not match its topic");
  }
  if (pack.contentFingerprint !== reviewedEvidencePackContentFingerprint(pack)) {
    throw new Error("reviewed evidence pack content fingerprint does not match its canonical content");
  }
  if (pack.review.reviewedPackFingerprint !== pack.contentFingerprint) {
    throw new Error("reviewed evidence pack approval is not bound to this exact content");
  }
  assertFreshApprovedReview(pack.review, now);
  const persistedShowProfile = assertShowProfileBinding(pack.showProfile, route);
  const expectedShowProfile = createShowProfileBinding(pack.showProfileReceipt, route);
  if (canonicalJson(persistedShowProfile) !== canonicalJson(expectedShowProfile)) {
    throw new Error("reviewed evidence pack Show Profile receipt does not match its sealed projection");
  }
  const authority = assertAuthority(pack.sourceAuthority, pack.topic, now);
  if (pack.authorityContentFingerprint !== authorityContentFingerprint(authority)) {
    throw new Error("reviewed evidence pack authority content fingerprint does not match its concrete reviewed authority");
  }
  const evidenceVisualManifests = normalizedEvidenceVisualManifests(pack.evidenceVisualManifests, now);
  assertReviewedPlan({
    value: pack.reviewedPlan,
    route,
    topic: pack.topic,
    authority,
    evidenceVisualManifests,
    now,
  });
  return pack as unknown as ReviewedEvidencePack;
}

/**
 * Compact persistence projection. It intentionally exposes no execution
 * capability: Convex stores these fields for owner-scoped lookup only.
 */
export function reviewedEvidencePackPersistenceBinding(value: unknown): {
  readonly contentFingerprint: string;
  readonly reviewId: string;
  readonly reviewerId: string;
  readonly reviewedAt: string;
  readonly routeSeedFingerprint: string;
  readonly routeKey: string;
  readonly family: string;
  readonly contentLaneKey: string;
  readonly showProfileFingerprint: string;
  readonly capabilityFingerprint: string;
  readonly selectedCapabilityKeys: readonly string[];
  readonly topicFingerprint: string;
  readonly authorityKind: "editorial_evidence_packet" | "data_story_source_ledger";
  readonly authorityContentFingerprint: string;
  readonly reviewedEvidenceRouteBindingFingerprint?: string;
} {
  const pack = assertReviewedEvidencePack(value);
  const plan = pack.reviewedPlan;
  return {
    contentFingerprint: pack.contentFingerprint,
    reviewId: pack.review.reviewId,
    reviewerId: pack.review.reviewerId,
    reviewedAt: pack.review.reviewedAt,
    routeSeedFingerprint: pack.routeSeedFingerprint,
    routeKey: pack.route.routeKey,
    family: pack.route.family,
    contentLaneKey: pack.route.contentLaneKey,
    showProfileFingerprint: pack.showProfile.showProfileFingerprint,
    capabilityFingerprint: pack.showProfile.capabilityFingerprint,
    selectedCapabilityKeys: [...pack.showProfile.selectedCapabilityKeys],
    topicFingerprint: pack.topicFingerprint,
    authorityKind: pack.sourceAuthority.kind,
    authorityContentFingerprint: pack.authorityContentFingerprint,
    ...(plan ? { reviewedEvidenceRouteBindingFingerprint: plan.reviewedEvidenceRouteBinding.bindingFingerprint } : {}),
  };
}
