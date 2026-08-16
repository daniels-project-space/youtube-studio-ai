/**
 * Final-master cinematic QA evidence contract.
 *
 * `visualReview` owns frame extraction and independent non-Google vision
 * judgement. This module deliberately makes no provider call: it validates the
 * receipt which says how that judgement covered the approved cinematic plan.
 *
 * A generic `defects: []` response is not enough to certify a Fern-style
 * sequence. A releasable receipt must bind the actual final-master frames to
 * every creative lock, planned claim, and causal/tension cut in the EDL.
 */
import { z } from "zod";

import type {
  CinematicCaseSequenceInput,
  CinematicCreativeLocks,
  CinematicEditDecisionList,
  CinematicMannequin,
} from "@/engine/cinematicCaseSequence";
import type { VisualReviewEvidence, VisualReviewFrame } from "@/lib/visualReview";
import { visionLocal, VISION_GATE_MAX_TOKENS } from "@/lib/vision";

export const CINEMATIC_FINAL_MASTER_QA_EVIDENCE_VERSION =
  "cinematic-final-master-qa-evidence/v2" as const;

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/, "expected sha256 fingerprint");
const reviewFingerprint = z.string().regex(/^[a-f0-9]{16,128}$/, "expected visual-review fingerprint");
const shotId = z.string().regex(/^cinematic-shot-[a-z0-9][a-z0-9-]{1,119}$/);
const beatId = z.string().regex(/^cinematic-beat-[a-z0-9][a-z0-9-]{1,119}$/);
const mannequinId = z.string().regex(/^mannequin-[a-z0-9][a-z0-9-]{1,119}$/);
const claimId = z.string().regex(/^claim-[a-z0-9][a-z0-9-]{1,119}$/);
const sourceId = z.string().regex(/^source-[a-z0-9][a-z0-9-]{1,119}$/);
const frameId = z.string().trim().min(1).max(160);

const ContinuitySchema = z.object({
  castId: mannequinId,
  faceless: z.literal(true),
  noLikeness: z.literal(true),
  silhouetteContinuous: z.literal(true),
  wardrobeContinuous: z.literal(true),
  paletteContinuous: z.literal(true),
  keyPropContinuous: z.literal(true),
  movementProfileContinuous: z.literal(true),
}).strict();

const LockReceiptSchema = z.object({
  shotId,
  /** The exact accepted criteria copied from the approved creative lock. */
  acceptedCriteria: z.array(z.string().trim().min(1).max(360)).min(4).max(10),
  /** Start / middle / end are intentionally explicit: a midpoint cannot certify continuity. */
  startFrameId: frameId,
  middleFrameId: frameId,
  endFrameId: frameId,
  continuity: z.array(ContinuitySchema).max(4),
  pass: z.literal(true),
}).strict();

const ClaimReceiptSchema = z.object({
  claimId,
  shotId,
  evidenceFrameIds: z.array(frameId).min(1).max(12),
  /** The on-screen citation/disclosure and the visual both support the spoken claim. */
  onScreenCitationVisible: z.literal(true),
  visualSupportVisible: z.literal(true),
  pass: z.literal(true),
}).strict();

const StoryPayoffReceiptSchema = z.object({
  coldOpenBeatId: beatId,
  revealBeatId: beatId,
  /** The cited source-proof shot that visibly carries the later answer/reframe. */
  shotId,
  citedClaimIds: z.array(claimId).min(1).max(24),
  citedSourceIds: z.array(sourceId).min(1).max(24),
  evidenceFrameIds: z.array(frameId).min(1).max(12),
  causalQuestionAnsweredOrReframed: z.literal(true),
  onScreenCitationVisible: z.literal(true),
  visualSupportVisible: z.literal(true),
  pass: z.literal(true),
}).strict();

const CutReceiptSchema = z.object({
  /** The EDL edit which begins this shot; the opening shot has no cut receipt. */
  shotId,
  cutReason: z.string().trim().min(1).max(80),
  tensionState: z.string().trim().min(1).max(80),
  beforeFrameId: frameId,
  afterFrameId: frameId,
  causalTurnVisible: z.literal(true),
  tensionTransitionVisible: z.literal(true),
  pass: z.literal(true),
}).strict();

export const CinematicFinalMasterQaEvidenceReceiptSchema = z.object({
  version: z.literal(CINEMATIC_FINAL_MASTER_QA_EVIDENCE_VERSION),
  /** Final-master and review fingerprints prevent a receipt being replayed for another render. */
  sequenceFingerprint: fingerprint,
  finalMasterSha256: fingerprint,
  visualReviewFingerprint: reviewFingerprint,
  reviewer: z.literal("non_google_vision"),
  locks: z.array(LockReceiptSchema).min(2).max(2_000),
  claims: z.array(ClaimReceiptSchema).min(1).max(20_000),
  payoffs: z.array(StoryPayoffReceiptSchema).min(1).max(500),
  cuts: z.array(CutReceiptSchema).max(2_000),
  pass: z.literal(true),
}).strict();

