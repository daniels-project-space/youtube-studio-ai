import { assertPackageToOpeningPlanBinding, type PackageToOpeningPlan } from "@/engine/packageToOpening";
import { canonicalJson } from "@/lib/canonicalJson";
import { pipelineInvocationSha256 as hashPipelineInvocation } from "@/lib/pipelineInvocationHash";
import {
  normalizePipelineInvocationSnapshot,
  type PipelineInvocationSnapshot,
} from "@/lib/pipelineInvocationSnapshot";
import { sha256Hex } from "@/lib/sha256";

export const THUMBNAIL_REFRESH_REPLAY_VERSION = "thumbnail-refresh-replay/v1";

type RecordValue = Record<string, unknown>;

export interface ThumbnailRefreshReplayStage {
  readonly block: string;
  readonly outputs?: unknown;
}

export interface ThumbnailRefreshReplayInput {
  readonly ownerId: string;
  readonly channelId: string;
  readonly runId: string;
  readonly pipelineInvocationSnapshot?: unknown;
  readonly pipelineInvocationSha256?: unknown;
  readonly stages: readonly ThumbnailRefreshReplayStage[];
}

export interface ThumbnailRefreshReplayMaterial {
  readonly version: typeof THUMBNAIL_REFRESH_REPLAY_VERSION;
  readonly ownerId: string;
  readonly channelId: string;
  readonly runId: string;
  readonly family: string;
  readonly contentLane: unknown;
  readonly channelProgramRoute: unknown;
  readonly styleDNA: unknown;
  readonly thumbnailPlaybook?: unknown;
  readonly topic: string;
  readonly title: string;
  readonly thumbnailDescription: string;
  readonly packageToOpeningPlan: PackageToOpeningPlan;
  readonly script?: unknown;
  readonly quizPlan?: unknown;
  /**
   * Exact declared store visible to `thumbnail_gen` in the source run. This is
   * reconstructed in frozen pipeline order from the invocation seed plus the
   * retained upstream stage outputs; a refresh must never substitute today's
   * channel identity, competitor set, or critic doctrine.
   */
  readonly store: Readonly<Record<string, unknown>>;
  readonly replayFingerprint: string;
}

export type ThumbnailRefreshReplayAssessment =
  | {
      readonly status: "ready_for_thumbnail_only";
      readonly reason: string;
      readonly material: ThumbnailRefreshReplayMaterial;
    }
  | {
      readonly status: "requires_private_successor";
      readonly reason: string;
      readonly missing: readonly string[];
    };

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

function outputFor(
  stages: readonly ThumbnailRefreshReplayStage[],
  blocks: readonly string[],
  key: string,
): unknown | undefined {
  const values = stages
    .filter((stage) => blocks.includes(stage.block))
    .map((stage) => record(stage.outputs)?.[key])
    .filter((value) => value !== undefined);
  if (values.length !== 1) return undefined;
  return values[0];
}

function replayBlockPresent(snapshot: RecordValue): boolean {
  const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
  return entries.filter((entry) => record(entry)?.block === "thumbnail_gen").length === 1;
}

// Keep this aligned with thumbnail_gen's required/optional consumes contract
// in moduleContracts.ts. Copying only these declared values avoids retaining
// unrelated scripts/media while still preventing an ambient current-channel
// read from changing historic packaging.
export const THUMBNAIL_REFRESH_STORE_KEYS = [
  "title",
  "thumbnailDescription",
  "topic",
  "packageToOpeningPlan",
  "channelName",
  "f1Url",
  "f1Key",
  "f1ThumbnailBaseProvenance",
  "loopUnitKey",
  "loopUnitResolution",
  "videoKey",
  "videoDurationSec",
  "styleGrammar",
  "styleDNA",
  "family",
  "persona",
  "thumbnailIdentity",
  "nicheIntel",
  "niche",
  "seoDatabank",
  "competitors",
  "healHints",
  "plannedThumbnailKey",
  "narrationText",
  "thumbnailPlaybook",
  "script",
  "quizPlan",
  "serializedProgramEpisodeContext",
  "channelProgramRoute",
  "syntheticScenario",
  "syntheticScenarioDisclosure",
  "scenarioVisualTreatment",
  "criticDoctrine",
  "contentLane",
] as const;

function frozenThumbnailStore(
  snapshot: RecordValue,
  seedStore: RecordValue,
  stages: readonly ThumbnailRefreshReplayStage[],
): Readonly<Record<string, unknown>> | null {
  const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
  const thumbnailIndex = entries.findIndex((entry) => record(entry)?.block === "thumbnail_gen");
  if (thumbnailIndex < 0) return null;
  const complete: Record<string, unknown> = { ...seedStore };
  for (const entry of entries.slice(0, thumbnailIndex)) {
    const block = text(record(entry)?.block);
    if (!block) return null;
    const matches = stages.filter((stage) => stage.block === block);
    if (matches.length !== 1) return null;
    const outputs = record(matches[0]?.outputs);
    if (outputs) Object.assign(complete, outputs);
  }
  const selected: Record<string, unknown> = {};
  for (const key of THUMBNAIL_REFRESH_STORE_KEYS) {
    if (complete[key] !== undefined) selected[key] = structuredClone(complete[key]);
  }
  return selected;
}

