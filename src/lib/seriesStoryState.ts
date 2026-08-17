/**
 * Real episodic story-state memory (Phase 4 — episodic continuity).
 *
 * Pure, dependency-free merge/render logic for the `seriesStoryState` Convex
 * table (see convex/seriesStoryState.ts + convex/schema.ts). Kept separate
 * from Convex handlers so it is directly unit-testable with plain objects.
 *
 * Scope note: this is PLOT/ARC continuity (running summary, plot beats,
 * unresolved narrative threads, named entities + one-line ROLE). It is
 * explicitly NOT wardrobe/appearance continuity — that is a separate concern
 * owned by the character/wardrobe continuity system on another branch
 * (channelCharacter.ts / characterLora.ts). `entities[].role` must stay a
 * one-line narrative role (e.g. "the skeptical detective"), never a physical
 * description.
 */

export interface SeriesEntity {
  name: string;
  role: string;
}

export interface SeriesPlotBeat {
  episode: number;
  beat: string;
  at: number;
}

/** The persisted shape (minus Convex's _id/_creationTime/ownerId/channelId/seriesTitle envelope). */
export interface SeriesStoryStateData {
  arcSummary: string;
  plotBeats: SeriesPlotBeat[];
  unresolvedThreads: string[];
  entities: SeriesEntity[];
  updatedAt: number;
}

export interface SeriesStoryStateUpdate {
  episode: number;
  /** Replaces the running arc summary when the model returns a fresh one; empty/omitted keeps the prior summary. */
  arcSummary?: string;
  /** Appended as a new plot-beat entry when non-empty. */
  newPlotBeat?: string;
  /** Replaces the unresolved-threads list when provided (the model's updated view after this episode); omitted keeps the prior list untouched. */
  unresolvedThreads?: string[];
  /** Merged into the entity roster, deduped by name (case-insensitive); existing entities are kept unless a new role is supplied for the same name. */
  newEntities?: SeriesEntity[];
  /** Injectable clock for deterministic tests. */
  now?: number;
}

/** Bounded plot-beat history — keeps the prompt block injected into the LLM small and the row size sane. */
export const MAX_PLOT_BEATS = 25;

function dedupeStrings(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const s = (raw ?? "").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function mergeEntities(existing: SeriesEntity[], incoming: SeriesEntity[]): SeriesEntity[] {
  const byName = new Map<string, SeriesEntity>();
  for (const e of existing) {
    const name = (e.name ?? "").trim();
    if (!name) continue;
    byName.set(name.toLowerCase(), { name, role: (e.role ?? "").trim() });
  }
  for (const e of incoming) {
    const name = (e.name ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const prior = byName.get(key);
    const role = (e.role ?? "").trim();
    // Prefer the newest non-empty role; fall back to whatever we already had.
    byName.set(key, { name: prior?.name ?? name, role: role || prior?.role || "" });
  }
  return Array.from(byName.values());
}

/**
 * Fold an episode's update into the existing story state (or start a fresh
 * one when `existing` is null — first episode of a series). Deterministic and
 * side-effect free so both the Convex mutation and tests can share it.
 */
export function mergeSeriesStoryState(
  existing: SeriesStoryStateData | null,
  update: SeriesStoryStateUpdate,
): SeriesStoryStateData {
  const now = update.now ?? Date.now();
  const base: SeriesStoryStateData = existing ?? {
    arcSummary: "",
    plotBeats: [],
    unresolvedThreads: [],
    entities: [],
    updatedAt: now,
  };

  const arcSummary = (update.arcSummary ?? "").trim() || base.arcSummary;

  const plotBeats = [...base.plotBeats];
  const beatText = (update.newPlotBeat ?? "").trim();
  if (beatText) {
    plotBeats.push({ episode: update.episode, beat: beatText, at: now });
  }
  const boundedBeats = plotBeats.slice(-MAX_PLOT_BEATS);

  const unresolvedThreads = update.unresolvedThreads
    ? dedupeStrings(update.unresolvedThreads)
    : base.unresolvedThreads;

  const entities = update.newEntities?.length
    ? mergeEntities(base.entities, update.newEntities)
    : base.entities;

  return { arcSummary, plotBeats: boundedBeats, unresolvedThreads, entities, updatedAt: now };
}

/**
 * Render story state as an LLM-ready text block for the continuation prompt.
 * Returns "" when there's no state yet (first episode, or a channel not
 * using SERIES MODE) — callers must omit the section entirely in that case
 * rather than emit an empty header, which is what preserves today's exact
 * title-only-continuity behavior for channels with no recorded state.
 */
export function renderStoryStateForPrompt(
  state: Pick<SeriesStoryStateData, "arcSummary" | "plotBeats" | "unresolvedThreads" | "entities"> | null | undefined,
): string {
  if (!state) return "";
  const lines: string[] = [];
  if (state.arcSummary && state.arcSummary.trim()) {
    lines.push(`ARC SO FAR: ${state.arcSummary.trim()}`);
  }
  if (state.unresolvedThreads?.length) {
    lines.push(`UNRESOLVED THREADS: ${state.unresolvedThreads.join("; ")}`);
  }
  if (state.entities?.length) {
    lines.push(`KNOWN ENTITIES: ${state.entities.map((e) => `${e.name} (${e.role})`).join("; ")}`);
  }
  const recentBeats = (state.plotBeats ?? []).slice(-5);
  if (recentBeats.length) {
    lines.push(`RECENT PLOT BEATS: ${recentBeats.map((b) => `Ep.${b.episode}: ${b.beat}`).join(" | ")}`);
  }
  return lines.join("\n");
}
