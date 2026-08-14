/**
 * ChartSpec — the ONE data contract the animated-chart renderer accepts.
 *
 * WHY THIS FILE EXISTS AT ALL
 * Two very different producers want the same renderer: `rank_data` (a real,
 * citation-backed "Top 10 X" ranking) and `sim_narrative` (a deliberately
 * INVENTED, dramatized "simulation run"). If each producer owned its own render
 * path we would have two chart engines to keep in step. Instead both emit this
 * one spec, and the renderer has exactly one input shape to understand.
 *
 * THE INVARIANT THIS FILE EXISTS TO PROTECT
 * A number on screen is either CHECKABLE or it is DECLARED FICTIONAL. There is
 * no third state and the two may never be mixed inside one chart:
 *
 *   • `speculative: false` → EVERY row must carry a real provenance tag and a
 *     resolvable https source URL. This is what stops a model from inventing
 *     statistics and having them rendered as if measured. Same discipline as
 *     src/lib/quizYearFacts.ts's answer-integrity asserts, applied to values.
 *   • `speculative: true`  → EVERY row must be tagged speculative-illustrative,
 *     NO row may carry a source URL (you cannot cite a number you invented),
 *     and a verbatim on-screen `disclosure` string is MANDATORY. The renderer
 *     burns it into the frame; it is not an optional nicety.
 *
 * Pure data + pure functions. No provider calls, no I/O, no React — so the
 * block, the renderer and the tests all share exactly one definition.
 */

export const CHART_SPEC_VERSION = "chart-spec/v1" as const;

export type ChartMode = "bar_race" | "count_up" | "line_series";

export const CHART_MODES: readonly ChartMode[] = ["bar_race", "count_up", "line_series"];

/**
 * Where a rendered number came from. The renderer never infers this; the
 * producing block sets it and `chartSpecDefects` proves the set is coherent.
 */
export type ChartValueProvenance =
  /** Read from a structured public dataset (e.g. a Wikidata statement). */
  | "dataset-sourced"
  /** Model-proposed but re-verified against an independently fetched document. */
  | "citation-verified"
  /** Invented for an explicitly-labelled illustrative scenario. Never citable. */
  | "speculative-illustrative";

export interface ChartSeriesPoint {
  /** Step index along the series axis (year, generation, tick). */
  step: number;
  value: number;
}

export interface ChartRow {
  /** Stable id — dedupe key and React key. */
  id: string;
  /** Rendered name of the bar / line. */
  label: string;
  /** Headline value (the last series point when a series is present). */
  value: number;
  /** Optional motion track. Required for bar_race and line_series. */
  series?: ChartSeriesPoint[];
  provenance: ChartValueProvenance;
  /** Verifiable citation. REQUIRED for non-speculative rows, FORBIDDEN otherwise. */
  sourceUrl?: string;
  /** Short human source name shown under the chart, e.g. "Wikidata". */
  sourceLabel?: string;
}

/**
 * Story beats let an invented simulation's graph move WHEN THE NARRATION SAYS
 * IT MOVES. The renderer highlights the step; it never invents one.
 */
export interface ChartBeat {
  step: number;
  /** Short on-screen caption for this moment, e.g. "a mutant dodges the wall". */
  caption: string;
}

export interface ChartSpec {
  version: typeof CHART_SPEC_VERSION;
  mode: ChartMode;
  title: string;
  subtitle?: string;
  /** Suffix appended to every rendered value, e.g. "%", "M", " km". */
  unit?: string;
  /** Prefix, e.g. "$". */
  valuePrefix?: string;
  /** Name of the series axis, e.g. "Generation" / "Year". */
  stepLabel?: string;
  rows: ChartRow[];
  beats?: ChartBeat[];
  /**
   * TRUE = the chart depicts an invented, illustrative scenario rather than
   * measured data. This is a hard content-honesty switch, not a style flag.
   */
  speculative: boolean;
  /** Verbatim on-screen disclosure. MANDATORY when `speculative`. */
  disclosure?: string;
  /** Screen time per row for bar_race/count_up reveals. */
  secondsPerRow?: number;
  /** Held outro seconds after the last reveal. */
  outroSeconds?: number;
}

