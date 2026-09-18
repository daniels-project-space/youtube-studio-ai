import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function main(): Promise<void> {
  const root = process.cwd();
  const [parent, child] = await Promise.all([
    readFile(join(root, "src/trigger/runPipeline.ts"), "utf8"),
    readFile(join(root, "src/trigger/renderBlockRunner.ts"), "utf8"),
  ]);

  for (const [label, source] of [["parent", parent], ["remote child", child]] as const) {
    assert.doesNotMatch(
      source,
      /reviewedLtxRuntime|resolveOwnerReviewedLtxRuntime|REVIEWED_LTX_RUNTIME_SEED_KEY/u,
      `${label} must not revive a legacy renderer through an execution-time registry read`,
    );
  }
  assert.match(
    parent,
    /assertPipelineVideoRuntimeReady\(entries\);/u,
    "the parent must perform the current H3 pre-spend admission",
  );
  assert.match(
    child,
    /assertPipelineVideoRuntimeReady\(frozenPipeline\.resolved\.entries\);/u,
    "a remote child must independently perform the same H3 admission before a paid block starts",
  );

  console.log("MiniMax H3 parent/remote-child runtime isolation wiring tests passed");
}

void main();
