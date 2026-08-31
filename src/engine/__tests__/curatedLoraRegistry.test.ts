import assert from "node:assert/strict";
import {
  CURATED_LORA_BENCHMARK_VERSION,
  OFFICIAL_LTX_LORA_CANDIDATES,
  assertCuratedLoraCandidate,
  assertCuratedLoraRegistry,
  assertSeriesLoraContinuityBinding,
  createCuratedLoraBenchmark,
  createSeriesLoraContinuityBinding,
  resolveCuratedLoraSelection,
  studioCuratedLtxCatalog,
  type CuratedLoraBenchmark,
  type CuratedLoraCandidate,
  type CuratedLoraLocalAsset,
  type CuratedLoraRuntimePin,
} from "../curatedLoraRegistry";

const ADAPTER_HASH = "a".repeat(64);
const BASE_HASH_25 = "b".repeat(64);
const BASE_HASH_23 = "c".repeat(64);
const CONTROL_HASH = "d".repeat(64);
const EVIDENCE_HASH = "e".repeat(64);
const REVISION = "f".repeat(40);
const LORA_ROOT = "/srv/comfyui/models/loras";

function styleCandidate(): CuratedLoraCandidate {
  return {
    id: "ltx-2.5-official-style-fixture",
    label: "Synthetic pinned official-style fixture",
    source: {
      publisher: "Lightricks",
      modelUrl: "https://huggingface.co/Lightricks/LTX-2.5",
      modelVersion: "LTX-2.5",
      fileName: "fixture-style.safetensors",
      immutableRevision: REVISION,
      sha256: ADAPTER_HASH,
      license: {
        id: "ltx-2-community-license",
        termsUrl: "https://github.com/Lightricks/LTX-2/blob/main/LICENSE.md",
        accessTermsRequireAcceptance: true,
      },
    },
    adapter: {
      adapterClass: "standard_lora",
      purpose: "style",
      requiresSeriesContinuity: false,
    },
    qualityRequirement: {
      metric: "visual_fidelity",
      minimumAdaptedScore: 8,
      minimumGainOverBaseline: 0.5,
    },
    compatibleRuntime: {
      baseModelIds: ["Lightricks/LTX-2.5"],
      baseModelVersions: ["2.5"],
      baseModelSha256: BASE_HASH_25,
      allowedLoaders: ["comfyui_lora"],
    },
    targetScopes: ["treatment", "channel"],
    supportedTreatments: ["anime_inspired_2d"],
    supportedFamilies: ["cinematic"],
    status: "curation_ready",
    notes: ["Test-only fixture proving the resolver contract; it is not a downloadable registry entry."],
  };
}

function unionControlCandidate(): CuratedLoraCandidate {
  const source = OFFICIAL_LTX_LORA_CANDIDATES.find((candidate) => candidate.id === "ltx-2.3-union-control-ic-lora");
  assert.ok(source);
  return {
    ...source,
    source: {
      ...source.source,
      immutableRevision: REVISION,
      sha256: ADAPTER_HASH,
    },
    compatibleRuntime: {
      ...source.compatibleRuntime,
      baseModelSha256: BASE_HASH_23,
    },
    status: "curation_ready",
  };
}

function subjectCandidate(): CuratedLoraCandidate {
  const base = styleCandidate();
  return {
    ...base,
    id: "ltx-2.5-official-subject-fixture",
    adapter: {
      adapterClass: "standard_lora",
      purpose: "subject",
      requiresSeriesContinuity: true,
    },
    targetScopes: ["channel"],
  };
}

function localAsset(candidate: CuratedLoraCandidate, hash = ADAPTER_HASH): CuratedLoraLocalAsset {
  return {
    candidateId: candidate.id,
    localPath: `${LORA_ROOT}/${candidate.id}.safetensors`,
    byteLength: 9_876,
    sha256: hash,
    sourceUrl: candidate.source.modelUrl,
    sourceVersion: candidate.source.modelVersion,
    sourceFileName: candidate.source.fileName,
    sourceImmutableRevision: REVISION,
    sourceLicenseId: "ltx-2-community-license",
    licenseAcceptedAt: "2026-08-22T00:00:00Z",
    verifiedAt: "2026-08-22T00:01:00Z",
  };
}

function runtime25(): CuratedLoraRuntimePin {
  return {
    baseModelId: "Lightricks/LTX-2.5",
    baseModelVersion: "2.5",
    baseModelSha256: BASE_HASH_25,
    loader: "comfyui_lora",
  };
}

