/**
 * A compact, deterministic observation of whether an already-reviewed master
 * samples the beginning, middle, and end of the route's intended experience.
 *
 * This is deliberately not a quality score, reviewer input, storage proof, or
 * release gate. It only binds existing route/planning/visual-review receipts
 * into a small certificate-compatible observation after final QA is complete.
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import {
  ContentLaneSchema,
  laneQualityPolicy,
} from "@/engine/contentLane";
import {
  assertEpisodeGraph,
  assertEpisodeGraphAgainstStorySpine,
  type EpisodeGraph,
} from "@/engine/episodeGraph";
import {
  channelProgramRouteRunSeedFingerprint,
  parseChannelProgramRouteRunSeed,
  type ChannelProgramRouteRunSeed,
} from "@/engine/channelProgramRoute";
import {
  StorySpineSchema,
  storySpineFingerprint,
  validateStorySpine,
  type StorySpine,
} from "@/engine/storySpine";
import { canonicalJson } from "@/lib/canonicalJson";
import {
  FinalMasterNarrationSemanticEvidenceSchema,
  type FinalMasterNarrationSemanticEvidence,
} from "@/lib/narrationTranscriptProof";
import {
  NarrationCueTimingEvidenceSchema,
  type NarrationCueTimingEvidence,
} from "@/lib/narrationCueTiming";

export const VIEWER_PROMISE_PROGRESSION_VERSION =
  "viewer-promise-progression/v1" as const;
export const VIEWER_PROMISE_PROGRESSION_OMISSION_VERSION =
  "viewer-promise-progression-omission/v1" as const;

const NARRATION_DURATION_TOLERANCE_SEC = 0.75;
const TIME_EPSILON_SEC = 0.001;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, "expected SHA-256");
const identifier = z.string().trim().min(1).max(240);
const objectKey = z.string().trim().min(1).max(2_000);
const finite = z.number().finite();

const ViewerPromiseProgressionModeSchema = z.enum([
  "progressive",
  "continuous",
]);

const viewerPromiseSchema = z.object({
  routeSeedFingerprint: sha256,
  routeFingerprint: sha256,
  programBriefFingerprint: sha256,
  family: identifier,
  contentLaneKey: identifier,
  claimMode: z.enum([
    "editorial_lane_policy",
    "certified_quiz_facts",
    "fictional_scenario_no_external_claims",
  ]),
  /** Hash only: a certificate must not copy the viewer-facing route copy. */
  viewerJobFingerprint: sha256,
}).strict();

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

const narrationClockSchema = z.object({
  narrationStartSec: finite.nonnegative(),
  narrationDurationSec: finite.positive(),
  sourceNarrationSha256: sha256,
  finalMasterNarrationReceiptFingerprint: sha256,
  cueTimingFingerprint: sha256,
}).strict();

/**
 * Story Spine and Episode Graph fields are plan provenance only. This receipt
 * does not assert a reviewer attested semantic plan fulfilment; that would
 * require a future ReviewedEvidenceRouteBinding authority.
 */
const progressionPlanSchema = z.object({
  source: z.enum([
    "story_spine",
    "episode_graph",
    "story_spine_episode_graph",
    "lane_visual_pacing_policy",
  ]),
  storySpineFingerprint: sha256.optional(),
  episodeGraphFingerprint: sha256.optional(),
  storyBeatCount: z.number().int().positive().optional(),
  storyShotCount: z.number().int().positive().optional(),
  episodeGraphBeatCount: z.number().int().min(2).optional(),
  narrationClock: narrationClockSchema.optional(),
  visualPacingMode: z.literal("exempt").optional(),
}).strict();

const milestoneWindowSchema = z.object({
  startSec: finite.nonnegative(),
  endSec: finite.positive(),
}).strict().superRefine((window, context) => {
  if (window.endSec <= window.startSec) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "viewer-promise milestone window end must follow start",
    });
  }
});

const reviewFrameSchema = z.object({
  id: identifier,
  tSec: finite.nonnegative(),
  r2Key: objectKey,
  /** Exact durable visual-review witness retained by the release certificate. */
  contentSha256: sha256,
  byteLength: z.number().int().positive(),
}).strict();

const milestoneSchema = z.object({
  id: z.enum(["opening", "middle", "closing"]),
  window: milestoneWindowSchema,
  storySpineBeatId: identifier.optional(),
  storySpineShotId: identifier.optional(),
  episodeGraphBeatId: identifier.optional(),
  reviewFrame: reviewFrameSchema.optional(),
}).strict();

const coverageSchema = z.object({
  milestoneCount: z.number().int().min(2).max(3),
  sampledMilestoneCount: z.number().int().min(0).max(3),
  sampledMilestoneRatio: z.number().min(0).max(1),
  maxUnsampledMilestoneSec: finite.nonnegative(),
  /** Existing review evidence only; no additional frame sampling is requested. */
  reviewMaxGapSec: finite.nonnegative(),
}).strict();

const receiptPayloadSchema = z.object({
  version: z.literal(VIEWER_PROMISE_PROGRESSION_VERSION),
  mode: ViewerPromiseProgressionModeSchema,
  assessmentScope: z.enum([
    "route-bound-plan-and-review-sample-coverage",
    "continuous-experience-review-coverage",
  ]),
  viewerPromise: viewerPromiseSchema,
  finalMaster: finalMasterSchema,
  visualReview: visualReviewBindingSchema,
  plan: progressionPlanSchema,
  milestones: z.array(milestoneSchema).min(2).max(3),
  coverage: coverageSchema,
}).strict();

