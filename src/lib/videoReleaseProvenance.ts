/**
 * A compact, observational projection of a released master's immutable
 * certificate. This deliberately contains no quality score, recommendation,
 * outcome, or publishing authorization.
 */
import {
  assertFinalMasterReleaseCertificate,
  type FinalMasterReleaseCertificate,
} from "@/lib/finalMasterReleaseCertificate";
import type {
  FinalMasterQualityEvidenceCoverage,
  FinalMasterStoryMeasurementCoverage,
} from "@/lib/finalMasterQualityEvidenceBinding";

export const VIDEO_RELEASE_PROVENANCE_VERSION =
  "video-release-provenance/v1" as const;

export interface VideoReleaseProvenanceClaim {
  version: typeof VIDEO_RELEASE_PROVENANCE_VERSION;
  releaseCertificateKey: string;
  releaseCertificateFingerprint: string;
  finalMasterSha256: string;
  qualityBindingVersion: string;
  qualityBindingFingerprint: string;
  qualityEvidenceFingerprint: string;
  contentLaneKey: string;
  renderer: string;
  programRoute?: {
    routeFingerprint: string;
    family: string;
    contentLaneKey: string;
    /** Optional on historical routes that predate the program-brief binding. */
    programBriefFingerprint?: string;
  };
  /** Completeness of recorded QA evidence only; never a performance claim. */
  evidenceStatus: FinalMasterQualityEvidenceCoverage;
  /**
   * Scope of the sealed story measurement only. `plan_only` is pre-render;
   * `final_master` carries a source-backed ratio in the full QA receipt and
   * never means every story element was covered.
   */
  storyMeasurementCoverage?: FinalMasterStoryMeasurementCoverage;
}

function requireText(value: string, label: string): string {
  if (!value.trim()) throw new Error(`video release provenance requires ${label}`);
  return value;
}

/**
 * Returns no claim for a readable pre-binding certificate. Those historical
 * releases remain intentionally unlinked instead of being upgraded by
 * inference. A present binding must belong to the exact uploaded master.
 */
export function videoReleaseProvenanceClaimFromCertificate(args: {
  certificate: FinalMasterReleaseCertificate | unknown;
  releaseCertificateKey: string;
  expectedFinalMasterSha256: string;
}): VideoReleaseProvenanceClaim | undefined {
  const certificate = assertFinalMasterReleaseCertificate(args.certificate);
  const releaseCertificateKey = requireText(
    args.releaseCertificateKey,
    "a release certificate key",
  );
  const expectedFinalMasterSha256 = requireText(
    args.expectedFinalMasterSha256,
    "an uploaded final-master digest",
  ).toLowerCase();

  if (certificate.finalMaster.sha256 !== expectedFinalMasterSha256) {
    throw new Error(
      "video release provenance certificate belongs to a different uploaded final master",
    );
  }

  const binding = certificate.qualityEvidence;
  if (!binding) return undefined;

  return {
    version: VIDEO_RELEASE_PROVENANCE_VERSION,
    releaseCertificateKey,
    releaseCertificateFingerprint: certificate.certificateFingerprint,
    finalMasterSha256: certificate.finalMaster.sha256,
    qualityBindingVersion: binding.version,
    qualityBindingFingerprint: binding.bindingFingerprint,
    qualityEvidenceFingerprint: binding.qualityEvidenceFingerprint,
    contentLaneKey: binding.contentLane.key,
    renderer: binding.contentLane.renderer,
    ...(binding.programRoute === undefined
      ? {}
      : {
          programRoute: {
            routeFingerprint: binding.programRoute.routeFingerprint,
            family: binding.programRoute.family,
            contentLaneKey: binding.programRoute.contentLaneKey,
            ...(binding.programRoute.programBriefFingerprint === undefined
              ? {}
              : { programBriefFingerprint: binding.programRoute.programBriefFingerprint }),
          },
        }),
    evidenceStatus: binding.evidenceCoverage,
    ...(binding.storyMeasurementCoverage === undefined
      ? {}
      : { storyMeasurementCoverage: binding.storyMeasurementCoverage }),
  };
}