function unavailable(missing: readonly string[]): ThumbnailRefreshReplayAssessment {
  return {
    status: "requires_private_successor",
    reason: "The retained run cannot prove the exact current thumbnail brief, so regenerate it as a private successor instead of inventing a thumbnail-only replay.",
    missing,
  };
}

/**
 * Determines whether a legacy video retained the immutable inputs necessary
 * for a thumbnail-only candidate. This performs no generation and intentionally
 * refuses to blend a historic package with current channel styling.
 */
export function assessThumbnailRefreshReplay(
  input: ThumbnailRefreshReplayInput,
): ThumbnailRefreshReplayAssessment {
  const rawSnapshot = record(input.pipelineInvocationSnapshot);
  let snapshot: RecordValue | null = null;
  if (
    rawSnapshot &&
    typeof input.pipelineInvocationSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(input.pipelineInvocationSha256)
  ) {
    try {
      const normalized = normalizePipelineInvocationSnapshot(
        rawSnapshot as unknown as PipelineInvocationSnapshot,
      );
      if (hashPipelineInvocation(normalized) === input.pipelineInvocationSha256) {
        snapshot = normalized as unknown as RecordValue;
      }
    } catch {
      // A malformed or hash-mismatched invocation is not replay authority.
    }
  }
  const seedStore = record(snapshot?.seedStore);
  const metadata = record(outputFor(input.stages, ["metadata", "quiz_metadata"], "title") === undefined
    ? undefined
    : {
        title: outputFor(input.stages, ["metadata", "quiz_metadata"], "title"),
        thumbnailDescription: outputFor(input.stages, ["metadata", "quiz_metadata"], "thumbnailDescription"),
      });
  const topic = text(outputFor(input.stages, ["topic_select", "quiz_topic_plan"], "topic"));
  const packageToOpeningPlan = outputFor(input.stages, ["package_to_opening_plan"], "packageToOpeningPlan");
  const script = outputFor(input.stages, ["script_gen"], "script");
  const quizPlan = outputFor(input.stages, ["quiz_topic_plan"], "quizPlan");
  const title = text(metadata?.title);
  const thumbnailDescription = text(metadata?.thumbnailDescription);
  const thumbnailStore = snapshot && seedStore
    ? frozenThumbnailStore(snapshot, seedStore, input.stages)
    : null;
  const missing = [
    !rawSnapshot ? "frozen pipeline invocation" : null,
    rawSnapshot && !snapshot ? "hash-verified frozen pipeline invocation" : null,
    snapshot && (!text(snapshot.ownerId) || snapshot.ownerId !== input.ownerId) ? "owner-bound invocation" : null,
    snapshot && (!text(snapshot.channelId) || snapshot.channelId !== input.channelId) ? "channel-bound invocation" : null,
    snapshot && (!text(snapshot.runId) || snapshot.runId !== input.runId) ? "run-bound invocation" : null,
    snapshot && !replayBlockPresent(snapshot) ? "one retained thumbnail generation stage" : null,
    !seedStore ? "frozen channel configuration" : null,
    !text(seedStore?.family) ? "frozen family" : null,
    !record(seedStore?.contentLane) ? "frozen content lane" : null,
    !record(seedStore?.channelProgramRoute) ? "frozen program route" : null,
    !record(seedStore?.styleDNA) ? "frozen Style DNA" : null,
    !topic ? "topic selection output" : null,
    !title ? "metadata title output" : null,
    !thumbnailDescription || thumbnailDescription.length < 80 ? "concrete thumbnail brief" : null,
    packageToOpeningPlan === undefined ? "package-to-opening plan" : null,
    !thumbnailStore ? "complete frozen thumbnail input store" : null,
  ].filter((value): value is string => value !== null);
  if (missing.length || !snapshot || !seedStore || !topic || !title || !thumbnailDescription || packageToOpeningPlan === undefined || !thumbnailStore) {
    return unavailable(missing);
  }

  let plan: PackageToOpeningPlan;
  try {
    plan = assertPackageToOpeningPlanBinding({
      plan: packageToOpeningPlan,
      title,
      thumbnailDescription,
      topic,
      route: seedStore.channelProgramRoute,
      script,
      quizPlan,
      family: seedStore.family,
      contentLane: seedStore.contentLane,
    });
  } catch {
    return unavailable(["package-to-opening binding that matches retained run inputs"]);
  }

  const materialWithoutFingerprint = {
    version: THUMBNAIL_REFRESH_REPLAY_VERSION,
    ownerId: input.ownerId,
    channelId: input.channelId,
    runId: input.runId,
    family: text(seedStore.family)!,
    contentLane: seedStore.contentLane,
    channelProgramRoute: seedStore.channelProgramRoute,
    styleDNA: seedStore.styleDNA,
    ...(seedStore.thumbnailPlaybook === undefined ? {} : { thumbnailPlaybook: seedStore.thumbnailPlaybook }),
    topic,
    title,
    thumbnailDescription,
    packageToOpeningPlan: plan,
    ...(script === undefined ? {} : { script }),
    ...(quizPlan === undefined ? {} : { quizPlan }),
    store: thumbnailStore,
  } as const;
  return {
    status: "ready_for_thumbnail_only",
    reason: "The frozen package, route, style, and opening binding are retained. A future candidate may replay this exact brief without rebuilding the video.",
    material: {
      ...materialWithoutFingerprint,
      replayFingerprint: sha256Hex(canonicalJson(materialWithoutFingerprint)),
    },
  };
}
