import assert from "node:assert/strict";

import {
  createChannelProgramBrief,
  SERIALIZED_PROGRAM_VERSION,
} from "@/engine/channelProgramBrief";
import {
  channelProgramRouteRunSeed,
  channelProgramRouteRunSeedFingerprint,
  resolveChannelProgramRoute,
} from "@/engine/channelProgramRoute";
import {
  assertSerializedProgramEpisodeContextBinding,
  createSerializedProgramEpisodeContext,
  parseSerializedProgramEpisodeContext,
  renderSerializedProgramEpisodeContextForPrompt,
  SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS,
} from "@/lib/serializedProgramEpisodeContext";
import {
  serializedProgramEpisodeIdentity,
  serializedProgramEpisodeMemoryKey,
} from "@/lib/serializedProgramEpisode";

const brief = createChannelProgramBrief({
  family: "narrated_stock",
  nicheKey: "educational",
  locale: "en",
  concept: "A repeatable serialized program with bounded continuity between episodes.",
  serializedProgram: {
    version: SERIALIZED_PROGRAM_VERSION,
    seriesTitle: "Seven Days of Better Questions",
    seriesCount: 7,
  },
});
const route = resolveChannelProgramRoute(brief);
const seed = channelProgramRouteRunSeed({ route, programBrief: brief });
const resolvedIdentity = serializedProgramEpisodeIdentity(seed);
if (!resolvedIdentity) throw new Error("serialized test route must derive an identity");
const identity: NonNullable<typeof resolvedIdentity> = resolvedIdentity;

const runId = "run-serialized-context-test";
const topic = "Seven Days of Better Questions — Part 2 of 7: The question beneath the answer";
const topicMemoryKey = serializedProgramEpisodeMemoryKey({
  identity,
  episodeNumber: 2,
  topic,
});

function bind(input: {
  readonly context: unknown;
  readonly runId?: string;
  readonly routeFingerprint?: string;
  readonly routeRunSeedFingerprint?: string;
  readonly topic?: string;
}) {
  return assertSerializedProgramEpisodeContextBinding({
    context: input.context,
    routeFingerprint: input.routeFingerprint ?? seed.routeFingerprint,
    routeRunSeedFingerprint:
      input.routeRunSeedFingerprint ?? channelProgramRouteRunSeedFingerprint(seed),
    runId: input.runId ?? runId,
    seriesIdentity: identity.value,
    seriesTitle: identity.seriesTitle,
    ...(identity.seriesCount === undefined ? {} : { seriesCount: identity.seriesCount }),
    ...(input.topic === undefined ? { topic } : { topic: input.topic }),
    topicMemoryKey,
  });
}

const context = createSerializedProgramEpisodeContext({
  routeFingerprint: seed.routeFingerprint,
  routeRunSeedFingerprint: channelProgramRouteRunSeedFingerprint(seed),
  runId,
  seriesIdentity: identity.value,
  seriesTitle: identity.seriesTitle,
  ...(identity.seriesCount === undefined ? {} : { seriesCount: identity.seriesCount }),
  episodeNumber: 2,
  topic,
  topicMemoryKey,
  continuity: {
    arcSummary: `Arc summary ${"x".repeat(SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.arcSummary + 400)}`,
    plotBeats: Array.from({ length: 14 }, (_value, index) => ({
      episode: index + 1,
      beat: `Beat ${index + 1}: ${"b".repeat(SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.plotBeat + 80)}`,
    })),
    unresolvedThreads: Array.from({ length: 18 }, (_value, index) =>
      `Open thread ${index + 1}: ${"t".repeat(SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.unresolvedThread + 60)}`,
    ),
    entities: Array.from({ length: 16 }, (_value, index) => ({
      name: `Entity ${index + 1}: ${"n".repeat(40)}`,
      role: `Role ${index + 1}: ${"r".repeat(SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.entityRole + 60)}`,
    })),
  },
});

