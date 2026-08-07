import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const sdkVersion = pkg.dependencies?.["@trigger.dev/sdk"];
const buildVersion = pkg.devDependencies?.["@trigger.dev/build"];
assert.ok(/^\d+\.\d+\.\d+$/.test(sdkVersion ?? ""), "Trigger SDK must use an exact version");
assert.equal(buildVersion, sdkVersion, "Trigger build and SDK versions must match");
assert.match(
  pkg.scripts?.["trigger:deploy"] ?? "",
  new RegExp(`trigger\\.dev@${sdkVersion?.replaceAll(".", "\\.")} deploy$`),
  "Trigger deploy script must pin the same CLI version as the SDK/build packages",
);

console.log(`RELEASE CONFIG PASS: Trigger CLI/SDK/build pinned to ${sdkVersion}`);
