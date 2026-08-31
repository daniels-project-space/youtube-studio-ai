/**
 * QuizShort private-release admission.
 *
 * This block never renders, calls a creative provider, or publishes media. It
 * only joins already-created, durable receipts at the last safe point before
 * upload_draft. A pass means “make a private human-review draft”, never
 * “publish automatically”.
 */
import { createHash } from "node:crypto";
import { channelProgramRouteRunSeedFingerprint, parseChannelProgramRouteRunSeed, type ChannelProgramRouteRunSeed } from "@/engine/channelProgramRoute";
import { resolveContentLane } from "@/engine/contentLane";
import { resolveCertifiedQuizProfile } from "@/engine/certifiedQuizProfile";
import { type Block, type StageContext } from "@/engine/types";
import {
  assertCertifiedQuizTopicPlan,
  assertCertifiedQuizTopicSafety,
  quizTopicPlanFingerprint,
  type QuizTopicPlan,
} from "@/trigger/blocks/quizPlanningBlocks";
import {
  parseFinalMasterReleaseCertificateBytes,
  type FinalMasterReleaseCertificate,
} from "@/lib/finalMasterReleaseCertificate";
import { quizCitationLabel } from "@/lib/quizCitation";
import { getObjectBytes } from "@/lib/storage";

export const QUIZ_SHORT_RELEASE_VERSION = "quiz-short-release/v1" as const;
const QUIZ_SHORT_ROUTE_KEY = "quizyear/portrait-supervised/v1" as const;
const QUIZ_SHORT_OPENING_HOOK_VERSION = "quiz-short-opening-hook/v1" as const;
const TIME_EPSILON_SEC = 0.02;

export interface QuizShortReleaseReceipt {
  readonly version: typeof QUIZ_SHORT_RELEASE_VERSION;
  readonly pass: true;
  readonly release: "human-editorial-review-required";
  readonly allowedPublishMode: "draft";
  readonly routeKey: typeof QUIZ_SHORT_ROUTE_KEY;
  readonly routeFingerprint: string;
  readonly planFingerprint: string;
  readonly certificateFingerprint: string;
  readonly finalMasterKey: string;
  readonly finalMasterSha256: string;
  readonly finalMasterDurationSec: number;
  readonly factSourceCount: number;
  readonly factSourceFingerprint: string;
  readonly openingEvidenceFingerprint: string;
}

interface QuizShortOpeningHook {
  readonly version: typeof QUIZ_SHORT_OPENING_HOOK_VERSION;
  readonly cueId: "quiz-short-opening-hook";
  readonly startSec: number;
  readonly endSec: number;
  readonly sampleSec: number;
  readonly expectedText: string;
}

interface CertifiedQuizRound {
  readonly questionText: string;
  readonly subject: string;
  readonly sourceUrl: string;
  readonly countdownSeconds: number;
  readonly revealSeconds: number;
  readonly correctAnswer: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function sameTime(left: number, right: number): boolean {
  return Math.abs(left - right) <= TIME_EPSILON_SEC;
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  return value.trim();
}

function safeSourceUrl(value: unknown, message: string): string {
  const sourceUrl = requiredString(value, message);
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("unsupported protocol");
  } catch {
    throw new Error(message);
  }
  return sourceUrl;
}

function optionText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const option = value as Record<string, unknown>;
  if (typeof option["label"] === "string" && option["label"].trim()) {
    return option["label"].trim();
  }
  const year = Number(option["year"]);
  return Number.isInteger(year) ? String(year) : "";
}

