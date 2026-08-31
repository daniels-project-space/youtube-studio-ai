import assert from "node:assert/strict";

import { CINEMATIC_CASE_SEQUENCE_VERSION } from "@/engine/cinematicCaseSequence";
import { CINEMATIC_CLIP_REVIEW_VERSION } from "@/engine/cinematicClipReview";
import { CINEMATIC_KEYFRAME_REVIEW_VERSION } from "@/engine/cinematicKeyframeReview";
import { CINEMATIC_TRANSITION_REVIEW_VERSION } from "@/engine/cinematicTransitionReview";
import { GENERATED_FOOTAGE_SCENE_MANIFEST_VERSION } from "@/engine/generatedFootageManifest";
import {
  classifyVisualSequenceEvidenceRejection,
  captureLocalVisualSequenceArtifactManifest,
  createCasefileCinematicVisualSequenceContract,
  createStandardNovitaVisualSequenceContract,
  createVisualSequenceEvidenceOmission,
  deriveVisualSequenceEvidenceLedger,
  standardNovitaVisualSequenceFingerprint,
  verifyVisualSequenceArtifactManifestObjects,
} from "@/engine/visualSequenceContract";
import {
  assertFinalMasterReleaseCertificate,
  createFinalMasterReleaseCertificate,
  FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
} from "@/lib/finalMasterReleaseCertificate";

const generation = {
  contractVersion: "1.0.0" as const,
  profileId: "production" as const,
  model: "ltx-video",
  revision: "a".repeat(40),
  checkpoint: "pinned-checkpoint",
  precision: "bf16" as const,
  width: 1280,
  height: 704,
  steps: 30,
  allowFallback: false as const,
  fps: 24,
  guidanceScale: 3,
  pipeline: "distilled" as const,
  twoStageRefine: true as const,
  textEncoderCheckpoint: "text-encoder",
  videoVaeCheckpoint: "video-vae",
  audioVaeCheckpoint: "audio-vae",
  spatialUpscalerCheckpoint: "spatial-upscaler",
  quantization: "fp8-cast" as const,
  offload: "cpu" as const,
  spatialUpscaleFactor: 2 as const,
  stageOneWidth: 640,
  stageOneHeight: 352,
  outputWidth: 1280,
  outputHeight: 704,
};

const renderManifest = {
  version: "1.0.0" as const,
  generation,
  durationSec: 6,
  items: [
    {
      shotId: "shot-one",
      clipKey: "owner/test/runs/run-1/novita/shot-one.mp4",
      t0: 0,
      t1: 3,
      sourceSentenceIds: ["sentence-1"],
      continuityState: "station-night",
    },
    {
      shotId: "shot-two",
      clipKey: "owner/test/runs/run-1/novita/shot-two.mp4",
      t0: 3,
      t1: 6,
      sourceSentenceIds: ["sentence-2"],
      continuityState: "station-night",
    },
  ],
};

const shotQaReport = {
  version: "1.0.0" as const,
  required: true as const,
  graderRan: true as const,
  passed: true as const,
  shots: renderManifest.items.map((item) => ({
    shotId: item.shotId,
    score: 0.94,
    threshold: 0.9,
    semanticAlignment: 0.95,
    continuity: 0.94,
    motionIntegrity: 0.93,
    artifactFree: 0.96,
    notes: [],
  })),
};

const visualCoverage = {
  version: "1.0.0" as const,
  mappedSec: 6,
  totalSec: 6,
  ratio: 1 as const,
  missingShotIds: [],
  duplicateShotIds: [],
};

const finalMaster = {
  sha256: "b".repeat(64),
  byteLength: 12_345,
  durationSec: 6,
};

const visualReview = {
  evidenceManifestKey: "owner/test/runs/run-1/visual-review/manifest.json",
  reviewFingerprint: "review-1",
  reviewReceiptVersion: "visual-review-release/v1",
  reviewReceiptFingerprint: "c".repeat(64),
  releaseReceiptFingerprint: "d".repeat(64),
  source: {
    sha256: finalMaster.sha256,
    durationSec: 6,
  },
  frameArtifacts: [
    {
      r2Key: "owner/test/runs/run-1/visual-review/frames/f001.jpg",
      contentSha256: "e".repeat(64),
      byteLength: 100,
    },
    {
      r2Key: "owner/test/runs/run-1/visual-review/frames/f002.jpg",
      contentSha256: "f".repeat(64),
      byteLength: 101,
    },
  ],
};

