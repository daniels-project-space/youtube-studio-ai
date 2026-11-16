import assert from "node:assert/strict";
import {
  channelBuildCompletionDisposition,
  channelInceptionProbeArtifactCandidate,
  channelInceptionProbeArtifactReceipt,
  isChannelInceptionProbeArtifactReceipt,
} from "../channelInceptionProbeArtifact";

const expected = { ownerId: "owner-1", channelId: "channel-1", runId: "run-1" };
const asset = {
  _id: "asset-1",
  ownerId: expected.ownerId,
  channelId: expected.channelId,
  runId: expected.runId,
  kind: "video",
  r2Key: "youtube-studio/channels/channel-1/runs/run-1/final.mp4",
};

const candidate = channelInceptionProbeArtifactCandidate([asset], expected);
assert.deepEqual(candidate, {
  assetId: "asset-1",
  runId: "run-1",
  r2Key: asset.r2Key,
});
assert.equal(channelInceptionProbeArtifactCandidate([], expected), null);
assert.equal(channelInceptionProbeArtifactCandidate([{ ...asset, ownerId: "other" }], expected), null);
assert.equal(channelInceptionProbeArtifactCandidate([{ ...asset, channelId: "other" }], expected), null);
assert.equal(channelInceptionProbeArtifactCandidate([{ ...asset, runId: "other" }], expected), null);
assert.equal(channelInceptionProbeArtifactCandidate([{ ...asset, kind: "thumbnail" }], expected), null);
assert.equal(channelInceptionProbeArtifactCandidate([{ ...asset, r2Key: " " }], expected), null);
assert.equal(channelInceptionProbeArtifactCandidate([asset, { ...asset, _id: "asset-2" }], expected), null);
assert.deepEqual(channelInceptionProbeArtifactReceipt(candidate, { contentLength: 64 }), {
  assetId: "asset-1",
  runId: "run-1",
  byteLength: 64,
});
assert.equal(channelInceptionProbeArtifactReceipt(candidate, null), null);
assert.equal(channelInceptionProbeArtifactReceipt(candidate, { contentLength: 0 }), null);
assert.equal(channelInceptionProbeArtifactReceipt(candidate, { contentLength: Number.NaN }), null);
assert.equal(isChannelInceptionProbeArtifactReceipt({ assetId: "asset-1", runId: "run-1", byteLength: 64 }), true);
assert.equal(isChannelInceptionProbeArtifactReceipt({ assetId: " ", runId: "run-1" }), false);
assert.equal(isChannelInceptionProbeArtifactReceipt(null), false);
assert.equal(channelBuildCompletionDisposition({
  inceptionStatus: "planned",
  executionAuthorized: false,
}), "plan-saved");
assert.equal(channelBuildCompletionDisposition({
  inceptionStatus: "planned",
  executionAuthorized: true,
}), "pending");
assert.equal(channelBuildCompletionDisposition({
  inceptionStatus: "complete",
  executionAuthorized: true,
  probeArtifact: { assetId: "asset-1", runId: "run-1", byteLength: 64 },
}), "output-ready");
assert.equal(channelBuildCompletionDisposition({
  inceptionStatus: "complete",
  executionAuthorized: true,
  probeArtifact: null,
}), "output-missing");
assert.equal(channelBuildCompletionDisposition({
  inceptionStatus: "blocked",
  executionAuthorized: true,
  probeArtifact: { assetId: "asset-1", runId: "run-1", byteLength: 64 },
}), "blocked");
assert.equal(channelBuildCompletionDisposition({
  inceptionStatus: "running",
  executionAuthorized: true,
  probeArtifact: { assetId: "asset-1", runId: "run-1", byteLength: 64 },
}), "pending");

console.log("channel inception probe artifact receipt PASS: exact unique video asset and stored bytes required");
