import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const panel = read("src/components/ThumbnailRefreshInventoryPanel.tsx");
const route = read("src/app/api/thumbnail-refresh/route.ts");
const library = read("src/app/(app)/library/page.tsx");

// Legacy review can now request one bounded, separate candidate. Stored media
// remains server-resolved from opaque run ids, and neither the browser nor the
// candidate endpoint receives authority to overwrite the source/YouTube image.
assert.match(panel, /fetch\("\/api\/thumbnail-refresh"/);
assert.match(panel, /Legacy never means replace automatically/);
assert.match(panel, /separate private successor draft/);
assert.match(panel, /Inspect run/);
assert.match(panel, /Exact thumbnail inputs retained/);
assert.match(panel, /private successor required/);
assert.match(panel, /Open private benchmark/);
assert.match(panel, /#route-qualification-benchmark/);
assert.match(panel, /previewRunId=/);
assert.match(panel, /candidatePreviewRunId=/);
assert.match(panel, /i\.ytimg\.com/);
assert.match(panel, /method:\s*["']POST/);
assert.match(panel, /confirmCandidateSpend:\s*true/);
assert.match(panel, /Render new candidate/);
assert.match(panel, /Resume candidate delivery/);
assert.match(panel, /Candidate authorization interrupted/);
assert.match(panel, /The current thumbnail is unchanged/);
assert.match(route, /requireStudioActor/);
assert.match(route, /thumbnailPresent: Boolean\(item\.thumbnailKey\)/);
assert.match(route, /presignDownload\(key/);
assert.match(route, /previewRunId/);
assert.match(route, /createCandidateShell/);
assert.match(route, /issueStudioActionApproval/);
assert.match(route, /sourceChanged:\s*false/);
assert.match(route, /youtubeChanged:\s*false/);
assert.doesNotMatch(route, /thumbnailKey:\s*item\.thumbnailKey/);
assert.doesNotMatch(route, /youtube\.thumbnails|setThumbnail|videos\.update/);
assert.match(library, /ThumbnailRefreshInventoryPanel selectedChannelSlug=\{selectedSlug\}/);

console.log("Thumbnail refresh inventory UI contracts passed");
