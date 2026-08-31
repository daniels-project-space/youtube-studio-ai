/**
 * Provider-free, immutable join of a frozen program route, a timed Story
 * Spine, and exactly one already-reviewed factual authority.
 *
 * This is deliberately a reusable factual/editorial evidence receipt, not a
 * QA result, render admission, certificate, or release gate. It rejects
 * non-editorial claim modes so fictional, Casefile, self-contained, and quiz
 * flows cannot use it as a cross-policy escape hatch.
 */
import { z } from "zod";

import {
  ChannelProgramRouteRunSeedSchema,
  channelProgramRouteRunSeedFingerprint,
  parseChannelProgramRouteRunSeed,
} from "@/engine/channelProgramRoute";
import {
  assertDataStorySourceLedger,
  dataStorySourceLedgerFingerprint,
} from "@/engine/dataStorySourceLedger";
import {
  assertEditorialEvidencePacket,
  editorialEvidencePacketContentFingerprint,
} from "@/engine/editorialEvidencePacket";
import {
  assertEpisodeGraphAgainstStorySpine,
  episodeGraphFingerprint,
} from "@/engine/episodeGraph";
import {
  assertEvidenceVisualManifestCollection,
  evidenceVisualManifestFingerprint,
} from "@/engine/evidenceVisualManifest";
import {
  StorySpineSchema,
  storySpineFingerprint,
  validateStorySpine,
} from "@/engine/storySpine";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export const REVIEWED_EVIDENCE_ROUTE_BINDING_VERSION =
  "reviewed-evidence-route-binding/v1" as const;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/, "expected SHA-256 fingerprint");
const topic = z.string().trim().min(1).max(1_200);
const evidenceVisualManifestId = z.string()
  .trim()
  .min(2)
  .max(160)
  .regex(/^[A-Za-z0-9._:-]+$/, "expected stable evidence visual manifest id");

export const ReviewedEvidenceSourceAuthoritySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("editorial_evidence_packet"),
    contentFingerprint: sha256,
  }).strict(),
  z.object({
    kind: z.literal("data_story_source_ledger"),
    contentFingerprint: sha256,
  }).strict(),
]);
export type ReviewedEvidenceSourceAuthority = z.infer<typeof ReviewedEvidenceSourceAuthoritySchema>;

export const ReviewedEvidenceVisualManifestRefSchema = z.object({
  id: evidenceVisualManifestId,
  contentFingerprint: sha256,
}).strict();
export type ReviewedEvidenceVisualManifestRef = z.infer<typeof ReviewedEvidenceVisualManifestRefSchema>;

const ReviewedEvidenceRouteBindingPayloadSchema = z.object({
  version: z.literal(REVIEWED_EVIDENCE_ROUTE_BINDING_VERSION),
  /** The entire immutable run seed, not only a route key or route fingerprint. */
  route: ChannelProgramRouteRunSeedSchema,
  routeSeedFingerprint: sha256,
  topicFingerprint: sha256,
  storySpineFingerprint: sha256,
  episodeGraphFingerprint: sha256.optional(),
  sourceAuthority: ReviewedEvidenceSourceAuthoritySchema,
  /** Stable ID order prevents equivalent reviewed manifest sets from hashing differently. */
  evidenceVisualManifestRefs: z.array(ReviewedEvidenceVisualManifestRefSchema).max(48),
}).strict();

export const ReviewedEvidenceRouteBindingSchema = ReviewedEvidenceRouteBindingPayloadSchema.extend({
  bindingFingerprint: sha256,
}).strict();
export type ReviewedEvidenceRouteBinding = z.infer<typeof ReviewedEvidenceRouteBindingSchema>;

interface ReviewedEvidenceAuthorityInput {
  /** Exactly one of these two reviewed authorities is required. */
  editorialEvidencePacket?: unknown;
  dataStorySourceLedger?: unknown;
  /** Injectable only for deterministic editorial-packet review validation. */
  now?: number;
}

export interface CreateReviewedEvidenceRouteBindingInput extends ReviewedEvidenceAuthorityInput {
  /** Complete frozen ChannelProgramRouteRunSeed, never a mutable route catalog lookup. */
  route: unknown;
  topic: unknown;
  storySpine: unknown;
  episodeGraph?: unknown;
  /** Optional because original explainers need not use factual visual inserts. */
  evidenceVisualManifests?: unknown;
}

