/**
 * Provider-free opening evidence for the post-transform Shorts lane.
 *
 * This is deliberately narrower than a channel-wide pacing rubric. It records
 * only facts already produced while building a Short: the caption/overlay plan,
 * its required visual-review evidence, OCR proof, and the reviewer's existing
 * ffmpeg scene-change plan input. It does not assert that a detector measured
 * continuous camera motion or that every channel must cut quickly.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

import { canonicalJson } from "@/lib/canonicalJson";
import { OnScreenTextProofSchema } from "@/lib/onScreenTextProof";
import type { CaptionCue } from "@/lib/ffmpeg";
import type { VisualReviewResult } from "@/lib/visualReview";

export const SHORTS_OPENING_EVIDENCE_VERSION = "shorts-opening-evidence/v1" as const;

const TIME_EPSILON_SEC = 0.001;
// `planVisualReviewEvidence` intentionally rounds extracted frame timestamps
// to tenths. A scene detector timestamp can therefore differ by at most 0.05s
// from the durable review frame that proves it was actually reviewed.
const REVIEW_FRAME_TIME_EPSILON_SEC = 0.051;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, "expected SHA-256");
const objectKey = z.string().trim().min(1).max(2_000);
const identifier = z.string().trim().min(1).max(240);
const finite = z.number().finite();

const finalMasterSchema = z.object({
  sha256,
  durationSec: finite.positive(),
}).strict();

const visualReviewBindingSchema = z.object({
  reviewFingerprint: z.string().trim().min(1).max(256),
  reviewReceiptVersion: z.string().trim().min(1).max(128),
  reviewReceiptFingerprint: sha256,
  releaseReceiptFingerprint: sha256,
}).strict();

export const ShortsOpeningEvidenceFrameSchema = z.object({
  id: identifier,
  tSec: finite.nonnegative(),
  r2Key: objectKey,
  contentSha256: sha256,
  byteLength: z.number().int().positive(),
}).strict();

const ShortsOpeningEvidencePayloadSchema = z.object({
  version: z.literal(SHORTS_OPENING_EVIDENCE_VERSION),
  finalMaster: finalMasterSchema,
  visualReview: visualReviewBindingSchema,
  /**
   * First planned semantic visual anchor, paired with a durable frame that
   * the existing final reviewer actually received. Text-bearing quiz cards
   * are distinct from spoken captions, so the receipt names that visual
   * authority rather than pretending every Short has narration.
   */
  firstSemanticVisual: z.object({
    tSec: finite.nonnegative(),
    source: z.enum(["caption_overlay", "on_screen_hook", "transcript_cue"]),
    reviewFrame: ShortsOpeningEvidenceFrameSchema,
  }).strict(),
  /**
   * First thresholded visual change found by reviewRender's already-run ffmpeg
   * scene detector. It is not a claim that continuous motion was measured.
   */
  firstVisualMotionChange: z.object({
    tSec: finite.positive(),
    source: z.literal("ffmpeg_scene_change"),
    reviewFrame: ShortsOpeningEvidenceFrameSchema,
  }).strict(),
  /** Present only when a timed, passing on-screen-text authority exists. */
  firstHookOnScreenText: z.object({
    tSec: finite.nonnegative(),
    endSec: finite.positive(),
    source: z.enum(["caption", "on_screen_hook"]),
    cueId: identifier,
    expectedTextSha256: sha256,
  }).strict().optional(),
  receiptFingerprint: sha256,
}).strict();

