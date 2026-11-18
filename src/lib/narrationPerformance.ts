import { measureAudio, probe } from "@/lib/ffmpeg";
import { assertAnyQwenNarrationSourceEvidence, type QwenNarrationProviderSourceEvidence } from "@/lib/hyperYoutubeQwenNarrationEvidence";

export const NARRATION_PERFORMANCE_EVIDENCE_VERSION = "narration-performance-evidence/v1" as const;

export interface NarrationPerformanceEvidence {
  version: typeof NARRATION_PERFORMANCE_EVIDENCE_VERSION;
  source: "local_ffmpeg";
  durationSec: number;
  wordCount: number;
  wordsPerSec: number;
  /** Speech-only clock, excluding measured inter-sentence silence when supplied. */
  spokenDurationSec?: number;
  spokenWordsPerSec?: number;
  integratedLufs: number;
  windowMeanDb: number;
  /** Present only when the source was synthesized by the pinned Qwen worker. */
  qwenProviderEvidence?: QwenNarrationProviderSourceEvidence;
}

/**
 * A sentence timecode drives captions, visual inserts, and the cinematic edit
 * plan.  A small number of failed duration probes can be reconciled against
 * the completed narration; beyond this limit the individual timing map is an
 * estimate, not a trustworthy edit clock.
 */
export const MAX_ESTIMATED_NARRATION_SENTENCE_DURATIONS = 2;

export function assertNarrationTimingMeasurementIntegrity(args: {
  sentenceCount: number;
  estimatedDurationCount: number;
}): void {
  const sentenceCount = Number(args.sentenceCount);
  const estimatedDurationCount = Number(args.estimatedDurationCount);
  if (!Number.isInteger(sentenceCount) || sentenceCount < 1) {
    throw new Error("narration timing integrity: sentence count is invalid");
  }
  if (
    !Number.isInteger(estimatedDurationCount) ||
    estimatedDurationCount < 0 ||
    estimatedDurationCount > sentenceCount
  ) {
    throw new Error("narration timing integrity: estimated-duration count is invalid");
  }
  if (estimatedDurationCount > MAX_ESTIMATED_NARRATION_SENTENCE_DURATIONS) {
    throw new Error(
      `narration timing integrity: ${estimatedDurationCount} sentence durations are estimates (maximum ${MAX_ESTIMATED_NARRATION_SENTENCE_DURATIONS}); caption and edit sync would be fiction`,
    );
  }
}

/**
 * The TTS worker emits this receipt and final QA consumes it on a different
 * worker. Keep that boundary strict so a log line, stale shape, or substituted
 * audio path cannot masquerade as measured narration evidence.
 */
export function assertNarrationPerformanceEvidence(value: unknown): NarrationPerformanceEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("narration performance evidence is missing or malformed");
  }
  const raw = value as Record<string, unknown>;
  const number = (key: string, min: number, max: number): number => {
    const candidate = raw[key];
    if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < min || candidate > max) {
      throw new Error(`narration performance evidence has invalid ${key}`);
    }
    return candidate;
  };
  if (raw.version !== NARRATION_PERFORMANCE_EVIDENCE_VERSION || raw.source !== "local_ffmpeg") {
    throw new Error("narration performance evidence must be a current local_ffmpeg receipt");
  }
  const durationSec = number("durationSec", 1.5, 86_400);
  const wordCount = number("wordCount", 3, 1_000_000);
  const wordsPerSec = number("wordsPerSec", 0.05, 20);
  const expectedWordsPerSec = wordCount / durationSec;
  if (Math.abs(wordsPerSec - expectedWordsPerSec) > Math.max(0.02, expectedWordsPerSec * 0.02)) {
    throw new Error("narration performance evidence wordsPerSec does not bind its wordCount and durationSec");
  }
  const spokenDurationSec = raw.spokenDurationSec === undefined
    ? undefined
    : number("spokenDurationSec", 1.5, 86_400);
  const spokenWordsPerSec = raw.spokenWordsPerSec === undefined
    ? undefined
    : number("spokenWordsPerSec", 0.05, 20);
  if ((spokenDurationSec === undefined) !== (spokenWordsPerSec === undefined)) {
    throw new Error("narration performance evidence must include both speech-only timing fields");
  }
  if (
    spokenDurationSec !== undefined && spokenWordsPerSec !== undefined &&
    Math.abs(spokenWordsPerSec - wordCount / spokenDurationSec) > Math.max(0.02, (wordCount / spokenDurationSec) * 0.02)
  ) {
    throw new Error("narration performance evidence spokenWordsPerSec does not bind its wordCount and spokenDurationSec");
  }
  if (spokenDurationSec !== undefined && spokenDurationSec > durationSec + 5) {
    throw new Error("narration performance evidence spokenDurationSec exceeds the measured track duration");
  }
  const qwenProviderEvidence = raw.qwenProviderEvidence === undefined
    ? undefined
    : assertAnyQwenNarrationSourceEvidence(raw.qwenProviderEvidence);
  return {
    version: NARRATION_PERFORMANCE_EVIDENCE_VERSION,
    source: "local_ffmpeg",
    durationSec,
    wordCount,
    wordsPerSec,
    ...(spokenDurationSec === undefined ? {} : { spokenDurationSec }),
    ...(spokenWordsPerSec === undefined ? {} : { spokenWordsPerSec }),
    integratedLufs: number("integratedLufs", -36, -6),
    windowMeanDb: number("windowMeanDb", -48, -3),
    ...(qwenProviderEvidence === undefined ? {} : { qwenProviderEvidence }),
  };
}

