import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../runPipeline.ts", import.meta.url), "utf8");
const merge = source.indexOf("const mergedModuleConfig = mergeRuntimeModuleConfig({");
const freeze = source.indexOf("entries = materializeRuntimePipelineParams(entries, firstParams)");

assert.ok(merge >= 0 && freeze >= 0 && merge < freeze, "module config must validate before frozen params are materialized");
assert.match(
  source,
  /code: "CHANNEL_MODULE_CONFIG_INVALID"[\s\S]*?retryable: false[\s\S]*?phase: "pipeline_configuration"/,
  "invalid selected module configuration must terminate before any provider boundary",
);
assert.doesNotMatch(
  source,
  /moduleConfig runtime merge failed \(defaults kept\)/,
  "module settings must never silently fall back to defaults",
);
assert.match(
  source,
  /channelModuleConfig: frozenModuleConfig/,
  "the invocation must freeze the validated effective config, not reread mutable channel settings",
);
const override = source.indexOf("payload.moduleConfigOverride ??");
const channelFallback = source.indexOf("}).moduleConfig", override);
assert.ok(
  override >= 0 && channelFallback > override,
  "an explicit supervised or probe override must become the configuration seen by downstream modules",
);

console.log("runtime module config run-pipeline wiring tests passed");