export const ShortsOpeningEvidenceSchema = ShortsOpeningEvidencePayloadSchema.superRefine((receipt, context) => {
  const durationSec = receipt.finalMaster.durationSec;
  const bounded = (value: number, path: Array<string | number>, label: string) => {
    if (value > durationSec + TIME_EPSILON_SEC) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: `${label} is outside the released Short duration`,
      });
    }
  };
  bounded(receipt.firstSemanticVisual.tSec, ["firstSemanticVisual", "tSec"], "first semantic visual timing");
  bounded(receipt.firstSemanticVisual.reviewFrame.tSec, ["firstSemanticVisual", "reviewFrame", "tSec"], "first semantic visual review frame");
  bounded(receipt.firstVisualMotionChange.tSec, ["firstVisualMotionChange", "tSec"], "first visual-change timing");
  bounded(receipt.firstVisualMotionChange.reviewFrame.tSec, ["firstVisualMotionChange", "reviewFrame", "tSec"], "first visual-change review frame");
  if (
    receipt.firstSemanticVisual.reviewFrame.tSec + TIME_EPSILON_SEC <
    receipt.firstSemanticVisual.tSec
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["firstSemanticVisual", "reviewFrame", "tSec"],
      message: "semantic visual review frame occurs before its planned anchor",
    });
  }
  if (
    Math.abs(
      receipt.firstVisualMotionChange.reviewFrame.tSec -
      receipt.firstVisualMotionChange.tSec,
    ) > REVIEW_FRAME_TIME_EPSILON_SEC
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["firstVisualMotionChange", "reviewFrame", "tSec"],
      message: "visual-change review frame is not the detector's timestamped scene anchor",
    });
  }
  if (receipt.firstHookOnScreenText) {
    bounded(receipt.firstHookOnScreenText.tSec, ["firstHookOnScreenText", "tSec"], "first hook/on-screen text timing");
    bounded(receipt.firstHookOnScreenText.endSec, ["firstHookOnScreenText", "endSec"], "first hook/on-screen text end timing");
    if (receipt.firstHookOnScreenText.endSec <= receipt.firstHookOnScreenText.tSec) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["firstHookOnScreenText", "endSec"],
        message: "first hook/on-screen text timing has no positive display window",
      });
    }
    if (receipt.firstSemanticVisual.source === "caption_overlay") {
      if (!sameNumber(receipt.firstSemanticVisual.tSec, receipt.firstHookOnScreenText.tSec)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["firstSemanticVisual", "tSec"],
          message: "caption semantic visual timing does not match the first hook/on-screen text timing",
        });
      }
      if (
        receipt.firstSemanticVisual.reviewFrame.tSec < receipt.firstHookOnScreenText.tSec - TIME_EPSILON_SEC ||
        receipt.firstSemanticVisual.reviewFrame.tSec > receipt.firstHookOnScreenText.endSec + TIME_EPSILON_SEC
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["firstSemanticVisual", "reviewFrame", "tSec"],
          message: "caption semantic visual review frame is outside the first hook/on-screen text window",
        });
      }
    }
  }
});

export type ShortsOpeningEvidence = z.infer<typeof ShortsOpeningEvidenceSchema>;
export type ShortsOpeningEvidenceFrame = z.infer<typeof ShortsOpeningEvidenceFrameSchema>;

export interface ShortsOpeningCaptionPlan {
  cueId: string;
  startSec: number;
  endSec: number;
  expectedTextSha256: string;
}

/** A timed text authority can be a spoken caption or a renderer-owned hook card. */
export interface ShortsOpeningOnScreenTextPlan extends ShortsOpeningCaptionPlan {
  readonly source: "caption" | "on_screen_hook";
}

/**
 * Turn an exact renderer-owned text window into a release receipt input.  This
 * is intentionally not limited to burned speech captions: non-narrated quiz
 * Shorts still need a truthfully named first semantic visual.
 */
