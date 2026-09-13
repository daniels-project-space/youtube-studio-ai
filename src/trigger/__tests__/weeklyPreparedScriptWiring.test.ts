import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../runPipeline.ts", import.meta.url), "utf8");

const manifestVerification = source.indexOf("weeklyPreparation = assertPlanWeekPreparationManifestBinding({");
const sidecarKey = source.indexOf("const preparedScriptKey = planWeekPreparedScriptKey(weeklyPreparation);");
const sidecarBinding = source.indexOf("weeklyPreparedScript = assertPlanWeekPreparedScriptBinding({");
const seed = source.indexOf("preparedScript: structuredClone(weeklyPreparedScript.script)");

assert.ok(manifestVerification >= 0, "weekly preparation must still be verified before any sidecar is considered");
assert.ok(sidecarKey > manifestVerification, "the sidecar destination must derive from the verified preparation packet");
assert.ok(sidecarBinding > sidecarKey, "the sidecar must be cryptographically/scope bound before its script reaches execution");
assert.ok(seed > sidecarBinding, "only an admitted sidecar may seed script_gen");
assert.match(
  source,
  /prepared script is unavailable or invalid/u,
  "an existing unreadable prepared script must fail closed instead of silently regenerating it",
);

console.log("weekly prepared-script runner wiring passed");
