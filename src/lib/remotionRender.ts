/**
 * In-process Remotion render (cloud title cards). Bundles the in-app composition
 * (src/remotion) and renders via @remotion/renderer with a headless Chromium
 * (ensureBrowser downloads chrome-headless-shell on first use, cached per
 * container). Heavy deps are dynamically imported so the Next build never loads
 * them. The bundle is cached per process.
 *
 * NOTE: the Trigger image must include src/remotion/** (additionalFiles build
 * extension) so bundle() can read the entry at runtime.
 */
import path from "node:path";

let serveUrlCache: string | null = null;

async function getServeUrl(): Promise<string> {
  if (serveUrlCache) return serveUrlCache;
  const { bundle } = await import("@remotion/bundler");
  serveUrlCache = await bundle({
    entryPoint: path.join(process.cwd(), "src/remotion/index.ts"),
  });
  return serveUrlCache;
}

export async function renderTitleCard(args: {
  title: string;
  subtitle?: string;
  palette?: string[];
  outPath: string;
  durationSec?: number;
  width?: number;
  height?: number;
  /** Local image rendered at 50% opacity behind the title (encoded to a data URI). */
  bgImagePath?: string;
  /** Outro card: fades to black at the end. */
  outro?: boolean;
  /** Chapter card: gently fades in from black and out to black on both ends. */
  chapter?: boolean;
  /** Transparent VP8 (overlay) vs opaque H.264 (standalone intro clip). */
  transparent?: boolean;
}): Promise<string> {
  const { selectComposition, renderMedia, ensureBrowser } = await import(
    "@remotion/renderer"
  );
  await ensureBrowser();
  const serveUrl = await getServeUrl();
  const width = args.width ?? 1920;
  const height = args.height ?? 1080;
  const durationInFrames = Math.max(1, Math.round((args.durationSec ?? 5) * 30));
  // Encode the bust to a data URI so the Remotion <Img> loads it without any
  // staticFile/public-dir plumbing in the bundled composition.
  let bgImage = "";
  if (args.bgImagePath) {
    try {
      const { readFile } = await import("node:fs/promises");
      const buf = await readFile(args.bgImagePath);
      bgImage = `data:image/jpeg;base64,${buf.toString("base64")}`;
    } catch {
      /* no bg → plain card */
    }
  }
  const inputProps = {
    title: args.title,
    subtitle: args.subtitle ?? "",
    palette: args.palette ?? [],
    bgImage,
    outro: args.outro ?? false,
    chapter: args.chapter ?? false,
    durationInFrames,
    width,
    height,
  };
  const composition = await selectComposition({
    serveUrl,
    id: "TitleCard",
    inputProps,
  });
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: args.transparent ? "vp8" : "h264",
    pixelFormat: args.transparent ? "yuva420p" : "yuv420p",
    imageFormat: args.transparent ? "png" : "jpeg", // png required for alpha
    outputLocation: args.outPath,
    chromiumOptions: { gl: "angle" },
  });
  return args.outPath;
}

/**
 * Render the DOCUMOTION timeline (documentary-collage shot kit) to an opaque
 * H.264 body. Shot specs carry data-URI assets; duration comes from the sum of
 * shot durations (calculateMetadata). Audio is muxed afterwards by the engine.
 */
export async function renderDocuMotion(args: {
  shots: unknown[];
  outPath: string;
  width?: number;
  height?: number;
  /** Renderer parallelism (defaults to Remotion's choice). */
  concurrency?: number;
  log?: (msg: string) => void;
}): Promise<string> {
  const { selectComposition, renderMedia, ensureBrowser } = await import(
    "@remotion/renderer"
  );
  await ensureBrowser();
  const serveUrl = await getServeUrl();
  const inputProps = {
    shots: args.shots,
    width: args.width ?? 1920,
    height: args.height ?? 1080,
  };
  const composition = await selectComposition({ serveUrl, id: "DocuMotion", inputProps });
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
        args.log?.(`documotion render ${pct}%`);
      }
    },
  });
  return args.outPath;
}

/**
 * Render a transparent (VP8/alpha) quote overlay — the QuoteOverlay composition
 * (bold quote, important words yellow, scrim fade-in). ffmpeg composites it over
 * the (blurred) body video. width/height should match the body canvas.
 */
/**
 * Render a transparent (VP8/alpha) DATA-VIZ insert — animated stat counter /
 * draw-on line chart / bar comparison, branded by the channel palette. ffmpeg
 * composites it over the (blurred) body while the narration speaks the numbers.
 */
