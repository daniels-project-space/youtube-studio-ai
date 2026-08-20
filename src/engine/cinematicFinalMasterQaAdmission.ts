import { z } from "zod";
import {
  CinematicCreativeLocksSchema,
  CinematicEditDecisionListSchema,
  type CinematicCreativeLocks,
  type CinematicEditDecisionList,
} from "./cinematicCaseSequence";
import {
  CINEMATIC_FINAL_MASTER_QA_MAX_REVIEW_CALLS,
  cinematicFinalMasterQaReviewCost,
} from "./pricing";

/**
 * Durable, pre-render proof that the exact final-master visual reviewer can
 * be afforded. The receipt is emitted as soon as the source-bound sequence is
 * admitted, then rechecked before Novita is allowed to spend.
 */
export const CINEMATIC_FINAL_MASTER_QA_ADMISSION_VERSION =
  "cinematic-final-master-qa-admission/v1";

export const CinematicFinalMasterQaAdmissionSchema = z.object({
  version: z.literal(CINEMATIC_FINAL_MASTER_QA_ADMISSION_VERSION),
  sequenceFingerprint: z.string().min(1),
  /** Optional review-only provenance; never a similarity/comparison result. */
  referenceMechanicsPacketFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  /** Optional reviewed factual-semantics provenance carried from cinematic admission. */
  narrativeEvidenceLedgerFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  reviewer: z.literal("non_google_vision"),
  lockCount: z.number().int().min(1).max(240),
  cutCount: z.number().int().min(0).max(239),
  reviewCallCount: z.number().int().min(1).max(CINEMATIC_FINAL_MASTER_QA_MAX_REVIEW_CALLS),
  reviewCostUsd: z.number().finite().min(0),
});

export type CinematicFinalMasterQaAdmission = z.infer<
  typeof CinematicFinalMasterQaAdmissionSchema
>;

function exactIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((id, index) => id === b[index]);
}

function expectedAdmission(args: {
  creativeLocks: CinematicCreativeLocks;
  editDecisionList: CinematicEditDecisionList;
}): Omit<CinematicFinalMasterQaAdmission, "reviewCostUsd"> {
  if (args.creativeLocks.sequenceFingerprint !== args.editDecisionList.sequenceFingerprint) {
    throw new Error("cinematic final-master QA admission cannot combine locks and EDL from different sequences");
  }
  if (
    args.creativeLocks.referenceMechanicsPacketFingerprint !==
    args.editDecisionList.referenceMechanicsPacketFingerprint
  ) {
    throw new Error("cinematic final-master QA admission cannot combine mechanics provenance from different review packets");
  }
  if (
    args.creativeLocks.narrativeEvidenceLedgerFingerprint !==
    args.editDecisionList.narrativeEvidenceLedgerFingerprint
  ) {
    throw new Error("cinematic final-master QA admission cannot combine Narrative Evidence Ledger provenance from different review packets");
  }
  const lockIds = args.creativeLocks.locks.map((lock) => lock.id);
  const editIds = args.editDecisionList.edits.map((edit) => edit.shotId);
  if (!exactIds(lockIds, editIds)) {
    throw new Error("cinematic final-master QA admission requires one creative lock for every EDL shot");
  }
  const lockCount = lockIds.length;
  const cutCount = Math.max(0, editIds.length - 1);
  return {
    version: CINEMATIC_FINAL_MASTER_QA_ADMISSION_VERSION,
    sequenceFingerprint: args.creativeLocks.sequenceFingerprint,
    ...(args.creativeLocks.referenceMechanicsPacketFingerprint
      ? { referenceMechanicsPacketFingerprint: args.creativeLocks.referenceMechanicsPacketFingerprint }
      : {}),
    ...(args.creativeLocks.narrativeEvidenceLedgerFingerprint
      ? { narrativeEvidenceLedgerFingerprint: args.creativeLocks.narrativeEvidenceLedgerFingerprint }
      : {}),
    reviewer: "non_google_vision",
    lockCount,
    cutCount,
    reviewCallCount: lockCount + cutCount,
  };
}

