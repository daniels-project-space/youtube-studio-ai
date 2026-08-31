import assert from "node:assert/strict";

import { createChannelProgramBrief, SERIALIZED_PROGRAM_VERSION } from "@/engine/channelProgramBrief";
import {
  channelProgramRouteRunSeed,
  channelProgramRouteRunSeedFingerprint,
  resolveChannelProgramRoute,
} from "@/engine/channelProgramRoute";
import {
  continueReservedSerializedProgramEpisode,
  parseSerializedProgramEpisodeMemoryKey,
  serializedProgramEpisodeBusyRetryAt,
  serializedProgramEpisodeBusyRetryReceipt,
  serializedProgramEpisodeBusyRetrySchedule,
  serializedProgramEpisodeIdentity,
  serializedProgramEpisodeMemoryKey,
  type SerializedProgramEpisodeClaim,
  type SerializedProgramEpisodeClaimInput,
  type SerializedProgramEpisodeClaimOwnership,
  type SerializedProgramEpisodeCompletionInput,
  type SerializedProgramEpisodeReservationAuthority,
} from "@/lib/serializedProgramEpisode";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const brief = createChannelProgramBrief({
  family: "narrated_stock",
  nicheKey: "psychology",
  locale: "en",
  concept: "A practical recurring program that gives curious adults one useful lesson per episode.",
  serializedProgram: {
    version: SERIALIZED_PROGRAM_VERSION,
    seriesTitle: "AI",
    seriesCount: 1,
  },
});
const route = resolveChannelProgramRoute(brief);
const seed = channelProgramRouteRunSeed({ route, programBrief: brief });
const resolvedIdentity = serializedProgramEpisodeIdentity(seed);
if (!resolvedIdentity) throw new Error("a sealed serialized route must derive an episode identity");
const identity: NonNullable<typeof resolvedIdentity> = resolvedIdentity;

type Row = {
  input: SerializedProgramEpisodeClaimInput;
  claimToken: string;
  episodeNumber: number;
  status: "claimed" | "completed";
  topic?: string;
  topicMemoryKey?: string;
};

/**
 * Mirrors the production Convex mutation boundary: one live claim blocks all
 * contenders, completed same-run claims replay, and failed work releases its
 * episode rather than incrementing a title-derived counter.
 */
class InMemorySerializedEpisodeAuthority implements SerializedProgramEpisodeReservationAuthority {
  private rows: Row[] = [];
  private readonly firstClaim = deferred();
  private mintCounter = 0;

  async claim(input: SerializedProgramEpisodeClaimInput): Promise<SerializedProgramEpisodeClaim> {
    const replay = this.rows.find((row) =>
      row.input.seriesIdentity.value === input.seriesIdentity.value &&
      row.input.runId === input.runId &&
      row.status === "completed" && row.topic,
    );
    if (replay?.topic) {
      return { kind: "completed", episodeNumber: replay.episodeNumber, topic: replay.topic };
    }
    const active = this.rows.find((row) =>
      row.input.seriesIdentity.value === input.seriesIdentity.value && row.status === "claimed",
    );
    if (active) return { kind: "busy", retryAfterMs: 1 };
    const completed = new Set(
      this.rows
        .filter((row) => row.input.seriesIdentity.value === input.seriesIdentity.value && row.status === "completed")
        .map((row) => row.episodeNumber),
    );
    let episodeNumber = 1;
    while (completed.has(episodeNumber)) episodeNumber += 1;
    if (input.seriesIdentity.seriesCount && episodeNumber > input.seriesIdentity.seriesCount) {
      return { kind: "exhausted" };
    }
    // A release removes its row, so rows.length is not a fencing source.  This
    // monotonically increasing mint proves a same-run reacquisition gets a
    // distinct token.
    const claimToken = `minted:${input.runId}:${episodeNumber}:${++this.mintCounter}`;
    this.rows.push({ input, claimToken, episodeNumber, status: "claimed" });
    this.firstClaim.resolve();
    return { kind: "acquired", episodeNumber, leaseExpiresAt: 9_999_999, claimToken };
  }

