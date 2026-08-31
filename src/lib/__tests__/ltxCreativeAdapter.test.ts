import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  LTX_CREATIVE_ADAPTER_BENCHMARK_EVIDENCE_VERSION,
  LTX_CREATIVE_ADAPTER_CONTRACT_VERSION,
  LTX_CREATIVE_ADAPTER_STACK_VERSION,
  resolveLtxCreativeAdapters,
} from "@/lib/ltxCreativeAdapter";
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
    contractVersion: LTX_CREATIVE_ADAPTER_CONTRACT_VERSION,
    role: "material-style",
    baseModel: OFFICIAL_RENDER_PINS.ltx.model,
    baseRevision: OFFICIAL_RENDER_PINS.ltx.revision,
    runtimeRevision: OFFICIAL_RENDER_PINS.ltx.runtimeRevision,
    triggerTokens: ["faceless mannequin", "tailored wool silhouette"],
    benchmark: {
      rtx4090ProfileBenchmarked: true,
      visualVerdict: "pass",
      calibratedStrength: 0.8,
      qualityDelta: {
        metric: "material_identity_consistency",
        baselineScore: 7.2,
        adaptedScore: 8.1,
      },
      evidence: {
        version: LTX_CREATIVE_ADAPTER_BENCHMARK_EVIDENCE_VERSION,
        evidenceManifestKey: "benchmarks/faceless-mannequin/evidence.json",
        immutableEvidenceObjectVersionId: "r2-version-ltx-adapter-001",
        evidenceSha256: "b".repeat(64),
        outputVideoKey: "benchmarks/faceless-mannequin/output.mp4",
        outputVideoSha256: "c".repeat(64),
        outputDurationMs: 5_000,
        outputArtifactReceiptFingerprint: "d".repeat(64),
        visualReviewReceiptFingerprint: "e".repeat(64),
        reviewedAt: "2026-08-23T00:00:00Z",
        reviewedBy: "visual-qa",
      },
    },
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
  adapters: [{
    id: adapter.id,
    strength: 0.8,
    triggerTokens: ["faceless mannequin", "tailored wool silhouette"],
    manifestSha256: "a".repeat(64),
  }],
});

