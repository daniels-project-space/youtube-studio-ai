/**
 * Universal thumbnail renderer.
 *
 * The image provider owns pixels only. It never receives headline, badge, or
 * channel-name strings and is always called with `allowText:false`. Exact type
 * is applied locally, so provider routing cannot change spelling, layout, or
 * the channel's typography contract.
 */
import { basename, extname, join } from "node:path";
import { writeFile } from "node:fs/promises";
import { thumbnailText, type ThumbnailTextObject } from "@/lib/ffmpeg";
import type { ThumbnailHeadlineLine, ThumbnailTextZone } from "@/lib/thumbnailLayout";

export type ThumbnailFont = "serif" | "sans" | "impact" | "marker" | "bebas" | "rounded";
export type ThumbnailTreatment = "plate" | "sticker" | "stamp" | "neon" | "clean";

export interface ThumbnailSceneSpec {
  /** Physical scene description only. Never put headline or badge copy here. */
  description: string;
  imageStyle?: string;
  palette?: string[];
  accentColor?: string;
  composition?: string;
  textZone: ThumbnailTextZone;
  visualAvoid?: string[];
}

export interface ThumbnailTypographySpec {
  lines: ThumbnailHeadlineLine[];
  subtitle?: string;
  footerLabel?: string;
  badgePlacement?: "bottomCenter" | "topRight";
  font?: ThumbnailFont;
  uppercase?: boolean;
  treatment?: ThumbnailTreatment;
  /** Style-DNA physical-design motif rendered by the local compositor. */
  textObject?: ThumbnailTextObject;
  textColor?: string;
  baseColor?: string;
  accentColor?: string;
  badgeStyle?: "center" | "pill";
}

export interface ThumbnailRenderSpec {
  scene: ThumbnailSceneSpec;
  typography: ThumbnailTypographySpec;
}

/**
 * A general video frame is not automatically a thumbnail base. Reuse is
 * allowed only when its producer explicitly proves both invariants below.
 */
export interface ThumbnailBaseProvenance {
  contract: "thumbnail-base-v1";
  textFree: true;
  safeZone: ThumbnailTextZone;
  source: "generated-thumbnail-scene" | "verified-video-still";
}

export interface ThumbnailBaseArtifact {
  path: string;
  provenance?: unknown;
}

export interface ThumbnailImageRequest {
  prompt: string;
  allowText: false;
  tier: "flash";
  aspectRatio: "16:9";
}

export type GenerateScene = (request: ThumbnailImageRequest) => Promise<Buffer>;
type CompositeTypography = typeof thumbnailText;

export function isThumbnailBaseProvenance(
  value: unknown,
  requestedZone?: ThumbnailTextZone,
): value is ThumbnailBaseProvenance {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<ThumbnailBaseProvenance>;
  return p.contract === "thumbnail-base-v1" &&
    p.textFree === true &&
    (p.source === "generated-thumbnail-scene" || p.source === "verified-video-still") &&
    typeof p.safeZone === "string" &&
    (requestedZone === undefined || p.safeZone === requestedZone);
}

/** Build the provider request from a scene-only type. Typography has no route
 * into this function, so copy isolation is structural rather than heuristic. */
export function buildThumbnailImageRequest(scene: ThumbnailSceneSpec): ThumbnailImageRequest {
  const zone = scene.textZone;
  const prompt = [
    "1280x720 YouTube thumbnail base art",
    scene.imageStyle ? `Signature visual style: ${scene.imageStyle}` : "Premium cinematic editorial artwork",
    scene.palette?.length ? `Palette: ${scene.palette.join(" / ")}` : "",
    scene.accentColor ? `Accent color: ${scene.accentColor}` : "",
    `Physical scene: ${scene.description}`,
    scene.composition ? `Composition: ${scene.composition}` : "",
    `Put the dominant hero on the side opposite the ${zone} safe zone, filling 55-70% of the frame`,
    `Keep the ${zone} 42% darker, simple, and genuinely empty for a later local overlay`,
    "The scene alone must communicate the subject at phone size; use at most three visual elements",
    scene.visualAvoid?.length ? `Avoid: ${scene.visualAvoid.join("; ")}` : "",
    "No textual props or writing surfaces: no text, letters, words, numbers, signs, labels, newspapers, posters, logos, badges, UI, or watermark",
  ].filter(Boolean).join(". ");

  return { prompt, allowText: false, tier: "flash", aspectRatio: "16:9" };
}

export async function renderThumbnail(args: {
  spec: ThumbnailRenderSpec;
  outJpg: string;
  tmpDir: string;
  baseArt?: ThumbnailBaseArtifact;
  generateScene?: GenerateScene;
  compositeTypography?: CompositeTypography;
}): Promise<{
  path: string;
  basePath: string;
  baseSource: "generated" | "reused";
  request?: ThumbnailImageRequest;
}> {
  const compositeTypography = args.compositeTypography ?? thumbnailText;
  const reusable = args.baseArt &&
    isThumbnailBaseProvenance(args.baseArt.provenance, args.spec.scene.textZone);

  let basePath: string;
  let request: ThumbnailImageRequest | undefined;
  if (reusable) {
    basePath = args.baseArt!.path;
  } else {
    if (!args.generateScene) {
      throw new Error("thumbnailRenderer: an explicit production image generator is required");
    }
    request = buildThumbnailImageRequest(args.spec.scene);
    const extension = extname(args.outJpg);
    const stem = basename(args.outJpg, extension || undefined);
    basePath = join(args.tmpDir, `${stem}.text-free-base.jpg`);
    await writeFile(basePath, await args.generateScene(request));
  }

  const type = args.spec.typography;
  await compositeTypography({
    basePath,
    outJpg: args.outJpg,
    title: type.lines.map((line) => line.text).join(" "),
    lines: type.lines,
    position: args.spec.scene.textZone,
    subtitle: type.subtitle,
    footerLabel: type.footerLabel,
    badgePlacement: type.badgePlacement,
    textColor: type.textColor,
    baseColor: type.baseColor,
    accentColor: type.accentColor,
    badgeStyle: type.badgeStyle,
    font: type.font,
    uppercase: type.uppercase,
    treatment: type.treatment,
    textObject: type.textObject,
  });

  return {
    path: args.outJpg,
    basePath,
    baseSource: reusable ? "reused" : "generated",
    ...(request ? { request } : {}),
  };
}
