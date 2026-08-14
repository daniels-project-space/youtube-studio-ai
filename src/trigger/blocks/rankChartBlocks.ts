/**
 * The chart lane's TWO blocks, deliberately kept apart.
 *
 *   rank_data     — sources a ranked list of REAL, cited numbers. One job.
 *   chart_render  — turns a ChartSpec (from ANY producer) into a finished
 *                   video, muxing narration someone else already synthesized.
 *                   One job.
 *
 * WHY TWO BLOCKS AND NOT ONE ENGINE
 * The other self-contained families (whiteboard_scribe, motion_comic,
 * lore_short, quiz_year) each collapse write → voice → paint → cut into a
 * single block because their stages are genuinely inseparable. This lane's are
 * not: the renderer is useful to a producer that has nothing to do with
 * rankings (see simNarrativeBlocks.ts, which drives the SAME renderer with an
 * invented simulation curve), and the data sourcing is useful with no renderer
 * at all. Fusing them would have meant a second chart engine the first time a
 * second producer appeared.
 *
 * WHAT NEITHER BLOCK DOES
 * Neither writes the script (script_gen does), neither synthesizes speech
 * (narration_tts does), neither makes a thumbnail (thumbnail_gen does). This
 * lane adds no new capability that an existing module already covers.
 *
 * THE COST STORY
 * ZERO paid media providers. Facts are Wikidata (CC0, free, unauthenticated),
 * the render is local Remotion + headless Chromium, and the mux is local
 * ffmpeg. `rank_data` and `chart_render` are both unpaid; the only spend on the
 * whole family is the shared script/narration/thumbnail/QA modules it reuses,
 * which is what makes it the cheapest family in the catalog.
 */
import { join } from "node:path";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Block, StageContext } from "@/engine/types";
import { makeRunTempDir } from "@/lib/files";
import { putObjectFromFile } from "@/lib/storage";
import { muxAudioOverVideo } from "@/lib/ffmpeg";
import {
  assertChartSpecIntegrity,
  chartDurationSeconds,
  chartNarrationBrief,
  clampOutroSeconds,
  clampSecondsPerRow,
  CHART_DEFAULT_OUTRO_SECONDS,
  CHART_DEFAULT_SECONDS_PER_ROW,
  CHART_SPEC_VERSION,
  type ChartMode,
  type ChartSpec,
} from "@/lib/chartSpec";
import {
  assertRankIntegrity,
  fetchRankedFacts,
  RANK_TOPICS,
  resolveRankTopic,
  type RankedFact,
  type RankTopicKey,
} from "@/lib/rankFacts";
import { renderRankChart } from "@/lib/rankChartRender";

function convex(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

async function recordAsset(
  ctx: StageContext,
  kind: string,
  r2Key: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await convex().mutation(api.assets.recordAsset, {
      ownerId: ctx.ownerId,
      channelId: ctx.channelId as Id<"channels">,
      runId: ctx.runId as Id<"runs">,
      kind,
      r2Key,
      meta,
    });
  } catch (e) {
    ctx.log(`recordAsset(${kind}) failed (non-fatal): ${e instanceof Error ? e.message : e}`);
  }
}

export const RANK_MIN_ROWS = 3;
export const RANK_MAX_ROWS = 12;
export const RANK_DEFAULT_ROWS = 10;

/**
 * How many rows fit the requested runtime. A "Top 10" needs ten reveals; a
 * 45-second cut cannot hold ten. Deterministic and bounded so the sourcing
 * query size (and therefore the request to the public endpoint) is predictable.
 */
export function rankRowCount(targetSeconds: number, secondsPerRow: number): number {
  if (!Number.isFinite(targetSeconds) || targetSeconds <= 0) return RANK_DEFAULT_ROWS;
  const perRow = Math.max(2, Math.min(20, secondsPerRow));
  const fits = Math.round((targetSeconds - CHART_DEFAULT_OUTRO_SECONDS) / perRow);
  return Math.max(RANK_MIN_ROWS, Math.min(RANK_MAX_ROWS, fits));
}

export function resolveChartMode(value: unknown): ChartMode {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw === "bar_race" ? "bar_race" : "count_up";
}

