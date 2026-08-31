/**
 * Provider-free admission for a single human-reviewed source-attributed
 * episode.  A selector carries identifiers only; factual material is always
 * reloaded from the private owner-scoped Reviewed Evidence Pack record.
 *
 * This deliberately does not make the data-story capability autonomous.  It
 * is the narrow bridge between an already-admitted immutable pack and the
 * frozen pipeline invocation that consumes it.
 */
import { z } from "zod";

import {
  channelProgramRouteRunSeedFingerprint,
  parseChannelProgramRouteRunSeed,
} from "@/engine/channelProgramRoute";
import {
  assertReviewedEvidencePack,
  type ReviewedEvidencePack,
} from "@/engine/reviewedEvidencePack";
import { editorialEvidencePacketFromDataStoryLedger } from "@/engine/editorialEvidencePacket";
import { canonicalJson } from "@/lib/canonicalJson";

export const REVIEWED_EVIDENCE_PACK_RUN_ADMISSION_VERSION =
  "reviewed-evidence-pack-run-admission/v1" as const;
export const REVIEWED_EVIDENCE_PACK_SELECTOR_SEED_KEY =
  "reviewedEvidencePackSelector" as const;
export const REVIEWED_EVIDENCE_PACK_SEED_KEY = "reviewedEvidencePack" as const;
export const REVIEWED_EVIDENCE_PACK_RUN_ADMISSION_SEED_KEY =
  "reviewedEvidencePackRunAdmission" as const;

const SOURCE_ATTRIBUTED_DATA_STORY_CAPABILITY = "source_attributed_data_story" as const;
const NARRATED_STOCK_FOUNDATION_ROUTE = "narrated-stock/foundation/v1" as const;
const NARRATED_DOCUMENTARY_LANE = "narrated_documentary" as const;
const SHA256 = /^[a-f0-9]{64}$/;

const selectorSchema = z.object({
  packId: z.string().trim().min(1).max(256),
  contentFingerprint: z.string().regex(SHA256, "expected SHA-256 content fingerprint"),
}).strict();

export type ReviewedEvidencePackRunSelector = z.infer<typeof selectorSchema>;

/** Selector-only public boundary: it never accepts factual packet contents. */
export function parseReviewedEvidencePackRunSelector(
  value: unknown,
): ReviewedEvidencePackRunSelector {
  return selectorSchema.parse(value);
}

export interface ReviewedEvidencePackRunBinding {
  /** The immutable Program Route seed that will be frozen into this invocation. */
  readonly route: unknown;
  /** Current profile on a fresh run; snapshot value on a resumed run. */
  readonly showProfileFingerprint: unknown;
  /** Current selected capabilities on a fresh run; frozen snapshot values on resume. */
  readonly selectedCapabilityKeys: unknown;
}

export interface ReviewedEvidencePackStoredRecord {
  readonly _id: unknown;
  readonly ownerId: unknown;
  readonly contentFingerprint: unknown;
  readonly pack: unknown;
}

export interface AdmittedReviewedEvidencePackRun {
  readonly selector: ReviewedEvidencePackRunSelector;
  readonly pack: ReviewedEvidencePack;
  readonly seed: Readonly<Record<string, unknown>>;
}

function requiredOwner(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("reviewed evidence run admission owner is invalid");
  }
  return value;
}

function requiredFingerprint(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`reviewed evidence run admission ${label} is invalid`);
  }
  return value;
}

function capabilityKeys(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((key) => typeof key !== "string" || !key.trim())) {
    throw new Error("reviewed evidence run admission selected capability keys are invalid");
  }
  const normalized = [...new Set(value.map((key) => key.trim()))].sort();
  if (normalized.length !== value.length) {
    throw new Error("reviewed evidence run admission selected capability keys are not unique");
  }
  return normalized;
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return canonicalJson([...left].sort()) === canonicalJson([...right].sort());
}

function topic(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`reviewed evidence run admission ${label} is invalid`);
  }
  return value.trim();
}

/**
 * Returns true only for the one explicitly admitted source-data-story route.
 * Any future factual route must opt in here through its own reviewed policy;
 * this prevents a newly added editorial route from silently consuming a pack.
 */
export function requiresReviewedEvidencePackForSourceDataStory(
  binding: ReviewedEvidencePackRunBinding,
): boolean {
  const route = parseChannelProgramRouteRunSeed(binding.route);
  const selectedCapabilityKeys = capabilityKeys(binding.selectedCapabilityKeys);
  const selected = selectedCapabilityKeys.includes(SOURCE_ATTRIBUTED_DATA_STORY_CAPABILITY);
  if (!selected) return false;

  if (
    route.routeKey !== NARRATED_STOCK_FOUNDATION_ROUTE ||
    route.family !== "narrated_stock" ||
    route.contentLaneKey !== NARRATED_DOCUMENTARY_LANE ||
    route.directives.claimMode !== "editorial_lane_policy"
  ) {
    throw new Error(
      "source_attributed_data_story is admitted only on the sealed narrated-stock editorial foundation route",
    );
  }
  requiredFingerprint(binding.showProfileFingerprint, "Show Profile fingerprint");
  return true;
}