export type CinematicFinalMasterQaEvidenceReceipt = z.infer<typeof CinematicFinalMasterQaEvidenceReceiptSchema>;

export interface CinematicQaExpectedLock {
  shotId: string;
  startSec: number;
  endSec: number;
  acceptanceCriteria: readonly string[];
  cast: readonly CinematicMannequin[];
  claimIds: readonly string[];
  storyPayoffs: readonly CinematicQaExpectedStoryPayoff[];
}

export interface CinematicQaExpectedCut {
  shotId: string;
  atSec: number;
  cutReason: string;
  tensionState: string;
}

/** A source-proof reveal which explicitly earns the opening causal question. */
export interface CinematicQaExpectedStoryPayoff {
  coldOpenBeatId: string;
  revealBeatId: string;
  shotId: string;
  coldOpenCausalQuestion: string;
  answerOrReframe: string;
  citedClaimIds: readonly string[];
  citedSourceIds: readonly string[];
}

/**
 * The exact final-master QA plan. It is generated from the already-admitted
 * cinematic sequence, so a caller cannot silently hand QA a looser parallel
 * description of the same episode.
 */
export interface CinematicFinalMasterQaPlan {
  sequenceFingerprint: string;
  bodyOffsetSec: number;
  locks: CinematicQaExpectedLock[];
  payoffs: CinematicQaExpectedStoryPayoff[];
  cuts: CinematicQaExpectedCut[];
}

/** A selected final-master review frame paired with the local image the reviewer saw. */
export interface CinematicQaEvidenceFrame extends VisualReviewFrame {
  localPath: string;
}

/**
 * Kept injectable for deterministic tests. The production implementation below
 * is explicitly restricted to the existing non-Google vision chain.
 */
export interface CinematicFinalMasterQaReviewerInput {
  kind: "lock" | "cut";
  prompt: string;
  frames: readonly CinematicQaEvidenceFrame[];
}

export type CinematicFinalMasterQaReviewer = (
  input: CinematicFinalMasterQaReviewerInput,
) => Promise<string>;

const LockJudgementSchema = z.object({
  pass: z.literal(true),
  acceptedCriteria: z.array(z.string().trim().min(1).max(360)).min(4).max(10),
  continuity: z.array(ContinuitySchema).max(4),
  claims: z.array(z.object({
    claimId,
    onScreenCitationVisible: z.literal(true),
    visualSupportVisible: z.literal(true),
    pass: z.literal(true),
  }).strict()).max(200),
  storyPayoffs: z.array(z.object({
    coldOpenBeatId: beatId,
    revealBeatId: beatId,
    causalQuestionAnsweredOrReframed: z.literal(true),
    onScreenCitationVisible: z.literal(true),
    visualSupportVisible: z.literal(true),
    pass: z.literal(true),
  }).strict()).max(24),
}).strict();

const CutJudgementSchema = z.object({
  pass: z.literal(true),
  cutReason: z.string().trim().min(1).max(80),
  tensionState: z.string().trim().min(1).max(80),
  causalTurnVisible: z.literal(true),
  tensionTransitionVisible: z.literal(true),
}).strict();

function finiteNonNegative(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function exactSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function sorted(values: readonly string[]): string[] {
  return unique(values).sort((left, right) => left.localeCompare(right));
}

function assertUnique(ids: readonly string[], label: string): void {
  if (new Set(ids).size !== ids.length) throw new Error(`cinematic QA evidence has duplicate ${label}`);
}

function parseReviewerJson(raw: string, label: string): unknown {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(stripped);
  } catch {
    throw new Error(`cinematic QA ${label} reviewer returned malformed JSON`);
  }
}

function selectedEvidenceFrames(args: {
  evidence: Pick<VisualReviewEvidence, "frames">;
  framePaths: readonly string[];
}): CinematicQaEvidenceFrame[] {
  if (args.evidence.frames.length !== args.framePaths.length) {
    throw new Error(
      `cinematic QA requires one local path per persisted visual-review frame (${args.framePaths.length}/${args.evidence.frames.length})`,
    );
  }
  const frames = args.evidence.frames.map((frame, index) => ({
    ...frame,
    localPath: args.framePaths[index] ?? "",
  }));
  if (frames.some((frame) => !frame.localPath.trim())) {
    throw new Error("cinematic QA visual-review evidence contains a missing local frame path");
  }
  assertUnique(frames.map((frame) => frame.id), "selected visual-review frame id");
  return frames;
}

function nearestEvidenceFrame(args: {
  frames: readonly CinematicQaEvidenceFrame[];
  targetSec: number;
  minSec: number;
  maxSec: number;
  exclude?: ReadonlySet<string>;
  context: string;
}): CinematicQaEvidenceFrame {
  const candidate = args.frames
    .filter((frame) =>
      frame.tSec >= args.minSec - 0.11 &&
      frame.tSec <= args.maxSec + 0.11 &&
      !args.exclude?.has(frame.id),
    )
    .sort((left, right) => Math.abs(left.tSec - args.targetSec) - Math.abs(right.tSec - args.targetSec))[0];
  if (!candidate) {
    throw new Error(
      `cinematic QA lacks selected visual-review evidence for ${args.context} near ${args.targetSec.toFixed(2)}s`,
    );
  }
  return candidate;
}