function runtime23Ic(): CuratedLoraRuntimePin {
  return {
    baseModelId: "Lightricks/LTX-2.3",
    baseModelVersion: "2.3",
    baseModelSha256: BASE_HASH_23,
    loader: "comfyui_ltx_ic_lora",
  };
}

function benchmark(
  candidate: CuratedLoraCandidate,
  runtime: CuratedLoraRuntimePin,
  target: Parameters<typeof resolveCuratedLoraSelection>[0]["request"]["target"],
  qualityDelta: { metric: CuratedLoraCandidate["qualityRequirement"]["metric"]; baselineScore: number; adaptedScore: number } = {
    metric: candidate.qualityRequirement.metric,
    baselineScore: 7.4,
    adaptedScore: 8.2,
  },
): CuratedLoraBenchmark {
  const benchmarkTarget = target.scope === "channel"
    ? { scope: "channel" as const, family: target.family }
    : target.scope === "treatment"
      ? { scope: "treatment" as const, treatment: target.treatment }
      : { scope: "shot_control" as const, controlKind: target.control.kind };
  return createCuratedLoraBenchmark({
    version: CURATED_LORA_BENCHMARK_VERSION,
    benchmarkId: `${candidate.id}-benchmark`,
    candidateId: candidate.id,
    candidateSha256: ADAPTER_HASH,
    runtime,
    target: benchmarkTarget,
    suiteVersion: "treatment-qa/v1",
    visualVerdict: "pass",
    qualityDelta,
    evidenceManifestKey: `runs/benchmark/${candidate.id}/evidence.json`,
    evidenceSha256: EVIDENCE_HASH,
    reviewedAt: "2026-08-22T00:02:00Z",
    reviewedBy: "visual-qa",
  });
}

function resolve(input: {
  candidate: CuratedLoraCandidate;
  runtime: CuratedLoraRuntimePin;
  target: Parameters<typeof resolveCuratedLoraSelection>[0]["request"]["target"];
  assets?: readonly CuratedLoraLocalAsset[];
  benchmarks?: readonly CuratedLoraBenchmark[];
  series?: ReturnType<typeof createSeriesLoraContinuityBinding>;
}) {
  return resolveCuratedLoraSelection({
    request: {
      candidateId: input.candidate.id,
      strength: 0.6,
      runtime: input.runtime,
      target: input.target,
      ...(input.series ? { series: input.series } : {}),
    },
    localLoraRoot: LORA_ROOT,
    localAssets: input.assets ?? [localAsset(input.candidate)],
    benchmarks: input.benchmarks ?? [benchmark(input.candidate, input.runtime, input.target)],
    registry: [input.candidate],
  });
}

