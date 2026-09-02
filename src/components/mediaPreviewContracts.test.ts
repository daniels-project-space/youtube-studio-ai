import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const preview = read("src/components/MediaPreview.tsx");
const previewCss = read("src/components/MediaPreview.module.css");
const assetImg = read("src/components/AssetImg.tsx");
const videoCard = read("src/components/VideoCard.tsx");
const rail = read("src/components/ArtifactWorkRail.tsx");
const daySchedule = read("src/app/(app)/schedule/DayByDaySchedule.tsx");

// One component owns the signed URL lifecycle, visual source state and the
// accessible loading/error state; surfaces do not each invent a new fallback.
assert.match(preview, /useAssetUrlState/);
assert.match(preview, /selectMediaPreview/);
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

for (const source of [videoCard, rail, daySchedule]) {
  assert.match(source, /fallbackSource="youtube"/);
  assert.doesNotMatch(source, /useAssetUrl\(/);
}

// Status and proof badges remain tied to their actual persisted fields rather
// than being replaced by a preview's source label.
assert.match(videoCard, /ReleaseEvidenceBadge/);
assert.match(videoCard, /reviewedSrc=\{video\.reviewedThumbnailUrl\}/);
assert.match(videoCard, /status=\{video\.releaseEvidenceStatus\}/);
assert.match(rail, /ReleaseEvidenceBadge/);
assert.match(rail, /reviewedSrc=\{video\.reviewedThumbnailUrl\}/);
assert.match(rail, /Reviewed ERNIE/);
assert.match(rail, /status=\{video\.releaseEvidenceStatus\}/);
assert.match(rail, /state === "ready" && source !== "unavailable"/);
assert.match(rail, /aria-label=\{`\$\{title\} video artifacts`\}/);
assert.match(rail, /tabIndex=\{0\}/);

console.log("MediaPreview UI contracts passed");
