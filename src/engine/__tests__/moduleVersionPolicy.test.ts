import assert from "node:assert/strict";
import { _clear, registerManifest, registerManifestVersion } from "../registry";
import { manifestFromBlock } from "../moduleManifest";
import { completePipelineForPolicy, materializeRuntimePipelineParams } from "../pipelineCompiler";
import { enforceLengthContract } from "../designerCore";
import type { PipelineEntry } from "../types";

const producer = (version: string, capabilities: string[]) => manifestFromBlock({
  id: "version_policy_fixture", consumes: [], produces: ["fixtureText"],
  run: async () => ({ fixtureText: version }),
}, { version, capabilities, certification: "contract" });

try {
  _clear();
  registerManifest(producer("1.0.0", []));
  registerManifestVersion(producer("2.0.0", ["script.generated"]));
  registerManifest(manifestFromBlock({
    id: "version_policy_quality", consumes: ["fixtureText"], produces: ["fixtureChecked"],
    run: async () => ({ fixtureChecked: true }),
  }, { version: "1.0.0", capabilities: ["script.qa_passed"], certification: "contract" }));
  const baseline = [{ block: "version_policy_fixture" }];
  assert.deepEqual(completePipelineForPolicy(baseline).entries, baseline);
  const selected: PipelineEntry[] = [{ block: "version_policy_fixture", version: "2.0.0", params: { keep: true } }];
  const completed = completePipelineForPolicy(selected);
  assert.equal(completed.entries[0].version, "2.0.0");
  assert.ok(completed.inserted.includes("version_policy_quality"), "policy must inspect selected revision's capabilities");
  assert.deepEqual(selected, [{ block: "version_policy_fixture", version: "2.0.0", params: { keep: true } }]);
  assert.throws(() => completePipelineForPolicy([{ block: "version_policy_fixture", version: "99.0.0" }]), /unknown executable version/);
  assert.throws(() => completePipelineForPolicy(selected, { manifestSource: "structural" }), /requires runtime manifest validation/);
  assert.equal(materializeRuntimePipelineParams(selected, { version_policy_fixture: { changed: true } })[0].version, "2.0.0");

  const lengthEntries: PipelineEntry[] = [
    { block: "composer_brief", version: "2.0.0", params: { targetSeconds: 30 } },
    { block: "music", version: "2.0.0", params: { trackCount: 8 } },
  ];
  const adjusted = enforceLengthContract(lengthEntries, 300, "music_loop");
  assert.deepEqual(adjusted.pipeline.map((entry) => entry.version), ["2.0.0", "2.0.0"]);
  assert.equal(adjusted.pipeline[0].params?.targetSeconds, 300);
  assert.equal(lengthEntries[0].params?.targetSeconds, 30);

  registerManifest(manifestFromBlock({ id: "qa_refine", consumes: [], produces: [], run: async () => ({}) },
    { version: "1.0.0", capabilities: [], certification: "contract" }));
  assert.throws(() => completePipelineForPolicy([{ block: "qa_refine", version: "1.0.0" }]), /cannot retire explicitly versioned/);
  registerManifest(manifestFromBlock({ id: "intro_card", consumes: [], produces: [], run: async () => ({}) },
    { version: "1.0.0", capabilities: [], certification: "contract" }));
  assert.throws(() => completePipelineForPolicy([
    { block: "intro_card", version: "1.0.0" }, { block: "assemble" },
  ]), /cannot retire explicitly versioned/);
  console.log("MODULE VERSION POLICY PASS: exact selected capabilities, preserved pins, unknown/structural refusal, explicit retirement guard, unchanged defaults");
} finally { _clear(); }
