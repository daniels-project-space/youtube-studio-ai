import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const preview = read("src/components/MediaPreview.tsx");
const previewCss = read("src/components/MediaPreview.module.css");
const assetImg = read("src/components/AssetImg.tsx");
const latestVideo = read("src/components/LatestVideoWidget.tsx");
const recentVideos = read("src/components/RecentVideos.tsx");
const videoCard = read("src/components/VideoCard.tsx");
const rail = read("src/components/ArtifactWorkRail.tsx");
const runWorkbench = read("src/components/RunMediaWorkbench.tsx");
const daySchedule = read("src/app/(app)/schedule/DayByDaySchedule.tsx");

// One component owns the signed URL lifecycle, visual source state and the
// accessible loading/error state; surfaces do not each invent a new fallback.
assert.match(preview, /useAssetUrlState/);
assert.match(preview, /selectMediaPreview/);
assert.match(preview, /probe=1/,
  "preview probes use a non-error availability response");
assert.match(preview, /full-object[\s\S]*probe validates the same path/,
  "video probes validate the native full-object delivery path");
assert.match(preview, /for \(let attempt = 0; attempt < 2; attempt\+\+\)/,
  "a transient video availability miss gets one bounded retry cycle");
assert.match(preview, /Range: "bytes=1048576-1048576"/,
  "video previews test a representative non-zero range before mounting stale masters");
assert.match(preview, /videoSourceReady/);
assert.match(preview, /showingPrivateImage/,
  "private image previews probe availability before mounting stale keys");
assert.match(preview, /reviewedSrc/);
assert.match(preview, /source: "reviewed"/);
assert.match(preview, /data-preview-source=/);
assert.match(preview, /data-preview-state=/);
assert.match(preview, /aria-busy=/);
assert.match(preview, /role=\{isDecorative \? undefined : "status"\}/);
assert.match(preview, /decoding="async"/);
assert.match(previewCss, /aspect-ratio: 16 \/ 9/);
assert.match(previewCss, /prefers-reduced-motion/);

for (const source of [assetImg, videoCard, rail, daySchedule]) {
  assert.match(source, /MediaPreview/);
}

// The channel hero is an owner-side artifact view. A pending Lo-Fi upload
// without its persisted 15-second frame uses a paused retained-master frame;
// every other channel stays persisted-thumbnail-only.
assert.match(latestVideo, /videoStillKey=\{v\?\.thumbnailPresentation === "lofi_frame_pending" \? v\.videoKey : undefined\}/);
assert.match(latestVideo, /allowVideoStill=\{v\?\.thumbnailPresentation === "lofi_frame_pending"\}/,
  "the latest-video hero enables the exact pending Lo-Fi frame");
assert.match(latestVideo, /video-card-lofi-quality/, "the latest-video hero preserves the Lo-Fi 4K marker");
assert.match(latestVideo, /priority\s*\/?>/);
assert.doesNotMatch(latestVideo, /i\.ytimg\.com|fallbackSource="youtube"/);
assert.match(runWorkbench, /SafeRunVideoPreview/);
assert.match(runWorkbench, /SafeRunImagePreview/);
assert.match(runWorkbench, /searchParams\.set\("probe", "1"\)/);
assert.match(runWorkbench, /fetch\(parsed\.toString\(\), \{ cache: "no-store", signal: controller\.signal \}\)/);
assert.match(runWorkbench, /Range: "bytes=1048576-1048576"/,
  "run video players test a representative non-zero range before mounting stale masters");
assert.match(runWorkbench, /if \(!sourceReady\)/,
  "run video players must wait for a successful availability probe before mounting");
assert.doesNotMatch(runWorkbench, /src=\{sourceReady \? src : "about:blank"\}/,
  "missing legacy video keys must not emit an invalid about:blank media request");

// The Studio's R2-only carousel filters to saved masters. A pending Lo-Fi
// thumbnail can use that exact master as its temporary preview source.
assert.match(recentVideos, /videoStillKey=\{video\.thumbnailPresentation === "lofi_frame_pending" \? video\.videoKey : undefined\}/);
assert.match(recentVideos, /allowVideoStill=\{video\.thumbnailPresentation === "lofi_frame_pending"\}/,
  "the recent-render carousel enables the exact pending Lo-Fi frame");
assert.match(recentVideos, /video-card-lofi-quality/, "the recent-render carousel preserves the Lo-Fi 4K marker");
assert.match(recentVideos, /priority=\{index < 3\}/);
assert.doesNotMatch(recentVideos, /i\.ytimg\.com|fallbackSource="youtube"/);

for (const source of [videoCard, rail, daySchedule]) {
  assert.match(source, /fallbackSource="youtube"/);
  assert.doesNotMatch(source, /useAssetUrl\(/);
}
assert.match(videoCard, /fallbackSrc=\{video\.thumbnailKey \|\| video\.thumbnailPresentation === "lofi_frame_pending"/,
  "a retained Library thumbnail must not fall back to stale YouTube artwork");
assert.match(rail, /fallbackSrc=\{video\.thumbnailKey \|\| video\.thumbnailPresentation === "lofi_frame_pending"/,
  "the artifact rail must preserve current thumbnail identity");
assert.match(daySchedule, /fallbackSrc=\{event\.thumbnailKey\s*\?/,
  "scheduled artwork must not mask a retained thumbnail with YouTube art");
assert.match(videoCard, /video-card-lofi-quality/,
  "Lo-Fi cards need a visible 4K source-frame emblem");
assert.match(rail, /lofiQualityBadge/,
  "artifact rail needs the same Lo-Fi 4K emblem");

// Status and proof badges remain tied to their actual persisted fields rather
// than being replaced by a preview's source label.
assert.match(videoCard, /ReleaseEvidenceBadge/);
assert.match(videoCard, /reviewedSrc=\{video\.reviewedThumbnailUrl\}/);
assert.match(videoCard, /status=\{video\.releaseEvidenceStatus\}/);
assert.match(rail, /ReleaseEvidenceBadge/);
assert.match(rail, /reviewedSrc=\{video\.reviewedThumbnailUrl\}/);
// A reviewed URL does not identify its generator. Keep source provenance
// distinct from both the provider and the persisted release-evidence status.
assert.match(rail, /source === "reviewed" \? "Reviewed"/);
assert.match(rail, /source === "r2" \? "Saved"/);
assert.match(rail, /source === "youtube" \? "YouTube" : "Public"/);
assert.doesNotMatch(rail, /Reviewed ERNIE/);
assert.match(rail, /status=\{video\.releaseEvidenceStatus\}/);
assert.match(rail, /state === "ready" && source !== "unavailable"/);
assert.match(rail, /source !== "unavailable" &&\s*video\.thumbnailPresentation !== "lofi_rendered_frame"/,
  "Lo-Fi rail cards must reserve the corner for the 4K emblem");
assert.match(rail, /aria-label=\{`\$\{title\} video artifacts`\}/);
assert.match(rail, /tabIndex=\{0\}/);

console.log("MediaPreview UI contracts passed");