/** The renderer refuses anything outside these bounds; producers clamp to them. */
export const CHART_MIN_ROWS = 3;
export const CHART_MAX_ROWS = 12;
export const CHART_MAX_LINE_SERIES = 4;
export const CHART_MIN_SERIES_POINTS = 3;
export const CHART_MAX_SERIES_POINTS = 240;
export const CHART_DEFAULT_SECONDS_PER_ROW = 6;
export const CHART_DEFAULT_OUTRO_SECONDS = 4;
/**
 * Timing bounds. Shared by the block, `chartDurationSeconds` and the Remotion
 * composition so all three size a video identically — the seconds a block
 * reports and the frames the composition renders must never disagree.
 *
 * The upper bounds are generous on purpose: when the narration runs longer than
 * the chart's natural runtime the reveals are STRETCHED to cover it, and a
 * picture that ends mid-sentence is a worse defect than a slow reveal.
 */
export const CHART_MIN_SECONDS_PER_ROW = 2;
export const CHART_MAX_SECONDS_PER_ROW = 45;
export const CHART_MAX_OUTRO_SECONDS = 120;

export function clampSecondsPerRow(value: number | undefined): number {
  const seconds = Number.isFinite(value) ? (value as number) : CHART_DEFAULT_SECONDS_PER_ROW;
  return Math.max(CHART_MIN_SECONDS_PER_ROW, Math.min(CHART_MAX_SECONDS_PER_ROW, seconds));
}

export function clampOutroSeconds(value: number | undefined): number {
  const seconds = Number.isFinite(value) ? (value as number) : CHART_DEFAULT_OUTRO_SECONDS;
  return Math.max(0, Math.min(CHART_MAX_OUTRO_SECONDS, seconds));
}

/**
 * The exact words a speculative chart must show. Kept as a constant (rather
 * than left to a prompt) so the honesty claim cannot drift between episodes and
 * a test can assert it verbatim.
 */
export const SPECULATIVE_DISCLOSURE =
  "ILLUSTRATIVE SCENARIO — not a real experiment. The figures below are invented to tell this story.";

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Deterministic integrity report. Returns EVERY defect rather than throwing on
 * the first, so a producing block can log the whole picture before failing.
 * Re-runnable: a checkpoint replay re-checks exactly the same way.
 */
export function chartSpecDefects(spec: ChartSpec): string[] {
  const defects: string[] = [];
  if (spec.version !== CHART_SPEC_VERSION) {
    defects.push(`unknown chart spec version "${String(spec.version)}"`);
  }
  if (!CHART_MODES.includes(spec.mode)) {
    defects.push(`unknown chart mode "${String(spec.mode)}"`);
  }
  if (typeof spec.title !== "string" || spec.title.trim().length === 0) {
    defects.push("chart title is empty");
  }
  const rows = Array.isArray(spec.rows) ? spec.rows : [];
  const maxRows = spec.mode === "line_series" ? CHART_MAX_LINE_SERIES : CHART_MAX_ROWS;
  const minRows = spec.mode === "line_series" ? 1 : CHART_MIN_ROWS;
  if (rows.length < minRows || rows.length > maxRows) {
    defects.push(`${spec.mode} needs ${minRows}-${maxRows} rows, got ${rows.length}`);
  }

  const seenIds = new Set<string>();
  const seenLabels = new Set<string>();
  let seriesLength: number | null = null;
  for (const row of rows) {
    const where = row?.id ? `row ${row.id}` : "row <no id>";
    if (typeof row?.id !== "string" || row.id.trim().length === 0) {
      defects.push("a row has no id");
    } else if (seenIds.has(row.id)) {
      defects.push(`duplicate row id ${row.id}`);
    } else {
      seenIds.add(row.id);
    }
    if (typeof row?.label !== "string" || row.label.trim().length === 0) {
      defects.push(`${where} has no label`);
    } else {
      const key = row.label.trim().toLowerCase();
      if (seenLabels.has(key)) defects.push(`duplicate row label "${row.label}"`);
      seenLabels.add(key);
    }
    if (!finite(row?.value)) defects.push(`${where} has a non-finite value`);

    // Series discipline: bar_race and line_series ARE motion — a row without a
    // track would sit frozen while its neighbours animate.
    if (spec.mode === "bar_race" || spec.mode === "line_series") {
      const series = Array.isArray(row?.series) ? row.series : [];
      if (series.length < CHART_MIN_SERIES_POINTS) {
        defects.push(`${where} needs at least ${CHART_MIN_SERIES_POINTS} series points for ${spec.mode}`);
      } else if (series.length > CHART_MAX_SERIES_POINTS) {
        defects.push(`${where} has ${series.length} series points (max ${CHART_MAX_SERIES_POINTS})`);
      }
      if (seriesLength === null) seriesLength = series.length;
      else if (series.length !== seriesLength) {
        defects.push(`${where} series length ${series.length} != ${seriesLength} (rows must share one time axis)`);
      }
      for (const point of series) {
        if (!finite(point?.step) || !finite(point?.value)) {
          defects.push(`${where} has a non-finite series point`);
          break;
        }
      }
      const last = series[series.length - 1];
      if (last && finite(row?.value) && Math.abs(last.value - row.value) > 1e-6) {
        defects.push(`${where} headline value ${row.value} != last series value ${last.value}`);
      }
    }
  }

  // ------------------------------------------------------------------
  // The honesty gate. This is the whole reason the file exists.
  // ------------------------------------------------------------------
  if (spec.speculative) {
    if (typeof spec.disclosure !== "string" || spec.disclosure.trim().length === 0) {
      defects.push("a speculative chart MUST carry an on-screen disclosure");
    }
    for (const row of rows) {
      if (row?.provenance !== "speculative-illustrative") {
        defects.push(
          `row ${row?.id ?? "?"} is "${String(row?.provenance)}" inside a speculative chart — ` +
            "invented and measured values may never be mixed",
        );
      }
      if (row?.sourceUrl !== undefined) {
        defects.push(`row ${row?.id ?? "?"} cites a source for an invented number`);
      }
    }
  } else {
    for (const row of rows) {
      if (row?.provenance !== "dataset-sourced" && row?.provenance !== "citation-verified") {
        defects.push(
          `row ${row?.id ?? "?"} has provenance "${String(row?.provenance)}" — a non-speculative ` +
            "chart may only render dataset-sourced or citation-verified values",
        );
      }
      if (!isHttpsUrl(row?.sourceUrl)) {
        defects.push(`row ${row?.id ?? "?"} has no resolvable https source URL`);
      }
    }
    if (spec.disclosure !== undefined) {
      defects.push("a non-speculative chart must not carry a speculative disclosure");
    }
  }

  for (const beat of spec.beats ?? []) {
    if (!finite(beat?.step)) defects.push("a beat has a non-finite step");
    if (typeof beat?.caption !== "string" || beat.caption.trim().length === 0) {
      defects.push("a beat has no caption");
    }
  }
  return defects;
}

