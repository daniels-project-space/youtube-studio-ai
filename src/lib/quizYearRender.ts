/**
 * Render the QuizYear composition from its OWN Remotion bundle.
 *
 * Mirrors src/lib/remotionRender.ts's structure (dynamic imports so the Next
 * build never loads @remotion/renderer, ensureBrowser, per-process serve-URL
 * cache) with one deliberate difference: the entry point is
 * src/remotion/quiz/index.ts rather than src/remotion/index.ts, and the cache
 * variable is separate. That is the catalog's "isolated Remotion bundle" gate —
 * a sibling composition cannot break a quiz render.
 *
 * NOTE: the Trigger image must include src/remotion/quiz/** (additionalFiles
 * build extension), the same requirement the shared bundle already carries.
 */
import path from "node:path";
import type { QuizYearRound } from "../remotion/quiz/QuizYear";

export type { QuizYearRound };

/** Separate from remotionRender.ts's cache — different entry point. */
let quizServeUrlCache: string | null = null;

export async function getQuizServeUrl(): Promise<string> {
  if (quizServeUrlCache) return quizServeUrlCache;
  const { bundle } = await import("@remotion/bundler");
  quizServeUrlCache = await bundle({
    entryPoint: path.join(process.cwd(), "src/remotion/quiz/index.ts"),
  });
  return quizServeUrlCache;
}

export interface RenderQuizYearArgs {
  rounds: QuizYearRound[];
  palette?: string[];
  title?: string;
  outPath: string;
  width?: number;
  height?: number;
  concurrency?: number;
  log?: (msg: string) => void;
}

/**
 * Render the full quiz body to an opaque H.264 file. Duration comes from the
 * rounds themselves via calculateMetadata, so countdown/reveal timing is
 * single-sourced in QuizYear.tsx.
 */
export async function renderQuizYear(args: RenderQuizYearArgs): Promise<string> {
  const { selectComposition, renderMedia, ensureBrowser } = await import("@remotion/renderer");
  await ensureBrowser();
  const serveUrl = await getQuizServeUrl();
  const inputProps = {
    rounds: args.rounds,
    palette: args.palette ?? [],
    title: args.title ?? "",
    width: args.width ?? 1920,
    height: args.height ?? 1080,
  };
  const composition = await selectComposition({ serveUrl, id: "QuizYear", inputProps });
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
        args.log?.(`quiz-year render ${pct}%`);
      }
    },
  });
  return args.outPath;
}

/** Fast review path — single stills, no full render. */
export async function renderQuizYearStills(args: {
  rounds: QuizYearRound[];
  palette?: string[];
  title?: string;
  frames: number[];
  outPaths: string[];
  width?: number;
  height?: number;
}): Promise<string[]> {
  const { selectComposition, renderStill, ensureBrowser } = await import("@remotion/renderer");
  await ensureBrowser();
  const serveUrl = await getQuizServeUrl();
  const inputProps = {
    rounds: args.rounds,
    palette: args.palette ?? [],
    title: args.title ?? "",
    width: args.width ?? 1920,
    height: args.height ?? 1080,
  };
  const composition = await selectComposition({ serveUrl, id: "QuizYear", inputProps });
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
