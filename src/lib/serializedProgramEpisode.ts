import type { ChannelProgramRouteRunSeed } from "@/engine/channelProgramRoute";

/**
 * A route-owned identity for one serialized-program episode stream. The route
 * fingerprint already binds the canonical brief and its admitted modifier; the
 * explicit serialized fields make the durable namespace auditable without
 * relying on a human title substring.
 */
export const SERIALIZED_PROGRAM_EPISODE_VERSION = "serialized_program_episode/v1" as const;
/** Upper bound for a durable busy requeue; the reservation lease is five minutes. */
export const SERIALIZED_PROGRAM_EPISODE_BUSY_RETRY_MAX_DELAY_MS = 6 * 60 * 1_000;
/** A persistent live claim is surfaced after a few durable handoffs, never polled forever. */
export const SERIALIZED_PROGRAM_EPISODE_BUSY_RETRY_MAX_ATTEMPTS = 3;

/** Derive the bounded not-before timestamp from an authoritative lease hint. */
export function serializedProgramEpisodeBusyRetryAt(
  now: number,
  retryAfterMs: number | undefined,
): number {
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw new Error("serialized program episode busy retry clock is invalid");
  }
  const requested = Number.isFinite(retryAfterMs) ? Math.floor(retryAfterMs!) : 250;
  const delay = Math.max(250, Math.min(requested, SERIALIZED_PROGRAM_EPISODE_BUSY_RETRY_MAX_DELAY_MS));
  return now + delay;
}

/**
 * A claimed retry clears only `retryAt`; the retained attempt number is audit
 * history, not a second live receipt. Keep this distinction shared and
 * explicit so a post-lease duplicate task resumes the frozen invocation
 * instead of coercing `undefined` into a malformed retry timestamp.
 */
export function serializedProgramEpisodeBusyRetryReceipt(input: {
  retryAt?: unknown;
  attempt?: unknown;
}):
  | { readonly kind: "none" }
  | { readonly kind: "active"; readonly retryAt: number; readonly attempt: number } {
  if (input.retryAt === undefined) return Object.freeze({ kind: "none" as const });
  const retryAt = Number(input.retryAt);
  const attempt = Number(input.attempt);
  if (
    !Number.isSafeInteger(retryAt) ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    attempt > SERIALIZED_PROGRAM_EPISODE_BUSY_RETRY_MAX_ATTEMPTS
  ) {
    throw new Error("serialized program episode retry receipt is malformed");
  }
  return Object.freeze({ kind: "active" as const, retryAt, attempt });
}

export interface SerializedProgramEpisodeIdentity {
  readonly version: typeof SERIALIZED_PROGRAM_EPISODE_VERSION;
  readonly value: string;
  readonly routeFingerprint: string;
  readonly seriesTitle: string;
  readonly seriesCount?: number;
}

export function serializedProgramEpisodeIdentity(
  route: Pick<ChannelProgramRouteRunSeed, "routeFingerprint" | "serializedProgram"> | undefined,
): SerializedProgramEpisodeIdentity | undefined {
  if (!route?.serializedProgram) return undefined;
  const serializedProgram = route.serializedProgram;
  const count = serializedProgram.seriesCount === undefined
    ? "open"
    : String(serializedProgram.seriesCount);
  const value = [
    SERIALIZED_PROGRAM_EPISODE_VERSION,
    route.routeFingerprint,
    encodeURIComponent(serializedProgram.seriesTitle),
    count,
  ].join("/");
  return Object.freeze({
    version: SERIALIZED_PROGRAM_EPISODE_VERSION,
    value,
    routeFingerprint: route.routeFingerprint,
    seriesTitle: serializedProgram.seriesTitle,
    ...(serializedProgram.seriesCount === undefined
      ? {}
      : { seriesCount: serializedProgram.seriesCount }),
  });
}

