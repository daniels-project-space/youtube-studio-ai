import { z } from "zod";

import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

/**
 * Immutable, run-bound continuity receipt for a completed serialized-program
 * episode. It is a deliberately bounded projection of the continuation state,
 * not a second mutable series-memory API.
 */
export const SERIALIZED_PROGRAM_EPISODE_CONTEXT_VERSION =
  "serialized_program_episode_context/v1" as const;

export const SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS = Object.freeze({
  routeFingerprint: 64,
  runId: 500,
  seriesIdentity: 1_000,
  seriesTitle: 160,
  topic: 500,
  topicMemoryKey: 3_000,
  arcSummary: 2_000,
  plotBeats: 8,
  plotBeat: 1_000,
  unresolvedThreads: 12,
  unresolvedThread: 240,
  entities: 12,
  entityName: 120,
  entityRole: 280,
  // Reused by multiple text/vision consumers; keep the prompt projection
  // useful for continuity without multiplying API input cost on long runs.
  promptChars: 2_400,
});

const FingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
const PositiveIntegerSchema = z.number().int().positive();

export const SerializedProgramEpisodeContextPlotBeatSchema = z.object({
  episode: PositiveIntegerSchema,
  beat: z.string().min(1).max(SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.plotBeat),
}).strict();

export const SerializedProgramEpisodeContextEntitySchema = z.object({
  name: z.string().min(1).max(SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.entityName),
  role: z.string().max(SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.entityRole),
}).strict();

export const SerializedProgramEpisodeContextContinuitySchema = z.object({
  arcSummary: z.string().min(1).max(SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.arcSummary).optional(),
  recentPlotBeats: z.array(SerializedProgramEpisodeContextPlotBeatSchema)
    .max(SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.plotBeats),
  unresolvedThreads: z.array(
    z.string().min(1).max(SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.unresolvedThread),
  ).max(SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.unresolvedThreads),
  entities: z.array(SerializedProgramEpisodeContextEntitySchema)
    .max(SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.entities),
}).strict();

const SerializedProgramEpisodeContextContentSchema = z.object({
  version: z.literal(SERIALIZED_PROGRAM_EPISODE_CONTEXT_VERSION),
  routeFingerprint: FingerprintSchema,
  routeRunSeedFingerprint: FingerprintSchema,
  runId: z.string().min(1).max(SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.runId),
  seriesIdentity: z.string().min(1).max(SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.seriesIdentity),
  seriesTitle: z.string().min(1).max(SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.seriesTitle),
  seriesCount: PositiveIntegerSchema.max(100).optional(),
  episodeNumber: PositiveIntegerSchema,
  topic: z.string().min(1).max(SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.topic),
  topicMemoryKey: z.string().min(1).max(SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.topicMemoryKey),
  continuity: SerializedProgramEpisodeContextContinuitySchema,
}).strict();

export const SerializedProgramEpisodeContextSchema = SerializedProgramEpisodeContextContentSchema
  .extend({ fingerprint: FingerprintSchema })
  .superRefine((value, issue) => {
    if (value.fingerprint !== serializedProgramEpisodeContextFingerprint(value)) {
      issue.addIssue({
        code: z.ZodIssueCode.custom,
        message: "serialized program episode context fingerprint is invalid",
      });
    }
  });

export type SerializedProgramEpisodeContext = z.infer<typeof SerializedProgramEpisodeContextSchema>;

export interface SerializedProgramEpisodeContextInput {
  readonly routeFingerprint: string;
  /** Full frozen ChannelProgramRouteRunSeed identity, not just its route projection. */
  readonly routeRunSeedFingerprint: string;
  readonly runId: string;
  readonly seriesIdentity: string;
  readonly seriesTitle: string;
  readonly seriesCount?: number;
  readonly episodeNumber: number;
  readonly topic: string;
  readonly topicMemoryKey: string;
  readonly continuity?: {
    readonly arcSummary?: unknown;
    readonly plotBeats?: readonly { readonly episode?: unknown; readonly beat?: unknown }[];
    readonly unresolvedThreads?: readonly unknown[];
    readonly entities?: readonly { readonly name?: unknown; readonly role?: unknown }[];
  };
}

