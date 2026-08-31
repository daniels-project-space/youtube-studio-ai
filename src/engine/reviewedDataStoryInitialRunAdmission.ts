import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { assertPersistedProgramBriefIdentity } from "@/engine/channelProgramBrief";
import {
  assertChannelProgramRouteBinding,
  assertChannelProgramRoutePipelineCompatibility,
  channelProgramRouteRunSeed,
} from "@/engine/channelProgramRoute";
import {
  assertChannelShowProfileReceiptPipelineCompatibility,
  channelShowProfileReceiptFingerprint,
} from "@/engine/channelShowProfileCodec";
import { resolveContentLane } from "@/engine/contentLane";
import { hasSourceAttributedDataStoryParams } from "@/engine/dataStory";
import {
  admitReviewedEvidencePackForSourceDataStoryRun,
  requiresReviewedEvidencePackForSourceDataStory,
  type ReviewedEvidencePackStoredRecord,
} from "@/engine/reviewedEvidenceRunAdmission";
import type { PipelineEntry } from "@/engine/types";

/**
 * An owner-selected reviewed ledger is the only first-run entrypoint for the
 * factual data-story lane. This is deliberately a pre-provider admission,
 * not an automatic planner or a generic scheduled-plan payload.
 */
export const REVIEWED_DATA_STORY_INITIAL_RUN_ADMISSION_VERSION =
  "reviewed-data-story-initial-run-admission/v1" as const;

const SHA256 = /^[a-f0-9]{64}$/;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 500 || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function fingerprint(value: unknown, label: string): string {
  const output = identifier(value, label);
  if (!SHA256.test(output)) throw new Error(`${label} must be a sha256 fingerprint`);
  return output;
}

function pipeline(value: unknown): PipelineEntry[] {
  if (!Array.isArray(value)) throw new Error("persisted channel pipeline is missing");
  return value as PipelineEntry[];
}

/**
 * New supervised work must use the v4 source-data materialization: Story
 * Spine and Episode Graph are both retained before the post-TTS review pause,
 * and no stock/visual handoff can occur before that graph exists.
 */
function assertInitialReviewMaterialization(entries: readonly PipelineEntry[]): void {
  const sourceDataIndex = entries.findIndex((entry) =>
    hasSourceAttributedDataStoryParams(entry.params ?? {}),
  );
  const storySpineIndex = entries.findIndex((entry) => entry.block === "story_spine");
  const episodeGraphIndex = entries.findIndex((entry) => entry.block === "episode_graph");
  const stockIndex = entries.findIndex((entry) => entry.block === "stock_footage");
  if (sourceDataIndex < 0) {
    throw new Error("sealed source-attributed data-story route is missing its exact materialization");
  }
  if (storySpineIndex < 0 || episodeGraphIndex < 0 || stockIndex < 0) {
    throw new Error("supervised source-data story requires Story Spine, Episode Graph, and stock handoff blocks");
  }
  if (!(storySpineIndex < episodeGraphIndex && episodeGraphIndex < stockIndex)) {
    throw new Error("supervised source-data story must retain Episode Graph before any stock/visual handoff");
  }
}

export interface ReviewedDataStoryInitialRunAdmission {
  readonly version: typeof REVIEWED_DATA_STORY_INITIAL_RUN_ADMISSION_VERSION;
  readonly ownerId: string;
  readonly channelId: string;
  readonly selector: {
    readonly packId: string;
    readonly contentFingerprint: string;
  };
  readonly routeSeedFingerprint: string;
  readonly showProfileFingerprint: string;
  readonly pipelineFingerprint: string;
  readonly topicFingerprint: string;
  readonly selectedCapabilityKeys: readonly string[];
  readonly admissionFingerprint: string;
}

export interface AdmittedReviewedDataStoryInitialRun {
  readonly admission: ReviewedDataStoryInitialRunAdmission;
  readonly selector: {
    readonly packId: string;
    readonly contentFingerprint: string;
  };
}

export function reviewedDataStoryInitialRunAdmissionFingerprint(
  admission: Omit<ReviewedDataStoryInitialRunAdmission, "admissionFingerprint">,
): string {
  return sha256Hex(canonicalJson(admission));
}

export interface ReviewedDataStoryInitialRunChannelBinding {
  readonly route: unknown;
  readonly showProfile: unknown;
  readonly routeSeed: unknown;
  readonly showProfileFingerprint: string;
  readonly selectedCapabilityKeys: readonly string[];
  readonly pipeline: readonly PipelineEntry[];
  readonly pipelineFingerprint: string;
}

/**
 * Shared server-side channel binding for both reviewed-pack admission and its
 * later outbox start. It rejects an ordinary narrated channel before a raw
 * ledger can even be persisted as a data-story pack.
 */
