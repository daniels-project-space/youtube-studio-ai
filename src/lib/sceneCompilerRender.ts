import path from "node:path";
import type { SceneManifest } from "@/engine/episodeGraph";
import {
  SCENE_COMPILER_COMPOSITION_ID,
  type SceneCompilerProps,
  sceneManifestMetadata,
} from "@/remotion/sceneCompiler/SceneCompiler";

export interface RenderSceneManifestArgs {
  manifest: SceneManifest;
  outPath: string;
  width?: number;
  height?: number;
  log?: (message: string) => void;
  concurrency?: number;
}

let sceneCompilerServeUrl: Promise<string> | undefined;

function assertSixteenByNine(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Scene compiler width and height must be positive finite values.");
  }
  if (Math.abs(width / height - 16 / 9) > 0.001) {
    throw new Error(`Scene compiler requires a 16:9 frame; received ${width}x${height}.`);
  }
}

export async function getSceneCompilerServeUrl(): Promise<string> {
  if (!sceneCompilerServeUrl) {
    sceneCompilerServeUrl = (async () => {
      const { bundle } = await import("@remotion/bundler");
      return bundle({
        entryPoint: path.join(process.cwd(), "src/remotion/sceneCompiler/index.ts"),
      });
    })();
  }
  return sceneCompilerServeUrl;
}

/**
 * Renders a validated scene manifest locally through Remotion. This function has
 * no model, storage, network-provider, or publishing side effects.
 */
export async function renderSceneManifest(args: RenderSceneManifestArgs): Promise<string> {
  const width = args.width ?? 1920;
  const height = args.height ?? 1080;
  assertSixteenByNine(width, height);
  if (!args.outPath.trim()) throw new Error("Scene compiler render requires an output path.");
  if (!args.manifest.scenes.length) throw new Error("Scene compiler render requires at least one scene.");

  const { selectComposition, renderMedia, ensureBrowser } = await import("@remotion/renderer");
  await ensureBrowser();
  const serveUrl = await getSceneCompilerServeUrl();
  const inputProps = {
    manifest: args.manifest,
    width,
    height,
  } satisfies SceneCompilerProps;
  const composition = await selectComposition({
    serveUrl,
    id: SCENE_COMPILER_COMPOSITION_ID,
    inputProps,
  });
  const metadata = sceneManifestMetadata(args.manifest, width, height);
  let lastPct = -10;

  await renderMedia({
    serveUrl,
    composition: { ...composition, ...metadata },
    inputProps,
    codec: "h264",
    outputLocation: args.outPath,
    chromiumOptions: { gl: "angle" },
    ...(args.concurrency ? { concurrency: args.concurrency } : {}),
    onProgress: ({ progress }) => {
      const pct = Math.round(progress * 100);
      if (pct >= lastPct + 10) {
        lastPct = pct;
        args.log?.(`scene-compiler render ${pct}%`);
      }
    },
  });
  return args.outPath;
}