export const ViewerPromiseProgressionReceiptSchema = receiptPayloadSchema
  .extend({ receiptFingerprint: sha256 })
  .strict()
  .superRefine((receipt, context) => {
    const milestoneIds = new Set(receipt.milestones.map((milestone) => milestone.id));
    if (milestoneIds.size !== receipt.milestones.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["milestones"],
        message: "viewer-promise milestones must not repeat an anchor id",
      });
    }
    const selectedFrameKeys = receipt.milestones
      .map((milestone) => milestone.reviewFrame?.r2Key)
      .filter((value): value is string => value !== undefined);
    if (new Set(selectedFrameKeys).size !== selectedFrameKeys.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["milestones"],
        message: "viewer-promise milestones must not reuse a visual-review frame",
      });
    }
    const sampled = receipt.milestones.filter((milestone) => milestone.reviewFrame).length;
    const maxUnsampled = receipt.milestones.reduce(
      (maximum, milestone) => milestone.reviewFrame
        ? maximum
        : Math.max(maximum, milestone.window.endSec - milestone.window.startSec),
      0,
    );
    if (receipt.coverage.milestoneCount !== receipt.milestones.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coverage", "milestoneCount"],
        message: "viewer-promise milestone count does not match milestones",
      });
    }
    if (receipt.coverage.sampledMilestoneCount !== sampled) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coverage", "sampledMilestoneCount"],
        message: "viewer-promise sampled milestone count does not match milestones",
      });
    }
    if (!sameNumber(receipt.coverage.sampledMilestoneRatio, sampled / receipt.milestones.length)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coverage", "sampledMilestoneRatio"],
        message: "viewer-promise sampled milestone ratio does not match milestones",
      });
    }
    if (!sameNumber(receipt.coverage.maxUnsampledMilestoneSec, maxUnsampled)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coverage", "maxUnsampledMilestoneSec"],
        message: "viewer-promise maximum unsampled window does not match milestones",
      });
    }
    for (const milestone of receipt.milestones) {
      if (milestone.window.endSec > receipt.finalMaster.durationSec + TIME_EPSILON_SEC) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["milestones", milestone.id, "window"],
          message: "viewer-promise milestone exceeds final-master duration",
        });
      }
      if (
        milestone.reviewFrame &&
        (
          milestone.reviewFrame.tSec < milestone.window.startSec - TIME_EPSILON_SEC ||
          milestone.reviewFrame.tSec > milestone.window.endSec + TIME_EPSILON_SEC
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["milestones", milestone.id, "reviewFrame"],
          message: "viewer-promise review frame falls outside its milestone window",
        });
      }
    }
    const isContinuous = receipt.mode === "continuous";
    if (
      isContinuous !== (receipt.plan.source === "lane_visual_pacing_policy") ||
      (isContinuous && receipt.assessmentScope !== "continuous-experience-review-coverage") ||
      (!isContinuous && receipt.assessmentScope !== "route-bound-plan-and-review-sample-coverage")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mode"],
        message: "viewer-promise mode, scope, and plan source disagree",
      });
    }
    if (isContinuous) {
      if (
        receipt.plan.visualPacingMode !== "exempt" ||
        receipt.plan.narrationClock ||
        receipt.plan.storySpineFingerprint ||
        receipt.plan.episodeGraphFingerprint
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["plan"],
          message: "continuous viewer-promise receipt must use only the exempt pacing policy",
        });
      }
    } else if (!receipt.plan.narrationClock) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["plan", "narrationClock"],
        message: "progressive viewer-promise receipt requires narration timing evidence",
      });
    }
    const requiresStorySpine =
      receipt.plan.source === "story_spine" ||
      receipt.plan.source === "story_spine_episode_graph";
    const requiresEpisodeGraph =
      receipt.plan.source === "episode_graph" ||
      receipt.plan.source === "story_spine_episode_graph";
    if (
      requiresStorySpine &&
      (!receipt.plan.storySpineFingerprint ||
        !receipt.plan.storyBeatCount ||
        !receipt.plan.storyShotCount)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["plan"],
        message: "Story Spine viewer-promise receipt lacks complete plan provenance",
      });
    }
    if (
      requiresEpisodeGraph &&
      (!receipt.plan.episodeGraphFingerprint || !receipt.plan.episodeGraphBeatCount)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["plan"],
        message: "Episode Graph viewer-promise receipt lacks complete plan provenance",
      });
    }
  });

const ViewerPromiseProgressionOmissionReasonCodeSchema = z.enum([
  "incomplete_story_spine",
  "story_spine_invalid",
  "episode_graph_invalid",
  "story_graph_binding_invalid",
  "narration_clock_unavailable",
  "narration_clock_mismatch",
  "visual_evidence_invalid",
  "insufficient_progression_anchors",
]);

const omissionPayloadSchema = z.object({
  version: z.literal(VIEWER_PROMISE_PROGRESSION_OMISSION_VERSION),
  status: z.enum(["not_measured", "rejected"]),
  mode: ViewerPromiseProgressionModeSchema,
  viewerPromise: viewerPromiseSchema,
  reasonCode: ViewerPromiseProgressionOmissionReasonCodeSchema,
}).strict();

export const ViewerPromiseProgressionOmissionSchema = omissionPayloadSchema
  .extend({ omissionFingerprint: sha256 })
  .strict();

export type ViewerPromiseProgressionReceipt = z.infer<
  typeof ViewerPromiseProgressionReceiptSchema
>;
export type ViewerPromiseProgressionOmission = z.infer<
  typeof ViewerPromiseProgressionOmissionSchema
>;
export type ViewerPromiseProgressionOmissionReasonCode = z.infer<
  typeof ViewerPromiseProgressionOmissionReasonCodeSchema
>;