function lockEvidenceFrames(
  lock: CinematicQaExpectedLock,
  frames: readonly CinematicQaEvidenceFrame[],
): [CinematicQaEvidenceFrame, CinematicQaEvidenceFrame, CinematicQaEvidenceFrame] {
  const span = lock.endSec - lock.startSec;
  if (!Number.isFinite(span) || span <= 0) {
    throw new Error(`cinematic QA lock ${lock.shotId} has invalid review timing`);
  }
  const used = new Set<string>();
  const start = nearestEvidenceFrame({
    frames,
    targetSec: lock.startSec + Math.min(0.25, span / 4),
    minSec: lock.startSec,
    maxSec: lock.startSec + span * 0.35,
    exclude: used,
    context: `lock ${lock.shotId} start`,
  });
  used.add(start.id);
  const middle = nearestEvidenceFrame({
    frames,
    targetSec: (lock.startSec + lock.endSec) / 2,
    minSec: lock.startSec + span * 0.30,
    maxSec: lock.endSec - span * 0.30,
    exclude: used,
    context: `lock ${lock.shotId} middle`,
  });
  used.add(middle.id);
  const end = nearestEvidenceFrame({
    frames,
    targetSec: lock.endSec - Math.min(0.25, span / 4),
    minSec: lock.endSec - span * 0.35,
    maxSec: lock.endSec,
    exclude: used,
    context: `lock ${lock.shotId} end`,
  });
  return [start, middle, end];
}

function lockReviewerPrompt(lock: CinematicQaExpectedLock, frames: readonly CinematicQaEvidenceFrame[]): string {
  const cast = lock.cast.map((mannequin) => ({
    castId: mannequin.id,
    silhouette: mannequin.silhouette,
    wardrobe: mannequin.wardrobeSignature,
    palette: mannequin.palette,
    keyProp: mannequin.keyProp,
    movementProfile: mannequin.movementProfile,
  }));
  const payoffs = lock.storyPayoffs.map((payoff) => ({
    coldOpenBeatId: payoff.coldOpenBeatId,
    revealBeatId: payoff.revealBeatId,
    coldOpenCausalQuestion: payoff.coldOpenCausalQuestion,
    answerOrReframe: payoff.answerOrReframe,
    citedClaimIds: payoff.citedClaimIds,
    citedSourceIds: payoff.citedSourceIds,
  }));
  return [
    "You are the independent final-master cinematic QA reviewer. This is a factual, faceless-mannequin reconstruction.",
    `Review the START, MIDDLE, and END frames for approved shot ${lock.shotId}. Never infer a real-person likeness or a fact not shown in the frames.`,
    `Frame order: ${frames.map((frame) => `${frame.id}@${frame.tSec.toFixed(2)}s`).join(", ")}.`,
    `Required acceptance criteria (repeat ALL exactly only if all are visibly satisfied): ${JSON.stringify(lock.acceptanceCriteria)}`,
    `Required mannequin continuity (every listed flag must be true only if visibly supported): ${JSON.stringify(cast)}`,
    `Approved claim ids for this shot: ${JSON.stringify(lock.claimIds)}. Only attest a claim when both a visible visual support and its on-screen citation/disclosure are visible.`,
    payoffs.length
      ? `Required story payoff(s): ${JSON.stringify(payoffs)}. For every listed payoff, certify it only when this cited source-proof reveal visibly answers or reframes that exact cold-open question without relying on unsupported prose.`
      : "No story payoff is assigned to this lock; return an empty storyPayoffs array.",
    "Return JSON only: {\"pass\":true,\"acceptedCriteria\":[...],\"continuity\":[{\"castId\":\"...\",\"faceless\":true,\"noLikeness\":true,\"silhouetteContinuous\":true,\"wardrobeContinuous\":true,\"paletteContinuous\":true,\"keyPropContinuous\":true,\"movementProfileContinuous\":true}],\"claims\":[{\"claimId\":\"...\",\"onScreenCitationVisible\":true,\"visualSupportVisible\":true,\"pass\":true}],\"storyPayoffs\":[{\"coldOpenBeatId\":\"...\",\"revealBeatId\":\"...\",\"causalQuestionAnsweredOrReframed\":true,\"onScreenCitationVisible\":true,\"visualSupportVisible\":true,\"pass\":true}]}. If any condition fails or cannot be seen, return {\"pass\":false}.",
  ].join("\n");
}

