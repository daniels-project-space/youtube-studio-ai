import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const route = readFileSync(join(root, "src/app/api/build-channel/route.ts"), "utf8");
const legacyTask = readFileSync(join(root, "src/trigger/buildChannelPackage.ts"), "utf8");

const retirementGate = route.indexOf("seed-only channel creation is retired");
const triggerSecretGate = route.indexOf("if (!process.env.TRIGGER_SECRET_KEY)");
const triggerImport = route.indexOf('await import("@trigger.dev/sdk")');
assert(retirementGate >= 0, "the route must explain that seed-only creation is retired");
assert(retirementGate < triggerSecretGate, "seed-only requests must stop before Trigger activation checks");
assert(retirementGate < triggerImport, "seed-only requests must stop before importing the Trigger SDK");
assert(!route.includes('"build-channel-package"'), "the API route must never dispatch the retired task");
assert.match(route, /if \(!body\.design\) \{[\s\S]*?status:\s*410/);
assert.match(route, /tasks\.trigger\(\s*"design-channel"/);

assert.match(
  legacyTask,
  /run:\s*async \(_payload: BuildChannelArgs\) => \{[\s\S]*?throw new Error\(LEGACY_CHANNEL_PACKAGE_RETIRED\)/,
  "direct task discovery must fail before any provider-capable initialization",
);
for (const unsafeLegacyDependency of [
  "bootstrapSecrets",
  "ConvexHttpClient",
  "synthChannelConcept",
  "generateChannelArt",
  "registerAllBlocks",
] as const) {
  assert(!legacyTask.includes(unsafeLegacyDependency), `${unsafeLegacyDependency} must not survive retirement`);
}

console.log("legacy seed-only channel creation retirement contract passed");