export type ViewerPromiseProgressionResolution =
  | { status: "measured"; receipt: ViewerPromiseProgressionReceipt }
  | { status: "omitted"; omission: ViewerPromiseProgressionOmission };

export interface DeriveViewerPromiseProgressionInput {
  /** A sealed run seed, never mutable channel state. */
  route: unknown;
  contentLane: unknown;
  finalMaster: { sha256: string; durationSec: number };
  visualReview: {
    reviewFingerprint: string;
    reviewReceiptVersion: string;
    reviewReceiptFingerprint: string;
    releaseReceiptFingerprint: string;
    evidence: unknown;
  };
  timedScript?: unknown;
  narrativeBeats?: unknown;
  continuityLedger?: unknown;
  shotList?: unknown;
  dpVisualSpecs?: unknown;
  editorEdl?: unknown;
  storyCoverage?: unknown;
  episodeGraph?: unknown;
  sentenceTimings?: unknown;
  narrationCueTiming?: unknown;
  finalMasterNarration?: unknown;
}

export interface AssertViewerPromiseProgressionCertificateBindingInput {
  receipt: unknown;
  finalMaster: { sha256: string; durationSec: number };
  visualReview: {
    reviewFingerprint: string;
    reviewReceiptVersion: string;
    reviewReceiptFingerprint: string;
    releaseReceiptFingerprint: string;
  };
  programRoute: {
    routeFingerprint: string;
    family: string;
    contentLaneKey: string;
    programBriefFingerprint?: string;
    routeSeedFingerprint?: string;
  };
  /** Full sealed route seed used to independently derive directive bindings. */
  sealedRoute: unknown;
  contentLane: { key: string };
  evidenceFrameArtifacts: readonly {
    id?: string;
    tSec?: number;
    r2Key: string;
    contentSha256: string;
    byteLength: number;
  }[];
  finalMasterNarration?: unknown;
  narrationCueTiming?: unknown;
}

export interface AssertViewerPromiseProgressionOmissionCertificateBindingInput {
  omission: unknown;
  programRoute: {
    routeFingerprint: string;
    family: string;
    contentLaneKey: string;
    programBriefFingerprint?: string;
    routeSeedFingerprint?: string;
  };
  /** Full sealed route seed used to independently derive directive bindings. */
  sealedRoute: unknown;
  contentLane: { key: string };
}

interface PlanAnchor {
  id: "opening" | "middle" | "closing";
  t0: number;
  t1: number;
  storySpineBeatId?: string;
  storySpineShotId?: string;
  episodeGraphBeatId?: string;
}

interface DurableReviewFrame {
  id: string;
  tSec: number;
  r2Key: string;
  contentSha256: string;
  byteLength: number;
}

interface ParsedVisualReview {
  binding: z.infer<typeof visualReviewBindingSchema>;
  frames: DurableReviewFrame[];
  reviewMaxGapSec: number;
}

type NarrationClockResolution =
  | {
      status: "available";
      clock: z.infer<typeof narrationClockSchema>;
      narration: FinalMasterNarrationSemanticEvidence;
      cueTiming: NarrationCueTimingEvidence;
    }
  | { status: "unavailable" }
  | { status: "mismatch" };

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalFingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function sameNumber(left: number, right: number): boolean {
  return Math.abs(left - right) <= TIME_EPSILON_SEC;
}

function roundSeconds(value: number): number {
  return Number(value.toFixed(6));
}

function viewerPromiseFromRoute(
  route: ChannelProgramRouteRunSeed,
) : z.infer<typeof viewerPromiseSchema> {
  return {
    routeSeedFingerprint: channelProgramRouteRunSeedFingerprint(route),
    routeFingerprint: route.routeFingerprint,
    programBriefFingerprint: route.programBriefFingerprint,
    family: route.family,
    contentLaneKey: route.contentLaneKey,
    claimMode: route.directives.claimMode,
    viewerJobFingerprint: canonicalFingerprint({ viewerJob: route.directives.viewerJob }),
  };
}

export function viewerPromiseProgressionReceiptFingerprint(
  value: z.input<typeof receiptPayloadSchema>,
): string {
  return canonicalFingerprint(receiptPayloadSchema.parse(value));
}

export function viewerPromiseProgressionOmissionFingerprint(
  value: z.input<typeof omissionPayloadSchema>,
): string {
  return canonicalFingerprint(omissionPayloadSchema.parse(value));
}

export function createViewerPromiseProgressionReceipt(
  input: z.input<typeof receiptPayloadSchema>,
): ViewerPromiseProgressionReceipt {
  const normalized = receiptPayloadSchema.parse(input);
  return assertViewerPromiseProgressionReceipt({
    ...normalized,
    receiptFingerprint: viewerPromiseProgressionReceiptFingerprint(normalized),
  });
}

export function createViewerPromiseProgressionOmission(input: {
  status: "not_measured" | "rejected";
  mode: z.infer<typeof ViewerPromiseProgressionModeSchema>;
  viewerPromise: z.infer<typeof viewerPromiseSchema>;
  reasonCode: ViewerPromiseProgressionOmissionReasonCode;
}): ViewerPromiseProgressionOmission {
  const normalized = omissionPayloadSchema.parse({
    version: VIEWER_PROMISE_PROGRESSION_OMISSION_VERSION,
    ...input,
  });
  return assertViewerPromiseProgressionOmission({
    ...normalized,
    omissionFingerprint: viewerPromiseProgressionOmissionFingerprint(normalized),
  });
}

export function assertViewerPromiseProgressionReceipt(
  value: unknown,
): ViewerPromiseProgressionReceipt {
  const receipt = ViewerPromiseProgressionReceiptSchema.parse(value);
  const { receiptFingerprint, ...unsigned } = receipt;
  if (receiptFingerprint !== viewerPromiseProgressionReceiptFingerprint(unsigned)) {
    throw new Error("viewer-promise progression receipt fingerprint does not match its payload");
  }
  return receipt;
}

