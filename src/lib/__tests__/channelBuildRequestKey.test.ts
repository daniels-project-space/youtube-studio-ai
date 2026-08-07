import assert from "node:assert/strict";
import {
  channelBuildIntentFingerprint,
  validateChannelBuildRequestKey,
} from "../channelBuildRequestKey";

const first = {
  nicheKey: "stoicism",
  family: "narrated_stock",
  moduleConfig: { captions: { enabled: true, size: 48 } },
};
const reordered = {
  moduleConfig: { captions: { size: 48, enabled: true } },
  family: "narrated_stock",
  nicheKey: "stoicism",
};
const fingerprint = channelBuildIntentFingerprint(first);
assert.equal(fingerprint, channelBuildIntentFingerprint(reordered));
const requestKey = `12345678-1234-1234-1234-123456789abc_${fingerprint}`;
assert.equal(validateChannelBuildRequestKey(requestKey, reordered), true);
assert.equal(validateChannelBuildRequestKey(requestKey, { ...first, nicheKey: "finance" }), false);

console.log("channel build canonical request-key tests passed");