function cutEvidenceFrames(
  cut: CinematicQaExpectedCut,
  frames: readonly CinematicQaEvidenceFrame[],
): [CinematicQaEvidenceFrame, CinematicQaEvidenceFrame] {
  const before = nearestEvidenceFrame({
    frames,
    targetSec: cut.atSec - 0.25,
    minSec: cut.atSec - 1.1,
    maxSec: cut.atSec - 0.04,
    context: `cut ${cut.shotId} before`,
  });
  const after = nearestEvidenceFrame({
    frames,
    targetSec: cut.atSec + 0.25,
    minSec: cut.atSec + 0.04,
    maxSec: cut.atSec + 1.1,
    exclude: new Set([before.id]),
    context: `cut ${cut.shotId} after`,
  });
  return [before, after];
}

function cutReviewerPrompt(cut: CinematicQaExpectedCut, frames: readonly CinematicQaEvidenceFrame[]): string {
  return [
    "You are the independent final-master cinematic QA reviewer.",
    `Review the BEFORE and AFTER frames at the planned causal edit into ${cut.shotId}: ${frames.map((frame) => `${frame.id}@${frame.tSec.toFixed(2)}s`).join(", ")}.`,
    `The approved causal reason is ${JSON.stringify(cut.cutReason)} and approved tension state is ${JSON.stringify(cut.tensionState)}.`,
    "Return JSON only: {\"pass\":true,\"cutReason\":\"exact approved reason\",\"tensionState\":\"exact approved state\",\"causalTurnVisible\":true,\"tensionTransitionVisible\":true}. If either side of the cut, causal turn, or tension transition cannot be seen, return {\"pass\":false}.",
  ].join("\n");
}

export async function defaultCinematicFinalMasterQaReviewer(
  input: CinematicFinalMasterQaReviewerInput,
): Promise<string> {
  return visionLocal({
    prompt: input.prompt,
    imagePaths: input.frames.map((frame) => frame.localPath),
    json: true,
    maxTokens: VISION_GATE_MAX_TOKENS,
    reasoningEffort: "none",
    noCache: true,
    providers: ["openrouter"], tier: "final",
    maxAttemptsPerProvider: 1,
  });
}

/**
 * Perform the semantic, per-lock/per-cut second pass over the exact frames the
 * generic visual review selected. It intentionally performs no extraction and
 * never calls a Google provider. A single incomplete judgement fails the run.
 */
export async function reviewCinematicFinalMasterQaEvidence(args: {
  plan: CinematicFinalMasterQaPlan;
  evidence: Pick<VisualReviewEvidence, "frames" | "coverage">;
  framePaths: readonly string[];
  visualReviewFingerprint: string;
  finalMasterSha256: string;
  reviewer?: CinematicFinalMasterQaReviewer;
}): Promise<CinematicFinalMasterQaEvidenceReceipt> {
  const reviewer = args.reviewer ?? defaultCinematicFinalMasterQaReviewer;
  const frames = selectedEvidenceFrames({ evidence: args.evidence, framePaths: args.framePaths });
  const locks: CinematicFinalMasterQaEvidenceReceipt["locks"] = [];
  const claims: CinematicFinalMasterQaEvidenceReceipt["claims"] = [];
  const payoffs: CinematicFinalMasterQaEvidenceReceipt["payoffs"] = [];
  const cuts: CinematicFinalMasterQaEvidenceReceipt["cuts"] = [];
  for (const lock of args.plan.locks) {
    const selected = lockEvidenceFrames(lock, frames);
    const judgement = LockJudgementSchema.parse(parseReviewerJson(
      await reviewer({ kind: "lock", frames: selected, prompt: lockReviewerPrompt(lock, selected) }),
      `lock ${lock.shotId}`,
    ));
    locks.push({
      shotId: lock.shotId,
      acceptedCriteria: judgement.acceptedCriteria,
      startFrameId: selected[0].id,
      middleFrameId: selected[1].id,
      endFrameId: selected[2].id,
      continuity: judgement.continuity,
      pass: true,
    });
    for (const claim of judgement.claims) {
      claims.push({
        claimId: claim.claimId,
        shotId: lock.shotId,
        evidenceFrameIds: selected.map((frame) => frame.id),
        onScreenCitationVisible: true,
        visualSupportVisible: true,
        pass: true,
      });
    }
    for (const payoff of judgement.storyPayoffs) {
      const expected = lock.storyPayoffs.find((candidate) =>
        candidate.coldOpenBeatId === payoff.coldOpenBeatId &&
        candidate.revealBeatId === payoff.revealBeatId,
      );
      if (!expected) {
        throw new Error(`cinematic QA lock ${lock.shotId} reviewer attested an unplanned story payoff`);
      }
      payoffs.push({
        coldOpenBeatId: expected.coldOpenBeatId,
        revealBeatId: expected.revealBeatId,
        shotId: expected.shotId,
        citedClaimIds: [...expected.citedClaimIds],
        citedSourceIds: [...expected.citedSourceIds],
        evidenceFrameIds: selected.map((frame) => frame.id),
        causalQuestionAnsweredOrReframed: true,
        onScreenCitationVisible: true,
        visualSupportVisible: true,
        pass: true,
      });
    }
  }
  for (const cut of args.plan.cuts) {
    const selected = cutEvidenceFrames(cut, frames);
    const judgement = CutJudgementSchema.parse(parseReviewerJson(
      await reviewer({ kind: "cut", frames: selected, prompt: cutReviewerPrompt(cut, selected) }),
      `cut ${cut.shotId}`,
    ));
    cuts.push({
      shotId: cut.shotId,
      cutReason: judgement.cutReason,
      tensionState: judgement.tensionState,
      beforeFrameId: selected[0].id,
      afterFrameId: selected[1].id,
      causalTurnVisible: true,
      tensionTransitionVisible: true,
      pass: true,
    });
  }
  return assertCinematicFinalMasterQaEvidence({
    receipt: {
      version: CINEMATIC_FINAL_MASTER_QA_EVIDENCE_VERSION,
      sequenceFingerprint: args.plan.sequenceFingerprint,
      finalMasterSha256: args.finalMasterSha256,
      visualReviewFingerprint: args.visualReviewFingerprint,
      reviewer: "non_google_vision",
      locks,
      claims,
      payoffs,
      cuts,
      pass: true,
    },
    plan: args.plan,
    evidence: args.evidence,
    visualReviewFingerprint: args.visualReviewFingerprint,
    finalMasterSha256: args.finalMasterSha256,
  });
}

