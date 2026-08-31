import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function main(): Promise<void> {
  const root = process.cwd();
  const runPipeline = await readFile(join(root, "src/trigger/runPipeline.ts"), "utf8");
  const renderChild = await readFile(join(root, "src/trigger/renderBlockRunner.ts"), "utf8");

  assert.match(
    runPipeline,
    /resolveOwnerReviewedLtxRuntime\(\{ client: convex, ownerId \}\)[\s\S]{0,900}assertPipelineVideoRuntimeReady\(entries, reviewedLtxRuntime\?\.runtime\)/,
    "the parent must reload the service-only reviewed benchmark registry before its first video pre-spend assertion",
  );
  assert.match(
    runPipeline,
    /REVIEWED_LTX_RUNTIME_SEED_KEY\] = reviewedLtxRuntime[\s\S]{0,300}else \{\s*delete seedStore\[REVIEWED_LTX_RUNTIME_SEED_KEY\]/,
    "fresh runs must freeze only a validated reviewed runtime target and remove arbitrary probe/payload residue",
  );
  assert.match(
    renderChild,
    /assertReviewedLtxRuntimeSeedStillActive\([\s\S]{0,600}resolveOwnerReviewedLtxRuntime\(\{ client: convex, ownerId: payload\.ownerId \}\)[\s\S]{0,300}assertPipelineVideoRuntimeReady\(frozenPipeline\.resolved\.entries, reviewedLtxRuntime\?\.runtime\)/,
    "a remote child must revalidate the frozen benchmark seed before it can launch a queued paid worker",
  );

  console.log("reviewed LTX runtime parent/remote-child wiring tests passed");
}

void main();