  async complete(input: SerializedProgramEpisodeCompletionInput): Promise<{ episodeNumber: number; topic: string }> {
    const row = this.rows.find((candidate) =>
      candidate.input.seriesIdentity.value === input.seriesIdentity.value &&
      candidate.episodeNumber === input.episodeNumber,
    );
    assert.ok(row, "only an acquired episode can complete");
    assert.equal(row.claimToken, input.claimToken);
    if (row.status === "completed") {
      assert.equal(row.topic, input.topic);
      assert.equal(row.topicMemoryKey, input.topicMemoryKey);
      return { episodeNumber: row.episodeNumber, topic: row.topic! };
    }
    row.status = "completed";
    row.topic = input.topic;
    row.topicMemoryKey = input.topicMemoryKey;
    return { episodeNumber: row.episodeNumber, topic: row.topic };
  }

  async release(input: SerializedProgramEpisodeClaimOwnership): Promise<boolean> {
    const index = this.rows.findIndex((row) =>
      row.status === "claimed" &&
      row.input.seriesIdentity.value === input.seriesIdentity.value &&
      row.input.runId === input.runId &&
      row.claimToken === input.claimToken,
    );
    if (index < 0) return false;
    this.rows.splice(index, 1);
    return true;
  }

  async waitForFirstClaim(): Promise<void> {
    await this.firstClaim.promise;
  }
}

function claim(runId: string): SerializedProgramEpisodeClaimInput {
  return {
    ownerId: "owner-serialized-episode-test",
    channelId: "channel-serialized-episode-test",
    seriesIdentity: identity,
    routeRunSeedFingerprint: channelProgramRouteRunSeedFingerprint(seed),
    runId,
  };
}

function generated(episodeNumber: number) {
  const topic = `AI — Part ${episodeNumber} of 1: A useful question`;
  return {
    topic,
    topicMemoryKey: serializedProgramEpisodeMemoryKey({ identity, episodeNumber, topic }),
    storyState: {
      arcSummary: `AI arc through episode ${episodeNumber}.`,
      newPlotBeat: `Episode ${episodeNumber} advances the AI arc.`,
      unresolvedThreads: ["What question comes next?"],
      newEntities: [],
    },
    value: { providerCalled: true },
  };
}

async function concurrentClaimHasNoSecondProviderCall(): Promise<void> {
  const authority = new InMemorySerializedEpisodeAuthority();
  const releaseFirst = deferred();
  let firstProviderCalls = 0;
  let secondProviderCalls = 0;
  const first = continueReservedSerializedProgramEpisode({
    authority,
    claim: claim("run-first"),
    generate: async (episodeNumber) => {
      firstProviderCalls += 1;
      await releaseFirst.promise;
      return generated(episodeNumber);
    },
  });
  await authority.waitForFirstClaim();
  const second = await continueReservedSerializedProgramEpisode({
    authority,
    claim: claim("run-second"),
    generate: async (episodeNumber) => {
      secondProviderCalls += 1;
      return generated(episodeNumber);
    },
  });
  assert.deepEqual(second, { kind: "busy", retryAfterMs: 1 });
  assert.equal(secondProviderCalls, 0, "a live atomic claim must stop a second continuation provider call");
  releaseFirst.resolve();
  const completed = await first;
  assert.equal(completed.kind, "generated");
  assert.equal(firstProviderCalls, 1);

  let replayProviderCalls = 0;
  const replay = await continueReservedSerializedProgramEpisode({
    authority,
    claim: claim("run-first"),
    generate: async (episodeNumber) => {
      replayProviderCalls += 1;
      return generated(episodeNumber);
    },
  });
  assert.deepEqual(
    replay,
    { kind: "completed", episodeNumber: 1, topic: "AI — Part 1 of 1: A useful question" },
    "a retry of a completed episode must replay its durable topic rather than call a provider again",
  );
  assert.equal(replayProviderCalls, 0);
}

