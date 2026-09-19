import path from "node:path";
import type { SceneManifest } from "@/engine/episodeGraph";
import {
  SCENE_COMPILER_COMPOSITION_ID,
  type SceneCompilerProps,
  sceneManifestMetadata,
} from "@/remotion/sceneCompiler/SceneCompiler";
import { preflightSceneLayout, resolveSceneLayout, type SceneLayoutProfileId } from "@/remotion/sceneCompiler/layoutProfile";

export interface RenderSceneManifestArgs {
  manifest: SceneManifest;
  outPath: string;
  width?: number;
  height?: number;
  layoutProfile?: SceneLayoutProfileId;
  /** Explicit installed browser for hermetic diagnostics; no implicit download. */
  browserExecutable?: string;
  log?: (message: string) => void;
  concurrency?: number;
}

let sceneCompilerServeUrl: Promise<string> | undefined;

export async function getSceneCompilerServeUrl(): Promise<string> {
  if (!sceneCompilerServeUrl) {
    sceneCompilerServeUrl = (async () => {
      const { bundle } = await import("@remotion/bundler");
      return bundle({
        entryPoint: path.join(process.cwd(), "src/remotion/sceneCompiler/index.ts"),
        webpackOverride: (configuration) => ({
          ...configuration,
          resolve: { ...configuration.resolve, alias: { ...configuration.resolve?.alias, "@": path.join(process.cwd(), "src") } },
        }),
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
  const layout = resolveSceneLayout(args);
  const { width, height } = layout;
  if (!args.outPath.trim()) throw new Error("Scene compiler render requires an output path.");
  if (!args.manifest.scenes.length) throw new Error("Scene compiler render requires at least one scene.");
  preflightSceneLayout(args.manifest, layout);

  const { selectComposition, renderMedia, ensureBrowser } = await import("@remotion/renderer");
  await ensureBrowser(args.browserExecutable ? { browserExecutable: args.browserExecutable } : undefined);
  const serveUrl = await getSceneCompilerServeUrl();
  const inputProps = {
    manifest: args.manifest,
    width,
    height,
    layoutProfile: layout.id,
  } satisfies SceneCompilerProps;
  const composition = await selectComposition({
    serveUrl,
    id: SCENE_COMPILER_COMPOSITION_ID,
    inputProps,
    browserExecutable: args.browserExecutable,
  });
  const metadata = sceneManifestMetadata(args.manifest, width, height);
  let lastPct = -10;

  await renderMedia({
    serveUrl,
    composition: { ...composition, ...metadata },
    inputProps,
    codec: "h264",
    outputLocation: args.outPath,
    browserExecutable: args.browserExecutable,
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
