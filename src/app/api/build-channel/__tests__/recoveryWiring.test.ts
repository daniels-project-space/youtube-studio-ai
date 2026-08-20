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
assert.match(wizard, /createChannelProgramBrief/);
assert.match(wizard, /design:\s*pending\.design/);
assert.doesNotMatch(wizard, /programBrief:\s*pending\.design\.programBrief/);
assert.match(route, /assertCanonicalChannelProgramBrief/);
assert.match(route, /briefToFormatSelectionInput/);
assert.match(route, /briefToCreativeCapabilityIntent/);
assert.match(route, /resolveUnhostedSupervisedCreativeCapabilityIntents/);
assert.match(route, /design\.programBrief/);
assert.ok(
  wizard.indexOf("programBrief,") < wizard.indexOf("const intent = canonicalJson(design)"),
  "the canonical program brief must be part of the request-key intent before persistence",
);
assert.ok(
  route.indexOf("programBrief = assertCanonicalChannelProgramBrief(design.programBrief)") < route.indexOf("validateChannelBuildRequestKey("),
  "the signed design brief must be verified before its request key is accepted",
);
assert.ok(
  route.indexOf("programBrief = assertCanonicalChannelProgramBrief(design.programBrief)") < route.indexOf("channelBuildCostAuthority({"),
  "the immutable program brief must be verified before cost authority",
);
assert.ok(
  route.indexOf("formatPreflight(family.key, briefToFormatSelectionInput(programBrief") < route.indexOf("channelBuildCostAuthority({"),
  "format preflight must be brief-derived before cost authority",
);
assert.ok(
  route.indexOf("resolveUnhostedSupervisedCreativeCapabilityIntents(") < route.indexOf("channelBuildCostAuthority({"),
  "unhosted supervised intent must stop before cost authority",
);
assert.ok(
  route.indexOf("briefToFormatSelectionInput") < route.indexOf("tasks.trigger"),
  "format preflight must be derived from the brief before Trigger dispatch",
);
assert.match(wizard, /combinedSetupAndValidationCapUsd/);
assert.match(wizard, /Production budget \/ video/);

console.log("channel build recovery/cost wiring tests passed");
