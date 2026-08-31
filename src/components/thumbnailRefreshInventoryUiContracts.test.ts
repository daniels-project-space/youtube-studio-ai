import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const panel = read("src/components/ThumbnailRefreshInventoryPanel.tsx");
const route = read("src/app/api/thumbnail-refresh/route.ts");
const library = read("src/app/(app)/library/page.tsx");

// Legacy output review is deliberately read-only: the browser sees an owner
// scoped status projection and visual proof. Stored media is resolved by the
// owner-authenticated server from a run ID; the browser never receives an R2
// key, render action, or external thumbnail replacement command.
assert.match(panel, /fetch\("\/api\/thumbnail-refresh"/);
assert.match(panel, /Legacy never means replace automatically/);
assert.match(panel, /separate private successor draft/);
assert.match(panel, /Inspect run/);
assert.match(panel, /Exact thumbnail inputs retained/);
assert.match(panel, /private successor required/);
assert.match(panel, /Open private benchmark/);
assert.match(panel, /#route-qualification-benchmark/);
assert.match(panel, /previewRunId=/);
assert.match(panel, /i\.ytimg\.com/);
assert.doesNotMatch(panel, /method:\s*["']POST/);
assert.match(route, /requireStudioActor/);
assert.match(route, /thumbnailPresent: Boolean\(item\.thumbnailKey\)/);
assert.match(route, /presignDownload\(item\.thumbnailKey/);
assert.match(route, /previewRunId/);
assert.doesNotMatch(route, /thumbnailKey:\s*item\.thumbnailKey/);
assert.match(library, /ThumbnailRefreshInventoryPanel selectedChannelSlug=\{selectedSlug\}/);

console.log("Thumbnail refresh inventory UI contracts passed");