const cameraAdapter = {
  ...adapter,
  id: "ltx-creative-deliberate-orbit",
  manifestSha256: "f".repeat(64),
  sourcePath: "/network/loras/deliberate-orbit.safetensors",
  localPath: "/workspace/model-cache/loras/deliberate-orbit.safetensors",
  creativeAdapter: {
    ...adapter.creativeAdapter,
    role: "camera-control",
    triggerTokens: ["slow deliberate orbit"],
    benchmark: {
      ...adapter.creativeAdapter.benchmark,
      calibratedStrength: 0.42,
      qualityDelta: {
        metric: "camera_motion_adherence",
        baselineScore: 7.1,
        adaptedScore: 8.2,
      },
    },
  },
};
const stackBenchmark = {
  rtx4090ProfileBenchmarked: true as const,
  visualVerdict: "pass" as const,
  calibratedAdapters: [
    { id: adapter.id, strength: 0.52 },
    { id: cameraAdapter.id, strength: 0.42 },
  ],
  qualityDeltas: [
    { metric: "material_identity_consistency" as const, baselineScore: 7.2, adaptedScore: 8.3 },
    { metric: "camera_motion_adherence" as const, baselineScore: 7.1, adaptedScore: 8.2 },
  ],
  evidence: adapter.creativeAdapter.benchmark.evidence,
};
const stackResolved = resolveLtxCreativeAdapters({
  selections: new Map([["case-shot-01", {
    version: LTX_CREATIVE_ADAPTER_STACK_VERSION,
    adapters: [
      { id: adapter.id, strength: 0.52 },
      { id: cameraAdapter.id, strength: 0.42 },
    ],
    benchmark: stackBenchmark,
  }]]),
  modelSpecs: [adapter, cameraAdapter],
  baseModel: OFFICIAL_RENDER_PINS.ltx.model,
  baseRevision: OFFICIAL_RENDER_PINS.ltx.revision,
  runtimeRevision: OFFICIAL_RENDER_PINS.ltx.runtimeRevision,
});
assert.deepEqual(stackResolved.get("case-shot-01")?.adapters.map(({ id, strength }) => ({ id, strength })), [
  { id: adapter.id, strength: 0.52 },
  { id: cameraAdapter.id, strength: 0.42 },
]);
assert.equal(stackResolved.get("case-shot-01")?.benchmark?.qualityDeltas.length, 2);
assert.throws(
  () => resolveLtxCreativeAdapters({
    selections: new Map([["case-shot-01", { id: adapter.id, strength: 0.74 }]]),
    modelSpecs: [adapter],
    baseModel: OFFICIAL_RENDER_PINS.ltx.model,
    baseRevision: OFFICIAL_RENDER_PINS.ltx.revision,
    runtimeRevision: OFFICIAL_RENDER_PINS.ltx.runtimeRevision,
  }),
  /strength does not match its exact RTX 4090 visual benchmark/,
  "a single adapter cannot be reweighted beyond its retained benchmark",
);
assert.throws(
  () => resolveLtxCreativeAdapters({
    selections: new Map([["case-shot-01", {
      version: LTX_CREATIVE_ADAPTER_STACK_VERSION,
      adapters: [
        { id: adapter.id, strength: 0.5 },
        { id: cameraAdapter.id, strength: 0.42 },
      ],
      benchmark: stackBenchmark,
    }]]),
    modelSpecs: [adapter, cameraAdapter],
    baseModel: OFFICIAL_RENDER_PINS.ltx.model,
    baseRevision: OFFICIAL_RENDER_PINS.ltx.revision,
    runtimeRevision: OFFICIAL_RENDER_PINS.ltx.runtimeRevision,
  }),
  /strengths do not match its exact RTX 4090 visual benchmark/,
  "a combined adapter recipe cannot borrow a nearby but unbenchmarked strength",
);
assert.throws(
  () => resolveLtxCreativeAdapters({
    selections: new Map([["case-shot-01", {
      version: LTX_CREATIVE_ADAPTER_STACK_VERSION,
      adapters: [
        { id: adapter.id, strength: 0.95 },
        { id: cameraAdapter.id, strength: 0.95 },
        { id: "ltx-creative-visual-style", strength: 0.15 },
      ],
      benchmark: {
        ...stackBenchmark,
        qualityDeltas: [
          ...stackBenchmark.qualityDeltas,
          { metric: "visual_style_coherence", baselineScore: 7.2, adaptedScore: 8.1 },
        ],
      },
    }]]),
    modelSpecs: [{
      ...adapter,
      id: "ltx-creative-visual-style",
      manifestSha256: "1".repeat(64),
      sourcePath: "/network/loras/visual-style.safetensors",
      localPath: "/workspace/model-cache/loras/visual-style.safetensors",
      creativeAdapter: {
        ...adapter.creativeAdapter,
        role: "visual-style",
        benchmark: {
          ...adapter.creativeAdapter.benchmark,
          qualityDelta: {
            metric: "visual_style_coherence",
            baselineScore: 7.2,
            adaptedScore: 8.1,
          },
        },
      },
    }, adapter, cameraAdapter],
    baseModel: OFFICIAL_RENDER_PINS.ltx.model,
    baseRevision: OFFICIAL_RENDER_PINS.ltx.revision,
    runtimeRevision: OFFICIAL_RENDER_PINS.ltx.runtimeRevision,
  }),
  /at most 2 complementary direct-LTX adapters/,
  "a direct stack must refuse a third LoRA rather than blindly layering styles",
);
assert.throws(
  () => resolveLtxCreativeAdapters({
    selections: new Map([["case-shot-01", {
      version: LTX_CREATIVE_ADAPTER_STACK_VERSION,
      adapters: [
        { id: adapter.id, strength: 0.95 },
        { id: cameraAdapter.id, strength: 0.95 },
      ],
      benchmark: stackBenchmark,
    }]]),
    modelSpecs: [adapter, cameraAdapter],
    baseModel: OFFICIAL_RENDER_PINS.ltx.model,
    baseRevision: OFFICIAL_RENDER_PINS.ltx.revision,
    runtimeRevision: OFFICIAL_RENDER_PINS.ltx.runtimeRevision,
  }),
  /combined strength must stay below 1.5/,
  "two complementary adapters must still stay below the over-conditioning cap",
);
assert.throws(
  () => resolveLtxCreativeAdapters({
    selections: new Map([["case-shot-01", {
      version: LTX_CREATIVE_ADAPTER_STACK_VERSION,
      adapters: [
        { id: adapter.id, strength: 0.52 },
        { id: cameraAdapter.id, strength: 0.42 },
      ],
      benchmark: { ...stackBenchmark, qualityDeltas: [stackBenchmark.qualityDeltas[0], { ...stackBenchmark.qualityDeltas[1], adaptedScore: 7.9 }] },
    }]]),
    modelSpecs: [adapter, cameraAdapter],
    baseModel: OFFICIAL_RENDER_PINS.ltx.model,
    baseRevision: OFFICIAL_RENDER_PINS.ltx.revision,
    runtimeRevision: OFFICIAL_RENDER_PINS.ltx.runtimeRevision,
  }),
  /below the quality floor/,
  "a multi-LoRA shot needs a combined benchmark, not merely individually passing adapters",
);