export const NARRATION_CADENCE_EVIDENCE_VERSION = "narration-cadence-evidence/v1" as const;

export type NarrationPausePurpose = "turn" | "reveal" | "question" | "release" | "section" | "continuation";
export type NarrationCadenceProfile = "standard" | "quiet_listening";

/** Shared genre detection and conservative timing allowance for long rests. */
export function isQuietListeningNarration(...hints: readonly unknown[]): boolean {
  const text = hints.filter((hint): hint is string => typeof hint === "string").join(" ");
  return /sleep|meditat|hypnot|drowsy|ambient|lo[\s-]?fi|mindful|breathwork|restful|relaxation/i.test(text);
}

/** Reserve up to 30 seconds of long-rest time per five minutes of requested runtime. */
export function quietListeningRestBudgetSec(targetDurationSec: number): number {
  if (!Number.isFinite(targetDurationSec) || targetDurationSec < 180) return 0;
  return Math.max(1, Math.floor(targetDurationSec / 300)) * 30;
}

/**
 * DELIVERY RATE — the pacing axis nothing was checking.
 *
 * Inter-sentence pauses are already enforced to within 0.08s by
 * evaluateNarrationCadence, which is tight. The rate of speech INSIDE those
 * sentences had only the sanity band in preflightNarrationPerformance, which
 * accepts anything between 0.3x and 2.5x of expected. That catches silence and
 * truncation and nothing else: a read 27% too fast passes comfortably.
 *
 * It is not hypothetical. Grading the studio's own narration corpus with
 * scripts/narration-oracle.py found the same pipeline delivering 98, 140 and
 * 158 words per minute on three scripts, against an ElevenLabs reference of
 * 125, 128 and 136. A 60% spread in delivery rate is a different video at each
 * end, and nothing in the pipeline noticed.
 *
 * CALIBRATION. The band has to pass work that was already approved, or it is
 * broken rather than strict — the rule the thumbnail gates were rebuilt on.
 * Centred on the channel's intended rate with a 15% tolerance, all three
 * reference takes pass and both outliers fail, which is the discrimination the
 * gate exists to provide.
 */
export const NARRATION_BASE_WORDS_PER_SEC = 2.15;
export const NARRATION_RATE_TOLERANCE = 0.15;
// This is the exact control range exposed by the narration module and used by
// every current channel physics profile. A value outside it would make the
// script word-budget, provider instruction, and measured delivery target
// disagree about what the channel asked for.
export const NARRATION_SPEED_MIN = 0.85;
export const NARRATION_SPEED_MAX = 1.15;

export function assertNarrationSpeed(value: unknown, label = "narration speed"): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < NARRATION_SPEED_MIN || value > NARRATION_SPEED_MAX) {
    throw new Error(`${label} must be a finite ${NARRATION_SPEED_MIN}-${NARRATION_SPEED_MAX} multiplier`);
  }
  return value;
}

export interface NarrationRateVerdict {
  ok: boolean;
  wordsPerSec: number;
  intendedWordsPerSec: number;
  lowerBound: number;
  upperBound: number;
  ratio: number;
  detail: string;
}

