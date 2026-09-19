import assert from "node:assert/strict";

import {
  buildChannelProfile,
  moduleParams,
  parseFrozenChannelProfile,
  usesModule,
} from "@/engine/channelProfile";

const profile = buildChannelProfile({
  row: {
    _id: "channel-profile-test",
    name: "Frozen profile test",
    slug: "frozen-profile-test",
    status: "active",
    template: "narrated_stock",
    budget: 12,
    identity: { niche: "history", persona: "measured narrator" },
  },
  archetype: "narrated_stock",
  pipeline: [
    { block: "editor_brief", params: { cadence: "steady", targetSeconds: 480 } },
    { block: "critic_spec", params: { strictness: "balanced" } },
  ],
  moduleOverrides: {
    editor_brief: { cadence: "tight" },
    "show-bible": { preset: "documentary", criticStrictness: "strict" },
  },
});

const restored = parseFrozenChannelProfile(JSON.parse(JSON.stringify(profile)));
assert.ok(restored, "a serialized invocation profile is readable by an execution worker");
assert.equal(restored.name, "Frozen profile test");
assert.equal(usesModule(restored, "editor_brief"), true, "the exact frozen pipeline survives the invocation boundary");
assert.deepEqual(
  moduleParams(restored, "editor_brief"),
  { cadence: "tight", targetSeconds: 480 },
  "validated module overrides retain their normal precedence over effective pipeline params",
);
assert.throws(
  () => parseFrozenChannelProfile({ id: "not-a-profile" }),
  /name|slug|archetype|pipeline/i,
  "a malformed frozen profile must fail loud instead of falling back to mutable channel data",
);

console.log("FROZEN CHANNEL PROFILE PASS: invocation-safe profile, effective pipeline, overrides, malformed-profile fence");
