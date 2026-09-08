import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const panel = read("src/components/ThumbnailRefreshInventoryPanel.tsx");
const route = read("src/app/api/thumbnail-refresh/route.ts");
const acceptRoute = read("src/app/api/thumbnail-refresh/accept/route.ts");
const ernieBatchRoute = read("src/app/api/thumbnail-refresh/ernie-batch/route.ts");
const ernieBatchTask = read("src/trigger/ernieThumbnailBatchApply.ts");
const library = read("src/app/(app)/library/page.tsx");

// Legacy review can now request one bounded, separate candidate. Stored media
// remains server-resolved from opaque run ids, and neither the browser nor the
// candidate endpoint receives authority to overwrite the source/YouTube image.
// Completed QA candidates enter the existing identity-bound replacement worker
// through a narrow automatic policy, without another browser confirmation.
assert.match(panel, /fetch\("\/api\/thumbnail-refresh"/);
assert.match(panel, /row\.legacyCleanupAction !== "retire"/);
assert.match(panel, /Current Golden Nano Banana Pro module snapshotted/);
assert.match(panel, /Inspect run/);
assert.match(panel, /Exact thumbnail inputs retained/);
assert.match(panel, /Nano candidate ready/);
assert.match(panel, /Open private benchmark/);
assert.match(panel, /#route-qualification-benchmark/);
assert.match(panel, /previewRunId=/);
assert.match(panel, /candidatePreviewRunId=/);
assert.match(panel, /i\.ytimg\.com/);
assert.match(panel, /method:\s*["']POST/);
assert.match(panel, /confirmCandidateSpend:\s*true/);
assert.match(panel, /Render Nano candidate/);
assert.match(panel, /Resume candidate delivery/);
assert.match(panel, /Candidate authorization interrupted/);
assert.match(panel, /become the Library image after production QA/);
assert.doesNotMatch(panel, /Use on YouTube/);
assert.doesNotMatch(panel, /confirmYoutubeVideoId/);
assert.match(panel, /sync to their exact connected YouTube video automatically/);
assert.match(panel, /canManage/);
assert.match(panel, /Current Golden Nano Banana Pro module snapshotted/);
assert.match(panel, /Render Nano candidate/);
assert.doesNotMatch(panel, /ernieBatch=reviewed/);
assert.doesNotMatch(panel, /Replace all 30 now/);
assert.match(panel, /Lo-Fi source-frame refresh/);
assert.match(panel, /Render exact video frame/);
assert.match(panel, /no generated scene/);
assert.match(panel, /retained finished videos/);
assert.match(panel, /queueLofiFrameCandidates/);
assert.match(route, /getStudioActor/);
assert.match(route, /actor\?\.ownerId \?\? process\.env\.STUDIO_OWNER_ID/);
assert.match(route, /thumbnailPresent: Boolean\(item\.thumbnailKey\)/);
assert.match(route, /presignDownload\(key/);
assert.match(route, /reviewedErnieBatchPreview/);
assert.match(route, /ERNIE_THUMBNAIL_REFRESH_BATCH_MANIFEST_KEY/);
assert.match(route, /assertPinnedErnieThumbnailRefreshBatch/);
assert.match(route, /previewRunId/);
assert.match(route, /createCandidateShell/);
assert.match(route, /issueStudioActionApproval/);
assert.match(route, /sourceChanged:\s*false/);
assert.match(route, /youtubeChanged:\s*false/);
assert.doesNotMatch(route, /thumbnailKey:\s*item\.thumbnailKey/);
assert.doesNotMatch(route, /youtube\.thumbnails|setThumbnail|videos\.update/);
assert.match(acceptRoute, /confirmYoutubeVideoId !== input\.youtubeVideoId/);
assert.match(acceptRoute, /youtubeThumbnailReplacementTriggerRequest/);
assert.match(ernieBatchRoute, /requireStudioActor/);
assert.match(ernieBatchRoute, /confirmReplaceAll/);
assert.match(ernieBatchRoute, /ernie-thumbnail-batch-apply/);
assert.match(ernieBatchTask, /assertPinnedErnieThumbnailRefreshBatch/);
assert.match(ernieBatchTask, /assertNativePng/);
assert.match(ernieBatchTask, /youtubeThumbnailReplacementTriggerRequest/);
assert.match(ernieBatchTask, /candidateArtifactSha256 !== item\.artifactSha256/);
assert.match(library, /ThumbnailRefreshInventoryPanel[\s\S]*selectedChannelSlug=\{selectedSlug\}[\s\S]*canManage=\{operationsAccess === "owner"\}/);
assert.doesNotMatch(library, /<OwnerOnlyNotice/);
assert.match(library, /id="thumbnail-refresh"[\s\S]*open/);
assert.doesNotMatch(library, /ernieBatch=reviewed/);
assert.doesNotMatch(library, /reviewedThumbnailUrl/);

console.log("Thumbnail refresh inventory UI contracts passed");
