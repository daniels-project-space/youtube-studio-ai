import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CURATED_LORA_BENCHMARK_VERSION,
  createCuratedLoraBenchmark,
  resolveCuratedLoraSelection,
  type CuratedLoraCandidate,
  type CuratedLoraLocalAsset,
} from "@/engine/curatedLoraRegistry";
import {
  COMFY_IC_LORA_BENCHMARK_EVIDENCE_VERSION,
  COMFY_IC_LORA_DEDICATED_BENCHMARK_VERSION,
  CURRENT_DIRECT_NOVITA_LTX_PIPELINES_BOUNDARY,
  admitComfyIcloraPreSpend,
  assertComfyIcloraRuntimePin,
  comfyIcloraSpendIntentFingerprint,
  createComfyIcloraLicenseAcceptance,
  createComfyIcloraBenchmarkEvidence,
  createComfyIcloraPreSpendReservation,
  createComfyIcloraDedicatedBenchmark,
  createComfyIcloraRuntimePin,
  createComfyIcloraShotBinding,
  createComfyIcloraWorkflowPin,
} from "@/engine/comfyIcloraWorkerContract";
import { planVisualTreatment } from "@/engine/visualTreatmentCatalog";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

const digest = (character: string) => character.repeat(64);
const revision = (character: string) => character.repeat(40);

const ADAPTER_HASH = digest("a");
const BASE_MODEL_HASH = digest("b");
const CONTROL_HASH = digest("c");
const RECEIPT_HASH = digest("d");
const SOURCE_REVISION = revision("e");

function shotControlFixture() {
  const core = {
    version: "narrative-shot-control/v1" as const,
    episodeBindingFingerprint: digest("1"),
    immutableProjectBriefFingerprint: digest("2"),
    visualStyle: "brick_animation" as const,
    visualStyleProfileFingerprint: digest("3"),
    castLocks: [],
    locationLocks: [],
    requiredAdapterCapabilities: [
      "reusable_cast_or_character_adapter",
      "first_frame_conditioning",
      "last_frame_continuation",
      "camera_lens_motion_controls",
    ] as const,
    shots: [{
      shotId: "shot-depth-001",
      continuityCharacterIds: ["character-mira"],
      locationId: "setting-workshop",
      cameraMove: "slow push toward Mira's worktable",
      lens: "35mm equivalent",
      motion: "Mira turns toward the table with controlled stop-motion timing.",
      firstFrameConstraint: "Mira is beside the workshop table with a stable brick-built silhouette.",
      lastFrameConstraint: "Mira points toward the completed model on the same workshop table.",
      continuityState: "Keep Mira's yellow jacket, green satchel, and the workshop geometry unchanged.",
    }],
  };
  return { ...core, fingerprint: sha256Hex(canonicalJson(core)) };
}

function icCandidate(): CuratedLoraCandidate {
  return {
    id: "ltx-2.3-union-depth-fixture",
    label: "Pinned official IC-LoRA depth fixture",
    source: {
      publisher: "Lightricks",
      modelUrl: "https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Union-Control",
      modelVersion: "LTX-2.3",
      fileName: "ltx-2.3-union-depth-fixture.safetensors",
      immutableRevision: SOURCE_REVISION,
      sha256: ADAPTER_HASH,
      license: {
        id: "ltx-2-community-license",
        termsUrl: "https://github.com/Lightricks/LTX-2/blob/main/LICENSE.md",
        accessTermsRequireAcceptance: true,
      },
    },
    adapter: { adapterClass: "ic_lora", controls: ["depth"], requiresControlArtifact: true },
    qualityRequirement: {
      metric: "structural_adherence",
      minimumAdaptedScore: 8,
      minimumGainOverBaseline: 0.5,
    },
    compatibleRuntime: {
      baseModelIds: ["Lightricks/LTX-2.3"],
      baseModelVersions: ["2.3"],
      baseModelSha256: BASE_MODEL_HASH,
      allowedLoaders: ["comfyui_ltx_ic_lora"],
    },
    targetScopes: ["shot_control"],
    supportedTreatments: ["brick_built_stop_motion"],
    supportedFamilies: ["cinematic"],
    status: "curation_ready",
    notes: ["Pure fixture only; no asset is downloaded by this test."],
  };
}