assert.throws(
  () => resolve([{ ...adapter, revision: "b".repeat(40) }]),
  /not pinned to the active LTX runtime/,
);
assert.throws(
  () => resolve([{ ...adapter, creativeAdapter: { ...adapter.creativeAdapter, benchmark: { rtx4090ProfileBenchmarked: false, visualVerdict: "pass" } } }]),
  /not present in the sealed worker model manifest/,
);
assert.throws(
  () => resolve([{
    ...adapter,
    creativeAdapter: {
      ...adapter.creativeAdapter,
      benchmark: {
        ...adapter.creativeAdapter.benchmark,
        qualityDelta: {
          ...adapter.creativeAdapter.benchmark.qualityDelta,
          adaptedScore: 7.9,
        },
      },
    },
  }]),
  /not present in the sealed worker model manifest/,
  "a passing review without the role-specific quality floor must not make a direct LTX adapter selectable",
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

assert.throws(
  () => resolveLtxCreativeAdapters({
    selections: new Map([["case-shot-01", {
      id: adapter.id,
      strength: 0.8,
      expectedManifestSha256: "f".repeat(64),
    }]]),
    modelSpecs: [adapter],
    baseModel: OFFICIAL_RENDER_PINS.ltx.model,
    baseRevision: OFFICIAL_RENDER_PINS.ltx.revision,
    runtimeRevision: OFFICIAL_RENDER_PINS.ltx.runtimeRevision,
  }),
  /does not match the Studio-approved adapter bytes/,
  "a Studio-approved adapter must still match the exact sealed worker model manifest",
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
  // Novita media seam, generic I2V wrapper, Story Spine renderer, and ambient
  // LTX loop together.
  const root = process.cwd();
  const [media, i2v, lofi, storySpineRenderer, directRenderer] = await Promise.all([
    readFile(join(root, "src/lib/novitaMedia.ts"), "utf8"),
    readFile(join(root, "src/lib/i2v.ts"), "utf8"),
    readFile(join(root, "src/trigger/blocks/lofiBlocks.ts"), "utf8"),
    readFile(join(root, "src/trigger/blocks/novitaRenderBlocks.ts"), "utf8"),
    readFile(join(root, "src/lib/novitaDirectRender.ts"), "utf8"),
  ]);
  assert.match(media, /creativeAdapter\?: LtxCreativeAdapterInput/);
  assert.match(media, /creativeAdapter: args\.creativeAdapter/);
  assert.match(i2v, /creativeAdapter\?: LtxCreativeAdapterInput/);
  assert.match(i2v, /creativeAdapter: req\.creativeAdapter/);
  assert.match(lofi, /LtxCreativeAdapterInputSchema\.optional\(\)\.parse/);
  assert.match(lofi, /creativeAdapter,/);
  assert.match(storySpineRenderer, /LtxCreativeAdapterInputSchema\.optional\(\)\.parse\(ctx\.params\["creativeAdapter"\]\)/);
  assert.match(storySpineRenderer, /\.\.\.\(creativeAdapter \? \{ creativeAdapter \} : \{\}\)/);
  assert.match(directRenderer, /creativeAdapterStack:/);
  assert.match(directRenderer, /LTX_CREATIVE_ADAPTER_STACK_VERSION/);
  console.log("LTX creative adapter tests passed");
}

void main();
