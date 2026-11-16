import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "src/trigger/blocks/narratedBlocks.ts"), "utf8");
const helperStart = source.indexOf("async function recordAsset(");
const helperEnd = source.indexOf("\n}", helperStart);
const helper = source.slice(helperStart, helperEnd > helperStart ? helperEnd : undefined);

assert.match(source, /await recordAsset\(ctx, "video", videoKey,/u,
  "timeline_assemble must register its persisted final master for the channel Library");
assert.match(helper, /if \(kind === "video"\)[\s\S]*new ExecutionError\([\s\S]*FINAL_VIDEO_LIBRARY_INDEX_FAILED[\s\S]*retryable: false/u,
  "a missing final-video Library index must fail the stage without retrying the completed encode");
assert.match(helper, /ctx\.log\(`recordAsset\(\$\{kind\}\) failed \(non-fatal\)/u,
  "intermediate asset indexing must remain best-effort");

console.log("FINAL VIDEO LIBRARY INDEX GATE PASS: completed output cannot go missing from the channel Library");