function assertCertifiedQuizShortRounds(value: unknown): CertifiedQuizRound[] {
  if (!Array.isArray(value) || value.length < 3 || value.length > 4) {
    throw new Error("quiz_short_release: portrait Short requires exactly three or four certified rounds");
  }
  return value.map((value, index) => {
    if (!value || typeof value !== "object") {
      throw new Error(`quiz_short_release: round ${index + 1} is malformed`);
    }
    const round = value as Record<string, unknown>;
    const questionText = requiredString(round["questionText"], `quiz_short_release: round ${index + 1} has no question text`);
    const subject = requiredString(round["subject"], `quiz_short_release: round ${index + 1} has no source subject`);
    const sourceUrl = safeSourceUrl(round["sourceUrl"], `quiz_short_release: round ${index + 1} has an invalid source URL`);
    const countdownSeconds = Number(round["countdownSeconds"]);
    const revealSeconds = Number(round["revealSeconds"]);
    if (!Number.isFinite(countdownSeconds) || countdownSeconds < 3 || !Number.isFinite(revealSeconds) || revealSeconds < 2) {
      throw new Error(`quiz_short_release: round ${index + 1} has invalid certified timing`);
    }
    if (!Array.isArray(round["options"]) || round["options"].length !== 4) {
      throw new Error(`quiz_short_release: round ${index + 1} must retain four answer options`);
    }
    const correct = round["options"].filter((option) =>
      Boolean(option && typeof option === "object" && (option as Record<string, unknown>)["isCorrect"] === true),
    );
    const correctAnswer = correct.length === 1 ? optionText(correct[0]) : "";
    if (!correctAnswer) {
      throw new Error(`quiz_short_release: round ${index + 1} lacks exactly one readable certified answer`);
    }
    return { questionText, subject, sourceUrl, countdownSeconds, revealSeconds, correctAnswer };
  });
}

function assertOpeningHook(value: unknown, rounds: readonly CertifiedQuizRound[], durationSec: number): QuizShortOpeningHook {
  if (!value || typeof value !== "object") {
    throw new Error("quiz_short_release: portrait renderer did not declare its opening hook");
  }
  const hook = value as Record<string, unknown>;
  const startSec = Number(hook["startSec"]);
  const endSec = Number(hook["endSec"]);
  const sampleSec = Number(hook["sampleSec"]);
  const expectedText = requiredString(hook["expectedText"], "quiz_short_release: opening hook has no readable question text");
  if (
    hook["version"] !== QUIZ_SHORT_OPENING_HOOK_VERSION ||
    hook["cueId"] !== "quiz-short-opening-hook" ||
    !Number.isFinite(startSec) || !Number.isFinite(endSec) || !Number.isFinite(sampleSec) ||
    startSec < 0 || endSec <= startSec || sampleSec < startSec || sampleSec > endSec ||
    endSec > durationSec + TIME_EPSILON_SEC || expectedText !== rounds[0]?.questionText
  ) {
    throw new Error("quiz_short_release: opening hook is malformed or does not match the first certified question");
  }
  return {
    version: QUIZ_SHORT_OPENING_HOOK_VERSION,
    cueId: "quiz-short-opening-hook",
    startSec,
    endSec,
    sampleSec,
    expectedText,
  };
}

function assertDeclaredCue(args: {
  readonly value: unknown;
  readonly id: string;
  readonly expectedText: string;
  readonly sampleSec?: number;
}): void {
  if (!Array.isArray(args.value)) throw new Error("quiz_short_release: renderer did not retain its timed text plan");
  const matches = args.value.filter((value) =>
    Boolean(value && typeof value === "object" && (value as Record<string, unknown>)["id"] === args.id),
  );
  if (matches.length !== 1) throw new Error(`quiz_short_release: expected one timed text cue for ${args.id}`);
  const cue = matches[0] as Record<string, unknown>;
  if (requiredString(cue["expectedText"], `quiz_short_release: cue ${args.id} lacks expected text`) !== args.expectedText) {
    throw new Error(`quiz_short_release: cue ${args.id} does not match the certified source text`);
  }
  if (args.sampleSec !== undefined && !sameTime(Number(cue["sampleSec"]), args.sampleSec)) {
    throw new Error(`quiz_short_release: cue ${args.id} does not retain the renderer opening sample time`);
  }
}

function assertPassingOcrCue(args: {
  readonly certificate: FinalMasterReleaseCertificate;
  readonly id: string;
  readonly expectedText: string;
  readonly sampleSec?: number;
}): void {
  const proof = args.certificate.onScreenText;
  if (!proof || !proof.passed) {
    throw new Error("quiz_short_release: final certificate lacks passing OCR proof");
  }
  const matches = proof.cues.filter((cue) => cue.id === args.id);
  if (matches.length !== 1) throw new Error(`quiz_short_release: final OCR proof lacks exactly one cue for ${args.id}`);
  const cue = matches[0];
  if (!cue.passed || cue.expectedTextSha256 !== sha256(args.expectedText)) {
    throw new Error(`quiz_short_release: final OCR proof does not attest the expected text for ${args.id}`);
  }
  if (args.sampleSec !== undefined && !sameTime(cue.sampleSec, args.sampleSec)) {
    throw new Error(`quiz_short_release: final OCR proof has a stale sample time for ${args.id}`);
  }
}