export async function renderDataInsert(args: {
  kind: "big_stat" | "line_chart" | "bar_compare" | "annotated_line" | "lower_third";
  title?: string;
  value?: string;
  label?: string;
  series?: number[];
  xLabels?: string[];
  bars?: { label: string; value: number; display?: string }[];
  events?: { idx: number; label: string }[];
  palette?: string[];
  accent?: string;
  outPath: string;
  durationSec: number;
  width?: number;
  height?: number;
}): Promise<string> {
  const { selectComposition, renderMedia, ensureBrowser } = await import(
    "@remotion/renderer"
  );
  await ensureBrowser();
  const serveUrl = await getServeUrl();
  const width = args.width ?? 1920;
  const height = args.height ?? 1080;
  const durationInFrames = Math.max(1, Math.round(args.durationSec * 30));
  const inputProps = {
    kind: args.kind,
    title: args.title ?? "",
    value: args.value,
    label: args.label,
    series: args.series,
    xLabels: args.xLabels,
    bars: args.bars,
    events: args.events,
    palette: args.palette ?? [],
    accent: args.accent,
    durationInFrames,
    width,
    height,
  };
  const composition = await selectComposition({ serveUrl, id: "DataInsert", inputProps });
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: "vp8",
    pixelFormat: "yuva420p",
    imageFormat: "png", // required for transparent (alpha) renders
    outputLocation: args.outPath,
    chromiumOptions: { gl: "angle" },
  });
  return args.outPath;
}

/**
 * Render the THUMBNAIL TEXT LAYER as a single transparent PNG (real
 * typography: per-word accents, giant number callout, stroke/glow/scrim) —
 * the replacement for ffmpeg drawtext. Composite over the AI base with ffmpeg.
 */
/** Render a FULL thumbnail from the designed template pack (jpeg, 1280x720). */
export async function renderThumbTemplate(args: {
  props: Record<string, unknown>;
  outJpg: string;
}): Promise<string> {
  const { selectComposition, renderStill, ensureBrowser } = await import("@remotion/renderer");
  await ensureBrowser();
  const serveUrl = await getServeUrl();
  const inputProps = { ...args.props };
  const composition = await selectComposition({ serveUrl, id: "ThumbTemplate", inputProps });
  await renderStill({
    serveUrl,
    composition: { ...composition, width: 1280, height: 720 },
    inputProps,
    output: args.outJpg,
    imageFormat: "jpeg",
    jpegQuality: 92,
    chromiumOptions: { gl: "angle" },
  });
  return args.outJpg;
}

export async function renderThumbTextLayer(args: {
  props: Record<string, unknown>;
  outPng: string;
  width?: number;
  height?: number;
}): Promise<string> {
  const { selectComposition, renderStill, ensureBrowser } = await import(
    "@remotion/renderer"
  );
  await ensureBrowser();
  const serveUrl = await getServeUrl();
  const inputProps = { ...args.props };
  const composition = await selectComposition({ serveUrl, id: "ThumbText", inputProps });
  await renderStill({
    serveUrl,
    composition: { ...composition, width: args.width ?? 1280, height: args.height ?? 720 },
    inputProps,
    output: args.outPng,
    imageFormat: "png", // alpha
    chromiumOptions: { gl: "angle" },
  });
  return args.outPng;
}

export async function renderQuoteOverlay(args: {
  quote: string;
  highlights?: string[];
  outPath: string;
  durationSec: number;
  width?: number;
  height?: number;
}): Promise<string> {
  const { selectComposition, renderMedia, ensureBrowser } = await import(
    "@remotion/renderer"
  );
  await ensureBrowser();
  const serveUrl = await getServeUrl();
  const width = args.width ?? 1920;
  const height = args.height ?? 1080;
  const durationInFrames = Math.max(1, Math.round(args.durationSec * 30));
  const inputProps = {
    quote: args.quote,
    highlights: args.highlights ?? [],
    durationInFrames,
    width,
    height,
  };
  const composition = await selectComposition({
    serveUrl,
    id: "QuoteOverlay",
    inputProps,
  });
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: "vp8",
    pixelFormat: "yuva420p",
    imageFormat: "png", // required for transparent (alpha) renders
    outputLocation: args.outPath,
    chromiumOptions: { gl: "angle" },
  });
  return args.outPath;
}