/** Build the strict QA plan from source-bound cinematic inputs. */
export function cinematicFinalMasterQaPlan(args: {
  sequence: Pick<CinematicCaseSequenceInput, "cast" | "beats"> & { contentFingerprint?: string };
  creativeLocks: CinematicCreativeLocks;
  editDecisionList: CinematicEditDecisionList;
  bodyOffsetSec?: number;
}): CinematicFinalMasterQaPlan {
  const offset = finiteNonNegative(args.bodyOffsetSec);
  if (args.creativeLocks.sequenceFingerprint !== args.editDecisionList.sequenceFingerprint) {
    throw new Error("cinematic QA plan cannot combine creative locks and EDL from different sequences");
  }
  const castById = new Map(args.sequence.cast.map((cast) => [cast.id, cast]));
  const shotPlan = new Map<string, { castIds: string[]; claimIds: string[] }>();
  for (const beat of args.sequence.beats) {
    for (const shot of beat.shots) {
      if (shotPlan.has(shot.id)) throw new Error(`cinematic QA plan contains duplicate shot ${shot.id}`);
      shotPlan.set(shot.id, { castIds: [...shot.castIds], claimIds: [...beat.claimIds] });
    }
  }
  const coldOpen = args.sequence.beats.find((beat) => beat.narrativeRole === "cold_open");
  if (!coldOpen) throw new Error("cinematic QA plan requires a cold-open beat");
  const payoffs: CinematicQaExpectedStoryPayoff[] = [];
  for (const beat of args.sequence.beats) {
    const payoff = beat.storyPayoff;
    if (!payoff) continue;
    if (beat.narrativeRole !== "reveal") {
      throw new Error(`cinematic QA plan found storyPayoff on non-reveal beat ${beat.id}`);
    }
    if (payoff.coldOpenBeatId !== coldOpen.id) {
      throw new Error(`cinematic QA storyPayoff ${beat.id} is not bound to cold-open beat ${coldOpen.id}`);
    }
    if (
      !payoff.citedClaimIds.every((id) => beat.claimIds.includes(id)) ||
      !payoff.citedSourceIds.every((id) => beat.sourceIds.includes(id))
    ) {
      throw new Error(`cinematic QA storyPayoff ${beat.id} cites ids outside its approved reveal binding`);
    }
    const sourceProofShot = [...beat.shots]
      .sort((left, right) => left.t0 - right.t0 || left.id.localeCompare(right.id))
      .find((shot) => shot.coveragePurpose === "evidence_insert" && shot.visualMode === "source_proof");
    if (!sourceProofShot) {
      throw new Error(`cinematic QA storyPayoff ${beat.id} lacks a cited source-proof evidence insert`);
    }
    payoffs.push({
      coldOpenBeatId: coldOpen.id,
      revealBeatId: beat.id,
      shotId: sourceProofShot.id,
      coldOpenCausalQuestion: coldOpen.causalQuestion,
      answerOrReframe: payoff.answerOrReframe,
      citedClaimIds: sorted(payoff.citedClaimIds),
      citedSourceIds: sorted(payoff.citedSourceIds),
    });
  }
  if (!payoffs.length) {
    throw new Error("cinematic QA plan requires a later source-bound storyPayoff before final-master review");
  }
  assertUnique(payoffs.map((payoff) => `${payoff.coldOpenBeatId}/${payoff.revealBeatId}`), "story payoff");
  const payoffByShot = new Map<string, CinematicQaExpectedStoryPayoff[]>();
  for (const payoff of payoffs) {
    const forShot = payoffByShot.get(payoff.shotId) ?? [];
    forShot.push(payoff);
    payoffByShot.set(payoff.shotId, forShot);
  }
  const locks = args.creativeLocks.locks.map((lock) => {
    const planned = shotPlan.get(lock.id);
    if (!planned) throw new Error(`cinematic QA creative lock ${lock.id} has no approved shot plan`);
    const cast = planned.castIds.map((id) => {
      const mannequin = castById.get(id);
      if (!mannequin) throw new Error(`cinematic QA shot ${lock.id} references unknown mannequin ${id}`);
      return mannequin;
    });
    return {
      shotId: lock.id,
      startSec: lock.startSec + offset,
      endSec: lock.endSec + offset,
      acceptanceCriteria: [...lock.acceptanceCriteria],
      cast,
      claimIds: sorted(planned.claimIds),
      storyPayoffs: payoffByShot.get(lock.id) ?? [],
    };
  });
  assertUnique(locks.map((lock) => lock.shotId), "creative-lock shot id");
  const lockIds = new Set(locks.map((lock) => lock.shotId));
  for (const payoff of payoffs) {
    if (!lockIds.has(payoff.shotId)) {
      throw new Error(`cinematic QA storyPayoff ${payoff.revealBeatId} has no final-master creative lock`);
    }
  }
  const editByShot = new Map(args.editDecisionList.edits.map((edit) => [edit.shotId, edit]));
  if (!exactSet(sorted([...lockIds]), sorted(args.editDecisionList.edits.map((edit) => edit.shotId)))) {
    throw new Error("cinematic QA plan requires one creative lock for every planned EDL shot");
  }
  for (const lock of locks) {
    const edit = editByShot.get(lock.shotId)!;
    if (Math.abs(lock.startSec - (edit.t0 + offset)) > 0.01 || Math.abs(lock.endSec - (edit.t1 + offset)) > 0.01) {
      throw new Error(`cinematic QA lock ${lock.shotId} timing does not match the approved EDL`);
    }
  }
  const cuts = args.editDecisionList.edits.slice(1).map((edit) => {
    if (!lockIds.has(edit.shotId)) {
      throw new Error(`cinematic QA EDL edit ${edit.shotId} has no final-master creative lock`);
    }
    return {
      shotId: edit.shotId,
      atSec: edit.t0 + offset,
      cutReason: edit.cutReason,
      tensionState: edit.tensionState,
    };
  });
  assertUnique(cuts.map((cut) => cut.shotId), "EDL cut shot id");
  return {
    sequenceFingerprint: args.creativeLocks.sequenceFingerprint,
    bodyOffsetSec: offset,
    locks,
    payoffs,
    cuts,
  };
}