function assertSupervisedQuizShortRoute(value: unknown): ChannelProgramRouteRunSeed {
  const route = parseChannelProgramRouteRunSeed(value);
  if (
    route.routeKey !== QUIZ_SHORT_ROUTE_KEY ||
    route.admission !== "supervised_private" ||
    route.family !== "quizyear" ||
    route.contentLaneKey !== "quiz_year" ||
    route.directives.claimMode !== "certified_quiz_facts" ||
    !route.quizProfile ||
    !["quiz_topic_plan", "quiz_topic_safety", "quiz_year", "qa_visual", "quiz_short_release", "upload_draft"].every(
      (block) => route.requiredBlocks.includes(block),
    )
  ) {
    throw new Error("quiz_short_release: this receipt is reserved for the sealed supervised QuizShort route");
  }
  return route;
}

function assertPortraitQaReport(value: unknown, certificate: FinalMasterReleaseCertificate): void {
  if (!value || typeof value !== "object") throw new Error("quiz_short_release: final portrait QA report is missing");
  const report = value as Record<string, unknown>;
  const structural = report["structural"] as Record<string, unknown> | undefined;
  const watch = report["watch"] as Record<string, unknown> | undefined;
  if (
    structural?.["ok"] !== true || structural["width"] !== 1080 || structural["height"] !== 1920 ||
    !sameTime(Number(structural["durationSec"]), certificate.finalMaster.durationSec) ||
    watch?.["ran"] !== true || watch["verdict"] !== "pass"
  ) {
    throw new Error("quiz_short_release: final QA did not prove a passing native 1080x1920 portrait master");
  }
}

function assertCertificateBindings(args: {
  readonly certificate: FinalMasterReleaseCertificate;
  readonly route: ChannelProgramRouteRunSeed;
  readonly videoKey: string;
  readonly videoDurationSec: number;
  readonly hook: QuizShortOpeningHook;
}): void {
  const { certificate, route, videoKey, videoDurationSec, hook } = args;
  if (
    certificate.finalMaster.r2Key !== videoKey ||
    !sameTime(certificate.finalMaster.durationSec, videoDurationSec) ||
    certificate.finalMaster.durationSec < 35 || certificate.finalMaster.durationSec > 60
  ) {
    throw new Error("quiz_short_release: final certificate is not bound to the 35–60 second portrait master");
  }
  const quality = certificate.qualityEvidence;
  if (!quality?.programRoute || quality.contentLane.key !== "quiz_year") {
    throw new Error("quiz_short_release: final certificate lacks its sealed QuizShort QA route binding");
  }
  if (
    quality.programRoute.routeFingerprint !== route.routeFingerprint ||
    quality.programRoute.routeSeedFingerprint !== channelProgramRouteRunSeedFingerprint(route) ||
    quality.programRoute.family !== route.family ||
    quality.programRoute.contentLaneKey !== route.contentLaneKey ||
    quality.qualityEvidence.release.hardGateReady !== true ||
    quality.qualityEvidence.axes.visual.status !== "pass" ||
    quality.qualityEvidence.axes.audio.status !== "pass" ||
    quality.qualityEvidence.axes.audio.score === undefined ||
    quality.qualityEvidence.axes.audio.minimumScore === undefined ||
    quality.qualityEvidence.axes.audio.score < quality.qualityEvidence.axes.audio.minimumScore
  ) {
    throw new Error("quiz_short_release: final certificate lacks passing route-bound visual/audio QA");
  }
  const opening = certificate.shortsOpeningEvidence;
  if (
    !opening || opening.firstSemanticVisual.source !== "on_screen_hook" ||
    !opening.firstHookOnScreenText || opening.firstHookOnScreenText.source !== "on_screen_hook" ||
    opening.firstHookOnScreenText.cueId !== hook.cueId ||
    opening.firstHookOnScreenText.expectedTextSha256 !== sha256(hook.expectedText) ||
    !sameTime(opening.firstSemanticVisual.tSec, hook.startSec) ||
    !sameTime(opening.firstHookOnScreenText.tSec, hook.startSec) ||
    !sameTime(opening.firstHookOnScreenText.endSec, hook.endSec) ||
    !opening.firstVisualMotionChange.reviewFrame
  ) {
    throw new Error("quiz_short_release: final certificate lacks complete opening visual/text/motion evidence");
  }
}