type SerializedProgramEpisodeContextContinuityInput = NonNullable<
  SerializedProgramEpisodeContextInput["continuity"]
>;

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return undefined;
  if (normalized.length <= max) return normalized;
  const cut = normalized.slice(0, max);
  return cut.replace(/\s+\S*$/, "").trim() || cut.trim();
}

function boundedStrings(input: readonly unknown[] | undefined, maxItems: number, maxLength: number): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const value of input ?? []) {
    const text = boundedText(value, maxLength);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(text);
    if (values.length >= maxItems) break;
  }
  return values;
}

function boundedPlotBeats(
  input: SerializedProgramEpisodeContextContinuityInput["plotBeats"],
): Array<{ episode: number; beat: string }> {
  const values: Array<{ episode: number; beat: string }> = [];
  for (const value of input ?? []) {
    const episode = typeof value?.episode === "number" && Number.isInteger(value.episode) && value.episode > 0
      ? value.episode
      : undefined;
    const beat = boundedText(value?.beat, SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.plotBeat);
    if (!episode || !beat) continue;
    values.push({ episode, beat });
  }
  return values.slice(-SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.plotBeats);
}

function boundedEntities(
  input: SerializedProgramEpisodeContextContinuityInput["entities"],
): Array<{ name: string; role: string }> {
  const byName = new Map<string, { name: string; role: string }>();
  for (const value of input ?? []) {
    const name = boundedText(value?.name, SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.entityName);
    if (!name) continue;
    const role = boundedText(value?.role, SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.entityRole) ?? "";
    const key = name.toLowerCase();
    const prior = byName.get(key);
    byName.set(key, { name: prior?.name ?? name, role: role || prior?.role || "" });
  }
  return Array.from(byName.values()).slice(0, SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.entities);
}

function contextContent(value: SerializedProgramEpisodeContext | z.infer<typeof SerializedProgramEpisodeContextContentSchema>) {
  const { fingerprint: _fingerprint, ...content } = value as SerializedProgramEpisodeContext;
  // Read only to exclude it from the content-addressed payload.
  void _fingerprint;
  return content;
}

/** Fingerprints only immutable content; callers never supply a trusted digest. */
export function serializedProgramEpisodeContextFingerprint(
  value: SerializedProgramEpisodeContext | z.infer<typeof SerializedProgramEpisodeContextContentSchema>,
): string {
  return sha256Hex(
    `${SERIALIZED_PROGRAM_EPISODE_CONTEXT_VERSION}\0${canonicalJson(contextContent(value))}`,
  );
}

function freezeContext(value: SerializedProgramEpisodeContext): SerializedProgramEpisodeContext {
  const frozen = {
    ...value,
    continuity: {
      ...value.continuity,
      recentPlotBeats: Object.freeze(value.continuity.recentPlotBeats.map((beat) => Object.freeze({ ...beat }))),
      unresolvedThreads: Object.freeze([...value.continuity.unresolvedThreads]),
      entities: Object.freeze(value.continuity.entities.map((entity) => Object.freeze({ ...entity }))),
    },
  };
  // Zod's inferred arrays are mutable at the type level, while this boundary
  // intentionally freezes them before exposing the durable receipt.
  return Object.freeze({ ...frozen, continuity: Object.freeze(frozen.continuity) }) as SerializedProgramEpisodeContext;
}

/**
 * Project the durable merged story state into the compact receipt that later
 * stages can trust. Continuity prose is deliberately normalized and capped;
 * route/run/topic fields are instead validated exactly and never truncated.
 */
export function createSerializedProgramEpisodeContext(
  input: SerializedProgramEpisodeContextInput,
): SerializedProgramEpisodeContext {
  const arcSummary = boundedText(
    input.continuity?.arcSummary,
    SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.arcSummary,
  );
  const content = SerializedProgramEpisodeContextContentSchema.parse({
    version: SERIALIZED_PROGRAM_EPISODE_CONTEXT_VERSION,
    routeFingerprint: input.routeFingerprint,
    routeRunSeedFingerprint: input.routeRunSeedFingerprint,
    runId: input.runId,
    seriesIdentity: input.seriesIdentity,
    seriesTitle: input.seriesTitle,
    ...(input.seriesCount === undefined ? {} : { seriesCount: input.seriesCount }),
    episodeNumber: input.episodeNumber,
    topic: input.topic,
    topicMemoryKey: input.topicMemoryKey,
    continuity: {
      ...(arcSummary
        ? { arcSummary }
        : {}),
      recentPlotBeats: boundedPlotBeats(input.continuity?.plotBeats),
      unresolvedThreads: boundedStrings(
        input.continuity?.unresolvedThreads,
        SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.unresolvedThreads,
        SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.unresolvedThread,
      ),
      entities: boundedEntities(input.continuity?.entities),
    },
  });
  return freezeContext(SerializedProgramEpisodeContextSchema.parse({
    ...content,
    fingerprint: serializedProgramEpisodeContextFingerprint(content),
  }));
}