function assertStoredRecord(args: {
  readonly selector: ReviewedEvidencePackRunSelector;
  readonly record: ReviewedEvidencePackStoredRecord;
  readonly ownerId: string;
}): void {
  if (String(args.record._id) !== args.selector.packId) {
    throw new Error("reviewed evidence pack storage identity does not match the requested selector");
  }
  if (args.record.ownerId !== args.ownerId) {
    throw new Error("reviewed evidence pack is not owned by this pipeline owner");
  }
  if (args.record.contentFingerprint !== args.selector.contentFingerprint) {
    throw new Error("reviewed evidence pack storage fingerprint does not match the requested selector");
  }
}

function assertPackMatchesBinding(args: {
  readonly pack: ReviewedEvidencePack;
  readonly binding: ReviewedEvidencePackRunBinding;
  readonly scheduledTopic?: unknown;
}): void {
  const route = parseChannelProgramRouteRunSeed(args.binding.route);
  const selectedCapabilityKeys = capabilityKeys(args.binding.selectedCapabilityKeys);
  const showProfileFingerprint = requiredFingerprint(
    args.binding.showProfileFingerprint,
    "Show Profile fingerprint",
  );
  if (args.pack.routeSeedFingerprint !== channelProgramRouteRunSeedFingerprint(route)) {
    throw new Error("reviewed evidence pack does not match this invocation's frozen Program Route seed");
  }
  if (canonicalJson(args.pack.route) !== canonicalJson(route)) {
    throw new Error("reviewed evidence pack route differs from this invocation's frozen Program Route seed");
  }
  if (args.pack.showProfile.showProfileFingerprint !== showProfileFingerprint) {
    throw new Error("reviewed evidence pack is bound to a different sealed Show Profile");
  }
  if (
    args.pack.showProfile.programBriefFingerprint !== route.programBriefFingerprint ||
    args.pack.showProfile.routeFingerprint !== route.routeFingerprint ||
    args.pack.showProfile.routeKey !== route.routeKey ||
    args.pack.showProfile.family !== route.family ||
    args.pack.showProfile.contentLaneKey !== route.contentLaneKey
  ) {
    throw new Error("reviewed evidence pack Show Profile projection does not match this frozen route");
  }
  if (!sameStringList(args.pack.showProfile.selectedCapabilityKeys, selectedCapabilityKeys)) {
    throw new Error("reviewed evidence pack capability selection differs from this sealed Show Profile");
  }
  if (args.scheduledTopic !== undefined && topic(args.scheduledTopic, "scheduled topic") !== args.pack.topic) {
    throw new Error("reviewed evidence pack topic does not match the claimed scheduled-plan topic");
  }
}

function admissionSeed(args: {
  readonly selector: ReviewedEvidencePackRunSelector;
  readonly pack: ReviewedEvidencePack;
  readonly showProfileFingerprint: string;
  readonly selectedCapabilityKeys: readonly string[];
  readonly now: number;
}): Readonly<Record<string, unknown>> {
  if (args.pack.sourceAuthority.kind !== "data_story_source_ledger") {
    throw new Error(
      "source_attributed_data_story requires a reviewed data-story source ledger, not a generic editorial packet",
    );
  }
  const ledger = args.pack.sourceAuthority.dataStorySourceLedger;
  const editorialEvidencePacket = args.pack.sourceAuthority.derivedEditorialEvidencePacket ??
    editorialEvidencePacketFromDataStoryLedger(ledger, args.now);
  const reviewedEvidenceRouteBindingFingerprint =
    args.pack.reviewedPlan?.reviewedEvidenceRouteBinding.bindingFingerprint;
  const admission = {
    version: REVIEWED_EVIDENCE_PACK_RUN_ADMISSION_VERSION,
    selector: args.selector,
    contentFingerprint: args.pack.contentFingerprint,
    routeSeedFingerprint: args.pack.routeSeedFingerprint,
    topicFingerprint: args.pack.topicFingerprint,
    showProfileFingerprint: args.showProfileFingerprint,
    selectedCapabilityKeys: [...args.selectedCapabilityKeys],
    authorityKind: args.pack.sourceAuthority.kind,
    authorityContentFingerprint: args.pack.authorityContentFingerprint,
    ...(reviewedEvidenceRouteBindingFingerprint === undefined
      ? {}
      : { reviewedEvidenceRouteBindingFingerprint }),
  } as const;
  return Object.freeze({
    [REVIEWED_EVIDENCE_PACK_SELECTOR_SEED_KEY]: args.selector,
    [REVIEWED_EVIDENCE_PACK_SEED_KEY]: args.pack,
    [REVIEWED_EVIDENCE_PACK_RUN_ADMISSION_SEED_KEY]: admission,
    // `topic_select` treats plannedTopic as a no-provider fast path. It is
    // deliberately the exact reviewed pack topic, never browser input.
    plannedTopic: args.pack.topic,
    dataStorySourceLedger: ledger,
    editorialEvidencePacket,
    evidenceVisualManifests: args.pack.evidenceVisualManifests,
  });
}

