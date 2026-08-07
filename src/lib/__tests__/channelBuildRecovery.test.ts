import assert from "node:assert/strict";
import {
  parsePendingChannelBuildRequest,
  reusableChannelBuildRequestKey,
  shouldRetainPendingChannelBuild,
  ChannelBuildSubmissionGate,
  type PendingChannelBuildRequest,
} from "../channelBuildRecovery";

const requestKey = `${"1".repeat(8)}-${"2".repeat(4)}-${"3".repeat(4)}-${"4".repeat(4)}-${"5".repeat(12)}_${"a".repeat(64)}`;
const pending: PendingChannelBuildRequest = {
  version: "channel-build-pending/v1",
  intent: '{"family":"narrated_stock","nicheKey":"stoicism"}',
  requestKey,
  design: { family: "narrated_stock", nicheKey: "stoicism" },
  displayName: "Quiet Stoic",
  startedAt: 1_800_000_000_000,
};

// Simulate the browser losing the POST response, reloading, then restoring the
// pre-dispatch journal. The exact request key must be replayed.
const restored = parsePendingChannelBuildRequest(JSON.stringify(pending));
assert.deepEqual(restored, pending);
assert.equal(reusableChannelBuildRequestKey(pending.intent, restored), requestKey);

// An explicit changed intent must never inherit authority/idempotency identity.
assert.equal(
  reusableChannelBuildRequestKey('{"family":"whiteboard"}', restored),
  undefined,
);
assert.equal(parsePendingChannelBuildRequest("not-json"), null);
assert.equal(
  parsePendingChannelBuildRequest(JSON.stringify({ ...pending, requestKey: "forged" })),
  null,
);
for (const status of [401, 403, 408, 425, 429, 500, 503]) {
  assert.equal(shouldRetainPendingChannelBuild(status), true, `${status} must retain the replay key`);
}
for (const status of [400, 409, 422]) {
  assert.equal(shouldRetainPendingChannelBuild(status), false, `${status} is a terminal intent rejection`);
}

const gate = new ChannelBuildSubmissionGate();
const firstAttempt = gate.begin(requestKey);
assert.ok(firstAttempt);
assert.equal(gate.begin(requestKey), null, "Strict Mode/double-click must share one request");
const otherAttempt = gate.begin(requestKey.replace(/a/g, "b"));
assert.ok(otherAttempt);
assert.equal(firstAttempt.controller.signal.aborted, true, "an explicit new intent aborts the old tab request");
gate.finish(firstAttempt);
assert.equal(gate.begin(otherAttempt.requestKey), null, "finishing a stale attempt must not release the current one");
gate.abort();
assert.equal(otherAttempt.controller.signal.aborted, true);

console.log("channel build lost-response recovery tests passed");