function main(): void {
  assertCuratedLoraRegistry();
  assert.ok(OFFICIAL_LTX_LORA_CANDIDATES.length >= 17, "the built-in catalog should cover the official quality/control families without admitting unverified weights");
  assert.ok(OFFICIAL_LTX_LORA_CANDIDATES.some((candidate) => candidate.adapter.adapterClass === "standard_lora"));
  assert.ok(OFFICIAL_LTX_LORA_CANDIDATES.some((candidate) => candidate.adapter.adapterClass === "ic_lora"));
  assert.ok(
    OFFICIAL_LTX_LORA_CANDIDATES.some((candidate) => candidate.adapter.adapterClass === "ic_lora" && candidate.adapter.controls.includes("depth")),
  );
  assert.ok(
    OFFICIAL_LTX_LORA_CANDIDATES.some((candidate) => candidate.adapter.adapterClass === "ic_lora" && candidate.adapter.controls.includes("motion_track")),
  );
  assert.ok(
    OFFICIAL_LTX_LORA_CANDIDATES.some((candidate) => candidate.adapter.adapterClass === "ic_lora" && candidate.adapter.controls.includes("restoration_video")),
    "the quality catalogue must include a dedicated restoration family rather than treating it as a style adapter",
  );
  assert.ok(
    OFFICIAL_LTX_LORA_CANDIDATES.some((candidate) => candidate.adapter.adapterClass === "ic_lora" && candidate.adapter.controls.includes("hdr_video")),
  );
  assert.ok(
    OFFICIAL_LTX_LORA_CANDIDATES.some((candidate) => candidate.adapter.adapterClass === "ic_lora" && candidate.adapter.controls.includes("light_direction_video")),
    "the catalog should distinguish directed relighting from a generic colour preset",
  );
  assert.ok(
    OFFICIAL_LTX_LORA_CANDIDATES.some((candidate) => candidate.adapter.adapterClass === "ic_lora" && candidate.adapter.controls.includes("water_reference_video")),
    "the catalog should retain the dry-shot reference contract for water VFX",
  );
  assert.ok(
    OFFICIAL_LTX_LORA_CANDIDATES.some((candidate) => candidate.adapter.adapterClass === "ic_lora"
      && candidate.compatibleRuntime.baseModelVersions.includes("2.5")
      && candidate.adapter.controls.includes("spatial_upscale")),
    "the current-generation creative upscaler should be cataloged separately from the LTX-2.3 variant",
  );
  assert.ok(OFFICIAL_LTX_LORA_CANDIDATES.every((candidate) => candidate.source.modelUrl.startsWith("https://huggingface.co/Lightricks/")));
  assert.ok(OFFICIAL_LTX_LORA_CANDIDATES.every((candidate) => candidate.source.sha256 === null));
  const studioCatalog = studioCuratedLtxCatalog();
  assert.equal(studioCatalog.length, OFFICIAL_LTX_LORA_CANDIDATES.length);
  assert.ok(studioCatalog.some((candidate) => candidate.qualityPhase === "shot_control"));
  assert.ok(studioCatalog.some((candidate) => candidate.qualityPhase === "targeted_postprocess"));
  assert.ok(studioCatalog.some((candidate) => candidate.qualityPhase === "base_generation"));
  assert.ok(studioCatalog.every((candidate) => candidate.qualityMetric.length > 0));
  assert.ok(studioCatalog.some((candidate) => candidate.activationGate === "exact_runtime_and_benchmark"));
  assert.ok(studioCatalog.some((candidate) => candidate.activationGate === "pinned_asset_license_workflow_guide_and_benchmark"));
  assert.ok(studioCatalog.some((candidate) => candidate.activationGate === "pinned_asset_license_workflow_and_benchmark"));
  assert.ok(!studioCatalog.some((candidate) => candidate.activationGate === "pinned_asset_license_and_direct_benchmark"), "the official descriptor catalog has no direct-worker style LoRA pinned today");
  assert.ok(studioCatalog.every((candidate) => !Object.hasOwn(candidate, "localPath")));

  // An official URL and declared license alone must never resolve a runtime asset.
  const officialBlocked = resolveCuratedLoraSelection({
    request: {
      candidateId: "ltx-2.3-union-control-ic-lora",
      strength: 0.6,
      runtime: runtime23Ic(),
      target: {
        scope: "shot_control",
        shotId: "shot-0001",
        control: { kind: "depth", r2Key: "runs/test/depth.mp4", sha256: CONTROL_HASH, byteLength: 1_024 },
      },
    },
    localLoraRoot: LORA_ROOT,
    localAssets: [],
    benchmarks: [],
  });
  assert.equal(officialBlocked.status, "blocked");
  assert.ok(officialBlocked.blockers.some((blocker) => /immutable official source revision/i.test(blocker)));

  const style = styleCandidate();
  const descriptorOnly = resolve({
    candidate: { ...style, status: "descriptor_only_pending_integrity_pin" },
    runtime: runtime25(),
    target: { scope: "treatment", treatment: "anime_inspired_2d" },
  });
  assert.equal(descriptorOnly.status, "blocked");
  assert.ok(descriptorOnly.blockers.some((blocker) => /descriptor-only/i.test(blocker)));

  const styleResolved = resolve({
    candidate: style,
    runtime: runtime25(),
    target: { scope: "treatment", treatment: "anime_inspired_2d" },
  });
  assert.equal(styleResolved.status, "eligible");
  if (styleResolved.status === "eligible") {
    assert.equal(styleResolved.selection.adapterClass, "standard_lora");
    assert.equal(styleResolved.selection.adapterSha256, ADAPTER_HASH);
    assert.match(styleResolved.selection.fingerprint, /^[a-f0-9]{64}$/);
  }

  const insufficientQualityGain = resolve({
    candidate: style,
    runtime: runtime25(),
    target: { scope: "treatment", treatment: "anime_inspired_2d" },
    benchmarks: [benchmark(style, runtime25(), { scope: "treatment", treatment: "anime_inspired_2d" }, {
      metric: "visual_fidelity",
      baselineScore: 7.9,
      adaptedScore: 8.05,
    })],
  });
  assert.equal(insufficientQualityGain.status, "blocked");
  assert.ok(insufficientQualityGain.blockers.some((blocker) => /required 0.5 quality gain/i.test(blocker)));

  const styleWrongScope = resolve({
    candidate: style,
    runtime: runtime25(),
    target: {
      scope: "shot_control",
      shotId: "shot-0001",
      control: { kind: "depth", r2Key: "runs/test/depth.mp4", sha256: CONTROL_HASH, byteLength: 1_024 },
    },
  });
  assert.equal(styleWrongScope.status, "blocked");
  assert.ok(styleWrongScope.blockers.some((blocker) => /standard LoRA/i.test(blocker)));

  const union = unionControlCandidate();
  const unionResolved = resolve({
    candidate: union,
    runtime: runtime23Ic(),
    target: {
      scope: "shot_control",
      shotId: "shot-0007",
      control: { kind: "depth", r2Key: "runs/test/depth-control.mp4", sha256: CONTROL_HASH, byteLength: 2_048 },
    },
  });
  assert.equal(unionResolved.status, "eligible");
  if (unionResolved.status === "eligible") {
    assert.equal(unionResolved.selection.adapterClass, "ic_lora");
  }

  const relight = OFFICIAL_LTX_LORA_CANDIDATES.find((candidate) => candidate.id === "ltx-2.3-relight-ic-lora");
  assert.ok(relight && relight.adapter.adapterClass === "ic_lora");
  if (relight && relight.adapter.adapterClass === "ic_lora") {
    const relightBenchmark = benchmark(
      relight,
      runtime23Ic(),
      { scope: "shot_control", shotId: "shot-relight", control: { kind: "light_direction_video", r2Key: "runs/test/relight.mp4", sha256: CONTROL_HASH, byteLength: 1_024 } },
    );
    assert.equal(relightBenchmark.target.scope, "shot_control");
    if (relightBenchmark.target.scope === "shot_control") {
      assert.equal(relightBenchmark.target.controlKind, "light_direction_video");
    }
  }

  const unionWrongScope = resolve({
    candidate: union,
    runtime: runtime23Ic(),
    target: { scope: "treatment", treatment: "anime_inspired_2d" },
  });
  assert.equal(unionWrongScope.status, "blocked");
  assert.ok(unionWrongScope.blockers.some((blocker) => /IC-LoRA/i.test(blocker)));

  const badHash = resolve({
    candidate: style,
    runtime: runtime25(),
    target: { scope: "treatment", treatment: "anime_inspired_2d" },
    assets: [localAsset(style, "0".repeat(64))],
  });
  assert.equal(badHash.status, "blocked");
  assert.ok(badHash.blockers.some((blocker) => /does not match its reviewed official source pin/i.test(blocker)));

  const tamperedTarget = { scope: "treatment" as const, treatment: "anime_inspired_2d" as const };
  const tampered = benchmark(style, runtime25(), tamperedTarget);
  const benchmarkTamper = resolve({
    candidate: style,
    runtime: runtime25(),
    target: { scope: "treatment", treatment: "anime_inspired_2d" },
    benchmarks: [{ ...tampered, evidenceSha256: CONTROL_HASH }],
  });
  assert.equal(benchmarkTamper.status, "blocked");
  assert.ok(benchmarkTamper.blockers.some((blocker) => /fingerprint/i.test(blocker)));

  const subject = subjectCandidate();
  const subjectWithoutSeries = resolve({
    candidate: subject,
    runtime: runtime25(),
    target: { scope: "channel", channelId: "channel-aurora", family: "cinematic" },
  });
  assert.equal(subjectWithoutSeries.status, "blocked");
  assert.ok(subjectWithoutSeries.blockers.some((blocker) => /series continuity binding/i.test(blocker)));

  const series = createSeriesLoraContinuityBinding({
    seriesIdentity: "series-aurora",
    episodeNumber: 4,
    routeFingerprint: "1".repeat(64),
    serializedContextFingerprint: "2".repeat(64),
  });
  assertSeriesLoraContinuityBinding(series);
  const subjectWithSeries = resolve({
    candidate: subject,
    runtime: runtime25(),
    target: { scope: "channel", channelId: "channel-aurora", family: "cinematic" },
    series,
  });
  assert.equal(subjectWithSeries.status, "eligible");
  if (subjectWithSeries.status === "eligible") {
    assert.equal(subjectWithSeries.selection.seriesBindingFingerprint, series.fingerprint);
  }

  assert.throws(
    () => assertCuratedLoraCandidate({
      ...style,
      source: { ...style.source, modelUrl: "https://civitai.com/models/untrusted" },
    }),
    /official Lightricks model/i,
    "community sources must never enter the curated registry",
  );

  console.log("CURATED LORA REGISTRY PASS");
}

main();
