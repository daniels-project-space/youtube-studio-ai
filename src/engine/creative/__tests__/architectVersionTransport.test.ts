import assert from "node:assert/strict";
import { applyArchitectPlan, type ArchitectPlan } from "../architect";
import { designPipeline } from "@/engine/designer";
import { getManifest, registerManifestVersion } from "@/engine/registry";
import { validatePipeline } from "@/engine/validate";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { createChannelShowProfile } from "@/engine/channelShowProfile";
import { assertChannelShowProfileReceiptExactComposition } from "@/engine/channelShowProfileCodec";
import type { PipelineEntry } from "@/engine/types";

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("version transport must not call a provider"); };
try {
  const base = designPipeline({ family: "music_loop", nicheKey: "lofi", lengthMinutes: 60 }).pipeline;
  const music = getManifest("music")!;
  const version = "2.0.0-transport-test";
  registerManifestVersion({ ...music, version });
  const pinned = base.map((entry) => entry.block === "music" ? { ...entry, version } : entry);
  const before = structuredClone(pinned);
  const plan: ArchitectPlan = {
    summary: "Tune the selected music implementation",
    decisions: [{ action: "set_params", block: "music", params: { trackCount: 3 }, why: "Vary the program" }],
    antiRepetition: [], missingCapabilities: [], groundingActions: [],
  };
  const result = applyArchitectPlan(pinned, plan, { family: "music_loop" });
  assert.equal(result.report.applied.length, 1, "must test the successful transform, not floor fallback");
  assert.deepEqual(result.report.rejected, []);
  const selected = result.pipeline.find((entry) => entry.block === "music")!;
  assert.equal(selected.version, version);
  assert.equal(selected.params?.trackCount, 3);
  assert.deepEqual(pinned, before, "architect must not rewrite its source pipeline");
  assert.equal(validatePipeline(result.pipeline).manifests.find((manifest) => manifest.id === "music")?.version, version);

  const noDecisions = applyArchitectPlan(pinned, { ...plan, decisions: [] }, { family: "music_loop" });
  assert.equal(noDecisions.pipeline.find((entry) => entry.block === "music")?.version, version);
  const legacy = applyArchitectPlan(base, plan, { family: "music_loop" });
  assert.equal(Object.hasOwn(legacy.pipeline.find((entry) => entry.block === "music")!, "version"), false);
  for (const invalid of ["9.9.9", " 1.0.0-migration", "1.0.0-migration "]) {
    const unknown = pinned.map((entry) => entry.block === "music" ? { ...entry, version: invalid } : entry);
    const rejected = applyArchitectPlan(unknown, plan, { family: "music_loop" });
    assert.equal(rejected.report.applied.length, 0);
    assert.equal(rejected.pipeline.find((entry) => entry.block === "music")?.version, invalid);
    assert.throws(() => validatePipeline(rejected.pipeline), /unknown block.*version/);
  }

  const programBrief = createChannelProgramBrief({
    family: "music_loop", nicheKey: "lofi", locale: "en", concept: "Original instrumental listening programs.",
  });
  const profile = createChannelShowProfile({ programBrief, pipeline: pinned });
  assert.doesNotThrow(() => assertChannelShowProfileReceiptExactComposition({ profile, programBrief, pipeline: pinned }));
  assert.throws(() => assertChannelShowProfileReceiptExactComposition({ profile, programBrief, pipeline: base }), /does not match the admitted channel composition/);
  for (const invalid of [null, 2, "", "   "]) {
    const malformed = pinned.map((entry) => entry.block === "music" ? { ...entry, version: invalid } : entry) as PipelineEntry[];
    assert.throws(() => assertChannelShowProfileReceiptExactComposition({ profile, programBrief, pipeline: malformed }), /invalid version/);
  }
  const spaced = pinned.map((entry) => entry.block === "music" ? { ...entry, version: ` ${version}` } : entry);
  assert.throws(() => assertChannelShowProfileReceiptExactComposition({ profile, programBrief, pipeline: spaced }), /does not match the admitted channel composition/);
  console.log("ARCHITECT VERSION TRANSPORT PASS: real transforms, exact registry validation, receipt admission, legacy parity");
} finally {
  globalThis.fetch = originalFetch;
}