/**
 * Build the render contract from sourced facts. A `count_up` ranking is a
 * static-value countdown; a `bar_race` needs a shared time axis, which is
 * synthesised as a monotone GROW-IN (each bar rising from zero to its real
 * sourced value) rather than an invented historical trajectory — the codebase
 * has no time series for these measures, and fabricating one would be exactly
 * the kind of plausible fiction this lane exists to avoid. Every bar still ends
 * on, and is cited at, its true value.
 */
export function buildRankChartSpec(args: {
  topic: RankTopicKey;
  facts: readonly RankedFact[];
  mode: ChartMode;
  title?: string;
  secondsPerRow: number;
  outroSeconds: number;
}): ChartSpec {
  const spec = RANK_TOPICS[args.topic];
  const steps = 12;
  const rows = args.facts.map((fact, index) => ({
    id: fact.wikidataQid,
    label: fact.label,
    value: fact.value,
    provenance: "dataset-sourced" as const,
    sourceUrl: fact.sourceUrl,
    sourceLabel: "Wikidata (CC0)",
    ...(args.mode === "bar_race"
      ? {
          series: Array.from({ length: steps }, (_, step) => {
            // Staggered ease-in: lower ranks resolve slightly sooner, so the
            // order becomes visible instead of every bar landing on one frame.
            // The LAST point is pinned to the exact sourced value, which is what
            // `chartSpecDefects` cross-checks against the headline value.
            if (step === steps - 1) return { step, value: fact.value };
            const eased = Math.min(1, (step + 1) / steps + index * 0.01);
            return { step, value: fact.value * eased };
          }),
        }
      : {}),
  }));
  return {
    version: CHART_SPEC_VERSION,
    mode: args.mode,
    title: args.title?.trim() || spec.title,
    subtitle: `Ranked by ${spec.measure}`,
    unit: spec.unit,
    stepLabel: args.mode === "bar_race" ? "Step" : undefined,
    rows,
    // REAL DATA. The honesty gate in chartSpec.ts now demands a resolvable
    // https citation on every single row, which the Wikidata QID URL supplies.
    speculative: false,
    secondsPerRow: args.secondsPerRow,
    outroSeconds: args.outroSeconds,
  };
}

export const rankData: Block = {
  id: "rank_data",
  consumes: [],
  produces: ["chartSpec", "chartBrief"],
  run: async (ctx) => {
    const secondsPerRow = Math.max(
      2,
      Math.min(20, Number(ctx.params["secondsPerRow"] ?? CHART_DEFAULT_SECONDS_PER_ROW)),
    );
    const outroSeconds = Math.max(
      0,
      Math.min(20, Number(ctx.params["outroSeconds"] ?? CHART_DEFAULT_OUTRO_SECONDS)),
    );
    const targetSeconds = Math.max(0, Number(ctx.params["targetSeconds"] ?? 0));
    const rows = rankRowCount(targetSeconds, secondsPerRow);
    const topic = resolveRankTopic(ctx.params["rankTopic"] ?? ctx.store["rankTopic"]);
    const mode = resolveChartMode(ctx.params["chartMode"]);
    const minNotability = Math.max(0, Number(ctx.params["minNotability"] ?? 20));
    const allowSensitiveTopics = ctx.params["allowSensitiveTopics"] === true;

    ctx.log(`rank_data: sourcing top ${rows} for "${topic}" (mode ${mode})`);

    // NO MODEL IS CALLED HERE. The values are read from Wikidata quantity
    // statements; there is no prompt on this path with a field a model could
    // put a number into.
    const sourced = await fetchRankedFacts({
      topic,
      count: rows,
      minNotability,
      allowSensitiveTopics,
      log: (m) => ctx.log(m),
    });
    for (const reason of sourced.rejected.slice(0, 12)) ctx.log(`rank_data drop — ${reason}`);

    // Deterministic, re-run on every checkpoint replay.
    assertRankIntegrity(sourced.facts);

    const spec = buildRankChartSpec({
      topic,
      facts: sourced.facts,
      mode,
      title: typeof ctx.store["topic"] === "string" ? (ctx.store["topic"] as string) : undefined,
      secondsPerRow,
      outroSeconds,
    });
    // The final gate before anything downstream can render or speak these
    // numbers: every row must still carry a resolvable citation.
    assertChartSpecIntegrity(spec);

    ctx.log(
      `rank_data ✓ ${spec.rows.length} cited rows, ${chartDurationSeconds(spec)}s of chart, $0.0000`,
    );
    return { chartSpec: spec, chartBrief: chartNarrationBrief(spec) };
  },
};