async function failedContinuationReleasesItsEpisode(): Promise<void> {
  const authority = new InMemorySerializedEpisodeAuthority();
  await assert.rejects(
    continueReservedSerializedProgramEpisode({
      authority,
      claim: claim("run-failed"),
      generate: async () => {
        throw new Error("provider returned malformed serialized continuation");
      },
    }),
    /malformed serialized continuation/,
  );
  let retryProviderCalls = 0;
  const retry = await continueReservedSerializedProgramEpisode({
    authority,
    claim: claim("run-retry"),
    generate: async (episodeNumber) => {
      retryProviderCalls += 1;
      return generated(episodeNumber);
    },
  });
  assert.equal(retry.kind, "generated", "a failed continuation must not permanently burn its episode number");
  assert.equal(retryProviderCalls, 1);
}

async function staleOwnershipCannotCompleteOrReleaseAReacquiredEpisode(): Promise<void> {
  const authority = new InMemorySerializedEpisodeAuthority();
  const input = claim("run-fenced");
  const stale = await authority.claim(input);
  assert.equal(stale.kind, "acquired");
  if (stale.kind !== "acquired") return;
  await authority.release({ ...input, claimToken: stale.claimToken });
  const current = await authority.claim(input);
  assert.equal(current.kind, "acquired");
  if (current.kind !== "acquired") return;
  assert.notEqual(current.claimToken, stale.claimToken, "each acquisition must mint a fencing token even for the same run");
  const staleTopic = generated(stale.episodeNumber);
  await assert.rejects(
    authority.complete({
      ...input,
      claimToken: stale.claimToken,
      episodeNumber: stale.episodeNumber,
      topic: staleTopic.topic,
      topicMemoryKey: staleTopic.topicMemoryKey,
      storyState: staleTopic.storyState,
    }),
    /Expected values to be strictly equal/,
    "timed-out work must not complete a newer acquisition with its stale token",
  );
  assert.equal(
    await authority.release({ ...input, claimToken: stale.claimToken }),
    false,
    "timed-out work must not release the newer acquisition either",
  );
  const currentTopic = generated(current.episodeNumber);
  await assert.doesNotReject(() => authority.complete({
    ...input,
    claimToken: current.claimToken,
    episodeNumber: current.episodeNumber,
    topic: currentTopic.topic,
    topicMemoryKey: currentTopic.topicMemoryKey,
    storyState: currentTopic.storyState,
  }));
  await assert.doesNotReject(
    () => authority.complete({
      ...input,
      claimToken: current.claimToken,
      episodeNumber: current.episodeNumber,
      topic: currentTopic.topic,
      topicMemoryKey: currentTopic.topicMemoryKey,
      storyState: currentTopic.storyState,
    }),
    "a same-token network-loss replay may return the completed receipt",
  );
  await assert.rejects(
    authority.complete({
      ...input,
      claimToken: stale.claimToken,
      episodeNumber: current.episodeNumber,
      topic: currentTopic.topic,
      topicMemoryKey: currentTopic.topicMemoryKey,
      storyState: currentTopic.storyState,
    }),
    /Expected values to be strictly equal/,
    "a stale token must not receive an idempotent completed response after a newer worker completes",
  );
}