export function reviewedDataStoryInitialRunChannelBinding(args: {
  readonly identity: unknown;
  readonly contentLane: unknown;
  readonly family: unknown;
  readonly pipeline: unknown;
}): ReviewedDataStoryInitialRunChannelBinding {
  const identity = object(args.identity, "reviewed data-story channel identity");
  const entries = pipeline(args.pipeline);
  const programBrief = assertPersistedProgramBriefIdentity(identity, {
    context: "reviewed data-story initial-run channel identity",
    requireProgramBrief: true,
  });
  if (!programBrief) throw new Error("reviewed data-story initial run requires a canonical Program Brief");
  if (identity["programRoute"] === undefined || identity["showProfile"] === undefined) {
    throw new Error("reviewed data-story initial run requires sealed Program Route and Show Profile receipts");
  }
  const route = assertChannelProgramRouteBinding({
    route: identity["programRoute"],
    programBrief,
  });
  assertChannelProgramRoutePipelineCompatibility({ route, programBrief, pipeline: entries });
  const showProfile = assertChannelShowProfileReceiptPipelineCompatibility({
    profile: identity["showProfile"],
    programBrief,
    pipeline: entries,
  });
  if (!showProfile.programRoute || showProfile.programRoute.fingerprint !== route.fingerprint) {
    throw new Error("reviewed data-story Show Profile does not match its sealed Program Route");
  }
  const lane = resolveContentLane({
    stored: args.contentLane,
    family: args.family,
    pipeline: entries,
  });
  if (lane.key !== route.contentLaneKey) {
    throw new Error("reviewed data-story Program Route does not match its content lane");
  }
  assertInitialReviewMaterialization(entries);
  const routeSeed = channelProgramRouteRunSeed({ route, programBrief });
  const showProfileFingerprint = channelShowProfileReceiptFingerprint(showProfile);
  const selectedCapabilityKeys = [...showProfile.selectedCapabilityKeys].sort();
  if (!requiresReviewedEvidencePackForSourceDataStory({
    route: routeSeed,
    showProfileFingerprint,
    selectedCapabilityKeys,
  })) {
    throw new Error("sealed channel route does not admit a supervised source-data-story evidence pack");
  }
  return Object.freeze({
    route,
    showProfile,
    routeSeed,
    showProfileFingerprint,
    selectedCapabilityKeys,
    pipeline: entries,
    pipelineFingerprint: sha256Hex(canonicalJson(entries)),
  });
}

/**
 * Re-derives every mutable channel binding from persisted records and admits
 * exactly one owner-owned reviewed ledger. The returned receipt intentionally
 * contains identifiers and fingerprints only: it never serializes facts into
 * an API, queue, or Trigger payload.
 */
export function admitReviewedDataStoryInitialRun(args: {
  readonly ownerId: unknown;
  readonly channelId: unknown;
  readonly identity: unknown;
  readonly contentLane: unknown;
  readonly family: unknown;
  readonly pipeline: unknown;
  readonly selector: unknown;
  readonly record: ReviewedEvidencePackStoredRecord;
  readonly now?: number;
}): AdmittedReviewedDataStoryInitialRun {
  const ownerId = identifier(args.ownerId, "reviewed data-story owner id");
  const channelId = identifier(args.channelId, "reviewed data-story channel id");
  const binding = reviewedDataStoryInitialRunChannelBinding(args);
  const admitted = admitReviewedEvidencePackForSourceDataStoryRun({
    selector: args.selector,
    record: args.record,
    ownerId,
    binding: {
      route: binding.routeSeed,
      showProfileFingerprint: binding.showProfileFingerprint,
      selectedCapabilityKeys: binding.selectedCapabilityKeys,
    },
    now: args.now,
  });
  const admissionBase = {
    version: REVIEWED_DATA_STORY_INITIAL_RUN_ADMISSION_VERSION,
    ownerId,
    channelId,
    selector: admitted.selector,
    // The pack binds the full RunSeed (including the Program Brief), rather
    // than only the Program Route's own fingerprint.
    routeSeedFingerprint: admitted.pack.routeSeedFingerprint,
    showProfileFingerprint: binding.showProfileFingerprint,
    pipelineFingerprint: binding.pipelineFingerprint,
    topicFingerprint: admitted.pack.topicFingerprint,
    selectedCapabilityKeys: binding.selectedCapabilityKeys,
  } as const;
  return Object.freeze({
    selector: admitted.selector,
    admission: Object.freeze({
      ...admissionBase,
      admissionFingerprint: reviewedDataStoryInitialRunAdmissionFingerprint(admissionBase),
    }),
  });
}

/** Only opaque identifiers from the durable receipt may cross the queue. */
export function reviewedDataStoryInitialDispatchEnvelope(
  admission: ReviewedDataStoryInitialRunAdmission,
): {
  readonly selector: { readonly packId: string; readonly contentFingerprint: string };
  readonly admissionFingerprint: string;
} {
  if (admission.version !== REVIEWED_DATA_STORY_INITIAL_RUN_ADMISSION_VERSION) {
    throw new Error("reviewed data-story initial admission version is unsupported");
  }
  return Object.freeze({
    selector: {
      packId: identifier(admission.selector.packId, "reviewed data-story pack id"),
      contentFingerprint: fingerprint(
        admission.selector.contentFingerprint,
        "reviewed data-story pack content fingerprint",
      ),
    },
    admissionFingerprint: fingerprint(
      admission.admissionFingerprint,
      "reviewed data-story admission fingerprint",
    ),
  });
}