/**
 * Judge delivered speech rate against the channel's own intended pace.
 *
 * `speed` comes from the channel's narration physics, where a quiet mentor runs
 * 0.95 and a chaos commentator 1.15. Judging every channel against one absolute
 * rate would mark a deliberately unhurried read as broken — the same mistake as
 * scoring every channel's CTR against one absolute threshold.
 */
export function evaluateNarrationRate(args: {
  wordCount: number;
  durationSec: number;
  /** Narration physics speed multiplier; 1 when the channel declares none. */
  speed?: number;
  tolerance?: number;
}): NarrationRateVerdict {
  const tolerance = args.tolerance ?? NARRATION_RATE_TOLERANCE;
  const speed = Number.isFinite(args.speed) && (args.speed ?? 0) > 0 ? args.speed! : 1;
  const intended = NARRATION_BASE_WORDS_PER_SEC * speed;
  const lowerBound = intended * (1 - tolerance);
  const upperBound = intended * (1 + tolerance);
  if (!Number.isFinite(args.durationSec) || args.durationSec <= 0 || args.wordCount <= 0) {
    return {
      ok: false, wordsPerSec: 0, intendedWordsPerSec: intended, lowerBound, upperBound, ratio: 0,
      detail: "no measurable narration to rate",
    };
  }
  const wordsPerSec = args.wordCount / args.durationSec;
  const ratio = wordsPerSec / intended;
  const ok = wordsPerSec >= lowerBound && wordsPerSec <= upperBound;
  const wpm = (value: number) => Math.round(value * 60);
  return {
    ok, wordsPerSec, intendedWordsPerSec: intended, lowerBound, upperBound, ratio,
    detail: ok
      ? `${wpm(wordsPerSec)} wpm is within ${Math.round(tolerance * 100)}% of the channel's intended ${wpm(intended)} wpm`
      : `${wpm(wordsPerSec)} wpm is ${wordsPerSec < lowerBound ? "slower" : "faster"} than the channel's intended ` +
        `${wpm(intended)} wpm by more than ${Math.round(tolerance * 100)}% (accepts ${wpm(lowerBound)}-${wpm(upperBound)} wpm)`,
  };
}

/**
 * Enforce, rather than merely report, the measured channel delivery contract.
 * This is shared by live and week-ahead narration so an early rendered take
 * cannot bypass the same pace requirement that protects an on-demand take.
 */
export function assertNarrationDeliveryRate(args: {
  wordCount: number;
  durationSec: number;
  speed?: number;
  label: string;
}): NarrationRateVerdict {
  const verdict = evaluateNarrationRate(args);
  if (!verdict.ok) {
    throw new Error(`${args.label}: final delivery rate failed the channel pace contract — ${verdict.detail}`);
  }
  return verdict;
}

export interface NarrationCadencePlan {
  version: typeof NARRATION_CADENCE_EVIDENCE_VERSION;
  gapsSec: number[];
  purposes: NarrationPausePurpose[];
}

export interface NarrationCadenceEvidence extends NarrationCadencePlan {
  meanGapSec: number;
  minGapSec: number;
  maxGapSec: number;
  distinctGapCount: number;
}

/**
 * Locate section boundaries only when the script structure reconstructs the
 * exact narration sentence sequence. A mismatch returns undefined so callers
 * can fail closed for a requested quiet-listening profile instead of guessing
 * where a 15–30 second pause belongs.
 */
export function deriveNarrationSectionBoundaryIndices(args: {
  sentences: readonly string[];
  openingSentences?: readonly string[];
  sectionSentences: readonly (readonly string[])[];
}): number[] | undefined {
  const expected = [
    ...(args.openingSentences ?? []),
    ...args.sectionSentences.flatMap((section) => [...section]),
  ];
  const normalize = (sentence: string) => sentence.trim().replace(/\s+/gu, " ");
  if (
    expected.length !== args.sentences.length ||
    expected.some((sentence, index) => normalize(sentence) !== normalize(args.sentences[index] ?? ""))
  ) {
    return undefined;
  }
  const boundaries: number[] = [];
  let cursor = args.openingSentences?.length ?? 0;
  for (let index = 0; index < args.sectionSentences.length; index++) {
    const section = args.sectionSentences[index]!;
    cursor += section.length;
    const hasLaterNarration = args.sectionSentences.slice(index + 1).some((later) => later.length > 0);
    if (section.length > 0 && hasLaterNarration) boundaries.push(cursor - 1);
  }
  return boundaries;
}