export function assertViewerPromiseProgressionOmission(
  value: unknown,
): ViewerPromiseProgressionOmission {
  const omission = ViewerPromiseProgressionOmissionSchema.parse(value);
  const { omissionFingerprint, ...unsigned } = omission;
  if (omissionFingerprint !== viewerPromiseProgressionOmissionFingerprint(unsigned)) {
    throw new Error("viewer-promise progression omission fingerprint does not match its payload");
  }
  return omission;
}

function omission(
  viewerPromise: z.infer<typeof viewerPromiseSchema>,
  mode: z.infer<typeof ViewerPromiseProgressionModeSchema>,
  status: "not_measured" | "rejected",
  reasonCode: ViewerPromiseProgressionOmissionReasonCode,
): ViewerPromiseProgressionResolution {
  return {
    status: "omitted",
    omission: createViewerPromiseProgressionOmission({
      status,
      mode,
      viewerPromise,
      reasonCode,
    }),
  };
}

function parseVisualReview(
  input: DeriveViewerPromiseProgressionInput["visualReview"],
  finalMaster: z.infer<typeof finalMasterSchema>,
): ParsedVisualReview | undefined {
  const candidate = z.object({
    reviewFingerprint: z.string().trim().min(1).max(256),
    reviewReceiptVersion: z.string().trim().min(1).max(128),
    reviewReceiptFingerprint: sha256,
    releaseReceiptFingerprint: sha256,
    evidence: z.object({
      source: z.object({
        sha256,
        durationSec: finite.positive(),
      }).strict(),
      frames: z.array(z.object({
        id: identifier,
        tSec: finite.nonnegative(),
        r2Key: objectKey,
        contentSha256: sha256,
        byteLength: z.number().int().positive(),
      }).passthrough()).min(1),
      coverage: z.object({
        maxGapSec: finite.nonnegative(),
      }).passthrough(),
    }).passthrough(),
  }).strict().safeParse(input);
  if (!candidate.success) return undefined;
  if (
    candidate.data.evidence.source.sha256 !== finalMaster.sha256 ||
    !sameNumber(candidate.data.evidence.source.durationSec, finalMaster.durationSec)
  ) {
    return undefined;
  }
  const seenKeys = new Set<string>();
  const frames = candidate.data.evidence.frames
    .map((frame) => ({
      id: frame.id,
      tSec: frame.tSec,
      r2Key: frame.r2Key,
      contentSha256: frame.contentSha256,
      byteLength: frame.byteLength,
    }))
    .sort((left, right) =>
      left.tSec - right.tSec || left.id.localeCompare(right.id) || left.r2Key.localeCompare(right.r2Key),
    );
  for (const frame of frames) {
    if (frame.tSec > finalMaster.durationSec + TIME_EPSILON_SEC || seenKeys.has(frame.r2Key)) {
      return undefined;
    }
    seenKeys.add(frame.r2Key);
  }
  return {
    binding: {
      reviewFingerprint: candidate.data.reviewFingerprint,
      reviewReceiptVersion: candidate.data.reviewReceiptVersion,
      reviewReceiptFingerprint: candidate.data.reviewReceiptFingerprint,
      releaseReceiptFingerprint: candidate.data.releaseReceiptFingerprint,
    },
    frames,
    reviewMaxGapSec: candidate.data.evidence.coverage.maxGapSec,
  };
}

function parseStorySpine(input: DeriveViewerPromiseProgressionInput):
  | { status: "absent" }
  | { status: "incomplete" }
  | { status: "invalid" }
  | { status: "available"; storySpine: StorySpine } {
  const values = [
    input.timedScript,
    input.narrativeBeats,
    input.continuityLedger,
    input.shotList,
    input.dpVisualSpecs,
    input.editorEdl,
    input.storyCoverage,
  ];
  const present = values.filter((value) => value !== undefined).length;
  if (!present) return { status: "absent" };
  if (present !== values.length) return { status: "incomplete" };
  const parsed = StorySpineSchema.safeParse({
    version: "1.0.0",
    timedScript: input.timedScript,
    narrativeBeats: input.narrativeBeats,
    continuityLedger: input.continuityLedger,
    shotList: input.shotList,
    dpVisualSpecs: input.dpVisualSpecs,
    editorEdl: input.editorEdl,
    coverage: input.storyCoverage,
  });
  if (!parsed.success) return { status: "invalid" };
  try {
    return { status: "available", storySpine: validateStorySpine(parsed.data) };
  } catch {
    return { status: "invalid" };
  }
}

function parseNarrationClock(
  input: DeriveViewerPromiseProgressionInput,
  finalMaster: z.infer<typeof finalMasterSchema>,
): NarrationClockResolution {
  const narration = FinalMasterNarrationSemanticEvidenceSchema.safeParse(
    input.finalMasterNarration,
  );
  const cueTiming = NarrationCueTimingEvidenceSchema.safeParse(input.narrationCueTiming);
  if (!narration.success || !cueTiming.success) return { status: "unavailable" };
  if (
    narration.data.finalMaster.sha256 !== finalMaster.sha256 ||
    !sameNumber(narration.data.finalMaster.durationSec, finalMaster.durationSec) ||
    narration.data.narration.startSec + narration.data.narration.durationSec >
      finalMaster.durationSec + NARRATION_DURATION_TOLERANCE_SEC ||
    narration.data.narration.sourceSha256 !== cueTiming.data.sourceSha256
  ) {
    return { status: "mismatch" };
  }
  return {
    status: "available",
    narration: narration.data,
    cueTiming: cueTiming.data,
    clock: {
      narrationStartSec: roundSeconds(narration.data.narration.startSec),
      narrationDurationSec: roundSeconds(narration.data.narration.durationSec),
      sourceNarrationSha256: narration.data.narration.sourceSha256,
      finalMasterNarrationReceiptFingerprint: narration.data.receiptFingerprint,
      cueTimingFingerprint: canonicalFingerprint(cueTiming.data),
    },
  };
}

