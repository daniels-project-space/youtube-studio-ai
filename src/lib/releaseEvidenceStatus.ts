import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

/**
 * A deliberately conservative dashboard projection of release-evidence state.
 *
 * This is not a new verifier and it never claims that R2 bytes were fetched or
 * replayed. It answers a narrower provenance question: did a successful
 * qa_visual stage retain a final-master certificate and the matching artifact
 * lineage needed for a later audit?
 */
export const RELEASE_EVIDENCE_STATUSES = [
  "not_ready",
  "legacy_unverified",
  "evidence_incomplete",
  "release_evidence_recorded",
] as const;

export type ReleaseEvidenceStatus = typeof RELEASE_EVIDENCE_STATUSES[number];

export type ReleaseEvidenceProjection = {
  status: ReleaseEvidenceStatus;
  certificateFingerprint?: string;
  certificateKey?: string;
};

export type ReleaseEvidenceQaStage = {
  status?: unknown;
  outputs?: unknown;
};

export type ReleaseEvidenceArtifact = {
  key?: unknown;
  type?: unknown;
  producerModule?: unknown;
  persistence?: unknown;
  payload?: unknown;
};

type ReleaseCertificateReference = {
  certificateKey: string;
  certificateFingerprint: string;
  finalMasterKey: string;
  finalMasterSha256: string;
  reviewEvidenceManifestKey: string;
  reviewEvidenceFrameCount: number;
  reviewEvidenceFrameKeysFingerprint: string;
  reviewReceiptKey: string;
  reviewFingerprint: string;
  reviewReceiptVersion: string;
  reviewReceiptFingerprint: string;
  reviewReleaseReceiptFingerprint: string;
};

const FINAL_MASTER_RELEASE_CERTIFICATE_REFERENCE_VERSION = "final-master-release-certificate-reference/v1";
const SHA256 = /^[a-f0-9]{64}$/i;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function sha256(value: unknown): string | undefined {
  const candidate = text(value);
  return candidate && SHA256.test(candidate) ? candidate.toLowerCase() : undefined;
}

function belongsToRun(value: unknown, runId: string): value is string {
  const key = text(value);
  return Boolean(key && key.includes(`/runs/${runId}/`));
}

/** Mirrors the certificate's sorted-frame-set digest without importing Node-only crypto into Convex. */
function evidenceFrameKeysFingerprint(keys: readonly string[]): string {
  return sha256Hex(canonicalJson([...keys].sort()));
}

function referenceFrom(value: unknown, runId: string): ReleaseCertificateReference | undefined {
  const reference = record(value);
  if (!reference || reference.version !== FINAL_MASTER_RELEASE_CERTIFICATE_REFERENCE_VERSION) return undefined;

  const finalMaster = record(reference.finalMaster);
  const visualReview = record(reference.visualReview);
  const certificateKey = reference && belongsToRun(reference.certificateKey, runId)
    ? reference.certificateKey
    : undefined;
  const certificateFingerprint = sha256(reference.certificateFingerprint);
  const finalMasterKey = finalMaster && belongsToRun(finalMaster.r2Key, runId)
    ? finalMaster.r2Key
    : undefined;
  const finalMasterSha256 = finalMaster && sha256(finalMaster.sha256);
  const durationSec = finalMaster?.durationSec;
  const reviewEvidenceManifestKey = visualReview && belongsToRun(visualReview.evidenceManifestKey, runId)
    ? visualReview.evidenceManifestKey
    : undefined;
  const reviewReceiptKey = visualReview && belongsToRun(visualReview.receiptKey, runId)
    ? visualReview.receiptKey
    : undefined;
  const reviewFingerprint = visualReview && text(visualReview.reviewFingerprint);
  const reviewReceiptVersion = visualReview && text(visualReview.reviewReceiptVersion);
  const reviewReceiptFingerprint = visualReview && sha256(visualReview.reviewReceiptFingerprint);
  const reviewReleaseReceiptFingerprint = visualReview && sha256(visualReview.releaseReceiptFingerprint);
  const reviewEvidenceFrameCount = visualReview?.evidenceFrameCount;
  const reviewEvidenceFrameKeysFingerprint = visualReview && sha256(visualReview.evidenceFrameKeysFingerprint);

  if (
    !certificateKey ||
    !certificateFingerprint ||
    !finalMasterKey ||
    !finalMasterSha256 ||
    typeof durationSec !== "number" ||
    !Number.isFinite(durationSec) ||
    durationSec <= 0 ||
    !reviewEvidenceManifestKey ||
    !reviewReceiptKey ||
    !reviewFingerprint ||
    !reviewReceiptVersion ||
    !reviewReceiptFingerprint ||
    !reviewReleaseReceiptFingerprint ||
    typeof reviewEvidenceFrameCount !== "number" ||
    !Number.isInteger(reviewEvidenceFrameCount) ||
    reviewEvidenceFrameCount < 1 ||
    reviewEvidenceFrameCount > 20_000 ||
    !reviewEvidenceFrameKeysFingerprint
  ) {
    return undefined;
  }

  return {
    certificateKey,
    certificateFingerprint,
    finalMasterKey,
    finalMasterSha256,
    reviewEvidenceManifestKey,
    reviewEvidenceFrameCount,
    reviewEvidenceFrameKeysFingerprint,
    reviewReceiptKey,
    reviewFingerprint,
    reviewReceiptVersion,
    reviewReceiptFingerprint,
    reviewReleaseReceiptFingerprint,
  };
}

