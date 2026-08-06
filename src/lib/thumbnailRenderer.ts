/**
 * Universal thumbnail renderer.
 *
 * The image provider owns pixels only. It never receives headline, badge, or
 * channel-name strings and is always called with `allowText:false`. Exact type
 * is applied locally, so switching Gemini/Fal cannot change spelling, layout,
 * or the channel's typography contract.
 */
import { basename, extname, join } from "node:path";
import { writeFile } from "node:fs/promises";
import { generateBananaImage } from "@/lib/banana";
import { thumbnailText } from "@/lib/ffmpeg";
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
  font?: ThumbnailFont;
  uppercase?: boolean;
  treatment?: ThumbnailTreatment;
  /** Rich Style-DNA name retained as provenance; rendering stays local. */
  textObject?: string;
  textColor?: string;
  accentColor?: string;
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

type GenerateScene = (request: ThumbnailImageRequest) => Promise<Buffer>;
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

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Build the provider request from scene-only fields. */
export function buildThumbnailImageRequest(spec: ThumbnailRenderSpec): ThumbnailImageRequest {
  const scene = spec.scene;
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

  // Regression alarm, not recovery: typed separation is the root fix. If a
  // future edit leaks copy across the boundary, stop before a paid request.
  const normalizedPrompt = normalized(prompt);
  // A scene can legitimately share one semantic keyword with a one-word
  // headline (for example, a scene about "taxation"). Block copied phrases
  // and every badge/subtitle instead of rejecting normal subject grounding.
  const forbiddenCopy = [
    ...spec.typography.lines
      .map((line) => normalized(line.text))
      .filter((copy) => copy.split(" ").length >= 2),
    normalized(spec.typography.subtitle ?? ""),
  ].filter((copy) => copy.length >= 3);
  for (const copy of forbiddenCopy) {
    if (normalizedPrompt.includes(copy)) {
      throw new Error(`thumbnail renderer: typography leaked into scene prompt (${copy})`);
    }
  }

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
  const generateScene = args.generateScene ?? generateBananaImage;
  const compositeTypography = args.compositeTypography ?? thumbnailText;
  const reusable = args.baseArt &&
    isThumbnailBaseProvenance(args.baseArt.provenance, args.spec.scene.textZone);

  let basePath: string;
  let request: ThumbnailImageRequest | undefined;
  if (reusable) {
    basePath = args.baseArt!.path;
  } else {
    request = buildThumbnailImageRequest(args.spec);
    const extension = extname(args.outJpg);
    const stem = basename(args.outJpg, extension || undefined);
    basePath = join(args.tmpDir, `${stem}.text-free-base.jpg`);
    await writeFile(basePath, await generateScene(request));
  }

  const type = args.spec.typography;
  await compositeTypography({
    basePath,
    outJpg: args.outJpg,
    title: type.lines.map((line) => line.text).join(" "),
    lines: type.lines,
    position: args.spec.scene.textZone,
    subtitle: type.subtitle,
    textColor: type.textColor,
    accentColor: type.accentColor,
    font: type.font,
    uppercase: type.uppercase,
    treatment: type.treatment,
  });

  return {
    path: args.outJpg,
    basePath,
    baseSource: reusable ? "reused" : "generated",
    ...(request ? { request } : {}),
  };
}
