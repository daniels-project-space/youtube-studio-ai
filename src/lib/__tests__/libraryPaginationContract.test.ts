import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const source = readFileSync(join(root, "convex/videos.ts"), "utf8");
const bounded = readFileSync(join(root, "src/lib/boundedConvexReads.ts"), "utf8");

const start = source.indexOf("export const listVideosPage = query(");
assert.ok(start >= 0, "the cursor-backed Library query remains exposed");
const pageQuery = source.slice(start).split("\nexport const librarySummary")[0]!;

// Cursor boundaries are owned by Convex's index paginator, not by a hidden
// collect/slice fallback. The result must return the paginator cursor exactly
// so the next page cannot restart or skip a boundary.
assert.match(pageQuery, /paginationOpts: paginationOptsValidator/);
assert.match(pageQuery, /\.paginate\(args\.paginationOpts\)/);
assert.match(pageQuery, /return \{[\s\S]*\.\.\.runPage,[\s\S]*page:/);
assert.doesNotMatch(pageQuery, /runPage\.page\.slice/);
assert.match(pageQuery, /withIndex\("by_owner"/);
assert.match(pageQuery, /withIndex\("by_channel"/);

// Filters must be applied before paid joins wherever possible, while title
// search remains after metadata title resolution. Both cursor paths use the
// same pure rules rather than maintaining a second archive/date definition.
assert.match(source, /matchesLibraryRunScope/);
assert.match(source, /matchesLibraryTitle/);
assert.match(pageQuery, /libraryState/);
assert.match(pageQuery, /args\.from/);
assert.match(pageQuery, /args\.to/);
assert.match(source, /function projectLibraryVideo\(/);

// Evidence and packaging parity: the page projection must retain the same
// sealed master certificate and current thumbnail candidate/Lo-Fi selection
// as the existing Library and lightbox paths.
for (const expression of [
  "recordedMasterKey(ctx, run._id)",
  "currentLibraryThumbnail(ctx, {",
  "selectLatestCurrentGoldenThumbnail",
  "selectLofiLibraryThumbnail",
  "releaseEvidenceStatus",
]) {
  assert.match(pageQuery + source.slice(0, start), new RegExp(expression.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

assert.match(bounded, /LIBRARY_PAGE_LIMIT/);
assert.match(bounded, /maxLimit: 24/);

console.log("Library cursor, filter, and evidence parity contracts passed");
