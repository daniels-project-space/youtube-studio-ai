import { assertPackageToOpeningPlanBinding, type PackageToOpeningPlan } from "@/engine/packageToOpening";
import { canonicalJson } from "@/lib/canonicalJson";
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
  const snapshot = record(input.pipelineInvocationSnapshot);
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
  const missing = [
    !snapshot ? "frozen pipeline invocation" : null,
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
  ].filter((value): value is string => value !== null);
  if (missing.length || !snapshot || !seedStore || !topic || !title || !thumbnailDescription || packageToOpeningPlan === undefined) {
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
