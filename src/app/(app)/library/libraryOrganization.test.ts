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

assert.match(schema, /libraryState: v\.optional\(v\.union\(v\.literal\("active"\), v\.literal\("archived"\)\)\)/);
assert.match(videos, /const libraryState = run\.libraryState \?\? "active"/);
assert.match(videos, /if \(!args\.includeArchived && libraryState === "archived"\) continue/);
assert.match(videos, /export const setLibraryState = mutation/);
assert.match(videos, /run\.ownerId !== args\.ownerId/);
const archiveMutation = videos.match(/export const setLibraryState = mutation\(\{([\s\S]*?)\n\}\);/)?.[1] ?? "";
assert.doesNotMatch(archiveMutation, /db\.delete|deleteObject|youtube/i, "archiving must never delete stored or external media");

assert.match(library, /includeArchived: true/);
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