function factSourceFingerprint(rounds: readonly CertifiedQuizRound[]): string {
  return sha256(JSON.stringify(rounds.map((round) => ({
    questionText: round.questionText,
    correctAnswer: round.correctAnswer,
    sourceUrl: round.sourceUrl,
  }))));
}

/**
 * Pure gate used by the runtime block and focused tests. All supplied evidence
 * must already exist; this function has no storage, provider, or publish side
 * effect.
 */
export function createQuizShortReleaseReceipt(input: {
  readonly route: unknown;
  readonly contentLane: unknown;
  readonly plan: unknown;
  readonly safety: unknown;
  readonly rounds: unknown;
  readonly onScreenTextCues: unknown;
  readonly openingHook: unknown;
  readonly qaReport: unknown;
  readonly videoKey: unknown;
  readonly videoDurationSec: unknown;
  readonly certificate: FinalMasterReleaseCertificate;
}): QuizShortReleaseReceipt {
  const route = assertSupervisedQuizShortRoute(input.route);
  const lane = resolveContentLane({ stored: input.contentLane, pipeline: [] });
  if (lane.key !== "quiz_year" || lane.primaryRenderer !== "quiz_year") {
    throw new Error("quiz_short_release: sealed QuizShort route must stay in the QuizYear content lane");
  }
  const profile = resolveCertifiedQuizProfile(route.quizProfile);
  const plan: QuizTopicPlan = assertCertifiedQuizTopicPlan(input.plan, profile);
  assertCertifiedQuizTopicSafety(input.safety, plan);
  const rounds = assertCertifiedQuizShortRounds(input.rounds);
  const videoKey = requiredString(input.videoKey, "quiz_short_release: final master key is missing");
  const videoDurationSec = Number(input.videoDurationSec);
  if (!Number.isFinite(videoDurationSec) || videoDurationSec < 35 || videoDurationSec > 60) {
    throw new Error("quiz_short_release: renderer did not declare a 35–60 second portrait master");
  }
  const hook = assertOpeningHook(input.openingHook, rounds, videoDurationSec);
  assertDeclaredCue({
    value: input.onScreenTextCues,
    id: hook.cueId,
    expectedText: hook.expectedText,
    sampleSec: hook.sampleSec,
  });
  for (const [index, round] of rounds.entries()) {
    const id = `quiz-round-${String(index + 1).padStart(2, "0")}-reveal-source`;
    assertDeclaredCue({
      value: input.onScreenTextCues,
      id,
      expectedText: `source ${quizCitationLabel(round.sourceUrl)}`,
    });
    assertPassingOcrCue({
      certificate: input.certificate,
      id,
      expectedText: `source ${quizCitationLabel(round.sourceUrl)}`,
    });
  }
  assertPassingOcrCue({
    certificate: input.certificate,
    id: hook.cueId,
    expectedText: hook.expectedText,
    sampleSec: hook.sampleSec,
  });
  assertPortraitQaReport(input.qaReport, input.certificate);
  assertCertificateBindings({ certificate: input.certificate, route, videoKey, videoDurationSec, hook });
  return {
    version: QUIZ_SHORT_RELEASE_VERSION,
    pass: true,
    release: "human-editorial-review-required",
    allowedPublishMode: "draft",
    routeKey: QUIZ_SHORT_ROUTE_KEY,
    routeFingerprint: route.routeFingerprint,
    planFingerprint: quizTopicPlanFingerprint(plan),
    certificateFingerprint: input.certificate.certificateFingerprint,
    finalMasterKey: videoKey,
    finalMasterSha256: input.certificate.finalMaster.sha256,
    finalMasterDurationSec: input.certificate.finalMaster.durationSec,
    factSourceCount: rounds.length,
    factSourceFingerprint: factSourceFingerprint(rounds),
    openingEvidenceFingerprint: input.certificate.shortsOpeningEvidence!.receiptFingerprint,
  };
}

