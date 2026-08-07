import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const route = readFileSync(join(root, "src/app/api/build-channel/route.ts"), "utf8");
const wizard = readFileSync(join(root, "src/app/(app)/channels/new/page.tsx"), "utf8");

assert(
  wizard.indexOf("sessionStorage.setItem(PENDING_BUILD_STORAGE_KEY") <
    wizard.indexOf('fetch("/api/build-channel"'),
  "the request key and full intent must be durable before network dispatch",
);
assert.match(wizard, /ChannelBuildSubmissionGate/);
assert.match(wizard, /if \(document\.hidden\)/);
assert.match(wizard, /const shouldReadTask = !progressAvailable \|\| Date\.now\(\) - lastTaskReadAt >= 15_000/);
assert.match(wizard, /pollAbortRef\.current\?\.abort\(\)/);
assert.match(route, /idempotencyKeys\.create\([\s\S]*scope:\s*"global"/);
assert.match(route, /channelBuildCostAuthority/);
assert.match(route, /maxCostUsd:\s*costAuthority\.setupCapUsd/);
assert.match(route, /maxCostUsd:\s*costAuthority\.validationCapUsd/);
assert.match(wizard, /combinedSetupAndValidationCapUsd/);
assert.match(wizard, /Production budget \/ video/);

console.log("channel build recovery/cost wiring tests passed");
