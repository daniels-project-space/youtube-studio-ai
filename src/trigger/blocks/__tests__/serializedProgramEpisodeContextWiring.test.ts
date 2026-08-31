import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createChannelProgramBrief,
  SERIALIZED_PROGRAM_VERSION,
} from "@/engine/channelProgramBrief";
import {
  channelProgramRouteRunSeed,
  channelProgramRouteRunSeedFingerprint,
  resolveChannelProgramRoute,
} from "@/engine/channelProgramRoute";
import { planStorySpine } from "@/engine/storySpine";
import type { StageContext } from "@/engine/types";
import { createSerializedProgramEpisodeContext } from "@/lib/serializedProgramEpisodeContext";
import {
  serializedProgramEpisodeIdentity,
  serializedProgramEpisodeMemoryKey,
} from "@/lib/serializedProgramEpisode";
import { serializedProgramEpisodeContextBlocks } from "../serializedProgramEpisodeContextBlocks";
import { serializedProgramEpisodeContextForStage } from "../../serializedProgramEpisodeContext";

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

function stageContext(input: {
  readonly runId: string;
  readonly store: Record<string, unknown>;
}): StageContext {
  return {
    ownerId: "owner-serialized-context-wiring-test",
    runId: input.runId,
    channelId: "channel-serialized-context-wiring-test",
    keyPrefix: "owner/test/channel/serialized-context/",
    params: {},
    store: input.store,
    budgetUsd: 0,
    log: () => {},
  };
}

const serializedBrief = createChannelProgramBrief({
  family: "narrated_stock",
  nicheKey: "educational",
  locale: "en",
  concept: "A serial program that preserves a bounded immutable continuity receipt.",
  serializedProgram: {
    version: SERIALIZED_PROGRAM_VERSION,
    seriesTitle: "Seven Days of Better Questions",
    seriesCount: 7,
  },
});
const serializedRoute = resolveChannelProgramRoute(serializedBrief);
const serializedSeed = channelProgramRouteRunSeed({
  route: serializedRoute,
  programBrief: serializedBrief,
});
const identity = serializedProgramEpisodeIdentity(serializedSeed);
if (!identity) throw new Error("serialized wiring test needs a serial identity");
const runId = "run-serialized-context-wiring-test";
const topic = "Seven Days of Better Questions — Part 1 of 7: Start with the real question";
const topicMemoryKey = serializedProgramEpisodeMemoryKey({ identity, episodeNumber: 1, topic });
const receipt = createSerializedProgramEpisodeContext({
  routeFingerprint: serializedSeed.routeFingerprint,
  routeRunSeedFingerprint: channelProgramRouteRunSeedFingerprint(serializedSeed),
  runId,
  seriesIdentity: identity.value,
  seriesTitle: identity.seriesTitle,
  ...(identity.seriesCount === undefined ? {} : { seriesCount: identity.seriesCount }),
  episodeNumber: 1,
  topic,
  topicMemoryKey,
  continuity: {
    arcSummary: "Episode one establishes a question worth carrying forward.",
    plotBeats: [{ episode: 1, beat: "The host reframes the first assumption." }],
    unresolvedThreads: ["Which assumption should the next episode test?"],
    entities: [{ name: "The host", role: "Guide for the question sequence" }],
  },
});

const bridge = serializedProgramEpisodeContextBlocks.find(
  (block) => block.id === "serialized_program_episode_context",
);
assert.ok(bridge, "the route-owned receipt bridge must be registered");
assert.deepEqual(bridge.consumes, ["topic"]);
assert.deepEqual(bridge.produces, ["serializedProgramEpisodeContext"]);
assert.equal(bridge.paid, undefined, "the bridge itself has no provider or render cost");

assert.deepEqual(
  serializedProgramEpisodeContextForStage(stageContext({
    runId,
    store: {
      channelProgramRoute: serializedSeed,
      topic,
      serializedProgramEpisodeContext: receipt,
    },
  }), "script_gen"),
  receipt,
  "a consumer receives only the completed row's exact route/run/topic-bound receipt",
);

const serialStorySpine = planStorySpine({
  topic,
  narrationDurationSec: 6,
  sentenceTimings: [{ text: "The first question opens the series.", start: 0, end: 6 }],
  serializedEpisodeContinuity: {
    episodeNumber: receipt.episodeNumber,
    seriesTitle: receipt.seriesTitle,
    ...(receipt.continuity.arcSummary ? { arcSummary: receipt.continuity.arcSummary } : {}),
    unresolvedThreads: receipt.continuity.unresolvedThreads,
    entities: receipt.continuity.entities,
  },
});
assert.match(
  serialStorySpine.continuityLedger.negativeConstraints.join(" "),
  /Sealed arc context: Episode one establishes a question worth carrying forward\./,
  "the local story planner uses the receipt's bounded arc rather than fetching live series state",
);
assert.match(
  serialStorySpine.continuityLedger.negativeConstraints.join(" "),
  /open threads are already resolved/,
  "the local story planner preserves bounded unresolved-thread continuity",
);
assert.ok(
  serialStorySpine.continuityLedger.entities.some((entity) => entity.name === "The host"),
  "named serial entities enter the local continuity ledger without inventing physical appearance",
);

