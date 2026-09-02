import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

assert.doesNotMatch(source, /ernieBatch=reviewed/, "the Library must not load the archived ERNIE comparison batch");
assert.doesNotMatch(source, /reviewedThumbnailUrls/, "no private ERNIE preview map may override a Library video");
assert.doesNotMatch(source, /reviewedThumbnailUrl/, "Library cards must render only retained or current-candidate artwork");
assert.match(source, /const libraryVideos = videos/, "the Library projects the authoritative video query without a batch overlay");

console.log("Library ERNIE overlay retirement contracts passed");