assert.equal(Object.isFrozen(context), true, "the durable receipt is immutable at its public boundary");
assert.equal(Object.isFrozen(context.continuity), true, "the continuity projection is immutable too");
assert.equal(Object.isFrozen(context.continuity.recentPlotBeats), true);
assert.equal(Object.isFrozen(context.continuity.unresolvedThreads), true);
assert.equal(Object.isFrozen(context.continuity.entities), true);
assert.equal(
  context.continuity.recentPlotBeats.length,
  SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.plotBeats,
  "only the bounded recent beat window survives onto an episode row",
);
assert.equal(context.continuity.unresolvedThreads.length, SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.unresolvedThreads);
assert.equal(context.continuity.entities.length, SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.entities);
assert.ok(
  (context.continuity.arcSummary?.length ?? 0) <= SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.arcSummary,
  "the stored arc summary is bounded before later prompts can reuse it",
);
assert.ok(
  context.continuity.recentPlotBeats.every(
    (beat) => beat.beat.length <= SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.plotBeat,
  ),
);
assert.ok(
  context.continuity.unresolvedThreads.every(
    (thread) => thread.length <= SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.unresolvedThread,
  ),
);
assert.ok(
  context.continuity.entities.every(
    (entity) =>
      entity.name.length <= SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.entityName &&
      entity.role.length <= SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.entityRole,
  ),
);

const rendered = renderSerializedProgramEpisodeContextForPrompt(context);
assert.match(rendered, /immutable receipt/);
assert.match(rendered, /Part 2 of 7/);
assert.ok(
  rendered.length <= SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.promptChars,
  "all existing provider consumers receive the same compact bounded prompt projection",
);
assert.deepEqual(bind({ context }), context, "a receipt binds exactly to its frozen route, run, and topic");

const nestedTamper = structuredClone(context);
nestedTamper.continuity.unresolvedThreads = ["A forged continuation thread"];
assert.throws(
  () => parseSerializedProgramEpisodeContext(nestedTamper),
  /fingerprint is invalid/,
  "tampering with nested continuity invalidates the content address",
);
const topicTamper = structuredClone(context);
topicTamper.topic = "Seven Days of Better Questions — Part 2 of 7: A swapped topic";
assert.throws(
  () => parseSerializedProgramEpisodeContext(topicTamper),
  /fingerprint is invalid/,
  "a topic swap cannot retain a valid immutable receipt",
);

assert.throws(
  () => bind({ context, runId: "run-serialized-context-retry" }),
  /not bound to the frozen route and run/,
  "a retry for a different run must not reuse another run's serial receipt",
);
const alteredSeed = {
  ...seed,
  directives: { ...seed.directives, viewerJob: "A changed route directive" },
};
const alteredSeedFingerprint = channelProgramRouteRunSeedFingerprint(alteredSeed);
assert.notEqual(
  alteredSeedFingerprint,
  channelProgramRouteRunSeedFingerprint(seed),
  "a full route-seed fingerprint detects directive drift even when the route projection is unchanged",
);
assert.throws(
  () => bind({ context, routeRunSeedFingerprint: alteredSeedFingerprint }),
  /not bound to the frozen route and run/,
  "a stale retry cannot rebind a receipt to a different frozen route seed",
);
assert.throws(
  () => bind({ context, routeFingerprint: "a".repeat(64) }),
  /not bound to the frozen route and run/,
  "cross-route receipts fail closed",
);
assert.throws(
  () => bind({ context, topic: "Seven Days of Better Questions — Part 2 of 7: Cross-topic reuse" }),
  /topic does not match the active pipeline topic/,
  "the active Topic Select output is part of the receipt binding",
);
assert.throws(
  () => parseSerializedProgramEpisodeContext(undefined),
  "a missing historical receipt is never coerced into mutable serial state",
);

console.log("serialized program episode context contracts passed");