const casefileFingerprint = "8".repeat(64);
const casefileScenes = [0, 1].map((index) => ({
  id: "cinematic-shot-casefile-" + String(index + 1),
  sequenceBeatId: "cinematic-beat-casefile",
  parentShotIds: ["shot-casefile-parent"],
  claimIds: ["claim-casefile"],
  sourceIds: ["source-casefile"],
  t0: index * 3,
  t1: (index + 1) * 3,
  durationSec: 3,
  still: "Anonymous evidence reconstruction with a cited archival object.",
  motion: "A restrained motivated camera move preserves anonymous mannequin continuity.",
  diegeticSoundscape: "Only visible evidence-object room tone; no dialogue, narration, or score.",
  negative: "no text, no real-person likeness, no gore",
  cameraMove: index === 0 ? "dolly_push" as const : "truck_left" as const,
  shotScale: index === 0 ? "close" as const : "wide" as const,
  lens: "50mm",
  visualMode: "source_proof" as const,
  coveragePurpose: "evidence_insert" as const,
  cutReason: index === 0 ? "new_fact" as const : "reveal" as const,
  tensionState: index === 0 ? "pressure" as const : "reversal" as const,
  castIds: index === 0 ? [] : ["mannequin-investigator"],
  continuitySeed: index + 1,
}));

const casefileArgs = {
  scenePlan: {
    version: CINEMATIC_CASE_SEQUENCE_VERSION,
    sequenceFingerprint: casefileFingerprint,
    sourcePacketFingerprint: "3".repeat(64),
    evidenceShotMapFingerprint: "4".repeat(64),
    durationSec: 6,
    scenes: casefileScenes,
    release: "private_human_editorial_review_only" as const,
  },
  editDecisionList: {
    version: CINEMATIC_CASE_SEQUENCE_VERSION,
    sequenceFingerprint: casefileFingerprint,
    durationSec: 6,
    edits: casefileScenes.map((scene) => ({
      shotId: scene.id,
      t0: scene.t0,
      t1: scene.t1,
      cutReason: scene.cutReason,
      tensionState: scene.tensionState,
      narrationPurpose: "Advance the supported causal question with a motivated visual turn.",
    })),
  },
  footageManifest: {
    version: GENERATED_FOOTAGE_SCENE_MANIFEST_VERSION,
    source: "cinematic_case_sequence" as const,
    sequenceFingerprint: casefileFingerprint,
    exactOrder: true as const,
    durationSec: 6,
    items: casefileScenes.map((scene, index) => ({
      sceneId: scene.id,
      clipKey: "owner/test/runs/casefile/" + scene.id + ".mp4",
      t0: scene.t0,
      t1: scene.t1,
      continuitySeed: scene.continuitySeed,
      keyframeReview: {
        version: CINEMATIC_KEYFRAME_REVIEW_VERSION,
        reviewer: "non_google_vision" as const,
        sceneId: scene.id,
        reviewedAgainstSceneIds: [],
        expectedCastIds: scene.castIds,
        forbidAdditionalPeople: true as const,
        onlyExpectedCastVisible: true as const,
        semanticAlignment: 0.9,
        composition: 0.9,
        continuity: 0.9,
        artifactFree: 0.9,
        textWatermarkFree: true as const,
        pass: true as const,
        notes: ["Independent keyframe gate accepted the source frame."],
      },
      clipReview: {
        version: CINEMATIC_CLIP_REVIEW_VERSION,
        reviewer: "non_google_vision" as const,
        sceneId: scene.id,
        sampleOffsetsSec: [0.2, 1.5, 2.8],
        expectedCastIds: scene.castIds,
        forbidAdditionalPeople: true as const,
        onlyExpectedCastVisible: true as const,
        semanticAlignment: 0.9,
        motionIntegrity: 0.9,
        continuity: 0.9,
        endBeat: 0.9,
        artifactFree: 0.9,
        textWatermarkFree: true as const,
        pass: true as const,
        notes: ["Independent clip gate accepted the actual LTX take."],
      },
      ...(index < casefileScenes.length - 1 ? {
        transitionToNextReview: {
          version: CINEMATIC_TRANSITION_REVIEW_VERSION,
          reviewer: "non_google_vision" as const,
          fromSceneId: scene.id,
          toSceneId: casefileScenes[index + 1]!.id,
          cutReason: casefileScenes[index + 1]!.cutReason,
          tensionState: casefileScenes[index + 1]!.tensionState,
          semanticContinuity: 0.9,
          visualProgression: 0.9,
          cutMotivation: 0.9,
          artifactFree: 0.9,
          textWatermarkFree: true as const,
          pass: true as const,
          notes: ["The outgoing proof frame motivates the incoming reveal."],
        },
      } : {}),
    })),
  },
  narrationDurationSec: 6,
};