function hasMatchingQaReview(
  outputs: Record<string, unknown>,
  reference: ReleaseCertificateReference,
  runId: string,
): boolean {
  if (
    outputs.finalMasterSha256 !== reference.finalMasterSha256 ||
    outputs.reviewFingerprint !== reference.reviewFingerprint ||
    outputs.reviewReceiptVersion !== reference.reviewReceiptVersion ||
    outputs.reviewReceiptFingerprint !== reference.reviewReceiptFingerprint
  ) {
    return false;
  }

  const reviewEvidence = record(outputs.reviewEvidence);
  const reviewResult = record(outputs.reviewResult);
  if (!reviewEvidence) {
    return false;
  }
  const frames = reviewEvidence.frames;
  let frameCount: number | undefined;
  let frameKeysFingerprint: string | undefined;
  if (Array.isArray(frames)) {
    const reviewFrameKeys: string[] = [];
    for (const frame of frames) {
      const r2Key = record(frame)?.r2Key;
      if (!belongsToRun(r2Key, runId)) return false;
      reviewFrameKeys.push(r2Key);
    }
    if (new Set(reviewFrameKeys).size !== reviewFrameKeys.length) return false;
    frameCount = reviewFrameKeys.length;
    frameKeysFingerprint = evidenceFrameKeysFingerprint(reviewFrameKeys);
  } else {
    frameCount = reviewEvidence.frameCount as number | undefined;
    frameKeysFingerprint = sha256(reviewEvidence.frameKeysFingerprint);
  }

  if (
    !Number.isInteger(frameCount) ||
    frameCount !== reference.reviewEvidenceFrameCount ||
    frameKeysFingerprint !== reference.reviewEvidenceFrameKeysFingerprint
  ) return false;

  return Boolean(
    reviewEvidence.manifestKey === reference.reviewEvidenceManifestKey &&
    reviewResult?.verdict === "pass" &&
    reviewResult.reviewReceiptVersion === reference.reviewReceiptVersion &&
    reviewResult.reviewReceiptFingerprint === reference.reviewReceiptFingerprint,
  );
}

function hasMatchingArtifact(
  artifacts: readonly ReleaseEvidenceArtifact[],
  expected: {
    key: string;
    type: string;
    producerModule?: string;
    persistence?: string;
    payload: unknown;
  },
): boolean {
  return artifacts.some((artifact) =>
    artifact.key === expected.key &&
    artifact.type === expected.type &&
    (expected.persistence === undefined || artifact.persistence === expected.persistence) &&
    (expected.producerModule === undefined || artifact.producerModule === expected.producerModule) &&
    artifact.payload === expected.payload,
  );
}

function hasRetainedCertificateArtifact(artifacts: readonly ReleaseEvidenceArtifact[]): boolean {
  return artifacts.some((artifact) =>
    artifact.key === "finalMasterReleaseCertificate" &&
    artifact.type === "FinalMasterReleaseCertificate" &&
    artifact.producerModule === "qa_visual" &&
    (artifact.persistence === "reference" || artifact.persistence === "summary"),
  );
}

function referenceFromArtifact(
  artifacts: readonly ReleaseEvidenceArtifact[],
  runId: string,
  certificateKey: string,
): ReleaseCertificateReference | undefined {
  for (const artifact of artifacts) {
    if (
      artifact.key !== "finalMasterReleaseCertificateReference" ||
      artifact.type !== "FinalMasterReleaseCertificateReference" ||
      artifact.producerModule !== "qa_visual" ||
      artifact.persistence !== "reference"
    ) {
      continue;
    }
    const reference = referenceFrom(artifact.payload, runId);
    // A repaired qa_visual stage may retain more than one immutable reference.
    // Only the reference named by this exact stage's certificate key can speak
    // for its current master/review lineage.
    if (reference?.certificateKey === certificateKey) return reference;
  }
  return undefined;
}

