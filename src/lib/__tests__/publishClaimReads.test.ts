import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = readFileSync(new URL("../../../convex/schema.ts", import.meta.url), "utf8");
const source = readFileSync(new URL("../../../convex/publishIntents.ts", import.meta.url), "utf8");
const claim = source.slice(source.indexOf("export const claim = mutation"), source.indexOf("export const complete = mutation"));

assert.match(
  schema,
  /\.index\("by_channel_status_lease", \["channelId", "status", "leaseExpiresAt"\]\)/,
  "publish claims need a channel/status/lease index",
);
assert.match(
  schema,
  /\.index\("by_channel_quota_status", \["channelId", "quotaDay", "status"\]\)/,
  "publish claims need a channel/day/status quota index",
);
assert.match(
  claim,
  /withIndex\("by_channel_status_lease"[\s\S]*?eq\("channelId", intent\.channelId\)[\s\S]*?eq\("status", "dispatching"\)[\s\S]*?gt\("leaseExpiresAt", args\.now\)/,
  "active dispatch admission should read only unexpired leases",
);
assert.match(
  claim,
  /withIndex\("by_channel_quota_status"[\s\S]*?eq\("channelId", intent\.channelId\)[\s\S]*?eq\("quotaDay", quotaDay\)[\s\S]*?eq\("status", "uploaded"\)/,
  "daily quota admission should read only uploaded rows for the day",
);
assert.doesNotMatch(
  claim,
  /withIndex\("by_channel_status", \(q\) =>[\s\S]*?collect\(\)/,
  "claims must not rescan every dispatching row for the channel",
);
assert.doesNotMatch(
  claim,
  /withIndex\("by_channel_quota_day", \(q\) =>[\s\S]*?collect\(\)/,
  "claims must not load non-uploaded quota history",
);
// Convex indexes omit legacy documents whose optional lease/quota fields are
// absent. This preserves the old `(leaseExpiresAt ?? 0) > now` and
// `status === uploaded` filters without a fallback owner/channel scan.
assert.match(claim, /activeDispatches = active\.filter\(\(row\) => row\._id !== intent\._id\)\.length/);
assert.match(claim, /\)\.length;\n    const repairedTiming/);

console.log("PUBLISH CLAIM READ CONTRACTS PASS");
