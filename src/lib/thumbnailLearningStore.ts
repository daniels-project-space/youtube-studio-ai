/**
 * PERSISTENCE FOR THE TWO LEARNING LOOPS.
 *
 * The defect ledger and the CTR analyser were pure logic with nothing writing
 * to them, which meant neither actually compounded: a channel still forgot
 * every rejection the moment a run ended. This is the store that gives them
 * memory, on the same R2 bucket the rest of the pipeline already uses.
 *
 * Design constraints that matter more than the plumbing:
 *
 *  - READS MUST NEVER BREAK A RENDER. A missing object, corrupt JSON or an R2
 *    outage returns an empty ledger, so the worst case is a channel that has
 *    not learned yet — never a failed thumbnail. Learning is an enhancement,
 *    and an enhancement that can take production down is a liability.
 *  - WRITES ARE APPEND-AND-TRIM, not read-modify-write-everything. The ledger
 *    is bounded on write so a long-lived channel cannot grow an unbounded
 *    object that eventually costs more to fetch than it is worth.
 *  - CTR SAMPLES ARE KEYED BY VIDEO. Re-pulling analytics for a video that is
 *    already recorded must update it rather than double-count it, or a channel
 *    polled weekly would inflate its own sample size and manufacture the
 *    significance the analyser is specifically designed to withhold.
 */
import {
  getObjectBytes,
  putObject,
} from "@/lib/storage";
import type { ChannelDefectLedger, DefectObservation } from "@/lib/thumbnailDefectLedger";
import type { ThumbnailPerformanceSample } from "@/lib/thumbnailCtrFeedback";

/** Bounded so a long-running channel cannot grow an unbounded object. */
const MAX_OBSERVATIONS = 200;
const MAX_SAMPLES = 500;

function channelSlug(channelName: string): string {
  return channelName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "channel";
}

export function thumbnailLedgerKey(keyPrefix: string, channelName: string): string {
  return `${keyPrefix}learning/thumbnails/${channelSlug(channelName)}/defect-ledger.json`;
}