export function admitReviewedEvidencePackForSourceDataStoryRun(args: {
  readonly selector: unknown;
  readonly record: ReviewedEvidencePackStoredRecord;
  readonly ownerId: unknown;
  readonly binding: ReviewedEvidencePackRunBinding;
  readonly scheduledTopic?: unknown;
  readonly now?: number;
}): AdmittedReviewedEvidencePackRun {
  const ownerId = requiredOwner(args.ownerId);
  const selector = parseReviewedEvidencePackRunSelector(args.selector);
  // Evaluate the selected route first: a pack cannot turn an ordinary
  // editorial route into a factual/data-story route.
  if (!requiresReviewedEvidencePackForSourceDataStory(args.binding)) {
    throw new Error("reviewed evidence pack selector is not accepted by this channel route");
  }
  assertStoredRecord({ selector, record: args.record, ownerId });
  const now = args.now ?? Date.now();
  const pack = assertReviewedEvidencePack(args.record.pack, now);
  if (pack.contentFingerprint !== selector.contentFingerprint) {
    throw new Error("reviewed evidence pack content does not match the requested selector");
  }
  assertPackMatchesBinding({
    pack,
    binding: args.binding,
    ...(args.scheduledTopic === undefined ? {} : { scheduledTopic: args.scheduledTopic }),
  });
  const showProfileFingerprint = requiredFingerprint(
    args.binding.showProfileFingerprint,
    "Show Profile fingerprint",
  );
  const selectedCapabilityKeys = capabilityKeys(args.binding.selectedCapabilityKeys);
  return {
    selector,
    pack,
    seed: admissionSeed({
      selector,
      pack,
      showProfileFingerprint,
      selectedCapabilityKeys,
      now,
    }),
  };
}

/**
 * A retry may replay only the exact DB-owned pack and exact seed projection
 * that were frozen into the original invocation.  It cannot accept a new
 * selector or reconstitute factual inputs from a browser payload.
 */
export function assertFrozenReviewedEvidencePackRunSeed(args: {
  readonly seedStore: Readonly<Record<string, unknown>>;
  readonly record: ReviewedEvidencePackStoredRecord;
  readonly ownerId: unknown;
  readonly binding: ReviewedEvidencePackRunBinding;
  /** Re-check a claimed plan topic when this retry was scheduler-dispatched. */
  readonly scheduledTopic?: unknown;
  readonly now?: number;
}): AdmittedReviewedEvidencePackRun {
  const selector = args.seedStore[REVIEWED_EVIDENCE_PACK_SELECTOR_SEED_KEY];
  const admitted = admitReviewedEvidencePackForSourceDataStoryRun({
    selector,
    record: args.record,
    ownerId: args.ownerId,
    binding: args.binding,
    scheduledTopic: args.scheduledTopic ?? args.seedStore["plannedTopic"],
    now: args.now,
  });
  for (const [key, value] of Object.entries(admitted.seed)) {
    if (canonicalJson(args.seedStore[key]) !== canonicalJson(value)) {
      throw new Error(`frozen reviewed evidence run seed ${key} does not match its immutable reviewed pack`);
    }
  }
  return admitted;
}

/** Rejects selector-only evidence state on all ordinary routes. */
export function assertNoReviewedEvidencePackRunSeed(
  seedStore: Readonly<Record<string, unknown>>,
): void {
  for (const key of [
    REVIEWED_EVIDENCE_PACK_SELECTOR_SEED_KEY,
    REVIEWED_EVIDENCE_PACK_SEED_KEY,
    REVIEWED_EVIDENCE_PACK_RUN_ADMISSION_SEED_KEY,
  ] as const) {
    if (seedStore[key] !== undefined) {
      throw new Error("reviewed evidence pack seed is only accepted by source_attributed_data_story");
    }
  }
}