assert.throws(
  () => serializedProgramEpisodeContextForStage(stageContext({
    runId: "run-serialized-context-other-retry",
    store: {
      channelProgramRoute: serializedSeed,
      topic,
      serializedProgramEpisodeContext: receipt,
    },
  }), "qa_script"),
  /not bound to the frozen route and run/,
  "a retry cannot consume a receipt from another run",
);
assert.throws(
  () => serializedProgramEpisodeContextForStage(stageContext({
    runId,
    store: {
      channelProgramRoute: serializedSeed,
      topic: "Seven Days of Better Questions — Part 1 of 7: A changed topic",
      serializedProgramEpisodeContext: receipt,
    },
  }), "thumbnail_gen"),
  /topic does not match the active pipeline topic/,
  "a later packaging stage cannot cross-bind a serial receipt to a different topic",
);

const legacyBrief = createChannelProgramBrief({
  family: "narrated_stock",
  nicheKey: "educational",
  locale: "en",
  concept: "A legacy non-serialized narrated program.",
});
const legacySeed = channelProgramRouteRunSeed({
  route: resolveChannelProgramRoute(legacyBrief),
  programBrief: legacyBrief,
});
assert.equal(
  serializedProgramEpisodeContextForStage(stageContext({
    runId,
    store: { channelProgramRoute: legacySeed, topic: "A legacy topic" },
  }), "script_gen"),
  undefined,
  "legacy non-serialized runs keep their existing behavior without a serial receipt",
);
assert.equal(
  serializedProgramEpisodeContextForStage(stageContext({
    runId,
    store: { channelProgramRoute: serializedSeed, topic },
  }), "script_gen"),
  undefined,
  "historical serialized stage snapshots without the new optional artifact do not query mutable series state",
);
assert.throws(
  () => serializedProgramEpisodeContextForStage(stageContext({
    runId,
    store: { channelProgramRoute: legacySeed, topic: "A legacy topic", serializedProgramEpisodeContext: receipt },
  }), "script_gen"),
  /requires a frozen serialized_program\/v1 route/,
  "a serial receipt cannot be injected into a non-serialized route",
);

const bridgeSource = source("src/trigger/blocks/serializedProgramEpisodeContextBlocks.ts");
const episodeSource = source("convex/serializedProgramEpisodes.ts");
const narratedSource = source("src/trigger/blocks/narratedBlocks.ts");
const crewSource = source("src/trigger/blocks/crewBlocks.ts");
const storySource = source("src/trigger/blocks/storySpineBlocks.ts");
const intelligenceSource = source("src/trigger/blocks/intelligenceBlocks.ts");
for (const [label, consumerSource, stage] of [
  ["crew", crewSource, "crew"],
  ["script", narratedSource, "script_gen"],
  ["script QA", narratedSource, "qa_script"],
  ["story spine", storySource, "story_spine"],
  ["metadata", intelligenceSource, "metadata"],
  ["thumbnail", intelligenceSource, "thumbnail_gen"],
  ["final QA", narratedSource, "qa_visual"],
] as const) {
  assert.match(
    consumerSource,
    new RegExp(`serializedProgramEpisodeContextForStage\\(ctx, "${stage}"\\)`),
    `${label} must consume the shared bounded receipt through the route/run/topic validator`,
  );
}
assert.match(
  narratedSource,
  /serializedVisualReviewContext[\s\S]{0,900}channelWorld/,
  "final QA threads a minimal immutable serial projection into its existing reviewer intent without a new provider call",
);
assert.doesNotMatch(
  bridgeSource,
  /api\.seriesStoryState|seriesStoryState\.get/,
  "the bridge reads the serial episode row, never a mutable continuity endpoint",
);
const receiptQuery = episodeSource.slice(
  episodeSource.indexOf("export const getCompletedContextForRun"),
  episodeSource.indexOf("export const release"),
);
assert.match(receiptQuery, /\.query\("serializedProgramEpisodes"/);
assert.doesNotMatch(
  receiptQuery,
  /\.query\("seriesStoryState"/,
  "later blocks cannot refresh their serial context from live series state",
);
const completion = episodeSource.slice(
  episodeSource.indexOf("export const complete"),
  episodeSource.indexOf("export const getCompletedContextForRun"),
);
assert.ok(
  completion.indexOf("mergeSeriesStoryState") < completion.indexOf("createSerializedProgramEpisodeContext") &&
    completion.indexOf("createSerializedProgramEpisodeContext") < completion.indexOf("await ctx.db.patch(row._id, {"),
  "the completed row receives the receipt derived from the same merged state transaction before it becomes visible",
);
assert.match(
  completion,
  /serializedProgramEpisodeContext,\n\s*updatedAt:/,
  "the atomic completed-row patch persists the bounded receipt alongside topic state",
);

console.log("serialized program episode context wiring tests passed");