/** Rejects tampered or over-broad persisted payloads before any stage can use them. */
export function parseSerializedProgramEpisodeContext(value: unknown): SerializedProgramEpisodeContext {
  return freezeContext(SerializedProgramEpisodeContextSchema.parse(value));
}

/**
 * Bind a receipt to the frozen route/run/topic values already present in a
 * pipeline invocation. This intentionally does not look up current channel or
 * series state, so retries cannot silently drift with mutable continuity.
 */
export function assertSerializedProgramEpisodeContextBinding(input: {
  readonly context: unknown;
  readonly routeFingerprint: string;
  readonly routeRunSeedFingerprint: string;
  readonly runId: string;
  readonly seriesIdentity: string;
  readonly seriesTitle: string;
  readonly seriesCount?: number;
  readonly topic?: string;
  readonly topicMemoryKey?: string;
}): SerializedProgramEpisodeContext {
  const context = parseSerializedProgramEpisodeContext(input.context);
  if (
    context.routeFingerprint !== input.routeFingerprint ||
    context.routeRunSeedFingerprint !== input.routeRunSeedFingerprint ||
    context.runId !== input.runId ||
    context.seriesIdentity !== input.seriesIdentity ||
    context.seriesTitle !== input.seriesTitle ||
    context.seriesCount !== input.seriesCount
  ) {
    throw new Error("serialized program episode context is not bound to the frozen route and run");
  }
  if (input.topic !== undefined && context.topic !== input.topic) {
    throw new Error("serialized program episode context topic does not match the active pipeline topic");
  }
  if (input.topicMemoryKey !== undefined && context.topicMemoryKey !== input.topicMemoryKey) {
    throw new Error("serialized program episode context topic-memory key is not bound to the episode receipt");
  }
  return context;
}

/**
 * Compact consumer-facing prompt context. It is intentionally much smaller
 * than the stored receipt so adding continuity does not create an unbounded
 * token/cost multiplier for script, crew, metadata, thumbnail, or QA calls.
 */
export function renderSerializedProgramEpisodeContextForPrompt(
  value: SerializedProgramEpisodeContext,
): string {
  const lines = [
    "SERIAL EPISODE CONTINUITY (immutable receipt; preserve it, do not invent a different episode order):",
    `Series: ${value.seriesTitle}; episode ${value.episodeNumber}${value.seriesCount ? ` of ${value.seriesCount}` : ""}.`,
    `Current episode focus: ${value.topic}`,
    value.continuity.arcSummary ? `Arc through this episode: ${value.continuity.arcSummary.slice(0, 800)}` : "",
    value.continuity.recentPlotBeats.length
      ? `Recent plot beats: ${value.continuity.recentPlotBeats.slice(-3).map((beat) => `Ep.${beat.episode}: ${beat.beat.slice(0, 240)}`).join(" | ")}`
      : "",
    value.continuity.unresolvedThreads.length
      ? `Open threads: ${value.continuity.unresolvedThreads.slice(0, 4).map((thread) => thread.slice(0, 120)).join("; ")}`
      : "",
    value.continuity.entities.length
      ? `Known narrative entities: ${value.continuity.entities.slice(0, 5).map((entity) => `${entity.name}${entity.role ? ` (${entity.role.slice(0, 100)})` : ""}`).join("; ")}`
      : "",
  ].filter(Boolean).join("\n");
  return lines.length <= SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.promptChars
    ? lines
    : lines.slice(0, SERIALIZED_PROGRAM_EPISODE_CONTEXT_LIMITS.promptChars).trimEnd();
}
