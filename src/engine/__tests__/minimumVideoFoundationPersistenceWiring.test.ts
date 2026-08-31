import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const channelsSource = readFileSync(resolve(process.cwd(), "convex/channels.ts"), "utf8");
const runtimeSource = readFileSync(resolve(process.cwd(), "src/trigger/runPipeline.ts"), "utf8");

assert.match(
  channelsSource,
  /assertMinimumVideoFoundationForAutomaticFamily\(\{\s*family: family \?\? lane\.family,[\s\S]*?pipeline: args\.pipeline,/,
  "new automatic channels must seal the full minimum foundation before persistence",
);
assert.match(
  channelsSource,
  /if \(rest\.pipeline !== undefined\) \{\s*assertMinimumVideoFoundationForAutomaticFamily\(/,
  "automatic pipeline edits must not bypass the minimum foundation, while unrelated legacy edits remain possible",
);
assert.match(
  channelsSource,
  /family: channel\.family \?\? lane\.family,[\s\S]*?pipeline: args\.pipeline,/,
  "optimistic pipeline updates must use the same persistence boundary",
);
assert.match(
  runtimeSource,
  /assertMinimumVideoFoundationForAutomaticFamily\(\{[\s\S]*?pipeline: entries,/,
  "durable execution must reassert the same automatic-family foundation before provider preflight",
);

console.log("minimum video foundation persistence wiring passed");