async function exactNamespaceAvoidsTitleCollisionsAndExhaustsBeforeGeneration(): Promise<void> {
  const ownKey = serializedProgramEpisodeMemoryKey({
    identity,
    episodeNumber: 1,
    topic: "AI — Part 1 of 1: A useful question",
  });
  const parsed = parseSerializedProgramEpisodeMemoryKey(ownKey);
  assert.equal(parsed?.identity.value, identity.value);
  assert.equal(parsed?.episodeNumber, 1);
  assert.equal(
    parseSerializedProgramEpisodeMemoryKey("A historical AI topic that only shares a short human title"),
    undefined,
    "legacy human topic text must never be counted as a serialized episode",
  );
  const resolvedOtherIdentity = serializedProgramEpisodeIdentity({
    routeFingerprint: "b".repeat(64),
    serializedProgram: { version: SERIALIZED_PROGRAM_VERSION, seriesTitle: "AI", seriesCount: 1 },
  });
  if (!resolvedOtherIdentity) throw new Error("a second sealed serialized route must derive an episode identity");
  const otherIdentity: NonNullable<typeof resolvedOtherIdentity> = resolvedOtherIdentity;
  assert.notEqual(otherIdentity.value, identity.value, "overlapping titles require the same sealed route receipt to share a namespace");

  const authority = new InMemorySerializedEpisodeAuthority();
  await continueReservedSerializedProgramEpisode({
    authority,
    claim: claim("run-complete"),
    generate: async (episodeNumber) => generated(episodeNumber),
  });
  let exhaustionProviderCalls = 0;
  const exhausted = await continueReservedSerializedProgramEpisode({
    authority,
    claim: claim("run-after-count"),
    generate: async (episodeNumber) => {
      exhaustionProviderCalls += 1;
      return generated(episodeNumber);
    },
  });
  assert.deepEqual(exhausted, { kind: "exhausted" });
  assert.equal(exhaustionProviderCalls, 0, "a completed count=1 series must exhaust before another continuation provider call");
}

function busyRequeueIsBoundedAndIdempotent(): void {
  const retryAt = serializedProgramEpisodeBusyRetryAt(1_000_000, 300_250);
  assert.equal(retryAt, 1_300_250, "the durable task must wait through the live serial lease rather than poll it");
  const first = serializedProgramEpisodeBusyRetrySchedule({
    payload: { channelId: "channel-serialized-episode-test", runId: "run-busy" },
    channelId: "channel-serialized-episode-test",
    runId: "run-busy",
    retryAt,
    attempt: 1,
  });
  const recoveredAfterLostEnqueue = serializedProgramEpisodeBusyRetrySchedule({
    payload: { channelId: "channel-serialized-episode-test", runId: "run-busy" },
    channelId: "channel-serialized-episode-test",
    runId: "run-busy",
    retryAt,
    attempt: 1,
  });
  assert.equal(
    recoveredAfterLostEnqueue.idempotencySeed,
    first.idempotencySeed,
    "a lost enqueue response reuses the same durable attempt receipt rather than scheduling a second replay",
  );
  assert.equal(first.concurrencyKey, "channel-serialized-episode-test");
  const nextAttempt = serializedProgramEpisodeBusyRetrySchedule({
    payload: { channelId: "channel-serialized-episode-test", runId: "run-busy" },
    channelId: "channel-serialized-episode-test",
    runId: "run-busy",
    retryAt: retryAt + 1,
    attempt: 2,
  });
  assert.notEqual(
    nextAttempt.idempotencySeed,
    first.idempotencySeed,
    "only a later durable contention receipt may schedule a new attempt",
  );
  assert.throws(
    () => serializedProgramEpisodeBusyRetrySchedule({
      payload: { channelId: "channel-serialized-episode-test", runId: "run-busy" },
      channelId: "channel-serialized-episode-test",
      runId: "run-busy",
      retryAt,
      attempt: 4,
    }),
    /invalid or exhausted/,
    "a persistent live claim cannot create unbounded delayed task churn",
  );
  assert.deepEqual(
    serializedProgramEpisodeBusyRetryReceipt({ attempt: 1 }),
    { kind: "none" },
    "after claimExecutionLease clears retryAt, a duplicate delayed task must resume rather than treat retained audit attempts as a malformed receipt",
  );
  assert.throws(
    () => serializedProgramEpisodeBusyRetryReceipt({ retryAt, attempt: undefined }),
    /receipt is malformed/,
    "a genuinely active retry receipt still requires its bounded attempt",
  );
}

async function main(): Promise<void> {
  await concurrentClaimHasNoSecondProviderCall();
  await failedContinuationReleasesItsEpisode();
  await staleOwnershipCannotCompleteOrReleaseAReacquiredEpisode();
  await exactNamespaceAvoidsTitleCollisionsAndExhaustsBeforeGeneration();
  busyRequeueIsBoundedAndIdempotent();
  console.log("serialized program episode reservation tests passed");
}

void main();