function actualFrameMap(evidence: Pick<VisualReviewEvidence, "frames">): Map<string, VisualReviewFrame> {
  const frames = new Map<string, VisualReviewFrame>();
  for (const frame of evidence.frames) {
    if (!Number.isFinite(frame.tSec) || frame.tSec < 0) {
      throw new Error(`cinematic QA evidence has an invalid frame timestamp for ${frame.id}`);
    }
    if (frames.has(frame.id)) throw new Error(`cinematic QA evidence has duplicate frame id ${frame.id}`);
    frames.set(frame.id, frame);
  }
  return frames;
}

function frameAt(frames: ReadonlyMap<string, VisualReviewFrame>, id: string, context: string): VisualReviewFrame {
  const frame = frames.get(id);
  if (!frame) throw new Error(`cinematic QA ${context} references missing visual-review frame ${id}`);
  return frame;
}

function assertTimeWithin(value: number, startSec: number, endSec: number, context: string): void {
  if (value < startSec - 0.11 || value > endSec + 0.11) {
    throw new Error(`cinematic QA ${context} frame @${value.toFixed(2)}s lies outside ${startSec.toFixed(2)}–${endSec.toFixed(2)}s`);
  }
}

function assertLockFrameSpread(
  receipt: z.infer<typeof LockReceiptSchema>,
  lock: CinematicQaExpectedLock,
  frames: ReadonlyMap<string, VisualReviewFrame>,
): void {
  const ids = [receipt.startFrameId, receipt.middleFrameId, receipt.endFrameId];
  if (new Set(ids).size !== 3) throw new Error(`cinematic QA lock ${lock.shotId} reuses one frame for continuity`);
  const [start, middle, end] = ids.map((id) => frameAt(frames, id, `lock ${lock.shotId}`));
  const span = lock.endSec - lock.startSec;
  if (!Number.isFinite(span) || span <= 0) throw new Error(`cinematic QA lock ${lock.shotId} has invalid timing`);
  assertTimeWithin(start.tSec, lock.startSec, lock.startSec + span * 0.35, `lock ${lock.shotId} start`);
  assertTimeWithin(middle.tSec, lock.startSec + span * 0.30, lock.endSec - span * 0.30, `lock ${lock.shotId} middle`);
  assertTimeWithin(end.tSec, lock.endSec - span * 0.35, lock.endSec, `lock ${lock.shotId} end`);
}

