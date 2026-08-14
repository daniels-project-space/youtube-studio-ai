import type { FC } from "react";
import { Composition } from "remotion";
import type { SceneManifest } from "@/engine/episodeGraph";
import {
  SCENE_COMPILER_COMPOSITION_ID,
  SceneCompiler,
  type SceneCompilerProps,
  sceneManifestMetadata,
} from "./SceneCompiler";

// The bundle only needs a shape-safe default to register its composition. Real renders
// receive a validated SceneManifest through renderSceneManifest().
const DEFAULT_MANIFEST = {
  version: "scene-manifest/v1",
  durationSec: 1,
  scenes: [],
} as unknown as SceneManifest;

export const SceneCompilerRoot: FC = () => (
  <Composition
    id={SCENE_COMPILER_COMPOSITION_ID}
    component={SceneCompiler}
    durationInFrames={30}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={{ manifest: DEFAULT_MANIFEST, width: 1920, height: 1080 } as SceneCompilerProps}
    calculateMetadata={({ props }) => {
      const renderProps = props as unknown as SceneCompilerProps;
      return {
        ...sceneManifestMetadata(renderProps.manifest, renderProps.width ?? 1920, renderProps.height ?? 1080),
        props,
      };
    }}
  />
);