export function planShortsOpeningOnScreenTextEvidence(input: {
  readonly cueId: string;
  readonly startSec: number;
  readonly endSec: number;
  readonly expectedText: string;
  readonly durationSec: number;
  readonly source: ShortsOpeningOnScreenTextPlan["source"];
}): ShortsOpeningOnScreenTextPlan {
  const cueId = input.cueId.trim();
  const expectedText = input.expectedText.trim();
  if (
    !cueId ||
    !expectedText ||
    !Number.isFinite(input.durationSec) || input.durationSec <= 0 ||
    !Number.isFinite(input.startSec) || !Number.isFinite(input.endSec) ||
    input.startSec < 0 || input.endSec <= input.startSec ||
    input.endSec > input.durationSec + TIME_EPSILON_SEC
  ) {
    throw new Error("shorts opening evidence text authority has invalid timing or text");
  }
  return {
    cueId,
    startSec: input.startSec,
    endSec: input.endSec,
    expectedTextSha256: textSha256(expectedText),
    source: input.source,
  };
}

function textSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sameNumber(left: number, right: number, epsilon = TIME_EPSILON_SEC): boolean {
  return Math.abs(left - right) <= epsilon;
}

function openingFingerprint(value: Omit<ShortsOpeningEvidence, "receiptFingerprint">): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function assertDurableFrame(value: unknown, subject: string): ShortsOpeningEvidenceFrame {
  const parsed = ShortsOpeningEvidenceFrameSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `shorts opening evidence ${subject} lacks a durable frame identity: ` +
        parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  }
  return parsed.data;
}

/**
 * Validate the existing caption plan before review so an ambiguous "first"
 * hook cannot consume a visual-review call and only then fail at certification.
 * Captions are optional for the reusable receipt; the current spinoff route
 * separately requires them and will therefore always obtain this authority.
 */
export function planShortsOpeningCaptionEvidence(
  captions: readonly CaptionCue[],
  durationSec: number,
): ShortsOpeningCaptionPlan | undefined {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error("shorts opening evidence requires a positive final-master duration");
  }
  if (!captions.length) return undefined;
  let priorStartSec = -1;
  for (const [index, caption] of captions.entries()) {
    const text = typeof caption.text === "string" ? caption.text.trim() : "";
    const startSec = Number(caption.startSec);
    const endSec = Number(caption.endSec);
    if (!text || !Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec <= startSec || endSec > durationSec + TIME_EPSILON_SEC) {
      throw new Error(`shorts opening evidence caption ${index + 1} has invalid final-master timing/text authority`);
    }
    if (startSec <= priorStartSec + TIME_EPSILON_SEC) {
      throw new Error("shorts opening evidence cannot choose an ambiguous first caption timing");
    }
    priorStartSec = startSec;
  }
  const first = captions[0]!;
  return planShortsOpeningOnScreenTextEvidence({
    cueId: "short-caption-001",
    startSec: Number(first.startSec),
    endSec: Number(first.endSec),
    expectedText: first.text.trim(),
    durationSec,
    source: "caption",
  });
}

type ReviewFrameWithReasons = ShortsOpeningEvidenceFrame & {
  selectionReasons: readonly string[];
};

function receiptFrame(frame: ReviewFrameWithReasons): ShortsOpeningEvidenceFrame {
  return {
    id: frame.id,
    tSec: frame.tSec,
    r2Key: frame.r2Key,
    contentSha256: frame.contentSha256,
    byteLength: frame.byteLength,
  };
}

function durableReviewFrames(
  review: Pick<VisualReviewResult, "evidence">,
): ReviewFrameWithReasons[] {
  const frames = review.evidence.frames.map((frame) => {
    const durable = assertDurableFrame({
      id: frame.id,
      tSec: frame.tSec,
      r2Key: frame.r2Key,
      contentSha256: frame.contentSha256,
      byteLength: frame.byteLength,
    }, "visual-review evidence");
    if (!Array.isArray(frame.selectionReasons) || frame.selectionReasons.some((reason) => typeof reason !== "string")) {
      throw new Error("shorts opening evidence visual-review frame lacks its selection reasons");
    }
    return { ...durable, selectionReasons: frame.selectionReasons };
  }).sort((left, right) =>
    left.tSec - right.tSec || left.id.localeCompare(right.id) || left.r2Key.localeCompare(right.r2Key),
  );
  if (!frames.length) {
    throw new Error("shorts opening evidence visual review retained no durable frames");
  }
  if (new Set(frames.map((frame) => frame.r2Key)).size !== frames.length) {
    throw new Error("shorts opening evidence visual review has duplicate durable frame keys");
  }
  return frames;
}

