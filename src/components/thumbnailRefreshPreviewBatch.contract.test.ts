import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { candidatePreviewIds } from "@/app/api/thumbnail-refresh/route";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const route = read("src/app/api/thumbnail-refresh/route.ts");
const panel = read("src/components/ThumbnailRefreshInventoryPanel.tsx");

assert.match(route, /MAX_BATCHED_CANDIDATE_PREVIEWS = 6/);
assert.match(route, /candidatePreviewRunIds/);
assert.match(route, /One inventory read serves the entire compact rail/);
assert.match(route, /item\.candidateRunId === runId/);
assert.match(panel, /candidatePreviewRunIds=/);
assert.match(panel, /previewUrl=\{row\.candidate\?\.runId/);
assert.match(panel, /deferFetch=\{featuredPreviewBatchId !== featuredPreviewRunIds\}/);
assert.match(panel, /The image endpoint retries R2 once itself/);
assert.match(panel, /featuredPreviewBatchFailureId/);
assert.match(panel, /Preview batch unavailable · loading cards individually/);

const ids = ["candidate-0001", "candidate-0002", "candidate-0003"];
assert.deepEqual(candidatePreviewIds(ids.join(",")), ids);
assert.deepEqual(candidatePreviewIds("candidate-0001,candidate-0001"), ["candidate-0001"]);
assert.equal(candidatePreviewIds(null), null);
assert.throws(() => candidatePreviewIds("short"), /invalid candidate thumbnail preview batch/);
assert.throws(
  () => candidatePreviewIds(["candidate-0001", "candidate-0002", "candidate-0003", "candidate-0004", "candidate-0005", "candidate-0006", "candidate-0007"].join(",")),
  /invalid candidate thumbnail preview batch/,
);

console.log("Thumbnail refresh preview batch contracts passed");