export function thumbnailPerformanceKey(keyPrefix: string, channelName: string): string {
  return `${keyPrefix}learning/thumbnails/${channelSlug(channelName)}/performance.json`;
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const bytes = await getObjectBytes(key, undefined, { timeoutMs: 15_000 });
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as T;
    return parsed ?? fallback;
  } catch {
    // Absent, unreachable or corrupt all mean the same thing to a renderer:
    // this channel has not learned anything yet. Never a hard failure.
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<boolean> {
  try {
    await putObject(key, Buffer.from(JSON.stringify(value)), { contentType: "application/json" });
    return true;
  } catch {
    return false;
  }
}

export async function loadDefectLedger(args: {
  keyPrefix: string;
  channelName: string;
}): Promise<ChannelDefectLedger> {
  const empty: ChannelDefectLedger = { channelName: args.channelName, observations: [] };
  const stored = await readJson<ChannelDefectLedger>(
    thumbnailLedgerKey(args.keyPrefix, args.channelName),
    empty,
  );
  // Defensive: a hand-edited or partially written object must not crash a render.
  if (!Array.isArray(stored.observations)) return empty;
  return {
    channelName: args.channelName,
    observations: stored.observations.filter((observation) =>
      observation
      && typeof observation.videoKey === "string"
      && typeof observation.reason === "string"
      && typeof observation.at === "number"
    ),
  };
}

/**
 * Append QA rejections for one video. Called after the critique loop settles,
 * so what lands in the ledger is what the grader actually rejected rather than
 * every transient candidate state.
 */
export async function appendDefectObservations(args: {
  keyPrefix: string;
  channelName: string;
  observations: readonly DefectObservation[];
}): Promise<{ persisted: boolean; total: number }> {
  if (!args.observations.length) return { persisted: true, total: 0 };
  const ledger = await loadDefectLedger(args);
  const observations = [...ledger.observations, ...args.observations].slice(-MAX_OBSERVATIONS);
  const persisted = await writeJson(
    thumbnailLedgerKey(args.keyPrefix, args.channelName),
    { channelName: args.channelName, observations },
  );
  return { persisted, total: observations.length };
}

export async function loadPerformanceSamples(args: {
  keyPrefix: string;
  channelName: string;
}): Promise<ThumbnailPerformanceSample[]> {
  const stored = await readJson<ThumbnailPerformanceSample[]>(
    thumbnailPerformanceKey(args.keyPrefix, args.channelName),
    [],
  );
  if (!Array.isArray(stored)) return [];
  return stored.filter((sample) =>
    sample
    && typeof sample.videoKey === "string"
    && typeof sample.impressions === "number"
    && typeof sample.clicks === "number"
    && sample.traits !== null
    && typeof sample.traits === "object"
  );
}

/**
 * Record what a published thumbnail actually did.
 *
 * Upserts by videoKey. A channel polled weekly would otherwise append the same
 * video every run, inflating its own sample count and manufacturing exactly the
 * significance `analyseThumbnailCtr` exists to withhold.
 */
export async function upsertPerformanceSamples(args: {
  keyPrefix: string;
  channelName: string;
  samples: readonly ThumbnailPerformanceSample[];
}): Promise<{ persisted: boolean; total: number }> {
  if (!args.samples.length) return { persisted: true, total: 0 };
  const existing = await loadPerformanceSamples(args);
  const byVideo = new Map(existing.map((sample) => [sample.videoKey, sample]));
  for (const sample of args.samples) byVideo.set(sample.videoKey, sample);
  const merged = [...byVideo.values()]
    .sort((left, right) => left.publishedAt - right.publishedAt)
    .slice(-MAX_SAMPLES);
  const persisted = await writeJson(thumbnailPerformanceKey(args.keyPrefix, args.channelName), merged);
  return { persisted, total: merged.length };
}

/**
 * Record the craft decisions a thumbnail made, before anyone knows how it did.
 *
 * Two-phase by necessity: the traits are known at render time and the metrics
 * are not known for days. Writing a zero-impression placeholder now lets the
 * scheduled analytics pass fill it in later by videoKey, and the analyser
 * ignores zero-impression rows because they fail its minimum-volume bar.
 */
export async function recordThumbnailTraits(args: {
  keyPrefix: string;
  channelName: string;
  videoKey: string;
  traits: Record<string, string>;
  publishedAt?: number;
}): Promise<{ persisted: boolean }> {
  const existing = await loadPerformanceSamples(args);
  const prior = existing.find((sample) => sample.videoKey === args.videoKey);
  const { persisted } = await upsertPerformanceSamples({
    keyPrefix: args.keyPrefix,
    channelName: args.channelName,
    samples: [{
      channelName: args.channelName,
      videoKey: args.videoKey,
      traits: args.traits,
      // Preserve any metrics already pulled; never reset them to zero.
      impressions: prior?.impressions ?? 0,
      clicks: prior?.clicks ?? 0,
      publishedAt: args.publishedAt ?? prior?.publishedAt ?? Date.now(),
    }],
  });
  return { persisted };
}

/**
 * Fill in metrics for a video whose traits were recorded at render time.
 * Returns false when there is nothing to attach them to, so a caller can tell
 * a missing join from a missing metric.
 */
export async function attachPerformanceMetrics(args: {
  keyPrefix: string;
  channelName: string;
  videoKey: string;
  analytics: { ctr?: number; thumbnailImpressions?: number };
}): Promise<{ attached: boolean; reason?: string }> {
  const existing = await loadPerformanceSamples(args);
  const prior = existing.find((sample) => sample.videoKey === args.videoKey);
  if (!prior) return { attached: false, reason: "no recorded traits for this video" };
  const sample = performanceSampleFromAnalytics({
    channelName: args.channelName,
    videoKey: args.videoKey,
    publishedAt: prior.publishedAt,
    traits: prior.traits,
    analytics: args.analytics,
  });
  if (!sample) return { attached: false, reason: "analytics did not include thumbnail impressions" };
  const { persisted } = await upsertPerformanceSamples({ ...args, samples: [sample] });
  return { attached: persisted };
}

/**
 * Convert one analytics reading into a performance sample.
 *
 * Returns null when the denominator is missing. YouTube does not always serve
 * the thumbnail-impressions metric, and a sample without impressions cannot
 * carry weight in a significance test — recording it with a fabricated or
 * zero denominator would corrupt every comparison the channel ever runs.
 */
export function performanceSampleFromAnalytics(args: {
  channelName: string;
  videoKey: string;
  publishedAt: number;
  traits: Record<string, string>;
  analytics: { ctr?: number; thumbnailImpressions?: number };
}): ThumbnailPerformanceSample | null {
  const impressions = args.analytics.thumbnailImpressions;
  const ctrPercent = args.analytics.ctr;
  if (
    typeof impressions !== "number" || !Number.isFinite(impressions) || impressions <= 0
    || typeof ctrPercent !== "number" || !Number.isFinite(ctrPercent) || ctrPercent < 0
  ) {
    return null;
  }
  // The Analytics metric is a percentage; the analyser works in raw counts.
  const clicks = Math.round(impressions * (ctrPercent / 100));
  return {
    channelName: args.channelName,
    videoKey: args.videoKey,
    traits: args.traits,
    impressions: Math.round(impressions),
    clicks: Math.min(clicks, Math.round(impressions)),
    publishedAt: args.publishedAt,
  };
}