/**
 * Fit the chart to the voice. When narration is longer than the chart's natural
 * runtime the reveals are STRETCHED rather than the voice being cut — a ranking
 * video whose picture ends mid-sentence is the defect this exists to prevent.
 */
export function fitChartToNarration(spec: ChartSpec, narrationSeconds: number): ChartSpec {
  if (!Number.isFinite(narrationSeconds) || narrationSeconds <= 0) return spec;
  const natural = chartDurationSeconds(spec);
  if (natural >= narrationSeconds) return spec;
  const outro = clampOutroSeconds(spec.outroSeconds);
  const rows = spec.mode === "line_series" ? 6 : Math.max(1, spec.rows.length);
  const perRow = clampSecondsPerRow((narrationSeconds - outro) / rows);
  const stretched: ChartSpec = { ...spec, secondsPerRow: perRow };
  // Even at the maximum reveal length a very long narration can outrun the
  // chart. Rather than cut the voice, hold the final frame for the remainder —
  // the picture may be slow, but it never ends mid-sentence.
  const shortfall = narrationSeconds - chartDurationSeconds(stretched);
  if (shortfall <= 0) return stretched;
  return { ...stretched, outroSeconds: clampOutroSeconds(outro + shortfall) };
}

export const chartRender: Block = {
  id: "chart_render",
  consumes: ["chartSpec"],
  produces: ["videoKey", "videoLocalPath", "videoDurationSec"],
  run: async (ctx) => {
    const rawSpec = ctx.store["chartSpec"] as ChartSpec;
    // The renderer NEVER trusts its input: an upstream producer that lost its
    // citations (or mixed invented rows into a sourced set) must fail here,
    // before pixels, on every replay.
    assertChartSpecIntegrity(rawSpec);

    const narrationLocalPath = ctx.store["narrationLocalPath"] as string | undefined;
    const narrationDurationSec = Number(ctx.store["narrationDurationSec"] ?? 0);
    const spec = narrationLocalPath
      ? fitChartToNarration(rawSpec, narrationDurationSec)
      : rawSpec;
    assertChartSpecIntegrity(spec);

    const palette = Array.isArray(ctx.store["palette"])
      ? (ctx.store["palette"] as unknown[]).map(String)
      : [];

    const runDir = await makeRunTempDir(ctx.runId, "chart_render");
    const silentPath = join(runDir, "chart-silent.mp4");
    await renderRankChart({
      spec,
      palette,
      title: String(ctx.store["channelName"] ?? ""),
      outPath: silentPath,
      log: (m) => ctx.log(m),
    });

    let outPath = silentPath;
    if (narrationLocalPath) {
      outPath = join(runDir, "chart.mp4");
      await muxAudioOverVideo({
        videoPath: silentPath,
        audioPath: narrationLocalPath,
        outPath,
        audioFadeOutSec: 2,
        audioDurationSec: narrationDurationSec,
      });
      ctx.log(`chart_render: muxed ${narrationDurationSec.toFixed(1)}s of narration`);
    } else {
      ctx.log("chart_render: no narration in the store — shipping the silent chart");
    }

    const prefix = `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/chart`;
    const videoKey = `${prefix}/chart.mp4`;
    await putObjectFromFile(videoKey, outPath, { contentType: "video/mp4" });
    const videoDurationSec = chartDurationSeconds(spec);

    await recordAsset(ctx, "video", videoKey, {
      durationSec: videoDurationSec,
      engine: "chart_render",
      mode: spec.mode,
      rows: spec.rows.length,
      speculative: spec.speculative,
      // Provenance travels with the asset. For a sourced chart that is a list
      // of citations; for a declared-illustrative chart it is the exact
      // disclosure that was burned into the frame.
      ...(spec.speculative
        ? { disclosure: spec.disclosure }
        : {
            sources: spec.rows.map((row) => ({
              label: row.label,
              value: row.value,
              url: row.sourceUrl,
            })),
            license: "CC0-1.0 (Wikidata)",
          }),
    });

    ctx.log(
      `chart_render ✓ → ${videoKey} (${videoDurationSec}s, ${spec.mode}, ` +
        `${spec.rows.length} rows, speculative=${spec.speculative}, $0.0000)`,
    );
    return { videoKey, videoLocalPath: outPath, videoDurationSec };
  },
};

export const rankChartBlocks: Block[] = [rankData, chartRender];