function stableUnit(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0) / 0xffffffff;
}

function pausePurpose(sentence: string, next: string | undefined): NarrationPausePurpose {
  const current = sentence.toLowerCase();
  const following = (next ?? "").toLowerCase();
  if (/\b(but|however|instead|yet|although|nevertheless)\b/.test(following)) return "turn";
  if (/\b(impossible|truth|revealed|discovered|finally|not what|never)\b/.test(current)) return "reveal";
  if (/\?$/.test(sentence.trim())) return "question";
  if (/\b(afterward|aftermath|therefore|as a result|consequence|finally)\b/.test(current)) return "release";
  return "continuation";
}

/**
 * Semantic pauses replace `Math.random()` timing. A reveal gets space, a
 * contradiction arrives with momentum, and otherwise a small deterministic
 * variation keeps repeated automated episodes from sounding metronomic while
 * preserving exact timing on retry. Quiet-listening profiles may place an
 * occasional longer rest only at a verified script-section boundary.
 */
export function planNarrationCadence(args: {
  sentences: readonly string[];
  baseGapSec: number;
  jitterSec: number;
  sectionBoundaryAfter?: readonly boolean[];
  profile?: NarrationCadenceProfile;
  maxQuietRestBudgetSec?: number;
}): NarrationCadencePlan {
  if (args.sectionBoundaryAfter && args.sectionBoundaryAfter.length !== args.sentences.length) {
    throw new Error("narration cadence: section-boundary count must match sentence count");
  }
  const base = Number.isFinite(args.baseGapSec) ? Math.max(0.2, Math.min(2.1, args.baseGapSec)) : 0.85;
  const jitter = Number.isFinite(args.jitterSec) ? Math.max(0, Math.min(0.35, args.jitterSec)) : 0.2;
  const purposes: NarrationPausePurpose[] = [];
  let sectionBoundaryOrdinal = 0;
  let plannedQuietRestSec = 0;
  const quietRestBudgetSec = args.maxQuietRestBudgetSec === undefined
    ? Number.POSITIVE_INFINITY
    : Number.isFinite(args.maxQuietRestBudgetSec)
      ? Math.max(0, args.maxQuietRestBudgetSec)
      : 0;
  const reservedRests = new Map<number, number>();
  if (args.profile === "quiet_listening" && Number.isFinite(quietRestBudgetSec) && quietRestBudgetSec >= 15) {
    // Spend the writer's reserved time across verified boundaries, not estimated ones.
    const boundaries = args.sentences.flatMap((_, index) =>
      index < args.sentences.length - 1 && args.sectionBoundaryAfter?.[index] ? [index] : []);
    const minimumRests = Math.ceil(quietRestBudgetSec / 30);
    if (boundaries.length < minimumRests) {
      throw new Error(`narration cadence: ${quietRestBudgetSec}s reserved quiet time requires at least ${minimumRests} verified section boundaries`);
    }
    const count = Math.min(boundaries.length, Math.floor(quietRestBudgetSec / 15), Math.max(minimumRests, Math.ceil(quietRestBudgetSec / 25)));
    const each = Math.floor(quietRestBudgetSec / count * 1000) / 1000;
    let assigned = 0;
    for (let ordinal = 0; ordinal < count; ordinal++) {
      const index = boundaries[Math.floor((ordinal + 0.5) * boundaries.length / count)]!;
      const rest = ordinal === count - 1 ? Number((quietRestBudgetSec - assigned).toFixed(3)) : each;
      reservedRests.set(index, rest);
      assigned += rest;
    }
  }
  const gapsSec = args.sentences.map((sentence, index) => {
    if (index === args.sentences.length - 1) {
      purposes.push("continuation");
      return 0;
    }
    if (args.profile === "quiet_listening" && args.sectionBoundaryAfter?.[index]) {
      const reserved = reservedRests.get(index);
      if (reserved !== undefined) {
        purposes.push("section");
        return reserved;
      }
      const boundaryOrdinal = sectionBoundaryOrdinal++;
      if (!Number.isFinite(quietRestBudgetSec) && boundaryOrdinal % 3 === 0) {
        purposes.push("section");
        const restDurations = [15, 20, 25, 30] as const;
        const restIndex = Math.min(
          restDurations.length - 1,
          Math.floor(stableUnit(`quiet-rest\n${sentence}\n${args.sentences[index + 1] ?? ""}`) * restDurations.length),
        );
        const restSec = restDurations[restIndex]!;
        if (plannedQuietRestSec + restSec <= quietRestBudgetSec) {
          plannedQuietRestSec += restSec;
          return restSec;
        }
        purposes.pop();
      }
    }
    const purpose = pausePurpose(sentence, args.sentences[index + 1]);
    purposes.push(purpose);
    const modifier = purpose === "turn"
      ? 0.72
      : purpose === "reveal"
        ? 1.28
        : purpose === "question"
          ? 1.16
          : purpose === "release"
            ? 1.22
            : 1;
    const variation = (stableUnit(`${sentence}\n${args.sentences[index + 1] ?? ""}`) * 2 - 1) * jitter;
    return Number(Math.max(0.2, Math.min(2.4, base * modifier + variation)).toFixed(3));
  });
  return { version: NARRATION_CADENCE_EVIDENCE_VERSION, gapsSec, purposes };
}

