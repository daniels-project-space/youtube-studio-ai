/**
 * Lo-Fi thumbnail contract.
 *
 * Lo-Fi uses the exact 15-second frame from its finished 4K moving world as a
 * Nano Banana reference edit. This is an isolated side lane: it reads the
 * normal thumbnail playbook but never mutates or replaces its configuration.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  grabFrame,
  imageToJpeg,
  imageRegionLuma,
  measureImageRegionSsim,
  measureImageRegionUniformity,
  probe,
  solidImage,
} from "@/lib/ffmpeg";

export const LOFI_RENDER_THUMBNAIL_CONTRACT = {
  version: "lofi-nano-banana-reference-thumbnail/v1",
  route: "nano-banana-lofi-video-reference",
  minimumWidth: 3_840,
  minimumHeight: 2_160,
  outputWidth: 1_280,
  outputHeight: 720,
  badge: "4K",
  typographyMatteColor: "#00ff00",
  minimumTypographyMatteUniformity: 0.98,
  /** Outside the provider-rendered bottom-right emblem, the video frame is immutable. */
  minimumBackgroundSsim: 0.995,
} as const;

export type LofiThumbnailReference = Readonly<{
  baseFramePath: string;
  referenceFramePath: string;
  referenceImage: Buffer;
  typographyMattePath: string;
  typographyMatteImage: Buffer;
  typographyMatteSha256: string;
  badgeTone: "black" | "white";
  sourceFrameTimeSec: number;
  sourceWidth: number;
  sourceHeight: number;
  sourceFrameSha256: string;
}>;

export function lofiNanoBananaEditPrompt(args: {
  visualLanguage?: unknown;
  priorIssues?: readonly string[];
  badgeTone?: "black" | "white";
}): string {
  const style = args.visualLanguage && typeof args.visualLanguage === "object"
    ? JSON.stringify(args.visualLanguage).slice(0, 1_200)
    : "rounded, atmospheric, restrained Lo-Fi thumbnail typography";
  const corrections = (args.priorIssues ?? []).map((issue) => issue.trim()).filter(Boolean).slice(0, 5);
  const badgeTone = args.badgeTone ?? "black";
  const badgeOutline = badgeTone === "black" ? "white" : "black";
  return [
    "Typography-overlay task with two attached images. Image 1 is the solid chroma-green output canvas and is the only image you may edit. Image 2 is the exact video frame and is visual context only.",
    "Return Image 1 with provider-rendered lettering added. Do not reproduce, redraw, fade, wash out, or composite Image 2 into the result.",
    `Every output pixel outside the 4K emblem, its tight outline, and its tight shadow must remain exact solid ${LOFI_RENDER_THUMBNAIL_CONTRACT.typographyMatteColor}.`,
    "Do not redraw, relight, recolor, retime, restyle, sharpen, blur, crop, move, add, or remove any scene element from Image 2. Day must remain day; night must remain night.",
    "Image 2 is the exact 15-second video frame. It is the finished artwork, not inspiration and not a scene to reinterpret.",
    "Add exactly one element and no others: a custom quality emblem containing exactly \"4K\" in the bottom-right corner. Nano Banana itself must render the emblem into its returned image. Do not add a headline, mood label, title, subtitle, or any other writing.",
    `For local contrast, the 4K emblem lettering must be pure ${badgeTone} with a tight pure ${badgeOutline} outline. Never use cream, beige, gold, gray, pastel, translucent, or low-contrast letter fill.`,
    `Use this read-only channel thumbnail visual language only for the emblem design: ${style}.`,
    "Golden-module symbol standard: a compact, deliberately designed 4K quality mark with crisp spacing and mobile-size legibility. A tight outline or shadow may touch the glyphs only.",
    "Never place the 4K mark on a filled rectangle, pill, card, banner, caption box, frosted-glass panel, opaque block, or semi-transparent shading block. A thin unfilled emblem keyline is allowed; plain typed text is not.",
    "Inset the bottom-right 4K emblem enough to remain legible at the edge. No logo, watermark, extra writing, fake player UI, border, arrow, sticker, or illustrated background.",
    corrections.length ? `Correct these rejected-attempt defects: ${corrections.join("; ")}.` : "",
  ].filter(Boolean).join(" ");
}