const sentenceTimingSchema = z.array(z.object({
  id: identifier,
  text: z.string().min(1),
  start: finite.nonnegative(),
  end: finite.positive(),
}).strict().superRefine((sentence, context) => {
  if (sentence.end <= sentence.start) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "sentence timing end must follow start",
    });
  }
})).min(1);

function normalizeSentenceText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function storySpineMatchesSentenceTimings(
  storySpine: StorySpine,
  sentenceTimings: unknown,
): "match" | "unavailable" | "mismatch" {
  if (sentenceTimings === undefined) return "unavailable";
  const parsed = sentenceTimingSchema.safeParse(sentenceTimings);
  if (!parsed.success || parsed.data.length !== storySpine.timedScript.sentences.length) {
    return "mismatch";
  }
  const fromSpine = storySpine.timedScript.sentences.map((sentence) => ({
    id: sentence.id,
    text: normalizeSentenceText(sentence.text),
    start: Math.round(sentence.t0 * 1_000),
    end: Math.round(sentence.t1 * 1_000),
  }));
  const fromContext = parsed.data.map((sentence) => ({
    id: sentence.id,
    text: normalizeSentenceText(sentence.text),
    start: Math.round(sentence.start * 1_000),
    end: Math.round(sentence.end * 1_000),
  }));
  return canonicalJson(fromSpine) === canonicalJson(fromContext) ? "match" : "mismatch";
}

function chooseDistinctAnchors<T extends { id: string; t0: number; t1: number }>(
  values: readonly T[],
  durationSec: number,
): Array<{ id: "opening" | "middle" | "closing"; value: T }> {
  const targets: Array<{ id: "opening" | "middle" | "closing"; tSec: number }> = [
    { id: "opening", tSec: durationSec * 0.1 },
    { id: "middle", tSec: durationSec * 0.5 },
    { id: "closing", tSec: durationSec * 0.9 },
  ];
  const used = new Set<string>();
  const selected: Array<{ id: "opening" | "middle" | "closing"; value: T }> = [];
  for (const target of targets) {
    const candidate = values
      .filter((value) => !used.has(value.id))
      .sort((left, right) => {
        const leftContains = left.t0 <= target.tSec && target.tSec <= left.t1 ? 0 : 1;
        const rightContains = right.t0 <= target.tSec && target.tSec <= right.t1 ? 0 : 1;
        const leftDistance = Math.abs((left.t0 + left.t1) / 2 - target.tSec);
        const rightDistance = Math.abs((right.t0 + right.t1) / 2 - target.tSec);
        return leftContains - rightContains || leftDistance - rightDistance || left.t0 - right.t0 || left.id.localeCompare(right.id);
      })[0];
    if (candidate) {
      used.add(candidate.id);
      selected.push({ id: target.id, value: candidate });
    }
  }
  return selected;
}

function representativeStoryShot(storySpine: StorySpine, beatId: string): string | undefined {
  const beat = storySpine.narrativeBeats.find((candidate) => candidate.id === beatId);
  if (!beat) return undefined;
  const midpoint = (beat.t0 + beat.t1) / 2;
  return storySpine.shotList
    .filter((shot) => shot.beatId === beatId)
    .sort((left, right) => {
      const leftContains = left.t0 <= midpoint && midpoint <= left.t1 ? 0 : 1;
      const rightContains = right.t0 <= midpoint && midpoint <= right.t1 ? 0 : 1;
      return leftContains - rightContains || Math.abs((left.t0 + left.t1) / 2 - midpoint) - Math.abs((right.t0 + right.t1) / 2 - midpoint) || left.id.localeCompare(right.id);
    })[0]?.id;
}

function graphBeatForStoryAnchor(
  graph: EpisodeGraph | undefined,
  storyBeatId: string,
  t0: number,
  t1: number,
): string | undefined {
  if (!graph) return undefined;
  const midpoint = (t0 + t1) / 2;
  return graph.beats
    .filter((beat) => beat.storySpineBeatIds.includes(storyBeatId))
    .sort((left, right) => {
      const leftContains = left.t0 <= midpoint && midpoint <= left.t1 ? 0 : 1;
      const rightContains = right.t0 <= midpoint && midpoint <= right.t1 ? 0 : 1;
      return leftContains - rightContains || Math.abs((left.t0 + left.t1) / 2 - midpoint) - Math.abs((right.t0 + right.t1) / 2 - midpoint) || left.id.localeCompare(right.id);
    })[0]?.id;
}

function selectReviewFrame(
  frames: readonly DurableReviewFrame[],
  window: { startSec: number; endSec: number },
  usedKeys: Set<string>,
): DurableReviewFrame | undefined {
  const midpoint = (window.startSec + window.endSec) / 2;
  return frames
    .filter((frame) =>
      !usedKeys.has(frame.r2Key) &&
      frame.tSec >= window.startSec - TIME_EPSILON_SEC &&
      frame.tSec <= window.endSec + TIME_EPSILON_SEC,
    )
    .sort((left, right) =>
      Math.abs(left.tSec - midpoint) - Math.abs(right.tSec - midpoint) ||
      left.tSec - right.tSec ||
      left.id.localeCompare(right.id) ||
      left.r2Key.localeCompare(right.r2Key),
    )[0];
}