function assertContinuity(
  receipt: z.infer<typeof LockReceiptSchema>,
  lock: CinematicQaExpectedLock,
): void {
  assertUnique(receipt.continuity.map((item) => item.castId), `mannequin continuity in ${lock.shotId}`);
  const expected = sorted(lock.cast.map((cast) => cast.id));
  const observed = sorted(receipt.continuity.map((item) => item.castId));
  if (!exactSet(observed, expected)) {
    throw new Error(`cinematic QA lock ${lock.shotId} has incomplete or foreign mannequin continuity evidence`);
  }
}

function assertCriteria(receipt: z.infer<typeof LockReceiptSchema>, lock: CinematicQaExpectedLock): void {
  assertUnique(receipt.acceptedCriteria, `acceptance criterion in ${lock.shotId}`);
  const expected = sorted(lock.acceptanceCriteria);
  const observed = sorted(receipt.acceptedCriteria);
  if (!exactSet(observed, expected)) {
    throw new Error(`cinematic QA lock ${lock.shotId} does not attest every approved acceptance criterion`);
  }
}

function assertClaimCoverage(
  receipt: CinematicFinalMasterQaEvidenceReceipt,
  plan: CinematicFinalMasterQaPlan,
  frames: ReadonlyMap<string, VisualReviewFrame>,
): void {
  const lockByShot = new Map(plan.locks.map((lock) => [lock.shotId, lock]));
  assertUnique(receipt.claims.map((claim) => `${claim.claimId}/${claim.shotId}`), "claim receipt");
  const expectedClaims = new Map<string, Set<string>>();
  for (const lock of plan.locks) {
    for (const id of lock.claimIds) {
      const allowed = expectedClaims.get(id) ?? new Set<string>();
      allowed.add(lock.shotId);
      expectedClaims.set(id, allowed);
    }
  }
  const covered = new Set<string>();
  for (const claim of receipt.claims) {
    const allowedShots = expectedClaims.get(claim.claimId);
    if (!allowedShots?.has(claim.shotId)) {
      throw new Error(`cinematic QA claim ${claim.claimId} is not admitted for shot ${claim.shotId}`);
    }
    const lock = lockByShot.get(claim.shotId)!;
    for (const id of claim.evidenceFrameIds) {
      const frame = frameAt(frames, id, `claim ${claim.claimId}`);
      assertTimeWithin(frame.tSec, lock.startSec, lock.endSec, `claim ${claim.claimId}`);
    }
    covered.add(claim.claimId);
  }
  const missing = [...expectedClaims.keys()].filter((id) => !covered.has(id));
  if (missing.length) throw new Error(`cinematic QA evidence is missing approved claim coverage: ${missing.join(", ")}`);
}

function storyPayoffKey(coldOpenBeatId: string, revealBeatId: string): string {
  return `${coldOpenBeatId}/${revealBeatId}`;
}

function assertStoryPayoffCoverage(
  receipt: CinematicFinalMasterQaEvidenceReceipt,
  plan: CinematicFinalMasterQaPlan,
  frames: ReadonlyMap<string, VisualReviewFrame>,
): void {
  if (receipt.payoffs.length !== plan.payoffs.length) {
    throw new Error(`cinematic QA evidence has ${receipt.payoffs.length}/${plan.payoffs.length} source-bound story payoff receipt(s)`);
  }
  const expected = new Map(plan.payoffs.map((payoff) => [
    storyPayoffKey(payoff.coldOpenBeatId, payoff.revealBeatId),
    payoff,
  ]));
  assertUnique(receipt.payoffs.map((payoff) => storyPayoffKey(payoff.coldOpenBeatId, payoff.revealBeatId)), "story payoff receipt");
  const lockByShot = new Map(plan.locks.map((lock) => [lock.shotId, lock]));
  for (const payoff of receipt.payoffs) {
    const planned = expected.get(storyPayoffKey(payoff.coldOpenBeatId, payoff.revealBeatId));
    if (!planned) {
      throw new Error(`cinematic QA evidence contains foreign story payoff ${payoff.revealBeatId}`);
    }
    if (payoff.shotId !== planned.shotId) {
      throw new Error(`cinematic QA story payoff ${payoff.revealBeatId} is not attached to its approved source-proof shot`);
    }
    if (
      !exactSet(sorted(payoff.citedClaimIds), sorted(planned.citedClaimIds)) ||
      !exactSet(sorted(payoff.citedSourceIds), sorted(planned.citedSourceIds))
    ) {
      throw new Error(`cinematic QA story payoff ${payoff.revealBeatId} does not preserve its approved cited claim/source binding`);
    }
    const lock = lockByShot.get(payoff.shotId);
    if (!lock) throw new Error(`cinematic QA story payoff ${payoff.revealBeatId} has no approved creative lock`);
    for (const id of payoff.evidenceFrameIds) {
      const frame = frameAt(frames, id, `story payoff ${payoff.revealBeatId}`);
      assertTimeWithin(frame.tSec, lock.startSec, lock.endSec, `story payoff ${payoff.revealBeatId}`);
    }
    for (const claimId of planned.citedClaimIds) {
      if (!receipt.claims.some((claim) => claim.claimId === claimId && claim.shotId === payoff.shotId)) {
        throw new Error(`cinematic QA story payoff ${payoff.revealBeatId} lacks cited claim ${claimId} on its source-proof shot`);
      }
    }
  }
}