export function evaluateNarrationCadence(args: {
  sentences: readonly string[];
  sentenceTimings: readonly { start: number; end: number }[];
  plan: NarrationCadencePlan;
}): NarrationCadenceEvidence {
  if (args.sentences.length !== args.sentenceTimings.length || args.plan.gapsSec.length !== args.sentences.length) {
    throw new Error("narration cadence: sentence, timing, and pause-plan counts must match");
  }
  const gaps = args.sentenceTimings.slice(0, -1).map((timing, index) => {
    const next = args.sentenceTimings[index + 1];
    if (!Number.isFinite(timing.start) || !Number.isFinite(timing.end) || !next || next.start < timing.end) {
      throw new Error(`narration cadence: invalid or overlapping timing at sentence ${index + 1}`);
    }
    const actual = next.start - timing.end;
    const planned = args.plan.gapsSec[index] ?? 0;
    if (Math.abs(actual - planned) > 0.08) {
      throw new Error(`narration cadence: sentence ${index + 1} pause ${actual.toFixed(3)}s does not match its planned ${planned.toFixed(3)}s delivery beat`);
    }
    return actual;
  });
  if (!gaps.length) {
    return {
      ...args.plan,
      meanGapSec: 0,
      minGapSec: 0,
      maxGapSec: 0,
      distinctGapCount: 0,
    };
  }
  const rounded = new Set(gaps.map((gap) => gap.toFixed(2)));
  return {
    ...args.plan,
    meanGapSec: Number((gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length).toFixed(3)),
    minGapSec: Number(Math.min(...gaps).toFixed(3)),
    maxGapSec: Number(Math.max(...gaps).toFixed(3)),
    distinctGapCount: rounded.size,
  };
}

/**
 * Reconcile timestamp estimates with the measured rendered narration only when
 * a probe failed. Scale speech intervals while retaining each planned pause,
 * then prove that the corrected cue map still matches the cadence plan.
 */
export function reconcileNarrationCadenceAfterDurationMeasurement(args: {
  sentences: readonly string[];
  sentenceTimings: readonly { start: number; end: number }[];
  plan: NarrationCadencePlan;
  estimatedDurationSec: number;
  measuredDurationSec: number;
  reconcileThresholdSec?: number;
}): {
  sentenceTimings: Array<{ start: number; end: number }>;
  scale: number;
  cadence: NarrationCadenceEvidence;
} {
  const estimatedDurationSec = Number(args.estimatedDurationSec);
  const measuredDurationSec = Number(args.measuredDurationSec);
  if (!Number.isFinite(estimatedDurationSec) || estimatedDurationSec <= 0) {
    throw new Error("narration cadence reconciliation: estimated narration duration is invalid");
  }
  if (!Number.isFinite(measuredDurationSec) || measuredDurationSec <= 0) {
    throw new Error("narration cadence reconciliation: measured narration duration is invalid");
  }
  const threshold = Number.isFinite(args.reconcileThresholdSec)
    ? Math.max(0, args.reconcileThresholdSec!)
    : 1.5;
  const plannedGapDurationSec = args.plan.gapsSec.slice(0, -1).reduce((sum, gap) => sum + gap, 0);
  const firstStartSec = args.sentenceTimings[0]?.start ?? 0;
  const estimatedSpeechDurationSec = estimatedDurationSec - plannedGapDurationSec - firstStartSec;
  const measuredSpeechDurationSec = measuredDurationSec - plannedGapDurationSec - firstStartSec;
  if (estimatedSpeechDurationSec <= 0 || measuredSpeechDurationSec <= 0) {
    throw new Error("narration cadence reconciliation: measured speech duration is invalid after preserving planned pauses");
  }
  const scale = Math.abs(measuredDurationSec - estimatedDurationSec) > threshold
    ? measuredSpeechDurationSec / estimatedSpeechDurationSec
    : 1;
  let cursor = firstStartSec;
  const sentenceTimings = args.sentenceTimings.map((timing, index) => {
    const duration = (timing.end - timing.start) * scale;
    const adjusted = { start: cursor, end: cursor + duration };
    cursor = adjusted.end + (index < args.sentenceTimings.length - 1 ? (args.plan.gapsSec[index] ?? 0) : 0);
    return adjusted;
  });
  const cadence = evaluateNarrationCadence({
    sentences: args.sentences,
    sentenceTimings,
    plan: args.plan,
  });
  return { sentenceTimings, scale, cadence };
}

