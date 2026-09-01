import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const schema = read("convex/schema.ts");
const state = read("convex/youtubeVideoRetirements.ts");
const route = read("src/app/api/youtube-video-retire/route.ts");
const task = read("src/trigger/youtubeVideoRetirement.ts");
const youtube = read("src/lib/youtube.ts");
const panel = read("src/components/ThumbnailRefreshInventoryPanel.tsx");

assert.match(schema, /youtubeVideoRetirements: defineTable/);
assert.match(schema, /deletionReceiptFingerprint: v\.optional\(v\.string\(\)\)/);
assert.match(schema, /\.index\("by_owner_video", \["ownerId", "youtubeVideoId"\]\)/);

assert.match(state, /requireStudioServiceIdentity\(ctx, args\.ownerId, "YouTube video retirement plan"\)/);
assert.match(state, /assessLegacyVideoCleanup/);
assert.match(state, /run\.youtubeVideoId !== args\.youtubeVideoId/);
assert.match(state, /Reconnect the exact YouTube channel/);
assert.match(state, /providerVideoChannelId !== row\.expectedYoutubeChannelId/);
assert.match(state, /youtube-video-retirement-receipt\/v1/);

assert.match(route, /confirmPermanentDeletion !== input\.youtubeVideoId/);
assert.match(route, /action: "youtube-video-retire"/);
assert.match(route, /idempotencyKeys\.create\([\s\S]*scope: "global"/);
assert.doesNotMatch(route, /deleteVideo\(/, "browser/API route must never delete directly");

assert.match(task, /id: "youtube-video-retirement"/);
assert.match(task, /expectedConnectorId: execution\.connectorId/);
assert.match(task, /expectedConnectorVersion: execution\.connectorVersion/);
assert.match(task, /hasAnyScope\(grant\.grantedScopes, YOUTUBE_WRITE_SCOPES\)/);
assert.match(task, /before\.channelId !== dispatch\.expectedYoutubeChannelId/);
assert.match(task, /const after = await getVideoIdentity/);
assert.match(task, /if \(after\) throw new Error\("YouTube retirement could not verify provider-side absence"\)/);

assert.match(youtube, /method: "DELETE"/);
assert.match(youtube, /response\.status === 404/);
assert.match(panel, /Type <code>\{row\.youtubeVideoId\}<\/code>/);
assert.match(panel, /Permanently delete/);

console.log("YouTube video retirement wiring tests passed");
