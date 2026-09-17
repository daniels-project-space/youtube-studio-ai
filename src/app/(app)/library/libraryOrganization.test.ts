import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const schema = read("convex/schema.ts");
const videos = read("convex/videos.ts");
const library = read("src/app/(app)/library/page.tsx");
const card = read("src/components/VideoCard.tsx");
const folders = read("src/components/ChannelFolderWorkspace.tsx");
const channels = read("src/app/(app)/channels/page.tsx");
const projection = read("src/lib/libraryProjection.ts");
const layout = read("src/app/(app)/library/library.module.css");
const paging = read("src/app/(app)/library/libraryPaging.ts");

assert.match(paging, /LIBRARY_PAGE_SIZE = 8/);
assert.match(layout, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/,
  "eight Library cards should fill two balanced desktop rows, not six-plus-two");
assert.match(layout, /max-width: 1050px[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/);
assert.match(layout, /max-width: 620px[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);

assert.match(schema, /libraryState: v\.optional\(v\.union\(v\.literal\("active"\), v\.literal\("archived"\)\)\)/);
assert.match(projection, /export function matchesLibraryRunScope\(/,
  "all Library projections must share the archive/state scope helper");
assert.match(videos, /matchesLibraryRunScope\(run, filters\)/,
  "the compatibility and cursor Library paths must apply the same archive/state rules");
assert.match(videos, /export const setLibraryState = mutation/);
assert.match(videos, /run\.ownerId !== args\.ownerId/);
const archiveMutation = videos.match(/export const setLibraryState = mutation\(\{([\s\S]*?)\n\}\);/)?.[1] ?? "";
assert.doesNotMatch(archiveMutation, /db\.delete|deleteObject|youtube/i, "archiving must never delete stored or external media");

assert.match(library, /includeArchived: true/);
assert.match(library, /api\.videos\.librarySummary/,
  "collection badges must use the exact lightweight aggregate, not the bounded card payload");
assert.doesNotMatch(library, /libraryVideos\?\.filter\(\(video\).*libraryState/,
  "collection badges must not silently stop at the 500-card presentation window");
assert.match(videos, /export const librarySummary = query/);
assert.match(videos, /withIndex\("by_owner_kind"/);
assert.match(schema, /\.index\("by_run_kind", \["runId", "kind"\]\)/,
  "Library card projections need a kind-scoped asset index");
assert.match(videos, /withIndex\("by_run_kind", \(q\) => q\.eq\("runId", run\._id\)\.eq\("kind", "video"\)\)/,
  "Library cards should not collect unrelated intermediate assets");
assert.match(videos, /withIndex\("by_run_kind", \(q\) => q\.eq\("runId", run\._id\)\.eq\("kind", "thumbnail"\)\)/,
  "Library cards should read thumbnails through the kind-scoped index");
assert.match(library, /type CollectionMode = "active" \| "archived"/);
assert.match(library, /Moved to archive/);
assert.match(library, />\s*Undo\s*</);
assert.match(card, /<article className="glass video-card"/);
assert.match(card, /className="video-card-open"/);
assert.match(card, /<footer className="video-card-footer">/);
assert.doesNotMatch(
  card,
  /<button[^>]*className="glass video-card"/,
  "the card container must be semantic content, not a button containing controls",
);

for (const operation of [/api\.folders\.create/, /api\.folders\.rename/, /api\.folders\.remove/]) {
  assert.match(folders, operation);
}
assert.doesNotMatch(folders, /window\.prompt|window\.confirm/);
assert.match(folders, /Channels will return to All channels/);
assert.match(channels, /<ChannelRoomSelect/);
assert.match(channels, /<select[\s\S]*All channels/);

console.log("Library archive and channel-room organization contracts passed");
