import { measureAudio, probe } from "@/lib/ffmpeg";

export const NARRATION_PERFORMANCE_EVIDENCE_VERSION = "narration-performance-evidence/v1" as const;

export interface NarrationPerformanceEvidence {
  version: typeof NARRATION_PERFORMANCE_EVIDENCE_VERSION;
  source: "local_ffmpeg";
  durationSec: number;
  wordCount: number;
  wordsPerSec: number;
  integratedLufs: number;
  windowMeanDb: number;
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
  return {
    version: NARRATION_PERFORMANCE_EVIDENCE_VERSION,
    source: "local_ffmpeg",
    durationSec,
    wordCount,
    wordsPerSec,
    integratedLufs: number("integratedLufs", -36, -6),
    windowMeanDb: number("windowMeanDb", -48, -3),
  };
}

export const NARRATION_CADENCE_EVIDENCE_VERSION = "narration-cadence-evidence/v1" as const;

export type NarrationPausePurpose = "turn" | "reveal" | "question" | "release" | "continuation";

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
 * preserving exact timing on retry.
 */
export function planNarrationCadence(args: {
  sentences: readonly string[];
  baseGapSec: number;
  jitterSec: number;
}): NarrationCadencePlan {
  const base = Number.isFinite(args.baseGapSec) ? Math.max(0.2, Math.min(2.1, args.baseGapSec)) : 0.85;
  const jitter = Number.isFinite(args.jitterSec) ? Math.max(0, Math.min(0.35, args.jitterSec)) : 0.2;
  const purposes: NarrationPausePurpose[] = [];
  const gapsSec = args.sentences.map((sentence, index) => {
    if (index === args.sentences.length - 1) {
      purposes.push("continuation");
      return 0;
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
 * a probe failed, then prove that the correction did not erase the semantic
 * pause plan. A linear timing scale also scales every pause; accepting it after
 * cadence was checked would turn a declared reveal/turn rhythm into fiction.
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
  const scale = Math.abs(measuredDurationSec - estimatedDurationSec) > threshold
    ? measuredDurationSec / estimatedDurationSec
    : 1;
  const sentenceTimings = args.sentenceTimings.map((timing) => ({
    start: timing.start * scale,
    end: timing.end * scale,
  }));
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
  const explicitPauses = (args.text.match(/\[(?:long )?pause\]/gi) ?? []).length;
  const expectedSec = words.length / (3.1 * Math.max(0.7, speed)) + explicitPauses * 1.5;
  if (media.durationSec < expectedSec * 0.3 || media.durationSec > expectedSec * 2.5 + 12) {
    throw new Error(
      `narration performance preflight: implausible delivery duration ${media.durationSec.toFixed(2)}s for ${words.length} spoken words (expected ~${expectedSec.toFixed(2)}s)`,
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
    integratedLufs: measured.integratedLufs,
    windowMeanDb: measured.windowMeanDb,
  };
}