function expectedCertificateKey(runId: string, certificateFingerprint: string): string {
  return `/runs/${runId}/release-certificates/${certificateFingerprint}.json`;
}

/**
 * Derive the dashboard state from durable QA and artifact records. A passing
 * QA boolean alone intentionally cannot reach `release_evidence_recorded`.
 */
export function deriveReleaseEvidenceProjection({
  runId,
  qaStage,
  artifacts,
}: {
  runId: string;
  qaStage?: ReleaseEvidenceQaStage | null;
  artifacts: readonly ReleaseEvidenceArtifact[];
}): ReleaseEvidenceProjection {
  if (qaStage?.status !== "ok") return { status: "not_ready" };

  const outputs = record(qaStage.outputs);
  if (!outputs) return { status: "not_ready" };

  const certificateKey = text(outputs.finalMasterReleaseCertificateKey);
  const hasReleaseSignals =
    outputs.finalMasterReleaseCertificate !== undefined ||
    outputs.finalMasterReleaseCertificateReference !== undefined ||
    certificateKey !== undefined ||
    artifacts.some((artifact) =>
      artifact.producerModule === "qa_visual" &&
      (
        artifact.key === "finalMasterReleaseCertificate" ||
        artifact.key === "finalMasterReleaseCertificateReference" ||
        artifact.key === "finalMasterReleaseCertificateKey"
      ),
    );

  if (outputs.qaPassed !== true) {
    return { status: hasReleaseSignals ? "evidence_incomplete" : "not_ready" };
  }

  // Runs created before the final-master certificate existed commonly have a
  // qaPassed flag and report, but no retained release lineage. Keep that state
  // distinct so the UI cannot imply that their masters were later verified.
  if (!hasReleaseSignals) return { status: "legacy_unverified" };

  // Do not use `finalMasterReleaseCertificate` from stage outputs or its full
  // artifact payload here. It can legitimately be summarized once narration
  // or cinematic receipts exceed the inline limit. The compact reference is a
  // separate, R2-backed artifact whose bounded payload is written atomically
  // with the certificate key before this QA stage becomes `ok`.
  if (!certificateKey) return { status: "evidence_incomplete" };
  const reference = referenceFromArtifact(artifacts, runId, certificateKey);
  if (
    !reference ||
    certificateKey !== reference.certificateKey ||
    !certificateKey.endsWith(expectedCertificateKey(runId, reference.certificateFingerprint)) ||
    !hasMatchingQaReview(outputs, reference, runId) ||
    !hasRetainedCertificateArtifact(artifacts) ||
    !hasMatchingArtifact(artifacts, {
      key: "finalMasterReleaseCertificateKey",
      type: "R2ObjectKey",
      producerModule: "qa_visual",
      persistence: "reference",
      payload: reference.certificateKey,
    }) ||
    !hasMatchingArtifact(artifacts, {
      key: "videoKey",
      type: "R2ObjectKey",
      payload: reference.finalMasterKey,
    })
  ) {
    return { status: "evidence_incomplete" };
  }

  return {
    status: "release_evidence_recorded",
    certificateFingerprint: reference.certificateFingerprint,
    certificateKey: reference.certificateKey,
  };
}

/** Missing stored values are pre-projection legacy records, never proof. */
export function normalizeReleaseEvidenceStatus(value: unknown): ReleaseEvidenceStatus {
  return RELEASE_EVIDENCE_STATUSES.includes(value as ReleaseEvidenceStatus)
    ? value as ReleaseEvidenceStatus
    : "legacy_unverified";
}

export function releaseEvidenceStatusLabel(value: unknown): string {
  switch (normalizeReleaseEvidenceStatus(value)) {
    case "not_ready":
      return "Release evidence pending";
    case "legacy_unverified":
      return "Legacy output — unverified";
    case "evidence_incomplete":
      return "Release evidence incomplete";
    case "release_evidence_recorded":
      return "Release evidence recorded";
  }
}

export function releaseEvidenceStatusDescription(value: unknown): string {
  switch (normalizeReleaseEvidenceStatus(value)) {
    case "not_ready":
      return "No successful release-evidence record has been completed.";
    case "legacy_unverified":
      return "This legacy run has no retained final-master release certificate. Treat its output as unverified.";
    case "evidence_incomplete":
      return "QA reported a pass, but its retained certificate, master, or review-evidence lineage is incomplete. Treat its output as unverified.";
    case "release_evidence_recorded":
      return "A passing QA stage, final-master certificate, and retained lineage are recorded. This status does not replay or re-verify the stored media bytes.";
  }
}
