import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const page = readFileSync(join(root, "src/app/(app)/library/page.tsx"), "utf8");
const css = readFileSync(join(root, "src/app/(app)/library/library.module.css"), "utf8");
const paging = readFileSync(join(root, "src/app/(app)/library/libraryPaging.ts"), "utf8");

assert.match(page, /const page = pageLibraryGroup\(filtered, visibleLimit\)/);
assert.match(page, /<section className=\{styles\.vault\}/);
assert.match(page, /<VideoGrid\s+videos=\{page\.visible\}/);
assert.match(page, /<LibraryMetric label="Visible"/);
assert.match(page, /<LibraryMetric label="Channels"/);
assert.match(page, /<LibraryMetric label="Unverified"/);
assert.doesNotMatch(page, /ArtifactWorkRail|Recent masters/,
  "the Library must not render the same masters once in a recent rail and again in the vault");
assert.equal(
  (page.match(/<VideoGrid\s+videos=/g) ?? []).length,
  1,
  "the filtered master collection must have one canonical visual surface",
);
assert.doesNotMatch(page, /expandedGroups|visibleLimits|isLibraryGroupExpanded/);
assert.match(page, /const selectCollection = \(next: CollectionMode\)/);
assert.match(page, /setVisibleLimit\(LIBRARY_PAGE_SIZE\)/,
  "changing collections resets dense paging instead of retaining a stale expanded page");
assert.match(page, /catch \(error\)[\s\S]*setChangeError/,
  "archive and restore failures must become visible operator errors");
assert.match(page, /role="alert"/);
assert.match(css, /\.libraryDashboard/);
assert.match(css, /\.libraryMetrics/);
assert.match(css, /\.vault \{/);
assert.doesNotMatch(css, /\.latestRail\s*\{/);
assert.match(css, /\.changeToast\[data-tone="error"\]/);
assert.doesNotMatch(css, /\.channelHeader \{/);
assert.match(paging, /export const LIBRARY_PAGE_SIZE = 8/);

console.log("Library vault workspace contracts passed");