function localAsset(candidate: CuratedLoraCandidate): CuratedLoraLocalAsset {
  return {
    candidateId: candidate.id,
    localPath: `/srv/comfyui/models/loras/${candidate.id}.safetensors`,
    byteLength: 9_876,
    sha256: ADAPTER_HASH,
    sourceUrl: candidate.source.modelUrl,
    sourceVersion: candidate.source.modelVersion,
    sourceFileName: candidate.source.fileName,
    sourceImmutableRevision: SOURCE_REVISION,
    sourceLicenseId: "ltx-2-community-license",
    licenseAcceptedAt: "2026-08-22T00:00:00Z",
    verifiedAt: "2026-08-22T00:01:00Z",
  };
}

function fixture() {
  const candidate = icCandidate();
  const runtime = createComfyIcloraRuntimePin({
    version: "comfyui-ltx-ic-lora-runtime-pin/v3",
    executionPath: "dedicated_comfyui_ltx_ic_lora",
    loader: "comfyui_ltx_ic_lora",
    provider: "novita",
    requiredGpuSku: "RTX 5090",
    workerImage: `ghcr.io/example/comfy-ltx@sha256:${digest("4")}`,
    workerOverlaySha256: digest("5"),
    runtimeBundleKey: "novita/runtime/comfy-ltx/fixture.tar.gz",
    runtimeBundleSha256: digest("6"),
    comfyUiSource: { repository: "comfyanonymous/ComfyUI", immutableRevision: revision("7") },
    comfyLtxVideoSource: { repository: "Lightricks/ComfyUI-LTXVideo", immutableRevision: revision("8") },
    ltxRuntimeSource: { repository: "Lightricks/LTX-2", immutableRevision: revision("9") },
    baseModel: {
      modelId: "Lightricks/LTX-2.3",
      modelVersion: "2.3",
      modelImmutableRevision: revision("f"),
      modelSha256: BASE_MODEL_HASH,
    },
    minimumVramGb: 32,
  });
  const workflow = createComfyIcloraWorkflowPin({
    version: "comfyui-ltx-ic-lora-workflow-pin/v1",
    workflowId: "ltx-2.5-iclora-union-control-distilled",
    workflowSource: { repository: "Lightricks/ComfyUI-LTXVideo", immutableRevision: revision("8") },
    workflowBlobPath: "workflows/ltx-2.3-union-depth-api.json",
    workflowBlobSha256: digest("a"),
    workflowGraphSha256: digest("b"),
    runtimeFingerprint: runtime.fingerprint,
    requiredGuideKinds: ["depth"],
    supportedTreatments: ["brick_built_stop_motion"],
    supportedFamilies: ["cinematic"],
  });
  const guide = {
    kind: "depth" as const,
    r2Key: "runs/run-001/visual/depth-guide.png",
    sha256: CONTROL_HASH,
    byteLength: 2_048,
    mediaType: "image/png",
    artifactReceiptFingerprint: RECEIPT_HASH,
    shotId: "shot-depth-001",
    shotControlFingerprint: shotControlFixture().fingerprint,
  };
  const existingBenchmark = createCuratedLoraBenchmark({
    version: CURATED_LORA_BENCHMARK_VERSION,
    benchmarkId: "curated-union-depth-001",
    candidateId: candidate.id,
    candidateSha256: ADAPTER_HASH,
    runtime: {
      baseModelId: "Lightricks/LTX-2.3",
      baseModelVersion: "2.3",
      baseModelSha256: BASE_MODEL_HASH,
      loader: "comfyui_ltx_ic_lora",
    },
    target: { scope: "shot_control", controlKind: "depth" },
    suiteVersion: "treatment-qa/v1",
    visualVerdict: "pass",
    qualityDelta: {
      metric: "structural_adherence",
      baselineScore: 7.3,
      adaptedScore: 8.2,
    },
    evidenceManifestKey: "benchmarks/curated-union-depth/evidence.json",
    evidenceSha256: RECEIPT_HASH,
    reviewedAt: "2026-08-22T00:02:00Z",
    reviewedBy: "visual-qa",
  });
  const resolved = resolveCuratedLoraSelection({
    request: {
      candidateId: candidate.id,
      strength: 0.6,
      runtime: {
        baseModelId: "Lightricks/LTX-2.3",
        baseModelVersion: "2.3",
        baseModelSha256: BASE_MODEL_HASH,
        loader: "comfyui_ltx_ic_lora",
      },
      target: {
        scope: "shot_control",
        shotId: guide.shotId,
        control: { kind: guide.kind, r2Key: guide.r2Key, sha256: guide.sha256, byteLength: guide.byteLength },
      },
    },
    localLoraRoot: "/srv/comfyui/models/loras",
    localAssets: [localAsset(candidate)],
    benchmarks: [existingBenchmark],
    registry: [candidate],
  });
  assert.equal(resolved.status, "eligible");
  if (resolved.status !== "eligible") throw new Error("fixture must resolve an existing curated IC-LoRA selection");

  const shotControl = shotControlFixture();
  const binding = createComfyIcloraShotBinding({
    family: "cinematic",
    treatmentPlan: planVisualTreatment("brick_built_stop_motion"),
    shotControl,
    shotId: guide.shotId,
  });
  const licenseAcceptance = createComfyIcloraLicenseAcceptance({
    version: "comfyui-ltx-ic-lora-license-acceptance/v1",
    candidateId: candidate.id,
    licenseId: "ltx-2-community-license",
    termsUrl: candidate.source.license.termsUrl,
    sourceImmutableRevision: SOURCE_REVISION,
    sourceSha256: ADAPTER_HASH,
    acceptedBy: "operator-001",
    acceptedAt: "2026-08-22T00:03:00Z",
    acceptanceReceiptFingerprint: digest("c"),
  });
  const benchmark = createComfyIcloraDedicatedBenchmark({
    version: COMFY_IC_LORA_DEDICATED_BENCHMARK_VERSION,
    benchmarkId: "comfy-union-depth-dedicated-001",
    runtimeFingerprint: runtime.fingerprint,
    workflowFingerprint: workflow.fingerprint,
    candidateId: candidate.id,
    candidateSourceImmutableRevision: SOURCE_REVISION,
    candidateSourceSha256: ADAPTER_HASH,
    adapterSha256: ADAPTER_HASH,
    curatedSelectionBenchmarkFingerprint: resolved.selection.benchmarkFingerprint,
    family: "cinematic",
    treatmentKey: "brick_built_stop_motion",
    treatmentPlanFingerprint: planVisualTreatment("brick_built_stop_motion").fingerprint,
    requiredTreatmentCriterionIds: planVisualTreatment("brick_built_stop_motion").qaBenchmarks
      .map((criterion) => `visual-treatment/brick_built_stop_motion/${criterion.id}`),
    controlKind: "depth",
    gpuSku: "RTX 5090",
    vramGb: 32,
    terminalStatus: "complete",
    visualVerdict: "pass",
    evidence: createComfyIcloraBenchmarkEvidence({
      version: COMFY_IC_LORA_BENCHMARK_EVIDENCE_VERSION,
      treatmentKey: "brick_built_stop_motion",
      treatmentPlanFingerprint: planVisualTreatment("brick_built_stop_motion").fingerprint,
      controlKind: "depth",
      evidenceManifestKey: "benchmarks/comfy-union-depth/evidence.json",
      immutableEvidenceObjectVersionId: "r2-version-ic-lora-001",
      evidenceSha256: digest("d"),
      guideArtifact: guide,
      outputVideo: {
        r2Key: "benchmarks/comfy-union-depth/output.mp4",
        sha256: digest("1"),
        byteLength: 1_024_000,
        durationMs: 5_000,
        artifactReceiptFingerprint: digest("2"),
      },
      visualReviewReceiptFingerprint: digest("3"),
      reviewedVideoSha256: digest("1"),
      criterionEvidence: planVisualTreatment("brick_built_stop_motion").qaBenchmarks.map((criterion) => ({
        id: `visual-treatment/brick_built_stop_motion/${criterion.id}`,
        scope: criterion.scope,
        verdict: "pass" as const,
        reviewFrameArtifactIds: [`frame-${criterion.id}-001`],
      })),
    }),
    reviewedAt: "2026-08-22T00:04:00Z",
    reviewedBy: "visual-qa",
  });
  const spendIntentFingerprint = comfyIcloraSpendIntentFingerprint({
    runtime,
    workflow,
    selection: resolved.selection,
    license: licenseAcceptance,
    binding,
    guides: [guide],
    benchmark,
  });
  const preSpendReservation = createComfyIcloraPreSpendReservation({
    version: "comfyui-ltx-ic-lora-pre-spend-reservation/v2",
    reservationId: "reservation-comfy-001",
    spendIntentFingerprint,
    budgetLedgerFingerprint: digest("e"),
    reservationReceiptFingerprint: digest("f"),
    spendCapCents: 500,
    reservedCents: 400,
    status: "reserved",
    reviewedBy: "budget-reviewer",
    reviewedAt: "2026-08-22T00:05:00Z",
  });
  return { runtime, workflow, candidate, selection: resolved.selection, guide, binding, shotControl, licenseAcceptance, benchmark, preSpendReservation };
}

