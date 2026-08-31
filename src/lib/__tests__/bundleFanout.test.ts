import assert from "node:assert/strict";

import {
  BUNDLE_FANOUT_DISPATCH_MAX_LIFETIME_MS,
  BUNDLE_FANOUT_MAX_DISPATCH_ATTEMPTS,
  bundleFanoutDispatchIsTerminal,
  bundleFanoutDispatchKey,
  bundleFanoutDispatchRetryDelayMs,
  bundleFanoutDispatchSchedule,
  bundleFanoutEnvelope,
  bundleFanoutNextDispatchAt,
  parseBundleFanoutEnvelope,
} from "@/lib/bundleFanout";

function envelope() {
  return bundleFanoutEnvelope({
    ownerId: "owner_a",
    baseRunId: "run_base",
    baseChannelId: "channel_base",
    siblingChannelId: "channel_es",
    reuse: {
      language: "es",
      topic: "A durable handoff",
      script: {
        sections: [{ narration: "One" }, { narration: "Two" }],
        hook: "A hook",
      },
      footageKeys: ["owner/a/bundle/run_base/clip_0.mp4", "owner/a/bundle/run_base/clip_1.mp4"],
      musicKey: "owner/a/bundle/run_base/music.mp3",
    },
  });
}

function main(): void {
  const first = envelope();
  const reordered = bundleFanoutEnvelope({
    ownerId: "owner_a",
    baseRunId: "run_base",
    baseChannelId: "channel_base",
    siblingChannelId: "channel_es",
    reuse: {
      footageKeys: ["owner/a/bundle/run_base/clip_0.mp4", "owner/a/bundle/run_base/clip_1.mp4"],
      script: {
        hook: "A hook",
        sections: [{ narration: "One" }, { narration: "Two" }],
      },
      musicKey: "owner/a/bundle/run_base/music.mp3",
      topic: "A durable handoff",
      language: "es",
    },
  });
  assert.equal(
    first.dispatchKey,
    "bundle_fanout/v1:run_base:channel_es",
    "a replay has one stable base-run/sibling identity",
  );
  assert.equal(first.dispatchKey, bundleFanoutDispatchKey("run_base", "channel_es"));
  assert.equal(
    first.dispatchEnvelopeFingerprint,
    reordered.dispatchEnvelopeFingerprint,
    "canonical JSON makes property order irrelevant to the immutable receipt",
  );

  const parsed = parseBundleFanoutEnvelope(first);
  const schedule = bundleFanoutDispatchSchedule({ runId: "run_child", envelope: first });
  const replaySchedule = bundleFanoutDispatchSchedule({ runId: "run_child", envelope: parsed });
  assert.equal(schedule.idempotencySeed, first.dispatchKey);
  assert.equal(replaySchedule.idempotencySeed, schedule.idempotencySeed);
  assert.deepEqual(replaySchedule.payload, schedule.payload);
  assert.equal(schedule.payload.channelId, "channel_es");
  assert.deepEqual(schedule.payload.reuse.footageKeys, first.reuse.footageKeys);

  assert.throws(
    () => parseBundleFanoutEnvelope({
      ...first,
      reuse: { ...first.reuse, footageKeys: ["owner/a/bundle/run_base/changed.mp4"] },
    }),
    /fingerprint is invalid or payload changed/,
    "a changed replay payload cannot silently mint or dispatch a different child contract",
  );
  assert.throws(
    () => parseBundleFanoutEnvelope({ ...first, dispatchKey: "bundle_fanout/v1:other:channel_es" }),
    /dispatch key is not bound/,
    "the stored key is bound to the exact parent run and sibling",
  );

  let elapsed = 0;
  for (let attempt = 1; attempt <= BUNDLE_FANOUT_MAX_DISPATCH_ATTEMPTS; attempt++) {
    const delay = bundleFanoutDispatchRetryDelayMs(attempt);
    assert(delay > 0, "every admitted retry has a positive delay");
    elapsed += delay;
    assert.equal(bundleFanoutDispatchIsTerminal(attempt), attempt === BUNDLE_FANOUT_MAX_DISPATCH_ATTEMPTS);
  }
  assert(elapsed < BUNDLE_FANOUT_DISPATCH_MAX_LIFETIME_MS, "retry backoff fits inside the bounded receipt window");
  assert.equal(bundleFanoutNextDispatchAt(1_000, 1), 16_000);
  assert.throws(
    () => bundleFanoutDispatchRetryDelayMs(BUNDLE_FANOUT_MAX_DISPATCH_ATTEMPTS + 1),
    /invalid or exhausted/,
    "an exhausted receipt cannot create an unbounded retry loop",
  );

  console.log("bundle fanout receipt tests passed");
}

main();