function spokenWords(text: string): string[] {
  return text
    .replace(/\[(?:long )?(?:pause|whisper|sigh|laugh|breath|beat)\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Provider-free physical QA for a narration take. It intentionally does not
 * pretend to judge acting or taste: the production voice audition remains the
 * human performance gate. This verifies that the actual synthesized audio is
 * audible, measured, and plausibly paced before a full visual render spends.
 */
export async function preflightNarrationPerformance(args: {
  audioPath: string;
  text: string;
  speed: number;
  /** Sum of individually measured spoken clips; excludes planned pauses. */
  spokenDurationSec?: number;
}): Promise<NarrationPerformanceEvidence> {
  const media = await probe(args.audioPath);
  if (!media.hasAudio || !Number.isFinite(media.durationSec) || media.durationSec < 1.5) {
    throw new Error("narration performance preflight: audio stream is missing or too short to measure");
  }
  const words = spokenWords(args.text);
  if (words.length < 3) {
    throw new Error("narration performance preflight: spoken text is too short for a production narration check");
  }
  const speed = Number.isFinite(args.speed) && args.speed > 0 ? args.speed : 1;
  const spokenDurationSec = args.spokenDurationSec ?? media.durationSec;
  if (
    !Number.isFinite(spokenDurationSec) || spokenDurationSec < 1.5 ||
    spokenDurationSec > media.durationSec + 5
  ) {
    throw new Error("narration performance preflight: speech-only duration is invalid for the measured audio");
  }
  const explicitPauses = (args.text.match(/\[(?:long )?pause\]/gi) ?? []).length;
  const expectedSec = words.length / (3.1 * Math.max(0.7, speed)) + explicitPauses * 1.5;
  if (spokenDurationSec < expectedSec * 0.3 || spokenDurationSec > expectedSec * 2.5 + 12) {
    throw new Error(
      `narration performance preflight: implausible spoken duration ${spokenDurationSec.toFixed(2)}s for ${words.length} spoken words (expected ~${expectedSec.toFixed(2)}s)`,
    );
  }
  const measured = await measureAudio(args.audioPath, {
    windowStartSec: 0,
    windowDurSec: Math.min(10, media.durationSec),
  });
  if (measured.integratedLufs === null || measured.windowMeanDb === null) {
    throw new Error("narration performance preflight: FFmpeg could not measure loudness evidence");
  }
  if (measured.integratedLufs < -36 || measured.integratedLufs > -6) {
    throw new Error(`narration performance preflight: integrated loudness ${measured.integratedLufs.toFixed(1)} LUFS is outside the safe narration range`);
  }
  if (measured.windowMeanDb < -48 || measured.windowMeanDb > -3) {
    throw new Error(`narration performance preflight: speech-window mean ${measured.windowMeanDb.toFixed(1)} dB is outside the safe narration range`);
  }
  return {
    version: NARRATION_PERFORMANCE_EVIDENCE_VERSION,
    source: "local_ffmpeg",
    durationSec: media.durationSec,
    wordCount: words.length,
    wordsPerSec: words.length / media.durationSec,
    spokenDurationSec,
    spokenWordsPerSec: words.length / spokenDurationSec,
    integratedLufs: measured.integratedLufs,
    windowMeanDb: measured.windowMeanDb,
  };
}
