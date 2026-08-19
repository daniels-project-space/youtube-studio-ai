import type { CinematicEditDecisionList } from "@/engine/cinematicCaseSequence";
import type { ShotRenderManifest } from "@/engine/renderArtifacts";
import type { ShotAnalysisReceipt } from "@/lib/shotAnalysis";
import { createHash } from "node:crypto";

export const CINEMATIC_EDIT_INTEGRITY_VERSION = "cinematic-edit-integrity/v1" as const;
export const CINEMATIC_EDIT_CUT_TOLERANCE_SEC = 0.85;

export interface CinematicEditIntegrityCut {
  shotId: string;
  cutReason: CinematicEditDecisionList["edits"][number]["cutReason"];
  tensionState: CinematicEditDecisionList["edits"][number]["tensionState"];
  expectedSec: number;
  observedSec?: number;
  deltaSec?: number;
  matched: boolean;
}

export interface CinematicEditIntegrityReceipt {
  version: typeof CINEMATIC_EDIT_INTEGRITY_VERSION;
  evaluator: "pyscenedetect/adaptive";
  sequenceFingerprint: string;
  finalMasterSha256: string;
  bodyOffsetSec: number;
  toleranceSec: number;
  plannedCutCount: number;
  observedCutCount: number;
  matchedCutCount: number;
  pass: boolean;
  cuts: CinematicEditIntegrityCut[];
}

/**
 * The shared LTX renderer predates the source-bound Casefile EDL, but its
 * render manifest is still an exact authored sequence. Keep its cut proof
 * separate so a generic cinematic episode is never mislabeled as Casefile
 * evidence while receiving the same final-master integrity check.
 */
export interface AuthoredShotEditIntegrityReceipt {
  version: typeof CINEMATIC_EDIT_INTEGRITY_VERSION;
  evaluator: "pyscenedetect/adaptive";
  planFingerprint: string;
  finalMasterSha256: string;
  bodyOffsetSec: number;
  toleranceSec: number;
  plannedCutCount: number;
  observedCutCount: number;
  matchedCutCount: number;
  pass: boolean;
  cuts: Array<{
    shotId: string;
    expectedSec: number;
    observedSec?: number;
    deltaSec?: number;
    matched: boolean;
  }>;
}

function resolvedTiming(args: { bodyOffsetSec?: number; toleranceSec?: number }) {
  return {
    offset: Number.isFinite(args.bodyOffsetSec) && Number(args.bodyOffsetSec) > 0
      ? Number(args.bodyOffsetSec)
      : 0,
    toleranceSec: Number.isFinite(args.toleranceSec) && Number(args.toleranceSec) > 0
      ? Number(args.toleranceSec)
      : CINEMATIC_EDIT_CUT_TOLERANCE_SEC,
  };
}

function nearestObservedCut(observed: number[], expectedSec: number) {
  const observedSec = observed.reduce<number | undefined>((best, candidate) =>
    best === undefined || Math.abs(candidate - expectedSec) < Math.abs(best - expectedSec)
      ? candidate
      : best,
  undefined);
  return {
    observedSec,
    deltaSec: observedSec === undefined ? undefined : Math.abs(observedSec - expectedSec),
  };
}

/**
 * The cinematic EDL owns the story time; an optional intro shifts it in the
 * final master. Every edit after the opening shot must have a nearby adaptive
 * scene boundary. This proves the rendered master actually turns when its
 * causal/tension plan says it does, while independent visual review judges the
 * artistic quality of that turn.
 */
export function evaluateCinematicEditIntegrity(args: {
  editDecisionList: CinematicEditDecisionList;
  shotAnalysis: ShotAnalysisReceipt;
  bodyOffsetSec?: number;
  toleranceSec?: number;
}): CinematicEditIntegrityReceipt {
  const { offset, toleranceSec } = resolvedTiming(args);
  // PySceneDetect emits scene starts, so the master opening is not a cut.
  const observed = args.shotAnalysis.scenes.slice(1).map((scene) => scene.startSec);
  const cuts = args.editDecisionList.edits.slice(1).map((edit) => {
    const expectedSec = edit.t0 + offset;
    const { observedSec, deltaSec } = nearestObservedCut(observed, expectedSec);
    return {
      shotId: edit.shotId,
      cutReason: edit.cutReason,
      tensionState: edit.tensionState,
      expectedSec,
      ...(observedSec === undefined ? {} : { observedSec }),
      ...(deltaSec === undefined ? {} : { deltaSec }),
      matched: deltaSec !== undefined && deltaSec <= toleranceSec,
    };
  });
  const matchedCutCount = cuts.filter((cut) => cut.matched).length;
  return {
    version: CINEMATIC_EDIT_INTEGRITY_VERSION,
    evaluator: "pyscenedetect/adaptive",
    sequenceFingerprint: args.editDecisionList.sequenceFingerprint,
    finalMasterSha256: args.shotAnalysis.source.sha256,
    bodyOffsetSec: offset,
    toleranceSec,
    plannedCutCount: cuts.length,
    observedCutCount: observed.length,
    matchedCutCount,
    pass: cuts.length > 0 && matchedCutCount === cuts.length,
    cuts,
  };
}

function authoredShotPlanFingerprint(manifest: ShotRenderManifest): string {
  const plan = manifest.items.map((item) => ({
    shotId: item.shotId,
    t0: item.t0,
    t1: item.t1,
    clipKey: item.clipKey,
  }));
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

export function evaluateAuthoredShotEditIntegrity(args: {
  manifest: ShotRenderManifest;
  shotAnalysis: ShotAnalysisReceipt;
  bodyOffsetSec?: number;
  toleranceSec?: number;
}): AuthoredShotEditIntegrityReceipt {
  const { offset, toleranceSec } = resolvedTiming(args);
  const observed = args.shotAnalysis.scenes.slice(1).map((scene) => scene.startSec);
  const cuts = args.manifest.items.slice(1).map((item) => {
    const expectedSec = item.t0 + offset;
    const { observedSec, deltaSec } = nearestObservedCut(observed, expectedSec);
    return {
      shotId: item.shotId,
      expectedSec,
      ...(observedSec === undefined ? {} : { observedSec }),
      ...(deltaSec === undefined ? {} : { deltaSec }),
      matched: deltaSec !== undefined && deltaSec <= toleranceSec,
    };
  });
  const matchedCutCount = cuts.filter((cut) => cut.matched).length;
  return {
    version: CINEMATIC_EDIT_INTEGRITY_VERSION,
    evaluator: "pyscenedetect/adaptive",
    planFingerprint: authoredShotPlanFingerprint(args.manifest),
    finalMasterSha256: args.shotAnalysis.source.sha256,
    bodyOffsetSec: offset,
    toleranceSec,
    plannedCutCount: cuts.length,
    observedCutCount: observed.length,
    matchedCutCount,
    pass: cuts.length > 0 && matchedCutCount === cuts.length,
    cuts,
  };
}