export function admitCinematicFinalMasterQa(args: {
  creativeLocks: CinematicCreativeLocks;
  editDecisionList: CinematicEditDecisionList;
}): CinematicFinalMasterQaAdmission {
  const expected = expectedAdmission(args);
  return CinematicFinalMasterQaAdmissionSchema.parse({
    ...expected,
    reviewCostUsd: cinematicFinalMasterQaReviewCost(expected.reviewCallCount),
  });
}

/**
 * Refuse a stale, weakened, or hand-edited receipt. Cost is intentionally
 * preserved from the admission moment so a resumed run keeps its original
 * bounded authority even if an operator later changes price configuration.
 */
export function assertCinematicFinalMasterQaAdmission(args: {
  admission: unknown;
  creativeLocks: unknown;
  editDecisionList: unknown;
}): CinematicFinalMasterQaAdmission {
  const creativeLocks = CinematicCreativeLocksSchema.parse(args.creativeLocks);
  const editDecisionList = CinematicEditDecisionListSchema.parse(args.editDecisionList);
  const expected = expectedAdmission({ creativeLocks, editDecisionList });
  const admission = CinematicFinalMasterQaAdmissionSchema.parse(args.admission);
  if (
    admission.sequenceFingerprint !== expected.sequenceFingerprint ||
    admission.referenceMechanicsPacketFingerprint !== expected.referenceMechanicsPacketFingerprint ||
    admission.narrativeEvidenceLedgerFingerprint !== expected.narrativeEvidenceLedgerFingerprint ||
    admission.reviewer !== expected.reviewer ||
    admission.lockCount !== expected.lockCount ||
    admission.cutCount !== expected.cutCount ||
    admission.reviewCallCount !== expected.reviewCallCount
  ) {
    throw new Error("cinematic final-master QA admission no longer matches the admitted sequence");
  }
  return admission;
}

/**
 * A source-bound cinematic master cannot truthfully receive `qaPassed` from
 * the lightweight draft path: its contract requires the independently
 * reviewed final-master lock, claim, and cut receipt.  Reject before any
 * reviewer/provider work rather than returning a green QA result without
 * that evidence.
 */
export function assertCinematicFinalMasterQaProfile(qaProfile: unknown): void {
  if (qaProfile === "draft") {
    throw new Error(
      "cinematic final-master QA cannot use qaProfile=draft; " +
        "run the evidence-backed production QA profile to obtain the required lock, claim, and causal-cut receipt",
    );
  }
}

/**
 * A Casefile master is admitted as a cinematic experience, not merely a
 * technically audible video.  Loudness proves that a track exists; it cannot
 * prove that the final narration, score, and diegetic bed are production
 * quality.  Keep that distinction executable at the final-master boundary so
 * a failed/unavailable aesthetics scorer cannot be silently downgraded to a
 * loudness-only green result.
 */
export function assertCinematicFinalMasterAudioAesthetics(
  audioQa: unknown,
  productionQuality: unknown,
): number {
  if (audioQa !== true) {
    throw new Error(
      "cinematic final-master QA requires audioQa=true for an independently scored final mix",
    );
  }
  if (
    typeof productionQuality !== "number" ||
    !Number.isFinite(productionQuality) ||
    productionQuality < 0 ||
    productionQuality > 10
  ) {
    throw new Error(
      "cinematic final-master QA requires a finite 0..10 audio aesthetics production-quality score; loudness alone is insufficient",
    );
  }
  return productionQuality;
}

/** `undefined` means this is not a cinematic final-master route. */
export function cinematicFinalMasterQaAdmissionCost(value: unknown): number {
  if (value === undefined) return 0;
  return CinematicFinalMasterQaAdmissionSchema.parse(value).reviewCostUsd;
}