export interface SerializedProgramEpisodeMemoryEntry {
  readonly identity: SerializedProgramEpisodeIdentity;
  readonly episodeNumber: number;
  readonly topic: string;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** A topic-memory key is namespaced by the exact sealed route, never its title alone. */
export function serializedProgramEpisodeMemoryKey(input: {
  readonly identity: SerializedProgramEpisodeIdentity;
  readonly episodeNumber: number;
  readonly topic: string;
}): string {
  const episodeNumber = positiveInteger(input.episodeNumber);
  const topic = input.topic.trim();
  if (!episodeNumber) throw new Error("serialized program episode number must be a positive integer");
  if (!topic) throw new Error("serialized program episode topic must not be empty");
  return `${input.identity.value}/episode/${episodeNumber}/${encodeURIComponent(topic)}`;
}

/**
 * Parses only the stable v1 namespace. Older human-title topic-memory keys
 * deliberately remain legacy records rather than being reclassified.
 */
export function parseSerializedProgramEpisodeMemoryKey(
  value: unknown,
): SerializedProgramEpisodeMemoryEntry | undefined {
  if (typeof value !== "string") return undefined;
  const parts = value.split("/");
  if (
    parts.length !== 8 ||
    parts[0] !== "serialized_program_episode" ||
    parts[1] !== "v1" ||
    !/^[a-f0-9]{64}$/.test(parts[2] ?? "") ||
    parts[5] !== "episode"
  ) {
    return undefined;
  }
  const count = parts[4] === "open" ? undefined : positiveInteger(parts[4]);
  const episodeNumber = positiveInteger(parts[6]);
  if ((parts[4] !== "open" && !count) || !episodeNumber) return undefined;
  try {
    const seriesTitle = decodeURIComponent(parts[3] ?? "").trim();
    const topic = decodeURIComponent(parts[7] ?? "").trim();
    if (!seriesTitle || !topic) return undefined;
    const identity = Object.freeze({
      version: SERIALIZED_PROGRAM_EPISODE_VERSION,
      value: parts.slice(0, 5).join("/"),
      routeFingerprint: parts[2]!,
      seriesTitle,
      ...(count === undefined ? {} : { seriesCount: count }),
    });
    return Object.freeze({ identity, episodeNumber, topic });
  } catch {
    return undefined;
  }
}

export type SerializedProgramEpisodeClaim =
  | {
    readonly kind: "acquired";
    readonly episodeNumber: number;
    readonly leaseExpiresAt: number;
    /** Minted by the atomic authority for this acquisition; fences stale workers. */
    readonly claimToken: string;
  }
  | { readonly kind: "completed"; readonly episodeNumber: number; readonly topic: string }
  | { readonly kind: "busy"; readonly retryAfterMs: number }
  | { readonly kind: "exhausted" };

export interface SerializedProgramEpisodeClaimInput {
  readonly ownerId: string;
  readonly channelId: string;
  readonly seriesIdentity: SerializedProgramEpisodeIdentity;
  /** Full frozen route seed, retained with the claim so retries cannot drift. */
  readonly routeRunSeedFingerprint: string;
  readonly runId: string;
}

export interface SerializedProgramEpisodeClaimOwnership extends SerializedProgramEpisodeClaimInput {
  readonly claimToken: string;
}

/**
 * The state update that is committed in the exact same Convex transaction as
 * an episode completion.  A non-empty beat is required so episode N+1 can
 * never start after N has only a topic-memory receipt and no continuity
 * transition.
 */
export interface SerializedProgramEpisodeStoryStateUpdate {
  readonly arcSummary?: string;
  readonly newPlotBeat: string;
  readonly unresolvedThreads?: readonly string[];
  readonly newEntities?: readonly { readonly name: string; readonly role: string }[];
}

export interface SerializedProgramEpisodeCompletionInput extends SerializedProgramEpisodeClaimOwnership {
  readonly episodeNumber: number;
  readonly topic: string;
  readonly topicMemoryKey: string;
  readonly storyState: SerializedProgramEpisodeStoryStateUpdate;
}

export interface SerializedProgramEpisodeReservationAuthority {
  claim(input: SerializedProgramEpisodeClaimInput): Promise<SerializedProgramEpisodeClaim>;
  complete(input: SerializedProgramEpisodeCompletionInput): Promise<{
    readonly episodeNumber: number;
    readonly topic: string;
  }>;
  release(input: SerializedProgramEpisodeClaimOwnership): Promise<boolean>;
}

/**
 * Pure Trigger-dispatch shape for a durable serialized-episode contention
 * retry. The run record owns the actual receipt/attempt; this derives the
 * stable task idempotency seed so lost enqueue responses can be replayed.
 */
export function serializedProgramEpisodeBusyRetrySchedule<T>(input: {
  readonly payload: T;
  readonly channelId: string;
  readonly runId: string;
  readonly retryAt: number;
  readonly attempt: number;
}): {
  readonly payload: T;
  readonly retryAt: number;
  readonly concurrencyKey: string;
  readonly idempotencySeed: string;
} {
  const channelId = input.channelId.trim();
  const runId = input.runId.trim();
  if (!channelId || !runId) {
    throw new Error("serialized program episode busy retry requires a channel and run identity");
  }
  if (!Number.isSafeInteger(input.retryAt) || input.retryAt <= 0) {
    throw new Error("serialized program episode busy retry timestamp is invalid");
  }
  if (
    !Number.isSafeInteger(input.attempt) ||
    input.attempt < 1 ||
    input.attempt > SERIALIZED_PROGRAM_EPISODE_BUSY_RETRY_MAX_ATTEMPTS
  ) {
    throw new Error("serialized program episode busy retry attempt is invalid or exhausted");
  }
  return Object.freeze({
    payload: input.payload,
    retryAt: input.retryAt,
    concurrencyKey: channelId,
    idempotencySeed:
      `serialized-program-episode-busy:${runId}:attempt:${input.attempt}:at:${input.retryAt}`,
  });
}

export type SerializedProgramEpisodeContinuation<T> =
  | { readonly kind: "generated"; readonly episodeNumber: number; readonly topic: string; readonly value: T }
  | Exclude<SerializedProgramEpisodeClaim, { readonly kind: "acquired" }>;

/**
 * Runs a continuation only after its atomic durable episode claim is acquired.
 * A busy or completed claim deliberately never invokes `generate`, preventing
 * duplicate provider calls. Any failed/malformed continuation releases its
 * claim so a transient error cannot burn an episode number.
 */
export async function continueReservedSerializedProgramEpisode<T>(input: {
  readonly authority: SerializedProgramEpisodeReservationAuthority;
  readonly claim: SerializedProgramEpisodeClaimInput;
  readonly generate: (episodeNumber: number) => Promise<{
    readonly topic: string;
    readonly topicMemoryKey: string;
    readonly storyState: SerializedProgramEpisodeStoryStateUpdate;
    readonly value: T;
  }>;
}): Promise<SerializedProgramEpisodeContinuation<T>> {
  const claim = await input.authority.claim(input.claim);
  if (claim.kind !== "acquired") return claim;
  const ownership: SerializedProgramEpisodeClaimOwnership = {
    ...input.claim,
    claimToken: claim.claimToken,
  };
  try {
    const generated = await input.generate(claim.episodeNumber);
    const completed = await input.authority.complete({
      ...ownership,
      episodeNumber: claim.episodeNumber,
      topic: generated.topic,
      topicMemoryKey: generated.topicMemoryKey,
      storyState: generated.storyState,
    });
    return {
      kind: "generated",
      episodeNumber: completed.episodeNumber,
      topic: completed.topic,
      value: generated.value,
    };
  } catch (error) {
    try {
      await input.authority.release(ownership);
    } catch {
      // Preserve the provider/validation failure. A durable lease expiry is a
      // secondary recovery path if this best-effort release cannot be reached.
    }
    throw error;
  }
}
