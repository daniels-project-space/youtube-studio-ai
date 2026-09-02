import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const videos = read("convex/videos.ts");
const card = read("src/components/VideoCard.tsx");
const rail = read("src/components/ArtifactWorkRail.tsx");
const preview = read("src/components/MediaPreview.tsx");

assert.match(videos, /selectLofiLibraryThumbnail/, "Library rows select a verified Lo-Fi rendered-frame thumbnail");
assert.match(videos, /thumbnailPresentation = exactFrame \? "lofi_rendered_frame" : "lofi_frame_pending"/,
  "a generic legacy thumbnail is never passed through as a valid Lo-Fi frame");
for (const source of [card, rail]) {
  assert.match(source, /videoStillKey=\{video\.thumbnailPresentation === "lofi_frame_pending" \? video\.videoKey : undefined\}/,
    "pending Lo-Fi rows use their retained master as the visual fallback");
  assert.match(source, /video\.thumbnailPresentation === "lofi_frame_pending"\s*\? undefined/,
    "pending Lo-Fi rows do not fall back to generic YouTube imagery");
}
assert.match(preview, /<video[\s\S]*preload="metadata"[\s\S]*onLoadedMetadata/,
  "the final-master fallback stays paused instead of autoplaying in the Library");
assert.match(preview, /Math\.min\(15, Math\.max\(0, duration - 0\.05\)\)/,
  "the fallback seeks to the 15-second source frame whenever the master is long enough");

console.log("Library Lo-Fi rendered-frame fallback contracts passed");