/** Re-check the private receipt at the upload boundary to defeat stale/tampered stage state. */
export function assertQuizShortReleaseReceiptForUpload(input: {
  readonly receipt: unknown;
  readonly route: unknown;
  readonly certificate: FinalMasterReleaseCertificate;
  readonly videoKey: unknown;
  readonly publishMode: unknown;
}): QuizShortReleaseReceipt {
  const route = assertSupervisedQuizShortRoute(input.route);
  const videoKey = requiredString(input.videoKey, "upload_draft: QuizShort final master key is missing");
  const receipt = input.receipt as Partial<QuizShortReleaseReceipt> | undefined;
  const factSourceCount = Number(receipt?.factSourceCount);
  if (
    !receipt || receipt.version !== QUIZ_SHORT_RELEASE_VERSION || receipt.pass !== true ||
    receipt.release !== "human-editorial-review-required" || receipt.allowedPublishMode !== "draft" ||
    receipt.routeKey !== QUIZ_SHORT_ROUTE_KEY || receipt.routeFingerprint !== route.routeFingerprint ||
    receipt.certificateFingerprint !== input.certificate.certificateFingerprint ||
    receipt.finalMasterKey !== videoKey || receipt.finalMasterSha256 !== input.certificate.finalMaster.sha256 ||
    !sameTime(Number(receipt.finalMasterDurationSec), input.certificate.finalMaster.durationSec) ||
    receipt.openingEvidenceFingerprint !== input.certificate.shortsOpeningEvidence?.receiptFingerprint ||
    !isSha256(receipt.planFingerprint) || !isSha256(receipt.factSourceFingerprint) ||
    !isSha256(receipt.openingEvidenceFingerprint) ||
    !Number.isInteger(factSourceCount) || factSourceCount < 3 || factSourceCount > 4
  ) {
    throw new Error("upload_draft: QuizShort private-review receipt is missing, stale, or bound to another master");
  }
  if (input.publishMode !== "draft") {
    throw new Error("upload_draft: QuizShort may only create a private draft; public or scheduled release requires a new explicit admission");
  }
  return receipt as QuizShortReleaseReceipt;
}

export const quizShortReleaseBlocks: Block[] = [{
  id: "quiz_short_release",
  consumes: [
    "quizPlan", "quizSafety", "quizRounds", "onScreenTextCues", "quizShortOpeningHook",
    "videoKey", "videoDurationSec", "qaReport", "contentLane", "channelProgramRoute",
    "finalMasterReleaseCertificateKey",
  ],
  produces: ["quizShortRelease"],
  run: async (ctx: StageContext) => {
    const certificateKey = requiredString(
      ctx.store["finalMasterReleaseCertificateKey"],
      "quiz_short_release: final-master release certificate key is missing",
    );
    // Read the already-persisted certificate only. No media/provider/publish
    // operation belongs in this admission block.
    const certificate = parseFinalMasterReleaseCertificateBytes(await getObjectBytes(certificateKey));
    const quizShortRelease = createQuizShortReleaseReceipt({
      route: ctx.store["channelProgramRoute"],
      contentLane: ctx.store["contentLane"],
      plan: ctx.store["quizPlan"],
      safety: ctx.store["quizSafety"],
      rounds: ctx.store["quizRounds"],
      onScreenTextCues: ctx.store["onScreenTextCues"],
      openingHook: ctx.store["quizShortOpeningHook"],
      qaReport: ctx.store["qaReport"],
      videoKey: ctx.store["videoKey"],
      videoDurationSec: ctx.store["videoDurationSec"],
      certificate,
    });
    ctx.log(
      `quiz_short_release: private human-review receipt sealed (${quizShortRelease.certificateFingerprint.slice(0, 12)}, ` +
        `${quizShortRelease.factSourceCount} certified source receipts)`,
    );
    return { quizShortRelease };
  },
}];
