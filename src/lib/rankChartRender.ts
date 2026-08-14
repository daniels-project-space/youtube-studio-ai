/**
 * Render the RankChart composition from its OWN Remotion bundle.
 *
 * Structural twin of src/lib/quizYearRender.ts (dynamic imports so the Next
 * build never loads @remotion/renderer, ensureBrowser, per-process serve-URL
 * cache) with its own entry point — src/remotion/chart/index.ts — and its own
 * cache variable. That is the "isolated Remotion bundle" gate: a sibling
 * composition cannot break a chart render, and a chart change cannot break the
 * quiz.
 *
 * ONE JOB: turn a ChartSpec into frames. It does not source data, does not
 * write narration, does not upload, and does not decide what is true.
 *
 * NOTE: the Trigger image must include src/remotion/chart/** (additionalFiles
 * build extension), the same requirement the quiz bundle already carries.
 */
import path from "node:path";
import type { ChartSpec } from "./chartSpec";

/** Separate from remotionRender.ts / quizYearRender.ts — different entry point. */
let chartServeUrlCache: string | null = null;

export async function getChartServeUrl(): Promise<string> {
  if (chartServeUrlCache) return chartServeUrlCache;
  const { bundle } = await import("@remotion/bundler");
  chartServeUrlCache = await bundle({
    entryPoint: path.join(process.cwd(), "src/remotion/chart/index.ts"),
  });
  return chartServeUrlCache;
}

export interface RenderRankChartArgs {
  spec: ChartSpec;
  palette?: string[];
  title?: string;
  outPath: string;
  width?: number;
  height?: number;
  concurrency?: number;
  log?: (msg: string) => void;
}

/**
 * Render the chart body to an opaque H.264 file. Duration comes from the spec
 * itself via calculateMetadata, so reveal timing is single-sourced in
 * RankChart.tsx / chartSpec.ts rather than duplicated here.
 */
export async function renderRankChart(args: RenderRankChartArgs): Promise<string> {
  const { selectComposition, renderMedia, ensureBrowser } = await import("@remotion/renderer");
  await ensureBrowser();
  const serveUrl = await getChartServeUrl();
  const inputProps = {
    spec: args.spec,
    palette: args.palette ?? [],
    title: args.title ?? "",
    width: args.width ?? 1920,
    height: args.height ?? 1080,
  };
  const composition = await selectComposition({ serveUrl, id: "RankChart", inputProps });
  let lastPct = -10;
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: "h264",
    outputLocation: args.outPath,
    chromiumOptions: { gl: "angle" },
    ...(args.concurrency ? { concurrency: args.concurrency } : {}),
    onProgress: ({ progress }) => {
      const pct = Math.round(progress * 100);
      if (pct >= lastPct + 10) {
        lastPct = pct;
        args.log?.(`rank-chart render ${pct}%`);
      }
    },
  });
  return args.outPath;
}

/** Fast review path — single stills, no full render. */
export async function renderRankChartStills(args: {
  spec: ChartSpec;
  palette?: string[];
  title?: string;
  frames: number[];
  outPaths: string[];
  width?: number;
  height?: number;
}): Promise<string[]> {
  const { selectComposition, renderStill, ensureBrowser } = await import("@remotion/renderer");
  await ensureBrowser();
  const serveUrl = await getChartServeUrl();
  const inputProps = {
    spec: args.spec,
    palette: args.palette ?? [],
    title: args.title ?? "",
    width: args.width ?? 1920,
    height: args.height ?? 1080,
  };
  const composition = await selectComposition({ serveUrl, id: "RankChart", inputProps });
  const out: string[] = [];
  for (let i = 0; i < args.frames.length; i++) {
    await renderStill({
      serveUrl,
      composition,
      inputProps,
      frame: Math.max(0, Math.min(composition.durationInFrames - 1, args.frames[i])),
      output: args.outPaths[i],
      imageFormat: "jpeg",
      jpegQuality: 88,
      chromiumOptions: { gl: "angle" },
    });
    out.push(args.outPaths[i]);
  }
  return out;
}
