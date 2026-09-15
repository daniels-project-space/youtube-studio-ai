import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const plan = readFileSync(resolve(process.cwd(), "convex/contentPlan.ts"), "utf8");
const videos = readFileSync(resolve(process.cwd(), "convex/videos.ts"), "utf8");
const channelPage = readFileSync(resolve(process.cwd(), "src/app/(app)/channels/[slug]/page.tsx"), "utf8");

assert.match(videos, /export async function currentLibraryThumbnailForRun\(/,
  "scheduled projections must reuse the shared current-thumbnail run boundary");
assert.match(videos, /const \{ currentThumbnail \} = await retainedRunMedia\(ctx, run\)/,
  "the run projection must preserve the same sealed-master and Lo-Fi rules as Library");
assert.match(plan, /function scheduledThumbnailProjector\(/,
  "content-plan reads must have a bounded scheduled-run projection helper");
assert.match(plan, /applyScheduledThumbnail\(row, await project\(row\.scheduledRunId, args\.channelId\)\)/,
  "the per-channel ready preview must replace stale scheduled artwork");
assert.match(plan, /const ownedRows = rows[\s\S]*?applyScheduledThumbnail\(row, await project\(row\.scheduledRunId, args\.channelId\)\)/,
  "the detailed per-channel plan must replace stale scheduled artwork");
assert.match(plan, /const current = await project\(r\.scheduledRunId, r\.channelId\)/,
  "the owner calendar projection must replace stale scheduled artwork");
assert.match(channelPage, /p\.thumbnailSource === "rendered_video_frame" && !p\.thumbnailKey/,
  "a resolved Lo-Fi frame must render as an image while an unresolved one stays an honest placeholder");

console.log("scheduled plan thumbnail projection contracts passed");
