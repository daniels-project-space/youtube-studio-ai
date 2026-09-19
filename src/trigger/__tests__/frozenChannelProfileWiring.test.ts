import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const runner = readFileSync(resolve(root, "runPipeline.ts"), "utf8");
const crew = readFileSync(resolve(root, "blocks/crewBlocks.ts"), "utf8");

assert.match(
  runner,
  /if \(!durableInvocation && !privateInvocationContext\) \{[\s\S]*?seedStore\.channelProfile = buildChannelProfile\(/,
  "only fresh ordinary runs may add the canonical profile to their immutable invocation seed",
);
assert.ok(
  runner.indexOf("entries = injectContentLaneIntoPipeline(entries, contentLane);") < runner.indexOf("seedStore.channelProfile = buildChannelProfile"),
  "the profile must capture the exact lane-injected pipeline rather than a pre-admission draft",
);
assert.match(
  crew,
  /const profile = parseFrozenChannelProfile\(ctx\.store\["channelProfile"\]\);[\s\S]*?if \(profile\)/,
  "crew blocks must prefer the frozen profile before their legacy loose-key adapter",
);
assert.match(
  crew,
  /if \(g\.profile\) return g\.profile;/,
  "crew resolution must preserve the full typed profile, not reconstruct a partial substitute",
);

console.log("FROZEN CHANNEL PROFILE WIRING PASS: ordinary snapshot, exact pipeline, crew consumption");
