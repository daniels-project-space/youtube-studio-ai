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
assert.match(page, /<LibraryMetric label="Review"/);
assert.doesNotMatch(page, /expandedGroups|visibleLimits|isLibraryGroupExpanded/);
assert.match(css, /\.libraryDashboard/);
assert.match(css, /\.libraryMetrics/);
assert.match(css, /\.vault \{/);
assert.doesNotMatch(css, /\.channelHeader \{/);
assert.match(paging, /export const LIBRARY_PAGE_SIZE = 8/);

console.log("Library vault workspace contracts passed");