function milestonesFromAnchors(args: {
  anchors: readonly PlanAnchor[];
  narrationStartSec: number;
  finalMasterDurationSec: number;
  frames: readonly DurableReviewFrame[];
}) {
  const usedKeys = new Set<string>();
  return args.anchors.map((anchor) => {
    const window = {
      startSec: roundSeconds(Math.max(0, args.narrationStartSec + anchor.t0)),
      endSec: roundSeconds(Math.min(args.finalMasterDurationSec, args.narrationStartSec + anchor.t1)),
    };
    const selected = selectReviewFrame(args.frames, window, usedKeys);
    if (selected) usedKeys.add(selected.r2Key);
    return {
      id: anchor.id,
      window,
      ...(anchor.storySpineBeatId ? { storySpineBeatId: anchor.storySpineBeatId } : {}),
      ...(anchor.storySpineShotId ? { storySpineShotId: anchor.storySpineShotId } : {}),
      ...(anchor.episodeGraphBeatId ? { episodeGraphBeatId: anchor.episodeGraphBeatId } : {}),
      ...(selected
        ? {
            reviewFrame: {
              id: selected.id,
              tSec: selected.tSec,
              r2Key: selected.r2Key,
              contentSha256: selected.contentSha256,
              byteLength: selected.byteLength,
            },
          }
        : {}),
    };
  });
}

function continuousMilestones(args: {
  finalMasterDurationSec: number;
  frames: readonly DurableReviewFrame[];
}) {
  const usedKeys = new Set<string>();
  const thirds: Array<{ id: "opening" | "middle" | "closing"; start: number; end: number }> = [
    { id: "opening", start: 0, end: args.finalMasterDurationSec / 3 },
    { id: "middle", start: args.finalMasterDurationSec / 3, end: (args.finalMasterDurationSec * 2) / 3 },
    { id: "closing", start: (args.finalMasterDurationSec * 2) / 3, end: args.finalMasterDurationSec },
  ];
  return thirds.map((third) => {
    const window = {
      startSec: roundSeconds(third.start),
      endSec: roundSeconds(third.end),
    };
    const selected = selectReviewFrame(args.frames, window, usedKeys);
    if (selected) usedKeys.add(selected.r2Key);
    return {
      id: third.id,
      window,
      ...(selected
        ? {
            reviewFrame: {
              id: selected.id,
              tSec: selected.tSec,
              r2Key: selected.r2Key,
              contentSha256: selected.contentSha256,
              byteLength: selected.byteLength,
            },
          }
        : {}),
    };
  });
}

function coverageFor(
  milestones: Array<z.infer<typeof milestoneSchema>>,
  reviewMaxGapSec: number,
): z.infer<typeof coverageSchema> {
  const sampledMilestoneCount = milestones.filter((milestone) => milestone.reviewFrame).length;
  return {
    milestoneCount: milestones.length,
    sampledMilestoneCount,
    sampledMilestoneRatio: sampledMilestoneCount / milestones.length,
    maxUnsampledMilestoneSec: Math.max(
      0,
      ...milestones
        .filter((milestone) => !milestone.reviewFrame)
        .map((milestone) => milestone.window.endSec - milestone.window.startSec),
    ),
    reviewMaxGapSec,
  };
}

/**
 * Derives one optional observation from artifacts that are already in memory
 * after final QA. No providers, renders, frame extractions, R2 reads, or gate
 * decisions occur here.
 */