/**
 * Deterministic preservation gate for provider-rendered Lo-Fi typography.
 * Only the small bottom-right emblem zone may change; the rest must remain
 * visually identical to the exact video frame.
 */
export async function measureLofiThumbnailBackgroundSsim(args: {
  referenceFramePath: string;
  candidatePath: string;
}): Promise<number> {
  return measureImageRegionSsim(
    args.referenceFramePath,
    args.candidatePath,
    [
      { x: 0, y: 0, width: 1_280, height: 580 },
      { x: 0, y: 580, width: 1_050, height: 140 },
    ],
    { canvasWidth: 1_280, canvasHeight: 720 },
  );
}

/** The provider output must remain chroma matte outside the 4K emblem zone. */
export async function measureLofiTypographyMatteUniformity(args: {
  providerOverlayPath: string;
}): Promise<number> {
  return measureImageRegionUniformity(
    args.providerOverlayPath,
    [
      { x: 0, y: 0, width: 1_280, height: 560 },
      { x: 0, y: 560, width: 1_020, height: 160 },
    ],
  );
}

export async function prepareLofiThumbnailReference(args: {
  videoPath: string;
  tmpDir: string;
}): Promise<LofiThumbnailReference> {
  const media = await probe(args.videoPath);
  const width = media.width ?? 0;
  const height = media.height ?? 0;
  if (!media.hasVideo || !Number.isFinite(media.durationSec) || media.durationSec <= 0) {
    throw new Error("thumbnail_gen: Lo-Fi source has no valid rendered video stream");
  }
  if (
    width < LOFI_RENDER_THUMBNAIL_CONTRACT.minimumWidth ||
    height < LOFI_RENDER_THUMBNAIL_CONTRACT.minimumHeight
  ) {
    throw new Error(
      `thumbnail_gen: refusing a false 4K Lo-Fi badge for ${width}x${height} source video`,
    );
  }

  if (media.durationSec <= 15) {
    throw new Error("thumbnail_gen: Lo-Fi render is too short to sample its required 15-second reference frame");
  }
  const sourceFrameTimeSec = 15;
  const baseFramePath = join(args.tmpDir, "lofi-render-frame.jpg");
  await grabFrame(args.videoPath, sourceFrameTimeSec, baseFramePath);
  const referenceFramePath = join(args.tmpDir, "lofi-render-reference-1280.jpg");
  await imageToJpeg(baseFramePath, referenceFramePath, 1_280, 720);
  const referenceImage = await readFile(referenceFramePath);
  const sourceFrameSha256 = createHash("sha256")
    .update(referenceImage)
    .digest("hex");
  const typographyMattePath = join(args.tmpDir, "lofi-typography-matte.png");
  await solidImage(
    typographyMattePath,
    LOFI_RENDER_THUMBNAIL_CONTRACT.outputWidth,
    LOFI_RENDER_THUMBNAIL_CONTRACT.outputHeight,
    LOFI_RENDER_THUMBNAIL_CONTRACT.typographyMatteColor,
  );
  const typographyMatteImage = await readFile(typographyMattePath);
  const typographyMatteSha256 = createHash("sha256").update(typographyMatteImage).digest("hex");
  const badgeLuma = await imageRegionLuma(
    referenceFramePath,
    { x: 1_050, y: 590, width: 230, height: 130 },
  );
  if (!Number.isFinite(badgeLuma)) {
    throw new Error("thumbnail_gen: could not measure Lo-Fi frame contrast zones");
  }
  const badgeTone = badgeLuma >= 140 ? "black" : "white";
  return {
    baseFramePath,
    referenceFramePath,
    referenceImage,
    typographyMattePath,
    typographyMatteImage,
    typographyMatteSha256,
    badgeTone,
    sourceFrameTimeSec,
    sourceWidth: width,
    sourceHeight: height,
    sourceFrameSha256,
  };
}
