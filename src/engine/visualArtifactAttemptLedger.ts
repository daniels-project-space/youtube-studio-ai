/**
 * Provider-free, content-addressed audit records for visual candidates.
 *
 * A VisualArtifactAttempt records what was reviewed and why it was accepted
 * or rejected. It is intentionally not a release certificate, render
 * admission, retry counter, or spend authority. The durable append-only
 * ledger is the existing runArtifacts store; this module only seals each
 * record and validates an optional in-memory lineage view.
 */
import { z } from "zod";

import {
  VISUAL_ARTIFACT_REVIEW_OUTCOME_VERSION,
  isVisualArtifactReviewRejection,
  type VisualArtifactKind,
  type VisualArtifactReviewRejection,
} from "./visualArtifactReviewOutcome";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export const VISUAL_ARTIFACT_ATTEMPT_VERSION =
  "visual-artifact-attempt/v1" as const;
export const VISUAL_ARTIFACT_ATTEMPT_LEDGER_VERSION =
  "visual-artifact-attempt-ledger/v1" as const;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/, "expected SHA-256 fingerprint");
const stableId = z.string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/, "expected stable identifier");
const adapterId = z.string()
  .trim()
  .min(1)
  .max(81)
  .regex(/^[a-z][a-z0-9_-]*$/, "expected adapter identifier");
const gateId = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9_-]*$/, "expected gate identifier");
const reviewVersion = z.string().trim().min(1).max(160);
const observation = z.string().trim().min(1).max(280);
const objectKey = z.string()
  .trim()
  .min(1)
  .max(1_600)
  .refine((value) => !value.includes("://"), "expected an object key, not a URL");

/**
 * Candidate identity is mandatory. Object-key and byte proof are deliberately
 * optional because some future adapters may review a local or provider-native
 * candidate before it has an object key. When bytes are present, the claim is
 * narrowly scoped to the downloaded review input rather than current storage.
 */
export const VisualArtifactAttemptCandidateSchema = z.object({
  id: stableId,
  r2Key: objectKey.optional(),
  sha256: sha256.optional(),
  byteLength: z.number().int().positive().optional(),
  captureScope: z.literal("local_review_input").optional(),
  objectDurability: z.literal("not_reverified").optional(),
}).strict().superRefine((value, ctx) => {
  const hasByteProof = value.sha256 !== undefined;
  const hasAnyByteMetadata =
    value.byteLength !== undefined ||
    value.captureScope !== undefined ||
    value.objectDurability !== undefined;
  if (hasByteProof && !hasAnyByteMetadata) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["byteLength"],
      message: "byte-bound candidate must include byte length and capture metadata",
    });
  }
  if (
    hasByteProof &&
    (value.byteLength === undefined ||
      value.captureScope !== "local_review_input" ||
      value.objectDurability !== "not_reverified")
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sha256"],
      message: "byte-bound candidate must state local review-input capture only",
    });
  }
  if (!hasByteProof && hasAnyByteMetadata) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sha256"],
      message: "candidate byte metadata requires a SHA-256 fingerprint",
    });
  }
});
export type VisualArtifactAttemptCandidate = z.infer<typeof VisualArtifactAttemptCandidateSchema>;

const VisualArtifactReviewRejectionSchema = z.custom<VisualArtifactReviewRejection>(
  (value) => isVisualArtifactReviewRejection(value),
  "expected a proven visual artifact review rejection",
);

const acceptedReviewSchema = z.object({
  verdict: z.literal("accepted"),
  gateId,
  reviewVersion,
  notes: z.array(observation).max(8),
  verdictFingerprint: sha256,
}).strict();

const rejectedReviewSchema = z.object({
  verdict: z.literal("rejected"),
  gateId,
  reviewVersion,
  notes: z.array(observation).max(8),
  rejection: VisualArtifactReviewRejectionSchema,
  verdictFingerprint: sha256,
}).strict();

const VisualArtifactAttemptReviewSchema = z.discriminatedUnion("verdict", [
  acceptedReviewSchema,
  rejectedReviewSchema,
]).superRefine((value, ctx) => {
  if (value.verdict === "rejected") {
    if (
      value.rejection.gateId !== value.gateId ||
      value.rejection.reviewVersion !== value.reviewVersion
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rejection"],
        message: "rejection must match the recorded gate and review version",
      });
    }
    if (canonicalJson(value.rejection.notes) !== canonicalJson(value.notes)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["notes"],
        message: "rejected verdict notes must exactly match the typed rejection",
      });
    }
  }
  const expected = visualArtifactReviewVerdictFingerprint(value);
  if (value.verdictFingerprint !== expected) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["verdictFingerprint"],
      message: "visual artifact review verdict fingerprint does not match payload",
    });
  }
});
export type VisualArtifactAttemptReview = z.infer<typeof VisualArtifactAttemptReviewSchema>;

export const VisualArtifactAttemptRepairSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("initial") }).strict(),
  z.object({
    kind: z.literal("replacement"),
    parentAttemptFingerprint: sha256,
    parentRejectionFingerprint: sha256,
  }).strict(),
]);
export type VisualArtifactAttemptRepair = z.infer<typeof VisualArtifactAttemptRepairSchema>;

const VisualArtifactAttemptPayloadSchema = z.object({
  version: z.literal(VISUAL_ARTIFACT_ATTEMPT_VERSION),
  /** Caller-owned adapter namespace, never a provider model name. */
  adapterId,
  /** Immutable sequence/shot-plan/etc. fingerprint selected by the adapter. */
  scopeFingerprint: sha256,
  attemptId: stableId,
  /** Strict append order within the optional aggregate ledger view. */
  ordinal: z.number().int().positive(),
  artifact: z.object({
    kind: z.enum(["image", "video"]),
    subjectId: stableId,
    candidate: VisualArtifactAttemptCandidateSchema,
  }).strict(),
  review: VisualArtifactAttemptReviewSchema,
  repair: VisualArtifactAttemptRepairSchema,
}).strict();

export const VisualArtifactAttemptSchema = VisualArtifactAttemptPayloadSchema.extend({
  attemptFingerprint: sha256,
}).strict().superRefine((value, ctx) => {
  if (value.review.verdict === "rejected") {
    if (
      value.review.rejection.artifactKind !== value.artifact.kind ||
      value.review.rejection.subjectId !== value.artifact.subjectId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["review", "rejection"],
        message: "rejection must match the recorded artifact kind and subject",
      });
    }
  }
  const expected = visualArtifactAttemptFingerprint(value);
  if (value.attemptFingerprint !== expected) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["attemptFingerprint"],
      message: "visual artifact attempt fingerprint does not match payload",
    });
  }
});
export type VisualArtifactAttempt = z.infer<typeof VisualArtifactAttemptSchema>;

export interface CreateVisualArtifactAttemptInput {
  adapterId: string;
  scopeFingerprint: string;
  attemptId: string;
  ordinal: number;
  artifact: {
    kind: VisualArtifactKind;
    subjectId: string;
    candidate: VisualArtifactAttemptCandidate;
  };
  review: {
    verdict: "accepted" | "rejected";
    gateId: string;
    reviewVersion: string;
    notes: readonly string[];
    rejection?: VisualArtifactReviewRejection;
  };
  repair: VisualArtifactAttemptRepair;
}

function withoutFingerprint(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { [key]: _fingerprint, ...payload } = value as Record<string, unknown>;
  void _fingerprint;
  return payload;
}

/** Hashes the complete verdict payload (not a human-readable error string). */
export function visualArtifactReviewVerdictFingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(withoutFingerprint(value, "verdictFingerprint")));
}

/** Stable reference used by a replacement to identify its rejected parent. */
export function visualArtifactReviewRejectionFingerprint(
  rejection: VisualArtifactReviewRejection,
): string {
  if (!isVisualArtifactReviewRejection(rejection)) {
    throw new Error("cannot fingerprint an invalid visual artifact review rejection");
  }
  return sha256Hex(canonicalJson(rejection));
}

/** Hashes the complete attempt payload, excluding only its derived fingerprint. */
export function visualArtifactAttemptFingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(withoutFingerprint(value, "attemptFingerprint")));
}

/** Seal a provider-free review event before it is appended to runArtifacts. */
export function createVisualArtifactAttempt(
  input: CreateVisualArtifactAttemptInput,
): VisualArtifactAttempt {
  const review = {
    verdict: input.review.verdict,
    gateId: input.review.gateId,
    reviewVersion: input.review.reviewVersion,
    notes: [...input.review.notes],
    ...(input.review.rejection === undefined
      ? {}
      : { rejection: input.review.rejection }),
  };
  const withVerdictFingerprint = {
    ...review,
    verdictFingerprint: visualArtifactReviewVerdictFingerprint(review),
  };
  const unsigned = {
    version: VISUAL_ARTIFACT_ATTEMPT_VERSION,
    adapterId: input.adapterId,
    scopeFingerprint: input.scopeFingerprint,
    attemptId: input.attemptId,
    ordinal: input.ordinal,
    artifact: input.artifact,
    review: withVerdictFingerprint,
    repair: input.repair,
  };
  return assertVisualArtifactAttempt({
    ...unsigned,
    attemptFingerprint: visualArtifactAttemptFingerprint(unsigned),
  });
}

