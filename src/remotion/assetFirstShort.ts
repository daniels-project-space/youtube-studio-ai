/**
 * A reusable contract for short-form editorial collage.  Every visible object
 * has an owner scene and a declared role, so a render cannot silently devolve
 * into a single generated backdrop with generic overlays.
 */
export type AssetFirstLayerRole =
  | "setting"
  | "hero"
  | "evidence"
  | "prop"
  | "type"
  | "texture";

export type AssetFirstAsset = {
  id: string;
  ownerSceneId: string;
  role: AssetFirstLayerRole;
  /** Relative to Remotion's public directory when a raster asset is used. */
  file?: string;
  provenance: "generated-original" | "licensed-editorial" | "procedural";
  purpose: string;
  layer: number;
};

export type AssetFirstSceneBoard = {
  id: string;
  startFrame: number;
  durationInFrames: number;
  narration: string;
  claim: string;
  visualVerb: string;
  caption: string;
  soundCue: string;
  assets: readonly AssetFirstAsset[];
};

export type AssetFirstShortBoard = {
  id: string;
  fps: number;
  durationInFrames: number;
  worldAnchor: {
    palette: string;
    treatment: readonly string[];
    continuity: string;
  };
  scenes: readonly AssetFirstSceneBoard[];
};
