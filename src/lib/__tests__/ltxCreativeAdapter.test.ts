import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveLtxCreativeAdapters } from "@/lib/ltxCreativeAdapter";
import { OFFICIAL_RENDER_PINS } from "@/lib/novitaFleet";

const adapter = {
  id: "ltx-creative-faceless-mannequin",
  kind: "file",
  repository: OFFICIAL_RENDER_PINS.ltx.model,
  revision: OFFICIAL_RENDER_PINS.ltx.revision,
  manifestSha256: "a".repeat(64),
  sourcePath: "/network/loras/faceless-mannequin.safetensors",
  localPath: "/workspace/model-cache/loras/faceless-mannequin.safetensors",
  creativeAdapter: {
    contractVersion: "ltx-creative-adapter/v1",
    role: "material-style",
    baseModel: OFFICIAL_RENDER_PINS.ltx.model,
    baseRevision: OFFICIAL_RENDER_PINS.ltx.revision,
    runtimeRevision: OFFICIAL_RENDER_PINS.ltx.runtimeRevision,
    triggerTokens: ["faceless mannequin", "tailored wool silhouette"],
    benchmark: { rtx4090ProfileBenchmarked: true, visualVerdict: "pass" },
  },
};

const resolve = (modelSpecs: readonly Record<string, unknown>[]) => resolveLtxCreativeAdapters({
  selections: new Map([["case-shot-01", { id: adapter.id, strength: 0.8 }]]),
  modelSpecs,
  baseModel: OFFICIAL_RENDER_PINS.ltx.model,
  baseRevision: OFFICIAL_RENDER_PINS.ltx.revision,
  runtimeRevision: OFFICIAL_RENDER_PINS.ltx.runtimeRevision,
});

const resolved = resolve([adapter]);
assert.deepEqual(resolved.get("case-shot-01"), {
  id: adapter.id,
  strength: 0.8,
  triggerTokens: ["faceless mannequin", "tailored wool silhouette"],
  manifestSha256: "a".repeat(64),
});

assert.throws(
  () => resolve([{ ...adapter, revision: "b".repeat(40) }]),
  /not pinned to the active LTX runtime/,
);
assert.throws(
  () => resolve([{ ...adapter, creativeAdapter: { ...adapter.creativeAdapter, benchmark: { rtx4090ProfileBenchmarked: false, visualVerdict: "pass" } } }]),
  /not present in the sealed worker model manifest/,
);
assert.throws(
  () => resolveLtxCreativeAdapters({
    selections: new Map([["case-shot-01", { id: adapter.id, strength: 1 }]]),
    modelSpecs: [adapter],
    baseModel: OFFICIAL_RENDER_PINS.ltx.model,
    baseRevision: OFFICIAL_RENDER_PINS.ltx.revision,
    runtimeRevision: OFFICIAL_RENDER_PINS.ltx.runtimeRevision,
  }),
  /less than or equal to 0.95/,
);

assert.deepEqual(resolveLtxCreativeAdapters({
  selections: new Map([["case-shot-01", undefined]]),
  modelSpecs: [],
  baseModel: OFFICIAL_RENDER_PINS.ltx.model,
  baseRevision: OFFICIAL_RENDER_PINS.ltx.revision,
  runtimeRevision: OFFICIAL_RENDER_PINS.ltx.runtimeRevision,
}), new Map());

async function main(): Promise<void> {
  // The adapter contract is only useful if every direct I2V caller can carry
  // the exact typed selection to the sealed worker. This locks the shared
  // Novita media seam, generic I2V wrapper, and ambient LTX loop together.
  const root = process.cwd();
  const [media, i2v, lofi] = await Promise.all([
    readFile(join(root, "src/lib/novitaMedia.ts"), "utf8"),
    readFile(join(root, "src/lib/i2v.ts"), "utf8"),
    readFile(join(root, "src/trigger/blocks/lofiBlocks.ts"), "utf8"),
  ]);
  assert.match(media, /creativeAdapter\?: LtxCreativeAdapterSelection/);
  assert.match(media, /creativeAdapter: args\.creativeAdapter/);
  assert.match(i2v, /creativeAdapter\?: LtxCreativeAdapterSelection/);
  assert.match(i2v, /creativeAdapter: req\.creativeAdapter/);
  assert.match(lofi, /LtxCreativeAdapterSelectionSchema\.optional\(\)\.parse/);
  assert.match(lofi, /creativeAdapter,/);
  console.log("LTX creative adapter tests passed");
}

void main();