/** Throwing form — the last gate a producing block runs before pixels. */
export function assertChartSpecIntegrity(spec: ChartSpec): void {
  const defects = chartSpecDefects(spec);
  if (defects.length) {
    throw new Error(`chart spec integrity: ${defects.join("; ")}`);
  }
}

/**
 * Screen time. Single-sourced here so the block's `videoDurationSec`, the
 * Remotion `calculateMetadata` frame count and the narration budget cannot
 * disagree with each other.
 */
export function chartDurationSeconds(spec: ChartSpec): number {
  const perRow = clampSecondsPerRow(spec.secondsPerRow);
  const outro = clampOutroSeconds(spec.outroSeconds);
  const rows = Array.isArray(spec.rows) ? spec.rows.length : 0;
  if (spec.mode === "line_series") {
    // One continuous playthrough of the shared time axis, not one pass per row.
    const steps = spec.rows[0]?.series?.length ?? 0;
    const seconds = Math.max(6, Math.min(600, steps * (perRow / 6)));
    return Math.round(seconds + outro);
  }
  return Math.round(Math.max(1, rows) * perRow + outro);
}

/**
 * The narration-facing digest: exactly the numbers that are allowed on screen,
 * with their citations. Script generation is grounded on THIS rather than on
 * the model's own recollection, which is what keeps the spoken figures and the
 * rendered figures identical.
 */
export function chartNarrationBrief(spec: ChartSpec): string {
  const lines = spec.rows.map((row, index) => {
    const value = `${spec.valuePrefix ?? ""}${row.value}${spec.unit ?? ""}`;
    const cite = row.sourceUrl ? ` [source: ${row.sourceUrl}]` : "";
    return `${index + 1}. ${row.label} — ${value}${cite}`;
  });
  const header = spec.speculative
    ? `INVENTED ILLUSTRATIVE FIGURES for "${spec.title}". These are NOT measurements.`
    : `VERIFIED FIGURES for "${spec.title}". Speak these EXACT numbers; never round, replace or add to them.`;
  return [header, ...lines].join("\n");
}