export function deriveViewerPromiseProgression(
  input: DeriveViewerPromiseProgressionInput,
): ViewerPromiseProgressionResolution {
  const route = parseChannelProgramRouteRunSeed(input.route);
  const contentLane = ContentLaneSchema.parse(input.contentLane);
  if (route.contentLaneKey !== contentLane.key) {
    throw new Error("viewer-promise progression route does not match the active content lane");
  }
  const viewerPromise = viewerPromiseFromRoute(route);
  const mode = laneQualityPolicy(contentLane).visualPacing.mode === "exempt"
    ? "continuous"
    : "progressive";
  const finalMaster = finalMasterSchema.safeParse(input.finalMaster);
  if (!finalMaster.success) {
    return omission(viewerPromise, mode, "rejected", "visual_evidence_invalid");
  }
  const visualReview = parseVisualReview(input.visualReview, finalMaster.data);
  if (!visualReview) {
    return omission(viewerPromise, mode, "rejected", "visual_evidence_invalid");
  }
  if (mode === "continuous") {
    const milestones = continuousMilestones({
      finalMasterDurationSec: finalMaster.data.durationSec,
      frames: visualReview.frames,
    });
    return {
      status: "measured",
      receipt: createViewerPromiseProgressionReceipt({
        version: VIEWER_PROMISE_PROGRESSION_VERSION,
        mode,
        assessmentScope: "continuous-experience-review-coverage",
        viewerPromise,
        finalMaster: finalMaster.data,
        visualReview: visualReview.binding,
        plan: {
          source: "lane_visual_pacing_policy",
          visualPacingMode: "exempt",
        },
        milestones,
        coverage: coverageFor(milestones, visualReview.reviewMaxGapSec),
      }),
    };
  }

  const storyResult = parseStorySpine(input);
  if (storyResult.status === "incomplete") {
    return omission(viewerPromise, mode, "not_measured", "incomplete_story_spine");
  }
  if (storyResult.status === "invalid") {
    return omission(viewerPromise, mode, "rejected", "story_spine_invalid");
  }
  let episodeGraph: EpisodeGraph | undefined;
  if (input.episodeGraph !== undefined) {
    try {
      episodeGraph = assertEpisodeGraph(input.episodeGraph);
    } catch {
      return omission(viewerPromise, mode, "rejected", "episode_graph_invalid");
    }
  }
  if (storyResult.status === "absent" && !episodeGraph) {
    return omission(viewerPromise, mode, "not_measured", "incomplete_story_spine");
  }
  const storySpine = storyResult.status === "available" ? storyResult.storySpine : undefined;
  if (storySpine && episodeGraph) {
    try {
      episodeGraph = assertEpisodeGraphAgainstStorySpine(episodeGraph, storySpine);
    } catch {
      return omission(viewerPromise, mode, "rejected", "story_graph_binding_invalid");
    }
  }

  const narrationClock = parseNarrationClock(input, finalMaster.data);
  if (narrationClock.status === "unavailable") {
    return omission(viewerPromise, mode, "not_measured", "narration_clock_unavailable");
  }
  if (narrationClock.status === "mismatch") {
    return omission(viewerPromise, mode, "rejected", "narration_clock_mismatch");
  }
  const planDurationSec = storySpine
    ? storySpine.timedScript.narrationDurationSec
    : episodeGraph!.durationSec;
  if (
    Math.abs(planDurationSec - narrationClock.clock.narrationDurationSec) >
    NARRATION_DURATION_TOLERANCE_SEC
  ) {
    return omission(viewerPromise, mode, "rejected", "narration_clock_mismatch");
  }
  if (storySpine) {
    const timingMatch = storySpineMatchesSentenceTimings(storySpine, input.sentenceTimings);
    if (timingMatch === "unavailable") {
      return omission(viewerPromise, mode, "not_measured", "narration_clock_unavailable");
    }
    if (timingMatch === "mismatch") {
      return omission(viewerPromise, mode, "rejected", "narration_clock_mismatch");
    }
  }

  const anchors: PlanAnchor[] = storySpine
    ? chooseDistinctAnchors(storySpine.narrativeBeats, planDurationSec).map(({ id, value }) => ({
        id,
        t0: value.t0,
        t1: value.t1,
        storySpineBeatId: value.id,
        ...(representativeStoryShot(storySpine, value.id)
          ? { storySpineShotId: representativeStoryShot(storySpine, value.id) }
          : {}),
        ...(graphBeatForStoryAnchor(episodeGraph, value.id, value.t0, value.t1)
          ? { episodeGraphBeatId: graphBeatForStoryAnchor(episodeGraph, value.id, value.t0, value.t1) }
          : {}),
      }))
    : chooseDistinctAnchors(episodeGraph!.beats, planDurationSec).map(({ id, value }) => ({
        id,
        t0: value.t0,
        t1: value.t1,
        episodeGraphBeatId: value.id,
      }));
  if (anchors.length < 2) {
    return omission(viewerPromise, mode, "not_measured", "insufficient_progression_anchors");
  }
  const milestones = milestonesFromAnchors({
    anchors,
    narrationStartSec: narrationClock.clock.narrationStartSec,
    finalMasterDurationSec: finalMaster.data.durationSec,
    frames: visualReview.frames,
  });
  if (milestones.some((milestone) => milestone.window.endSec <= milestone.window.startSec)) {
    return omission(viewerPromise, mode, "rejected", "narration_clock_mismatch");
  }
  const plan = storySpine && episodeGraph
    ? {
        source: "story_spine_episode_graph" as const,
        storySpineFingerprint: storySpineFingerprint(storySpine),
        episodeGraphFingerprint: canonicalFingerprint(episodeGraph),
        storyBeatCount: storySpine.narrativeBeats.length,
        storyShotCount: storySpine.shotList.length,
        episodeGraphBeatCount: episodeGraph.beats.length,
        narrationClock: narrationClock.clock,
      }
    : storySpine
      ? {
          source: "story_spine" as const,
          storySpineFingerprint: storySpineFingerprint(storySpine),
          storyBeatCount: storySpine.narrativeBeats.length,
          storyShotCount: storySpine.shotList.length,
          narrationClock: narrationClock.clock,
        }
      : {
          source: "episode_graph" as const,
          episodeGraphFingerprint: canonicalFingerprint(episodeGraph!),
          episodeGraphBeatCount: episodeGraph!.beats.length,
          narrationClock: narrationClock.clock,
        };
  return {
    status: "measured",
    receipt: createViewerPromiseProgressionReceipt({
      version: VIEWER_PROMISE_PROGRESSION_VERSION,
      mode,
      assessmentScope: "route-bound-plan-and-review-sample-coverage",
      viewerPromise,
      finalMaster: finalMaster.data,
      visualReview: visualReview.binding,
      plan,
      milestones,
      coverage: coverageFor(milestones, visualReview.reviewMaxGapSec),
    }),
  };
}

function assertCertificateRouteBinding(args: {
  viewerPromise: z.infer<typeof viewerPromiseSchema>;
  programRoute: AssertViewerPromiseProgressionCertificateBindingInput["programRoute"];
  sealedRoute: unknown;
  contentLane: AssertViewerPromiseProgressionCertificateBindingInput["contentLane"];
}) {
  const { viewerPromise, programRoute, contentLane } = args;
  const sealedRoute = parseChannelProgramRouteRunSeed(args.sealedRoute);
  const expectedViewerPromise = viewerPromiseFromRoute(sealedRoute);
  if (
    !programRoute.programBriefFingerprint ||
    !programRoute.routeSeedFingerprint ||
    viewerPromise.routeFingerprint !== programRoute.routeFingerprint ||
    viewerPromise.programBriefFingerprint !== programRoute.programBriefFingerprint ||
    viewerPromise.routeSeedFingerprint !== programRoute.routeSeedFingerprint ||
    viewerPromise.family !== programRoute.family ||
    viewerPromise.contentLaneKey !== programRoute.contentLaneKey ||
    viewerPromise.contentLaneKey !== contentLane.key ||
    programRoute.routeFingerprint !== sealedRoute.routeFingerprint ||
    programRoute.programBriefFingerprint !== sealedRoute.programBriefFingerprint ||
    programRoute.routeSeedFingerprint !== channelProgramRouteRunSeedFingerprint(sealedRoute) ||
    programRoute.family !== sealedRoute.family ||
    programRoute.contentLaneKey !== sealedRoute.contentLaneKey
  ) {
    throw new Error("viewer-promise progression evidence does not match the final-QA route binding");
  }
  if (
    viewerPromise.claimMode !== expectedViewerPromise.claimMode ||
    viewerPromise.viewerJobFingerprint !== expectedViewerPromise.viewerJobFingerprint
  ) {
    throw new Error("viewer-promise progression evidence does not match sealed route directives");
  }
}

