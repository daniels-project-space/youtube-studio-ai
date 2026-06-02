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
  const inputProps = {
    title: args.title,
    subtitle: args.subtitle ?? "",
    palette: args.palette ?? [],
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
    outputLocation: args.outPath,
    chromiumOptions: { gl: "angle" },
  });
  return args.outPath;
}
