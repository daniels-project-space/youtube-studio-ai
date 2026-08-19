import type {
  CinematicCreativeLocks,
  CinematicEditDecisionList,
} from "@/engine/cinematicCaseSequence";

export interface CinematicQaCreativeLock {
  shotId: string;
  startSec: number;
  endSec: number;
  expected: string;
  acceptanceCriteria: string[];
}

export interface CinematicQaFocusWindow {
  startSec: number;
  endSec: number;
  reason: "reviewer";
}

/**
 * Convert narration-relative cinematic evidence to final-master time. A title
 * card is a real visual offset, so reviewing raw EDL timecodes after it would
 * inspect the previous shot rather than the intended causal beat or cut.
 */
export function cinematicFinalMasterQaEvidence(args: {
  creativeLocks: CinematicCreativeLocks;
  editDecisionList: CinematicEditDecisionList;
  bodyOffsetSec?: number;
}): {
  creativeLocks: CinematicQaCreativeLock[];
  focusWindows: CinematicQaFocusWindow[];
} {
  const offset = Number.isFinite(args.bodyOffsetSec) && Number(args.bodyOffsetSec) > 0
    ? Number(args.bodyOffsetSec)
    : 0;
  const creativeLocks = args.creativeLocks.locks.map((lock) => ({
    shotId: lock.id,
    startSec: lock.startSec + offset,
    endSec: lock.endSec + offset,
    expected: lock.expected,
    acceptanceCriteria: [...lock.acceptanceCriteria],
  }));
  const revealWindows = args.editDecisionList.edits
    .filter((edit) => edit.cutReason === "reveal" || edit.cutReason === "contradiction" || edit.tensionState === "reversal")
    .map((edit) => ({
      startSec: edit.t0 + offset,
      endSec: edit.t1 + offset,
      reason: "reviewer" as const,
    }));
  // A single broad midpoint can prove that a shot existed, but cannot prove
  // that the faceless mannequin, wardrobe, prop, lighting, and evidence state
  // survived the shot. Require small start/middle/end inspection windows for
  // every approved lock. `qa_visual` turns these into complete 2fps evidence
  // when the cinematic route is present, independently of its normal cap.
  const lockStateWindows = creativeLocks.flatMap((lock) => {
    const span = Math.max(0, lock.endSec - lock.startSec);
    const inset = Math.min(0.25, span / 4);
    const moments = [
      lock.startSec + inset,
      (lock.startSec + lock.endSec) / 2,
      lock.endSec - inset,
    ];
    return moments.map((moment) => ({
      startSec: Math.max(lock.startSec, moment - 0.1),
      endSec: Math.min(lock.endSec, moment + 0.1),
      reason: "reviewer" as const,
    }));
  });
  // A Fern-like sequence succeeds because the cuts cause turns in information
  // and tension. Sample every actual join densely, not merely the occasional
  // reveal, so the final reviewer can see a dropped, mistimed, or visually
  // incoherent transition in the assembled master.
  const cutWindows = args.editDecisionList.edits.slice(1).map((edit) => ({
    startSec: Math.max(0, edit.t0 + offset - 0.35),
    endSec: edit.t0 + offset + 0.45,
    reason: "reviewer" as const,
  }));
  return { creativeLocks, focusWindows: [...lockStateWindows, ...revealWindows, ...cutWindows] };
}