export interface ReviewedEvidenceRouteBindingMatchInput extends ReviewedEvidenceAuthorityInput {
  route: unknown;
  topic: unknown;
  storySpine: unknown;
  /** When absent, the binding must also be graph-free. */
  episodeGraph?: unknown;
  /** Omit only when the expected reviewed manifest set is empty. */
  evidenceVisualManifests?: unknown;
}

function bindingPayload(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { bindingFingerprint: _bindingFingerprint, ...payload } = value as Record<string, unknown>;
  void _bindingFingerprint;
  return payload;
}

function compareManifestIds(left: ReviewedEvidenceVisualManifestRef, right: ReviewedEvidenceVisualManifestRef): number {
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function assertSortedUniqueEvidenceVisualManifestRefs(
  refs: readonly ReviewedEvidenceVisualManifestRef[],
): void {
  for (let index = 1; index < refs.length; index += 1) {
    const previous = refs[index - 1]!;
    const current = refs[index]!;
    if (previous.id === current.id) {
      throw new Error(`reviewed evidence route binding repeats evidence visual manifest ${current.id}`);
    }
    if (compareManifestIds(previous, current) > 0) {
      throw new Error("reviewed evidence route binding evidence visual manifest refs must be sorted by id");
    }
  }
}

function evidenceVisualManifestRefs(value: unknown): ReviewedEvidenceVisualManifestRef[] {
  const manifests = value === undefined ? [] : assertEvidenceVisualManifestCollection(value);
  return manifests
    .map((manifest) => ({
      id: manifest.id,
      contentFingerprint: evidenceVisualManifestFingerprint(manifest),
    }))
    .sort(compareManifestIds);
}

function assertEditorialLaneRoute(route: ReturnType<typeof parseChannelProgramRouteRunSeed>): void {
  if (route.directives.claimMode !== "editorial_lane_policy") {
    throw new Error(
      "reviewed evidence route binding requires a frozen route with directives.claimMode === editorial_lane_policy",
    );
  }
}

function sourceAuthority(
  input: ReviewedEvidenceAuthorityInput,
  expectedTopic: unknown,
): ReviewedEvidenceSourceAuthority {
  const hasEditorialEvidencePacket = input.editorialEvidencePacket !== undefined;
  const hasDataStorySourceLedger = input.dataStorySourceLedger !== undefined;
  if (hasEditorialEvidencePacket === hasDataStorySourceLedger) {
    throw new Error(
      "reviewed evidence route binding requires exactly one reviewed authority: editorial evidence packet XOR data-story source ledger",
    );
  }

  if (hasEditorialEvidencePacket) {
    const now = input.now === undefined ? Date.now() : z.number().finite().parse(input.now);
    const packet = assertEditorialEvidencePacket(input.editorialEvidencePacket, now);
    if (reviewedEvidenceRouteTopicFingerprint(packet.subject) !== reviewedEvidenceRouteTopicFingerprint(expectedTopic)) {
      throw new Error("reviewed evidence route binding editorial evidence packet subject does not match the receipt topic");
    }
    return {
      kind: "editorial_evidence_packet",
      contentFingerprint: editorialEvidencePacketContentFingerprint(packet),
    };
  }

  const ledger = assertDataStorySourceLedger(input.dataStorySourceLedger);
  if (reviewedEvidenceRouteTopicFingerprint(ledger.topic) !== reviewedEvidenceRouteTopicFingerprint(expectedTopic)) {
    throw new Error("reviewed evidence route binding data-story source ledger topic does not match the receipt topic");
  }
  return {
    kind: "data_story_source_ledger",
    contentFingerprint: dataStorySourceLedgerFingerprint(ledger),
  };
}

/** Stable identity of the normalized topic the receipt binds. */
export function reviewedEvidenceRouteTopicFingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(topic.parse(value)));
}

/**
 * Canonical fingerprint of the receipt payload. Accepts either a payload or a
 * complete binding so integrity tests can deliberately recompute a tampered
 * receipt before asserting that its other invariants still fail closed.
 */
export function reviewedEvidenceRouteBindingFingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(ReviewedEvidenceRouteBindingPayloadSchema.parse(bindingPayload(value))));
}

/** Parse and verify the receipt's intrinsic immutable invariants. */
export function assertReviewedEvidenceRouteBinding(value: unknown): ReviewedEvidenceRouteBinding {
  const binding = ReviewedEvidenceRouteBindingSchema.parse(value);
  const route = parseChannelProgramRouteRunSeed(binding.route);
  assertEditorialLaneRoute(route);
  if (binding.routeSeedFingerprint !== channelProgramRouteRunSeedFingerprint(route)) {
    throw new Error("reviewed evidence route binding route seed fingerprint does not match the full frozen route seed");
  }
  assertSortedUniqueEvidenceVisualManifestRefs(binding.evidenceVisualManifestRefs);
  if (binding.bindingFingerprint !== reviewedEvidenceRouteBindingFingerprint(binding)) {
    throw new Error("reviewed evidence route binding fingerprint does not match its canonical payload");
  }
  return binding;
}

