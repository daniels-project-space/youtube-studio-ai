import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const source = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

const legacyRoute = source("src/app/api/youtube-provision/route.ts");
assert.match(
  legacyRoute,
  /authorizeStudioRoute\(request\)/,
  "the retired endpoint must retain its privileged route boundary",
);
assert.match(legacyRoute, /legacy_youtube_provision_retired/);
assert.match(legacyRoute, /status:\s*410/);
assert.doesNotMatch(legacyRoute, /request\.json\(/);
assert.doesNotMatch(legacyRoute, /@trigger\.dev\/sdk/);
assert.doesNotMatch(legacyRoute, /tasks\.trigger\(/);

const legacyTask = source("src/trigger/provisionYoutube.ts");
assert.match(legacyTask, /id:\s*"provision-youtube"/);
assert.match(legacyTask, /retired:\s*true/);
assert.match(legacyTask, /nonRetryable:\s*true/);
assert.match(legacyTask, /maxAttempts:\s*1/);
for (const forbiddenProviderBoundary of [
  "bootstrapSecrets",
  "withStagehand",
  "hasBrowserbase",
  "runStagehandAgentLoop",
  "StudioConvexHttpClient",
  "requireInternalQuerySecret",
]) {
  assert.doesNotMatch(
    legacyTask,
    new RegExp(forbiddenProviderBoundary),
    `retired provision-youtube task must not retain ${forbiddenProviderBoundary}`,
  );
}

const supportedRoute = source("src/app/api/youtube-create/route.ts");
assert.match(supportedRoute, /confirmedCreateNewChannel !== true/);
assert.match(supportedRoute, /tasks\.trigger\("youtube-create-channel"/);

const supportedTask = source("src/trigger/youtubeCreateChannel.ts");
assert.ok(
  supportedTask.indexOf("verifyStudioActionApproval") < supportedTask.indexOf("if (!hasBrowserbase())"),
  "the supported task must verify approval before opening Browserbase/Stagehand",
);
assert.match(supportedTask, /youtubeCreationClaims\.claim/);

console.log("Legacy YouTube provisioning retirement regression tests passed");
