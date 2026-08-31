import assert from "node:assert/strict";
import { assessYouTubeSetup } from "@/lib/youtubeSetupStatus";

const bare = assessYouTubeSetup({});
assert.equal(bare.destination, "needs_channel");
assert.equal(bare.oauth, "needs_channel");
assert.equal(bare.canAutoCreate, true);
assert.equal(bare.brandingSync, "waiting_for_oauth");

const creating = assessYouTubeSetup({
  created: { status: "creating" },
  generatedAvatarKey: "owners/o/channels/c/art/avatar.jpg",
});
assert.equal(creating.destination, "creating");
assert.equal(creating.oauth, "waiting_for_channel");
assert.equal(creating.canConnect, false);
assert.equal(creating.canAutoCreate, false);
assert.equal(creating.profileHandoff, "waiting_for_target");

const createdNeedsOauth = assessYouTubeSetup({
  created: { status: "created", ytChannelId: "UC-created", handle: "@a-real-channel" },
  generatedAvatarKey: "owners/o/channels/c/art/avatar.jpg",
});
assert.equal(createdNeedsOauth.destination, "created_needs_oauth");
assert.equal(createdNeedsOauth.oauth, "connect_required");
assert.equal(createdNeedsOauth.targetChannelId, "UC-created");
assert.equal(createdNeedsOauth.targetLabel, "@a-real-channel");
assert.equal(createdNeedsOauth.canAutoCreate, false, "never offer a duplicate external channel");
assert.equal(createdNeedsOauth.profileHandoff, "owner_action_required");

const partialScope = assessYouTubeSetup({
  connector: {
    status: "active",
    scopeHealth: "partial",
    ytChannelId: "UC-partial",
    ytTitle: "Partial permissions",
  },
});
assert.equal(partialScope.destination, "verified");
assert.equal(partialScope.oauth, "incomplete");
assert.equal(partialScope.brandingSync, "waiting_for_oauth");
assert.equal(partialScope.canAutoCreate, false);

const ready = assessYouTubeSetup({
  connector: {
    status: "active",
    scopeHealth: "healthy",
    ytChannelId: "UC-ready",
    ytTitle: "Ready channel",
  },
  generatedAvatarKey: "owners/o/channels/c/art/avatar.jpg",
});
assert.equal(ready.destination, "verified");
assert.equal(ready.oauth, "ready");
assert.equal(ready.brandingSync, "attempted_unverified");
assert.equal(ready.profileHandoff, "owner_action_required", "avatar completion is owner-confirmed only");

console.log("YouTube setup status contracts passed");