function assertCuts(
  receipt: CinematicFinalMasterQaEvidenceReceipt,
  plan: CinematicFinalMasterQaPlan,
  frames: ReadonlyMap<string, VisualReviewFrame>,
  toleranceSec: number,
): void {
  if (receipt.cuts.length !== plan.cuts.length) {
    throw new Error(`cinematic QA evidence has ${receipt.cuts.length}/${plan.cuts.length} planned cut receipt(s)`);
  }
  const expected = new Map(plan.cuts.map((cut) => [cut.shotId, cut]));
  assertUnique(receipt.cuts.map((cut) => cut.shotId), "cut receipt shot id");
  for (const cut of receipt.cuts) {
    const planned = expected.get(cut.shotId);
    if (!planned) throw new Error(`cinematic QA evidence contains foreign cut ${cut.shotId}`);
    if (cut.cutReason !== planned.cutReason || cut.tensionState !== planned.tensionState) {
      throw new Error(`cinematic QA cut ${cut.shotId} does not match planned causal/tension state`);
    }
    if (cut.beforeFrameId === cut.afterFrameId) {
      throw new Error(`cinematic QA cut ${cut.shotId} reuses a frame on both sides of the join`);
    }
    const before = frameAt(frames, cut.beforeFrameId, `cut ${cut.shotId}`);
    const after = frameAt(frames, cut.afterFrameId, `cut ${cut.shotId}`);
    if (before.tSec >= planned.atSec || after.tSec <= planned.atSec) {
      throw new Error(`cinematic QA cut ${cut.shotId} must retain distinct before and after frames around its planned join`);
    }
    if (before.tSec > planned.atSec + toleranceSec || before.tSec < planned.atSec - toleranceSec * 2) {
      throw new Error(`cinematic QA cut ${cut.shotId} has no before-frame at its planned join`);
    }
    if (after.tSec < planned.atSec - toleranceSec || after.tSec > planned.atSec + toleranceSec * 2) {
      throw new Error(`cinematic QA cut ${cut.shotId} has no after-frame at its planned join`);
    }
  }
}

/**
 * Validate a final-master cinematic visual QA receipt without invoking an AI
 * provider. It fails closed on malformed, incomplete, cross-render, or
 * cross-sequence evidence; callers may persist the returned typed receipt.
 */
export function assertCinematicFinalMasterQaEvidence(args: {
  receipt: unknown;
  plan: CinematicFinalMasterQaPlan;
  evidence: Pick<VisualReviewEvidence, "frames" | "coverage">;
  visualReviewFingerprint: string;
  finalMasterSha256: string;
  cutToleranceSec?: number;
}): CinematicFinalMasterQaEvidenceReceipt {
  const receipt = CinematicFinalMasterQaEvidenceReceiptSchema.parse(args.receipt);
  if (receipt.sequenceFingerprint !== args.plan.sequenceFingerprint) {
    throw new Error("cinematic QA evidence belongs to a different cinematic sequence");
  }
  if (receipt.visualReviewFingerprint !== args.visualReviewFingerprint) {
    throw new Error("cinematic QA evidence belongs to a different visual-review run");
  }
  if (receipt.finalMasterSha256 !== args.finalMasterSha256) {
    throw new Error("cinematic QA evidence belongs to different final-master bytes");
  }
  if (args.plan.cuts.length > 0) {
    const required = args.evidence.coverage.requiredFocusFrameCount;
    const missing = args.evidence.coverage.missingFocusFrameCount;
    if (typeof required !== "number" || !Number.isInteger(required) || required <= 0 || missing !== 0) {
      throw new Error("cinematic QA evidence requires complete focused cut coverage from visual review");
    }
  }
  const frames = actualFrameMap(args.evidence);
  assertUnique(receipt.locks.map((lock) => lock.shotId), "lock receipt shot id");
  if (receipt.locks.length !== args.plan.locks.length) {
    throw new Error(`cinematic QA evidence has ${receipt.locks.length}/${args.plan.locks.length} creative-lock receipt(s)`);
  }
  const expectedLocks = new Map(args.plan.locks.map((lock) => [lock.shotId, lock]));
  for (const lock of receipt.locks) {
    const planned = expectedLocks.get(lock.shotId);
    if (!planned) throw new Error(`cinematic QA evidence contains foreign creative lock ${lock.shotId}`);
    assertCriteria(lock, planned);
    assertLockFrameSpread(lock, planned, frames);
    assertContinuity(lock, planned);
  }
  assertClaimCoverage(receipt, args.plan, frames);
  assertStoryPayoffCoverage(receipt, args.plan, frames);
  const tolerance = Number.isFinite(args.cutToleranceSec)
    ? Math.max(0.1, Math.min(1, Number(args.cutToleranceSec)))
    : 0.55;
  assertCuts(receipt, args.plan, frames, tolerance);
  return receipt;
}
