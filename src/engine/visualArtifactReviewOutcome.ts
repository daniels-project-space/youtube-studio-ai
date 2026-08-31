/**
 * Shared recovery contract for independently reviewed visual artifacts.
 *
 * A new paid candidate is permitted only when a gate has returned a complete,
 * typed visual rejection. Transport, storage, frame-extraction, malformed
 * reviewer, and contract failures do not establish that different pixels would
 * solve the problem, so Phase A intentionally fails them closed. A future
 * checkpoint/requeue layer may reuse the same artifact for review-only retry.
 */

export const VISUAL_ARTIFACT_REVIEW_OUTCOME_VERSION =
  "visual-artifact-review-outcome/v1" as const;

export type VisualArtifactKind = "image" | "video";

export interface VisualArtifactReviewRejection {
  readonly schemaVersion: typeof VISUAL_ARTIFACT_REVIEW_OUTCOME_VERSION;
  /** Stable gate namespace; it must not rely on a human-readable error string. */
  readonly gateId: string;
  readonly artifactKind: VisualArtifactKind;
  /** Scene, shot, or other caller-owned artifact subject identifier. */
  readonly subjectId: string;
  /** Version of the gate's reviewed evidence schema. */
  readonly reviewVersion: string;
  /** Concrete visual observations supplied by the independently parsed gate. */
  readonly notes: readonly string[];
}

/**
 * Every recovery must bind the rejection to its exact gate, artifact, subject,
 * and evidence-schema version. Keeping these required prevents a future
 * recovery caller from accidentally weakening repair authority.
 */
export type VisualArtifactReviewExpectation = Readonly<
  Pick<
    VisualArtifactReviewRejection,
    "gateId" | "artifactKind" | "subjectId" | "reviewVersion"
  >
>;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const GATE_ID = /^[a-z][a-z0-9_-]{0,127}$/;

function hasBoundedIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value);
}

/** Verify the complete, machine-readable evidence rejection payload. */
export function isVisualArtifactReviewRejection(
  value: unknown,
): value is VisualArtifactReviewRejection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rejection = value as Record<string, unknown>;
  return (
    rejection.schemaVersion === VISUAL_ARTIFACT_REVIEW_OUTCOME_VERSION &&
    typeof rejection.gateId === "string" &&
    GATE_ID.test(rejection.gateId) &&
    (rejection.artifactKind === "image" ||
      rejection.artifactKind === "video") &&
    hasBoundedIdentifier(rejection.subjectId) &&
    typeof rejection.reviewVersion === "string" &&
    rejection.reviewVersion.trim().length > 0 &&
    rejection.reviewVersion.length <= 160 &&
    Array.isArray(rejection.notes) &&
    rejection.notes.length <= 8 &&
    rejection.notes.every(
      (note) =>
        typeof note === "string" &&
        note.trim().length > 0 &&
        note.length <= 280,
    )
  );
}

function checkedRejection(
  value: VisualArtifactReviewRejection,
): VisualArtifactReviewRejection {
  if (!isVisualArtifactReviewRejection(value)) {
    throw new Error(
      "visual artifact review rejection must carry a valid evidence payload",
    );
  }
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    gateId: value.gateId,
    artifactKind: value.artifactKind,
    subjectId: value.subjectId,
    reviewVersion: value.reviewVersion,
    notes: Object.freeze([...value.notes]),
  });
}

/**
 * The sole error class which permits a bounded paid visual replacement. Gate
 * adapters create it only after they have parsed a valid reviewer verdict and
 * established an actual visual failure.
 */
export class VisualArtifactReviewRejectedError extends Error {
  readonly code = "VISUAL_ARTIFACT_REVIEW_REJECTED" as const;
  readonly rejection: VisualArtifactReviewRejection;

  constructor(rejection: VisualArtifactReviewRejection, message?: string) {
    const checked = checkedRejection(rejection);
    super(
      message ??
        `${checked.gateId} rejected ${checked.artifactKind} ${checked.subjectId}: ` +
          (checked.notes.join("; ") || "reviewer rejected the candidate"),
    );
    this.name = "VisualArtifactReviewRejectedError";
    this.rejection = checked;
  }
}

function matchesExpectation(
  rejection: VisualArtifactReviewRejection,
  expected: VisualArtifactReviewExpectation,
): boolean {
  return (
    rejection.gateId === expected.gateId &&
    rejection.artifactKind === expected.artifactKind &&
    rejection.subjectId === expected.subjectId &&
    rejection.reviewVersion === expected.reviewVersion
  );
}

/**
 * Accept only a locally-created, structurally sound rejection for the exact
 * gate/artifact subject currently under recovery. A forged object, a rejection
 * for another shot, or a different gate fails closed.
 */
export function isProvenVisualArtifactReviewRejection(
  error: unknown,
  expected: VisualArtifactReviewExpectation,
): error is VisualArtifactReviewRejectedError {
  return (
    error instanceof VisualArtifactReviewRejectedError &&
    error.code === "VISUAL_ARTIFACT_REVIEW_REJECTED" &&
    isVisualArtifactReviewRejection(error.rejection) &&
    matchesExpectation(error.rejection, expected)
  );
}

export type VisualArtifactReviewOutcome =
  | {
      readonly disposition: "render_replacement";
      readonly rejection: VisualArtifactReviewRejection;
    }
  | {
      readonly disposition: "fail_closed";
    };

/**
 * Phase A recovery policy. Only proven visual evidence authorizes another
 * render; every other failure remains fail-closed until a durable review-only
 * checkpoint/requeue path exists.
 */
export function classifyVisualArtifactReviewOutcome(
  error: unknown,
  expected: VisualArtifactReviewExpectation,
): VisualArtifactReviewOutcome {
  if (isProvenVisualArtifactReviewRejection(error, expected)) {
    return { disposition: "render_replacement", rejection: error.rejection };
  }
  return { disposition: "fail_closed" };
}