/** Validates a measured receipt against the surrounding release certificate. */
export function assertViewerPromiseProgressionCertificateBinding(
  input: AssertViewerPromiseProgressionCertificateBindingInput,
): ViewerPromiseProgressionReceipt {
  const receipt = assertViewerPromiseProgressionReceipt(input.receipt);
  assertCertificateRouteBinding({
    viewerPromise: receipt.viewerPromise,
    programRoute: input.programRoute,
    sealedRoute: input.sealedRoute,
    contentLane: input.contentLane,
  });
  const expectsContinuousObservation =
    laneQualityPolicy(input.contentLane.key).visualPacing.mode === "exempt";
  if (
    (receipt.mode === "continuous") !== expectsContinuousObservation
  ) {
    throw new Error("viewer-promise progression mode does not match the certificate content-lane pacing policy");
  }
  if (
    receipt.finalMaster.sha256 !== input.finalMaster.sha256 ||
    !sameNumber(receipt.finalMaster.durationSec, input.finalMaster.durationSec) ||
    receipt.visualReview.reviewFingerprint !== input.visualReview.reviewFingerprint ||
    receipt.visualReview.reviewReceiptVersion !== input.visualReview.reviewReceiptVersion ||
    receipt.visualReview.reviewReceiptFingerprint !== input.visualReview.reviewReceiptFingerprint ||
    receipt.visualReview.releaseReceiptFingerprint !== input.visualReview.releaseReceiptFingerprint
  ) {
    throw new Error("viewer-promise progression receipt does not match final-master visual-review evidence");
  }
  const certificateFrameArtifacts = new Map(
    input.evidenceFrameArtifacts.map((artifact) => [artifact.r2Key, artifact]),
  );
  for (const milestone of receipt.milestones) {
    if (!milestone.reviewFrame) continue;
    const certificateFrame = certificateFrameArtifacts.get(milestone.reviewFrame.r2Key);
    if (!certificateFrame) {
      throw new Error("viewer-promise progression receipt references a visual-review frame absent from the certificate");
    }
    if (
      certificateFrame.id !== milestone.reviewFrame.id ||
      certificateFrame.tSec !== milestone.reviewFrame.tSec ||
      certificateFrame.contentSha256 !== milestone.reviewFrame.contentSha256 ||
      certificateFrame.byteLength !== milestone.reviewFrame.byteLength
    ) {
      throw new Error("viewer-promise progression receipt does not match the certificate durable visual-review witness");
    }
  }
  if (receipt.mode === "progressive") {
    const narration = FinalMasterNarrationSemanticEvidenceSchema.safeParse(input.finalMasterNarration);
    const cueTiming = NarrationCueTimingEvidenceSchema.safeParse(input.narrationCueTiming);
    if (!narration.success || !cueTiming.success) {
      throw new Error("progressive viewer-promise progression receipt requires narration and cue-timing evidence");
    }
    const clock = receipt.plan.narrationClock;
    if (!clock) {
      throw new Error("progressive viewer-promise progression receipt lacks narration clock evidence");
    }
    if (
      narration.data.finalMaster.sha256 !== input.finalMaster.sha256 ||
      !sameNumber(narration.data.finalMaster.durationSec, input.finalMaster.durationSec) ||
      narration.data.narration.sourceSha256 !== clock.sourceNarrationSha256 ||
      !sameNumber(narration.data.narration.startSec, clock.narrationStartSec) ||
      !sameNumber(narration.data.narration.durationSec, clock.narrationDurationSec) ||
      narration.data.receiptFingerprint !== clock.finalMasterNarrationReceiptFingerprint ||
      cueTiming.data.sourceSha256 !== clock.sourceNarrationSha256 ||
      canonicalFingerprint(cueTiming.data) !== clock.cueTimingFingerprint
    ) {
      throw new Error("progressive viewer-promise narration clock does not match certificate audio evidence");
    }
  }
  return receipt;
}

/** Validates a non-gating omission against the sealed route identity. */
export function assertViewerPromiseProgressionOmissionCertificateBinding(
  input: AssertViewerPromiseProgressionOmissionCertificateBindingInput,
): ViewerPromiseProgressionOmission {
  const omission = assertViewerPromiseProgressionOmission(input.omission);
  assertCertificateRouteBinding({
    viewerPromise: omission.viewerPromise,
    programRoute: input.programRoute,
    sealedRoute: input.sealedRoute,
    contentLane: input.contentLane,
  });
  const expectsContinuousObservation =
    laneQualityPolicy(input.contentLane.key).visualPacing.mode === "exempt";
  if ((omission.mode === "continuous") !== expectsContinuousObservation) {
    throw new Error("viewer-promise progression omission mode does not match the certificate content-lane pacing policy");
  }
  return omission;
}