async function main(): Promise<void> {
  const localPaths: string[] = [];
  let remoteCalls = 0;
  const artifactManifest = await captureLocalVisualSequenceArtifactManifest({
    source: "standard_novita",
    sequenceFingerprint: standardNovitaVisualSequenceFingerprint(renderManifest),
    items: [
      {
        id: "shot-one",
        r2Key: "owner/test/runs/run-1/novita/shot-one-repaired.mp4",
        localPath: "/tmp/accepted-shot-one.mp4",
      },
      {
        id: "shot-two",
        r2Key: "owner/test/runs/run-1/novita/shot-two.mp4",
        localPath: "/tmp/accepted-shot-two.mp4",
      },
    ],
    getLocalFileIntegrity: async (localPath) => {
      localPaths.push(localPath);
      return localPath.includes("one")
        ? { sha256: "1".repeat(64), byteLength: 111 }
        : { sha256: "2".repeat(64), byteLength: 222 };
    },
  });
  assert.deepEqual(
    localPaths,
    ["/tmp/accepted-shot-one.mp4", "/tmp/accepted-shot-two.mp4"],
    "capture receives only already-present local accepted paths",
  );
  assert.equal(remoteCalls, 0, "local capture cannot make an R2 or provider request");
  assert.equal(
    artifactManifest.captureScope,
    "local_post_qa",
    "raw bytes are explicitly scoped to the accepted local QA capture",
  );
  assert.equal(
    artifactManifest.objectDurability,
    "not_reverified",
    "raw byte capture must not be read as current-object proof",
  );

  const contract = createStandardNovitaVisualSequenceContract({
    shotRenderManifest: renderManifest,
    shotQaReport,
    visualCoverage,
    artifactManifest,
  });
  assert.equal(contract.assemblyBinding, "unmeasured");
  assert.equal(contract.items[0]!.r2Key, artifactManifest.items[0]!.r2Key);
  assert.equal(contract.items[0]!.artifact.state, "byte_bound");
  if (contract.items[0]!.artifact.state !== "byte_bound") {
    throw new Error("expected captured standard clip byte binding");
  }
  assert.equal(contract.items[0]!.artifact.captureScope, "local_post_qa");
  assert.equal(contract.items[0]!.artifact.objectDurability, "not_reverified");

  const resolution = deriveVisualSequenceEvidenceLedger({
    standardNovita: {
      shotRenderManifest: renderManifest,
      shotQaReport,
      visualCoverage,
      artifactManifest,
    },
    finalMaster,
    visualReview,
  });
  assert.equal(resolution.status, "supported");
  if (resolution.status !== "supported") throw new Error("expected standard Novita ledger");
  assert.equal(resolution.ledger.assemblyBinding, "unmeasured");
  assert.equal(resolution.ledger.sourceArtifactBinding.binding, "byte_bound");
  assert.equal(
    resolution.ledger.sourceArtifactBinding.byteBoundCaptureScope,
    "local_post_qa",
  );
  assert.equal(
    resolution.ledger.sourceArtifactBinding.byteBoundObjectDurability,
    "not_reverified",
  );
  const certificateInput = {
    version: FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
    finalMaster: {
      r2Key: "owner/test/runs/run-1/final/master.mp4",
      ...finalMaster,
    },
    visualReview: {
      evidenceManifestKey: visualReview.evidenceManifestKey,
      evidenceFrameKeys: visualReview.frameArtifacts.map((frame) => frame.r2Key),
      evidenceFrameArtifacts: visualReview.frameArtifacts,
      receiptKey: "owner/test/runs/run-1/visual-review/receipt.json",
      reviewFingerprint: visualReview.reviewFingerprint,
      reviewReceiptVersion: visualReview.reviewReceiptVersion,
      reviewReceiptFingerprint: visualReview.reviewReceiptFingerprint,
      releaseReceiptFingerprint: visualReview.releaseReceiptFingerprint,
    },
  };
  const legacyCertificate = createFinalMasterReleaseCertificate(certificateInput);
  assert.equal(
    legacyCertificate.visualSequenceEvidenceOmission,
    undefined,
    "legacy certificates remain valid without an omission record",
  );
  assert.doesNotThrow(
    () => assertFinalMasterReleaseCertificate(legacyCertificate),
    "legacy certificates without visual-sequence evidence remain readable",
  );
  const certificateWithVisualSequenceEvidence = createFinalMasterReleaseCertificate({
    ...certificateInput,
    visualSequenceEvidence: resolution.ledger,
  });
  assert.doesNotThrow(
    () => assertFinalMasterReleaseCertificate(certificateWithVisualSequenceEvidence),
    "an optional ledger is certificate-bound only when its exact byte receipts match",
  );
  assert.equal(
    certificateWithVisualSequenceEvidence.visualSequenceEvidenceOmission,
    undefined,
    "a valid attached ledger must not carry an omission record",
  );
  const rejectedSequenceReceiptOmission = createVisualSequenceEvidenceOmission({
    status: "rejected",
    adapter: "standard_novita",
    reasonCode: "sequence_receipt_invalid",
  });
  const unsupportedNoAdapterOmission = createVisualSequenceEvidenceOmission({
    status: "unsupported",
    adapter: "none",
    reasonCode: "no_supported_sequence_contract",
  });
  assert.equal(unsupportedNoAdapterOmission.status, "unsupported");
  assert.equal(unsupportedNoAdapterOmission.adapter, "none");
  assert.deepEqual(
    Object.keys(rejectedSequenceReceiptOmission).sort(),
    [
      "adapter",
      "omissionFingerprint",
      "reasonCode",
      "status",
      "version",
    ],
    "omission records stay bounded and never persist raw adapter errors",
  );
  const certificateWithOmission = createFinalMasterReleaseCertificate({
    ...certificateInput,
    visualSequenceEvidenceOmission: rejectedSequenceReceiptOmission,
  });
  assert.doesNotThrow(
    () => assertFinalMasterReleaseCertificate(certificateWithOmission),
    "a rejected exact adapter is durably observable without altering release semantics",
  );
  assert.throws(
    () => createFinalMasterReleaseCertificate({
      ...certificateInput,
      visualSequenceEvidence: resolution.ledger,
      visualSequenceEvidenceOmission: rejectedSequenceReceiptOmission,
    }),
    /cannot attach visual-sequence evidence and an omission together/,
    "an attached ledger and an omission record are mutually exclusive",
  );
  assert.throws(
    () => createFinalMasterReleaseCertificate({
      ...certificateInput,
      finalMaster: {
        ...certificateInput.finalMaster,
        sha256: "a".repeat(64),
      },
      visualSequenceEvidence: resolution.ledger,
    }),
    /different final-master byte receipt/,
    "a ledger cannot be attached to a certificate for other final-master bytes",
  );

  const wrongOrderArtifactManifest =
    await captureLocalVisualSequenceArtifactManifest({
      source: "standard_novita",
      sequenceFingerprint: standardNovitaVisualSequenceFingerprint(renderManifest),
      items: [
        {
          id: "shot-two",
          r2Key: "owner/test/runs/run-1/novita/shot-two.mp4",
          localPath: "/tmp/wrong-order-two.mp4",
        },
        {
          id: "shot-one",
          r2Key: "owner/test/runs/run-1/novita/shot-one.mp4",
          localPath: "/tmp/wrong-order-one.mp4",
        },
      ],
      getLocalFileIntegrity: async () => ({
        sha256: "6".repeat(64),
        byteLength: 666,
      }),
    });
  assert.throws(
    () => createStandardNovitaVisualSequenceContract({
      shotRenderManifest: renderManifest,
      shotQaReport,
      visualCoverage,
      artifactManifest: wrongOrderArtifactManifest,
    }),
    /identity\/order/,
    "a valid artifact manifest for the wrong ordered sequence cannot bind a contract",
  );

  let validArtifactInvalidBaseReceiptError: unknown;
  try {
    createStandardNovitaVisualSequenceContract({
      shotRenderManifest: renderManifest,
      shotQaReport: { ...shotQaReport, passed: false },
      visualCoverage,
      artifactManifest,
    });
  } catch (error) {
    validArtifactInvalidBaseReceiptError = error;
  }
  assert(
    validArtifactInvalidBaseReceiptError instanceof Error,
    "the invalid base receipt must be rejected even when the artifact is valid",
  );
  assert.equal(
    classifyVisualSequenceEvidenceRejection(validArtifactInvalidBaseReceiptError),
    "sequence_receipt_invalid",
    "a valid artifact must not cause invalid QA/coverage to be mislabeled as artifact invalid",
  );

  const receiptOnly = createStandardNovitaVisualSequenceContract({
    shotRenderManifest: renderManifest,
    shotQaReport,
    visualCoverage,
  });
  assert.equal(
    receiptOnly.items[0]!.artifact.state,
    "receipt_bound",
    "key-only historical standard receipts must not be upgraded to byte proof",
  );

  const casefileContract = createCasefileCinematicVisualSequenceContract(casefileArgs);
  assert.equal(casefileContract.source.kind, "casefile_cinematic");
  assert(
    casefileContract.items.every((item) => item.artifact.state === "receipt_bound"),
    "current generated Casefile takes remain receipt-bound until a matching byte manifest exists",
  );
  const casefileResolution = deriveVisualSequenceEvidenceLedger({
    casefileCinematic: casefileArgs,
    finalMaster,
    visualReview,
  });
  assert.equal(casefileResolution.status, "supported");
  if (casefileResolution.status !== "supported") {
    throw new Error("expected Casefile cinematic ledger");
  }
  assert.equal(
    casefileResolution.ledger.sourceArtifactBinding.binding,
    "receipt_bound",
    "Casefile QA receipts must not be represented as current generated-clip byte proof",
  );
  let sourceMismatchError: unknown;
  try {
    createCasefileCinematicVisualSequenceContract({
      ...casefileArgs,
      artifactManifest,
    });
  } catch (error) {
    sourceMismatchError = error;
  }
  assert(sourceMismatchError instanceof Error);
  assert.equal(
    classifyVisualSequenceEvidenceRejection(sourceMismatchError),
    "artifact_manifest_source_mismatch",
    "a manifest from another renderer cannot bind a supported sequence adapter",
  );

  await assert.rejects(
    () => verifyVisualSequenceArtifactManifestObjects({
      manifest: artifactManifest,
      getObjectIntegrity: async () => {
        remoteCalls++;
        return {
          sha256: "9".repeat(64),
          byteLength: 111,
        };
      },
    }),
    /no longer matches its captured bytes/,
    "a replaced object at the same accepted key cannot satisfy byte-bound proof",
  );

  const reused = await captureLocalVisualSequenceArtifactManifest({
    source: "standard_novita",
    sequenceFingerprint: standardNovitaVisualSequenceFingerprint(renderManifest),
    items: [
      {
        id: "shot-one",
        r2Key: "owner/test/runs/run-1/novita/reused.mp4",
        localPath: "/tmp/reused-one.mp4",
      },
      {
        id: "shot-two",
        r2Key: "owner/test/runs/run-1/novita/reused.mp4",
        localPath: "/tmp/reused-two.mp4",
      },
    ],
    getLocalFileIntegrity: async () => ({
      sha256: "7".repeat(64),
      byteLength: 777,
    }),
  });
  let reusedObjectReads = 0;
  const reusedVerification = await verifyVisualSequenceArtifactManifestObjects({
    manifest: reused,
    getObjectIntegrity: async () => {
      reusedObjectReads++;
      return { sha256: "7".repeat(64), byteLength: 777 };
    },
  });
  assert.equal(
    reusedVerification.verificationScope,
    "current_object_bytes_at_check",
    "only the opt-in verifier can make a current-object-at-check assertion",
  );
  assert.equal(reusedVerification.objectDurability, "verified_at_check_only");
  assert.equal(reusedVerification.checkedObjectCount, 1);
  assert.equal(
    reusedObjectReads,
    1,
    "a deliberately reused clip key is verified once without invalidating its two ordered uses",
  );

  const unsupported = deriveVisualSequenceEvidenceLedger({
    finalMaster,
    visualReview,
  });
  assert.deepEqual(unsupported, {
    status: "unsupported",
    reason: "no_supported_sequence_contract",
  });

  console.log("Visual sequence contract tests passed");
}

void main();
