import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const schema = read("convex/schema.ts");
const convex = read("convex/youtubeThumbnailReplacements.ts");
const route = read("src/app/api/thumbnail-refresh/accept/route.ts");
const task = read("src/trigger/youtubeThumbnailReplacement.ts");
const panel = read("src/components/ThumbnailRefreshInventoryPanel.tsx");

assert.match(schema, /youtubeThumbnailReplacements: defineTable/);
assert.match(schema, /candidateArtifactSha256: v\.string\(\)/);
assert.match(schema, /by_owner_candidate/);
assert.match(convex, /candidate\.thumbnailRefreshSourceRunId !== source\._id/);
assert.match(convex, /assessment\.status !== "current_golden_candidate"/);
assert.match(convex, /candidateArtifactSha256: artifactSha256/);
assert.match(convex, /applicationReceiptFingerprint/);
assert.match(convex, /Retired legacy videos cannot receive replacement thumbnails/);
assert.match(route, /confirmYoutubeVideoId !== input\.youtubeVideoId/);
assert.match(route, /action: "youtube-thumbnail-replacement"/);
assert.match(route, /scope: "global"/);
assert.match(task, /candidateSha256 !== dispatch\.candidateArtifactSha256/);
assert.match(task, /video\.channelId !== dispatch\.expectedYoutubeChannelId/);
assert.match(task, /setVideoThumbnailWithAccessToken/);
assert.match(task, /completeApplication/);
assert.match(panel, />Use on YouTube</);
assert.match(panel, /Confirm video/);

console.log("YouTube thumbnail replacement wiring: PASS");