function firstSceneChange(
  sceneChangeTimes: readonly number[] | undefined,
  durationSec: number,
): number {
  const times = [...new Set((sceneChangeTimes ?? [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > TIME_EPSILON_SEC && value <= durationSec + TIME_EPSILON_SEC))]
    .sort((left, right) => left - right);
  const first = times[0];
  if (first === undefined) {
    throw new Error(
      "shorts opening evidence lacks an existing thresholded visual/motion change; " +
        "refusing to invent a motion timing from a static review sample",
    );
  }
  return first;
}

function assertPassingOnScreenTextForCaption(args: {
  onScreenText: unknown;
  caption: ShortsOpeningCaptionPlan;
  finalMasterSha256: string;
}): void {
  const proof = OnScreenTextProofSchema.safeParse(args.onScreenText);
  if (!proof.success || !proof.data.passed || proof.data.source.sha256 !== args.finalMasterSha256) {
    throw new Error("shorts opening evidence lacks passing final-master on-screen text authority for its first caption");
  }
  const cue = proof.data.cues.find((candidate) => candidate.id === args.caption.cueId);
  if (!cue || !cue.passed || cue.expectedTextSha256 !== args.caption.expectedTextSha256) {
    throw new Error("shorts opening evidence first caption does not match its passing OCR receipt");
  }
  if (cue.sampleSec < args.caption.startSec - TIME_EPSILON_SEC || cue.sampleSec > args.caption.endSec + TIME_EPSILON_SEC) {
    throw new Error("shorts opening evidence first caption OCR sample is outside its planned visual timing");
  }
}

/**
 * Mint a Short-only observation from already-existing plan/review artifacts.
 * It makes no network/provider call and never turns an absent scene detector
 * value into a made-up motion claim.
 */
export function createShortsOpeningEvidence(args: {
  finalMaster: { sha256: string; durationSec: number };
  review: Pick<
    VisualReviewResult,
    "ran" | "verdict" | "referenceCriteriaComplete" | "evidence" |
      "reviewFingerprint" | "reviewReceiptVersion" | "reviewReceiptFingerprint" | "sceneChangeTimes"
  >;
  visualReviewReleaseReceiptFingerprint: string;
  caption?: ShortsOpeningCaptionPlan;
  openingText?: ShortsOpeningOnScreenTextPlan;
  onScreenText?: unknown;
}): ShortsOpeningEvidence {
  const finalMaster = finalMasterSchema.parse(args.finalMaster);
  if (!args.review.ran || args.review.verdict !== "pass" || !args.review.referenceCriteriaComplete) {
    throw new Error("shorts opening evidence requires a passing complete post-transform visual review");
  }
  if (
    args.review.evidence.source.sha256 !== finalMaster.sha256 ||
    !sameNumber(args.review.evidence.source.durationSec, finalMaster.durationSec)
  ) {
    throw new Error("shorts opening evidence visual review is not bound to the released Short bytes/duration");
  }
  const visualReview = visualReviewBindingSchema.parse({
    reviewFingerprint: args.review.reviewFingerprint,
    reviewReceiptVersion: args.review.reviewReceiptVersion,
    reviewReceiptFingerprint: args.review.reviewReceiptFingerprint,
    releaseReceiptFingerprint: args.visualReviewReleaseReceiptFingerprint,
  });
  const frames = durableReviewFrames(args.review);
  if (args.caption && args.openingText) {
    throw new Error("shorts opening evidence cannot bind two competing first text authorities");
  }
  const openingText = args.openingText
    ?? (args.caption ? { ...args.caption, source: "caption" as const } : undefined);
  let firstSemanticVisual: ShortsOpeningEvidence["firstSemanticVisual"];
  let firstHookOnScreenText: ShortsOpeningEvidence["firstHookOnScreenText"];
  if (openingText) {
    if (
      !Number.isFinite(openingText.startSec) ||
      !Number.isFinite(openingText.endSec) ||
      openingText.startSec < 0 ||
      openingText.endSec <= openingText.startSec ||
      openingText.endSec > finalMaster.durationSec + TIME_EPSILON_SEC ||
      !sha256.safeParse(openingText.expectedTextSha256).success
    ) {
      throw new Error("shorts opening evidence caption plan is invalid");
    }
    assertPassingOnScreenTextForCaption({
      onScreenText: args.onScreenText,
      caption: openingText,
      finalMasterSha256: finalMaster.sha256,
    });
    const reviewFrame = frames.find((frame) =>
      frame.selectionReasons.includes("overlay") &&
      frame.tSec >= openingText.startSec - TIME_EPSILON_SEC &&
      frame.tSec <= openingText.endSec + TIME_EPSILON_SEC,
    );
    if (!reviewFrame) {
      throw new Error(
        "shorts opening evidence lacks a durable reviewed overlay frame for the first caption; " +
          "the final-review plan must retain the claimed semantic visual anchor",
      );
    }
    firstSemanticVisual = {
      tSec: openingText.startSec,
      source: openingText.source === "caption" ? "caption_overlay" : "on_screen_hook",
      reviewFrame: receiptFrame(reviewFrame),
    };
    firstHookOnScreenText = {
      tSec: openingText.startSec,
      endSec: openingText.endSec,
      source: openingText.source,
      cueId: openingText.cueId,
      expectedTextSha256: openingText.expectedTextSha256,
    };
  } else {
    const reviewFrame = frames.find((frame) => frame.selectionReasons.includes("cue"));
    if (!reviewFrame) {
      throw new Error(
        "shorts opening evidence lacks a planned/reviewed semantic visual anchor and has no timed caption authority",
      );
    }
    firstSemanticVisual = {
      tSec: reviewFrame.tSec,
      source: "transcript_cue",
      reviewFrame: receiptFrame(reviewFrame),
    };
    firstHookOnScreenText = undefined;
  }

  const firstChangeSec = firstSceneChange(args.review.sceneChangeTimes, finalMaster.durationSec);
  const motionReviewFrame = frames
    .filter((frame) => frame.selectionReasons.includes("scene"))
    .sort((left, right) =>
      Math.abs(left.tSec - firstChangeSec) - Math.abs(right.tSec - firstChangeSec) ||
      left.tSec - right.tSec ||
      left.id.localeCompare(right.id),
    )[0];
  if (!motionReviewFrame || Math.abs(motionReviewFrame.tSec - firstChangeSec) > REVIEW_FRAME_TIME_EPSILON_SEC) {
    throw new Error(
      "shorts opening evidence lacks a durable review frame for the first detected visual/motion change",
    );
  }

  const unsigned = {
    version: SHORTS_OPENING_EVIDENCE_VERSION,
    finalMaster,
    visualReview,
    firstSemanticVisual,
    firstVisualMotionChange: {
      tSec: firstChangeSec,
      source: "ffmpeg_scene_change" as const,
      reviewFrame: receiptFrame(motionReviewFrame),
    },
    ...(firstHookOnScreenText ? { firstHookOnScreenText } : {}),
  };
  const normalized = ShortsOpeningEvidencePayloadSchema.omit({ receiptFingerprint: true }).parse(unsigned);
  return assertShortsOpeningEvidence({
    ...normalized,
    receiptFingerprint: openingFingerprint(normalized),
  });
}

export function assertShortsOpeningEvidence(value: unknown): ShortsOpeningEvidence {
  const receipt = ShortsOpeningEvidenceSchema.parse(value);
  const { receiptFingerprint, ...unsigned } = receipt;
  const expected = openingFingerprint(unsigned);
  if (receiptFingerprint !== expected) {
    throw new Error("shorts opening evidence fingerprint does not match its payload");
  }
  return receipt;
}

/**
 * Certificate validation is structural only: the optional field never makes
 * a non-Short subject follow a pacing policy. When present, every referenced
 * opening frame must be one of this certificate's durable review artifacts.
 */
export function assertShortsOpeningEvidenceCertificateBinding(args: {
  evidence: unknown;
  finalMaster: { sha256: string; durationSec: number };
  visualReview: {
    reviewFingerprint: string;
    reviewReceiptVersion: string;
    reviewReceiptFingerprint: string;
    releaseReceiptFingerprint: string;
    evidenceFrameArtifacts?: readonly unknown[];
  };
  onScreenText?: unknown;
}): ShortsOpeningEvidence {
  const evidence = assertShortsOpeningEvidence(args.evidence);
  const finalMaster = finalMasterSchema.parse(args.finalMaster);
  const visualReview = visualReviewBindingSchema.parse({
    reviewFingerprint: args.visualReview.reviewFingerprint,
    reviewReceiptVersion: args.visualReview.reviewReceiptVersion,
    reviewReceiptFingerprint: args.visualReview.reviewReceiptFingerprint,
    releaseReceiptFingerprint: args.visualReview.releaseReceiptFingerprint,
  });
  if (
    evidence.finalMaster.sha256 !== finalMaster.sha256 ||
    !sameNumber(evidence.finalMaster.durationSec, finalMaster.durationSec)
  ) {
    throw new Error("shorts opening evidence belongs to a different released master");
  }
  if (
    evidence.visualReview.reviewFingerprint !== visualReview.reviewFingerprint ||
    evidence.visualReview.reviewReceiptVersion !== visualReview.reviewReceiptVersion ||
    evidence.visualReview.reviewReceiptFingerprint !== visualReview.reviewReceiptFingerprint ||
    evidence.visualReview.releaseReceiptFingerprint !== visualReview.releaseReceiptFingerprint
  ) {
    throw new Error("shorts opening evidence does not bind this final visual-review receipt");
  }
  if (!args.visualReview.evidenceFrameArtifacts) {
    throw new Error("shorts opening evidence requires durable visual-review frame artifacts");
  }
  const artifacts = args.visualReview.evidenceFrameArtifacts.map((frame) => {
    const raw = frame as Record<string, unknown>;
    return assertDurableFrame({
      id: raw.id,
      tSec: raw.tSec,
      r2Key: raw.r2Key,
      contentSha256: raw.contentSha256,
      byteLength: raw.byteLength,
    }, "certificate visual-review artifact");
  });
  const hasFrame = (frame: ShortsOpeningEvidenceFrame): boolean => artifacts.some((artifact) =>
    artifact.id === frame.id &&
    sameNumber(artifact.tSec, frame.tSec) &&
    artifact.r2Key === frame.r2Key &&
    artifact.contentSha256 === frame.contentSha256 &&
    artifact.byteLength === frame.byteLength,
  );
  if (!hasFrame(evidence.firstSemanticVisual.reviewFrame)) {
    throw new Error("shorts opening evidence semantic visual frame is absent from the certificate review artifacts");
  }
  if (!hasFrame(evidence.firstVisualMotionChange.reviewFrame)) {
    throw new Error("shorts opening evidence visual/motion frame is absent from the certificate review artifacts");
  }
  if (evidence.firstHookOnScreenText) {
    assertPassingOnScreenTextForCaption({
      onScreenText: args.onScreenText,
      caption: {
        cueId: evidence.firstHookOnScreenText.cueId,
        startSec: evidence.firstHookOnScreenText.tSec,
        endSec: evidence.firstHookOnScreenText.endSec,
        expectedTextSha256: evidence.firstHookOnScreenText.expectedTextSha256,
      },
      finalMasterSha256: finalMaster.sha256,
    });
  }
  return evidence;
}