function request(value: ReturnType<typeof fixture>) {
  return {
    runtime: value.runtime,
    workflow: value.workflow,
    candidate: value.candidate,
    selection: value.selection,
    licenseAcceptance: value.licenseAcceptance,
    shotBinding: value.binding,
    shotControl: value.shotControl,
    guideArtifacts: [value.guide],
    benchmark: value.benchmark,
    preSpendReservation: value.preSpendReservation,
  };
}

function main(): void {
  const value = fixture();
  const directWorkerSource = readFileSync("infra/novita/worker.py", "utf8");
  assert(directWorkerSource.includes(`LTX_REVISION = ${JSON.stringify(CURRENT_DIRECT_NOVITA_LTX_PIPELINES_BOUNDARY.baseModelImmutableRevision)}`));
  assert(directWorkerSource.includes(`LTX_RUNTIME_REVISION = ${JSON.stringify(CURRENT_DIRECT_NOVITA_LTX_PIPELINES_BOUNDARY.runtimeRevision)}`));
  assert.match(directWorkerSource, /"ltx_pipelines\.distilled"/u, "the current worker remains the direct ltx_pipelines path");
  assert.match(directWorkerSource, /"--lora"/u, "the current worker exposes only the standard LoRA CLI path");

  const admitted = admitComfyIcloraPreSpend(request(value));
  assert.equal(admitted.status, "eligible_for_reserved_spend");
  if (admitted.status !== "eligible_for_reserved_spend") throw new Error("fixture should satisfy every sealed pre-spend proof");
  assert.equal(admitted.workOrder.guideArtifacts[0]?.r2Key, value.guide.r2Key);
  assert.equal(admitted.workOrder.guideArtifacts[0]?.sha256, CONTROL_HASH);
  assert.equal(admitted.workOrder.provider, "novita");
  assert.equal(admitted.workOrder.requiredGpuSku, "RTX 5090");
  assert.doesNotMatch(JSON.stringify(admitted.workOrder), /data:image|base64|rawBytes/i, "work orders may retain artifact metadata but never reference bytes");

  const { fingerprint: _benchmarkFingerprint, ...benchmarkCore } = value.benchmark;
  void _benchmarkFingerprint;
  const { fingerprint: _benchmarkEvidenceFingerprint, ...benchmarkEvidenceCore } = benchmarkCore.evidence;
  void _benchmarkEvidenceFingerprint;
  assert.throws(
    () => createComfyIcloraDedicatedBenchmark({
      ...benchmarkCore,
      gpuSku: "RTX 4090",
      vramGb: 32,
    }),
    /required RTX 5090 Novita worker/i,
    "a 32 GB GPU that is not the sealed RTX 5090 worker may not claim IC-LoRA quality support",
  );
  assert.throws(
    () => createComfyIcloraDedicatedBenchmark({
      ...benchmarkCore,
      requiredTreatmentCriterionIds: benchmarkCore.requiredTreatmentCriterionIds.slice(1),
    }),
    /complete canonical treatment review rubric/i,
    "a dedicated IC-LoRA benchmark may not omit a difficult treatment-specific QA criterion",
  );
  assert.throws(
    () => createComfyIcloraDedicatedBenchmark({
      ...benchmarkCore,
      treatmentPlanFingerprint: digest("0"),
    }),
    /canonical treatment QA plan/i,
    "a benchmark must be invalidated when its treatment QA plan changes",
  );
  assert.throws(
    () => createComfyIcloraDedicatedBenchmark({
      ...benchmarkCore,
      evidence: createComfyIcloraBenchmarkEvidence({
        ...benchmarkEvidenceCore,
        reviewedVideoSha256: digest("0"),
      }),
    }),
    /review does not bind the retained benchmark video bytes/i,
    "a benchmark review may not certify video bytes other than the retained output",
  );
  assert.throws(
    () => createComfyIcloraDedicatedBenchmark({
      ...benchmarkCore,
      evidence: createComfyIcloraBenchmarkEvidence({
        ...benchmarkEvidenceCore,
        criterionEvidence: benchmarkEvidenceCore.criterionEvidence.slice(1),
      }),
    }),
    /retain passing witnesses for every treatment criterion/i,
    "a benchmark may not hide a failed or unreviewed treatment requirement in an aggregate pass",
  );

  const { fingerprint: _runtimeFingerprint, ...runtimeCore } = value.runtime;
  void _runtimeFingerprint;
  assert.throws(
    () => assertComfyIcloraRuntimePin({
      ...runtimeCore,
      executionPath: CURRENT_DIRECT_NOVITA_LTX_PIPELINES_BOUNDARY.executionPath,
      loader: CURRENT_DIRECT_NOVITA_LTX_PIPELINES_BOUNDARY.loader,
      fingerprint: digest("0"),
    }),
    /rejects the existing direct Novita ltx_pipelines worker/i,
    "the direct LTX pipeline worker must never be accepted as a Comfy IC-LoRA runtime",
  );
  const directWorker = admitComfyIcloraPreSpend({
    ...request(value),
    runtime: {
      ...runtimeCore,
      executionPath: CURRENT_DIRECT_NOVITA_LTX_PIPELINES_BOUNDARY.executionPath,
      loader: CURRENT_DIRECT_NOVITA_LTX_PIPELINES_BOUNDARY.loader,
      fingerprint: digest("0"),
    },
  });
  assert.equal(directWorker.status, "blocked");
  if (directWorker.status === "blocked") assert(directWorker.blockers.some((blocker) => /direct Novita ltx_pipelines/i.test(blocker)));

  const standardLoRA = admitComfyIcloraPreSpend({
    ...request(value),
    selection: { ...value.selection, adapterClass: "standard_lora" },
  });
  assert.equal(standardLoRA.status, "blocked");
  if (standardLoRA.status === "blocked") assert(standardLoRA.blockers.some((blocker) => /rejects standard LoRA/i.test(blocker)));

  const standardCandidate: CuratedLoraCandidate = {
    ...value.candidate,
    id: "ltx-standard-fixture",
    adapter: { adapterClass: "standard_lora", purpose: "style", requiresSeriesContinuity: false },
    targetScopes: ["treatment"],
  };
  const standardCandidateAdmission = admitComfyIcloraPreSpend({ ...request(value), candidate: standardCandidate });
  assert.equal(standardCandidateAdmission.status, "blocked");
  if (standardCandidateAdmission.status === "blocked") {
    assert(standardCandidateAdmission.blockers.some((blocker) => /rejects standard LoRA candidates/i.test(blocker)));
  }

  const { fingerprint: _workflowFingerprint, ...workflowCore } = value.workflow;
  void _workflowFingerprint;
  const wrongControlWorkflow = createComfyIcloraWorkflowPin({
    ...workflowCore,
    workflowId: "ltx-2.5-iclora-ingredients-single-stage-distilled",
  });
  const wrongControlWorkflowAdmission = admitComfyIcloraPreSpend({
    ...request(value),
    workflow: wrongControlWorkflow,
  });
  assert.equal(wrongControlWorkflowAdmission.status, "blocked");
  if (wrongControlWorkflowAdmission.status === "blocked") {
    assert(
      wrongControlWorkflowAdmission.blockers.some((blocker) => /not appropriate for the selected control kind/i.test(blocker)),
      "an official reference-sheet graph must not be repurposed as a depth-control graph",
    );
  }

  const foreignSourceWorkflow = createComfyIcloraWorkflowPin({
    ...workflowCore,
    workflowSource: { ...value.workflow.workflowSource, repository: "unverified/example-workflow" },
  });
  const foreignSourceWorkflowAdmission = admitComfyIcloraPreSpend({
    ...request(value),
    workflow: foreignSourceWorkflow,
  });
  assert.equal(foreignSourceWorkflowAdmission.status, "blocked");
  if (foreignSourceWorkflowAdmission.status === "blocked") {
    assert(
      foreignSourceWorkflowAdmission.blockers.some((blocker) => /official ComfyUI-LTXVideo source/i.test(blocker)),
      "an official-looking workflow identifier may not mask an unrelated workflow source",
    );
  }

  const changedRuntime = createComfyIcloraRuntimePin({
    ...runtimeCore,
    comfyUiSource: { ...value.runtime.comfyUiSource, immutableRevision: revision("0") },
  });
  const revisionMismatch = admitComfyIcloraPreSpend({ ...request(value), runtime: changedRuntime });
  assert.equal(revisionMismatch.status, "blocked");
  if (revisionMismatch.status === "blocked") assert(revisionMismatch.blockers.some((blocker) => /workflow runtime fingerprint does not match/i.test(blocker)));

  const mismatchedGuide = admitComfyIcloraPreSpend({
    ...request(value),
    guideArtifacts: [{ ...value.guide, sha256: digest("0") }],
  });
  assert.equal(mismatchedGuide.status, "blocked");
  if (mismatchedGuide.status === "blocked") assert(mismatchedGuide.blockers.some((blocker) => /control bytes do not exactly match/i.test(blocker)));

  const detachedCuratedBenchmark = createComfyIcloraDedicatedBenchmark({
    ...benchmarkCore,
    curatedSelectionBenchmarkFingerprint: digest("0"),
  });
  const detachedBenchmark = admitComfyIcloraPreSpend({ ...request(value), benchmark: detachedCuratedBenchmark });
  assert.equal(detachedBenchmark.status, "blocked");
  if (detachedBenchmark.status === "blocked") {
    assert(detachedBenchmark.blockers.some((blocker) => /benchmark evidence does not exactly bind/i.test(blocker)));
  }

  console.log("COMFY IC-LORA WORKER CONTRACT PASS");
}

main();