/**
 * Verify a persisted receipt against the concrete inputs a later generic QA
 * consumer already has, including its current reviewed authority and manifest
 * collection. This stays deliberately agnostic about route-family policy and
 * does not re-run a provider, release gate, or reviewer workflow.
 */
export function assertReviewedEvidenceRouteBindingMatches(
  value: unknown,
  expected: ReviewedEvidenceRouteBindingMatchInput,
): ReviewedEvidenceRouteBinding {
  const binding = assertReviewedEvidenceRouteBinding(value);
  const route = parseChannelProgramRouteRunSeed(expected.route);
  assertEditorialLaneRoute(route);
  if (binding.routeSeedFingerprint !== channelProgramRouteRunSeedFingerprint(route)) {
    throw new Error("reviewed evidence route binding does not match the expected frozen route seed");
  }
  if (binding.topicFingerprint !== reviewedEvidenceRouteTopicFingerprint(expected.topic)) {
    throw new Error("reviewed evidence route binding does not match the expected topic");
  }

  const expectedAuthority = sourceAuthority(expected, expected.topic);
  if (canonicalJson(binding.sourceAuthority) !== canonicalJson(expectedAuthority)) {
    throw new Error("reviewed evidence route binding does not match the expected reviewed authority");
  }
  const expectedManifestRefs = evidenceVisualManifestRefs(expected.evidenceVisualManifests);
  if (canonicalJson(binding.evidenceVisualManifestRefs) !== canonicalJson(expectedManifestRefs)) {
    throw new Error("reviewed evidence route binding does not match the expected reviewed evidence visual manifests");
  }

  const storySpine = validateStorySpine(StorySpineSchema.parse(expected.storySpine));
  if (binding.storySpineFingerprint !== storySpineFingerprint(storySpine)) {
    throw new Error("reviewed evidence route binding does not match the expected Story Spine");
  }

  if (expected.episodeGraph === undefined) {
    if (binding.episodeGraphFingerprint !== undefined) {
      throw new Error("reviewed evidence route binding unexpectedly requires an Episode Graph");
    }
  } else {
    const episodeGraph = assertEpisodeGraphAgainstStorySpine(expected.episodeGraph, storySpine);
    if (binding.episodeGraphFingerprint === undefined) {
      throw new Error("reviewed evidence route binding is missing the expected Episode Graph");
    }
    if (binding.episodeGraphFingerprint !== episodeGraphFingerprint(episodeGraph)) {
      throw new Error("reviewed evidence route binding does not match the expected Episode Graph");
    }
  }
  return binding;
}

/**
 * Create a self-verifying receipt from existing reviewed artifacts only. No
 * provider call, renderer selection, quality verdict, or release authority is
 * introduced by this helper.
 */
export function createReviewedEvidenceRouteBinding(
  input: CreateReviewedEvidenceRouteBindingInput,
): ReviewedEvidenceRouteBinding {
  const route = parseChannelProgramRouteRunSeed(input.route);
  assertEditorialLaneRoute(route);
  const storySpine = validateStorySpine(StorySpineSchema.parse(input.storySpine));
  const episodeGraph = input.episodeGraph === undefined
    ? undefined
    : assertEpisodeGraphAgainstStorySpine(input.episodeGraph, storySpine);
  const payload = {
    version: REVIEWED_EVIDENCE_ROUTE_BINDING_VERSION,
    route,
    routeSeedFingerprint: channelProgramRouteRunSeedFingerprint(route),
    topicFingerprint: reviewedEvidenceRouteTopicFingerprint(input.topic),
    storySpineFingerprint: storySpineFingerprint(storySpine),
    ...(episodeGraph ? { episodeGraphFingerprint: episodeGraphFingerprint(episodeGraph) } : {}),
    sourceAuthority: sourceAuthority(input, input.topic),
    evidenceVisualManifestRefs: evidenceVisualManifestRefs(input.evidenceVisualManifests),
  };
  return assertReviewedEvidenceRouteBinding({
    ...payload,
    bindingFingerprint: reviewedEvidenceRouteBindingFingerprint(payload),
  });
}