/** Parse a sealed single record. This does not invent retry or release authority. */
export function assertVisualArtifactAttempt(value: unknown): VisualArtifactAttempt {
  return VisualArtifactAttemptSchema.parse(value);
}

function ledgerPayload(value: unknown): unknown {
  return withoutFingerprint(value, "ledgerFingerprint");
}

/**
 * Optional compact lineage view for UIs and evidence packs. It is not the
 * durable source of truth: each attempt is independently persisted through
 * runArtifacts so an exception after a review cannot erase the record.
 */
export const VisualArtifactAttemptLedgerSchema = z.object({
  version: z.literal(VISUAL_ARTIFACT_ATTEMPT_LEDGER_VERSION),
  scopeFingerprint: sha256,
  attempts: z.array(VisualArtifactAttemptSchema).min(1).max(512),
  ledgerFingerprint: sha256,
}).strict().superRefine((value, ctx) => {
  const seenAttempts = new Map<string, VisualArtifactAttempt>();
  const seenIds = new Set<string>();
  value.attempts.forEach((attempt, index) => {
    if (attempt.scopeFingerprint !== value.scopeFingerprint) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attempts", index, "scopeFingerprint"],
        message: "attempt scope fingerprint must match the ledger",
      });
    }
    if (attempt.ordinal !== index + 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attempts", index, "ordinal"],
        message: "attempt ordinals must be contiguous append order starting at one",
      });
    }
    if (seenIds.has(attempt.attemptId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attempts", index, "attemptId"],
        message: "ledger cannot repeat an attempt id",
      });
    }
    seenIds.add(attempt.attemptId);

    if (attempt.repair.kind === "replacement") {
      const parent = seenAttempts.get(attempt.repair.parentAttemptFingerprint);
      if (!parent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["attempts", index, "repair", "parentAttemptFingerprint"],
          message: "replacement parent must be an earlier attempt in this ledger",
        });
      } else if (parent.review.verdict !== "rejected") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["attempts", index, "repair", "parentAttemptFingerprint"],
          message: "replacement parent must carry a rejected verdict",
        });
      } else {
        if (
          visualArtifactReviewRejectionFingerprint(parent.review.rejection) !==
          attempt.repair.parentRejectionFingerprint
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["attempts", index, "repair", "parentRejectionFingerprint"],
            message: "replacement parent rejection fingerprint does not match",
          });
        }
        if (
          parent.artifact.kind !== attempt.artifact.kind ||
          parent.artifact.subjectId !== attempt.artifact.subjectId
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["attempts", index, "artifact"],
            message: "replacement must stay on its rejected parent artifact subject",
          });
        }
      }
    }
    seenAttempts.set(attempt.attemptFingerprint, attempt);
  });
  const expected = visualArtifactAttemptLedgerFingerprint(value);
  if (value.ledgerFingerprint !== expected) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ledgerFingerprint"],
      message: "visual artifact attempt ledger fingerprint does not match payload",
    });
  }
});
export type VisualArtifactAttemptLedger = z.infer<typeof VisualArtifactAttemptLedgerSchema>;

export function visualArtifactAttemptLedgerFingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(ledgerPayload(value)));
}

export function createVisualArtifactAttemptLedger(input: {
  scopeFingerprint: string;
  attempts: readonly VisualArtifactAttempt[];
}): VisualArtifactAttemptLedger {
  const unsigned = {
    version: VISUAL_ARTIFACT_ATTEMPT_LEDGER_VERSION,
    scopeFingerprint: input.scopeFingerprint,
    attempts: [...input.attempts],
  };
  return assertVisualArtifactAttemptLedger({
    ...unsigned,
    ledgerFingerprint: visualArtifactAttemptLedgerFingerprint(unsigned),
  });
}

export function assertVisualArtifactAttemptLedger(value: unknown): VisualArtifactAttemptLedger {
  return VisualArtifactAttemptLedgerSchema.parse(value);
}

/** Keeps the review-outcome version visible to consumers documenting evidence provenance. */
export const VISUAL_ARTIFACT_ATTEMPT_REJECTION_SCHEMA_VERSION =
  VISUAL_ARTIFACT_REVIEW_OUTCOME_VERSION;
