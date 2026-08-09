import { execFile } from "node:child_process";

import type { ThumbnailTextZone } from "@/lib/thumbnailLayout";

export const GOLDEN_THUMBNAIL_TEXT_ZONE_CONTRACT =
  "golden-thumbnail-text-zone/v1" as const;

export type GoldenThumbnailTextZone = Extract<
  ThumbnailTextZone,
  "left" | "right" | "upperLeft" | "upperRight"
>;

export interface ThumbnailZoneRegionEvidence {
  zone: GoldenThumbnailTextZone;
  /** Mean 8-bit luminance in the typography footprint. */
  meanLuma: number;
  /** Share of pixels bright enough to compete with white/gold headline type. */
  brightFraction: number;
  /** Normalized texture/edge score; 0 is flat negative space and 1 is very busy. */
  occupancy: number;
  /** Combined light-and-clutter risk; lower is safer for Golden typography. */
  risk: number;
}

export interface ThumbnailTextZoneResolution {
  contract: typeof GOLDEN_THUMBNAIL_TEXT_ZONE_CONTRACT;
  requestedZone: ThumbnailTextZone;
  resolvedZone: ThumbnailTextZone;
  changed: boolean;
  reason:
    | "safer-negative-space"
    | "requested-zone-preserved"
    | "unsupported-requested-zone"
    | "trusted-safe-zone-provenance";
  /** Requested risk minus resolved risk. Zero when no correction was made. */
  riskImprovement: number;
  regions: ThumbnailZoneRegionEvidence[];
}

const ANALYSIS_WIDTH = 160;
const ANALYSIS_HEIGHT = 90;
const CANDIDATE_ZONES: readonly GoldenThumbnailTextZone[] = [
  "left",
  "right",
  "upperLeft",
  "upperRight",
];

type FractionalRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** These footprints mirror the practical headline areas, with the outer 4%
 * excluded so a bright rim at the crop edge cannot move the entire layout. */
const REGION_RECTS: Record<GoldenThumbnailTextZone, FractionalRect> = {
  left: { x: 0.04, y: 0.12, width: 0.4, height: 0.76 },
  right: { x: 0.56, y: 0.12, width: 0.4, height: 0.76 },
  upperLeft: { x: 0.04, y: 0.06, width: 0.45, height: 0.5 },
  upperRight: { x: 0.51, y: 0.06, width: 0.45, height: 0.5 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function isCandidateZone(zone: ThumbnailTextZone): zone is GoldenThumbnailTextZone {
  return CANDIDATE_ZONES.includes(zone as GoldenThumbnailTextZone);
}

function scoreRegion(args: {
  luma: Uint8Array;
  width: number;
  height: number;
  zone: GoldenThumbnailTextZone;
}): ThumbnailZoneRegionEvidence {
  const rect = REGION_RECTS[args.zone];
  const x0 = clamp(Math.floor(args.width * rect.x), 0, args.width - 1);
  const y0 = clamp(Math.floor(args.height * rect.y), 0, args.height - 1);
  const x1 = clamp(Math.ceil(args.width * (rect.x + rect.width)), x0 + 1, args.width);
  const y1 = clamp(Math.ceil(args.height * (rect.y + rect.height)), y0 + 1, args.height);

  let count = 0;
  let sum = 0;
  let sumSquares = 0;
  let bright = 0;
  let edgeSum = 0;
  let edgeCount = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const index = y * args.width + x;
      const value = args.luma[index] ?? 0;
      count += 1;
      sum += value;
      sumSquares += value * value;
      if (value >= 190) bright += 1;
      if (x + 1 < x1) {
        edgeSum += Math.abs(value - (args.luma[index + 1] ?? value));
        edgeCount += 1;
      }
      if (y + 1 < y1) {
        edgeSum += Math.abs(value - (args.luma[index + args.width] ?? value));
        edgeCount += 1;
      }
    }
  }

  const meanLuma = sum / count;
  const variance = Math.max(0, sumSquares / count - meanLuma * meanLuma);
  const standardDeviation = Math.sqrt(variance);
  const edgeEnergy = edgeCount ? edgeSum / edgeCount : 0;
  const brightFraction = bright / count;
  const occupancy = clamp(
    0.55 * clamp(standardDeviation / 72, 0, 1) +
      0.45 * clamp(edgeEnergy / 54, 0, 1),
    0,
    1,
  );
  const risk = clamp(
    0.5 * (meanLuma / 255) + 0.2 * brightFraction + 0.3 * occupancy,
    0,
    1,
  );

  return {
    zone: args.zone,
    meanLuma: rounded(meanLuma),
    brightFraction: rounded(brightFraction),
    occupancy: rounded(occupancy),
    risk: rounded(risk),
  };
}

/**
 * Resolve a Golden typography zone from an already-decoded luminance frame.
 * A move requires a substantial overall risk improvement plus a visible
 * brightness or occupancy improvement. Small scoring differences therefore
 * cannot make an otherwise stable composition jump between regions.
 */
export function resolveGoldenThumbnailTextZone(args: {
  luma: Uint8Array;
  width: number;
  height: number;
  requestedZone: ThumbnailTextZone;
}): ThumbnailTextZoneResolution {
  if (!Number.isInteger(args.width) || !Number.isInteger(args.height) ||
      args.width < 2 || args.height < 2) {
    throw new Error("thumbnail safe-zone analysis requires positive integer dimensions");
  }
  if (args.luma.length !== args.width * args.height) {
    throw new Error(
      `thumbnail safe-zone luma length mismatch: expected ${args.width * args.height}, ` +
      `received ${args.luma.length}`,
    );
  }

  const regions = CANDIDATE_ZONES.map((zone) => scoreRegion({ ...args, zone }));
  if (!isCandidateZone(args.requestedZone)) {
    return {
      contract: GOLDEN_THUMBNAIL_TEXT_ZONE_CONTRACT,
      requestedZone: args.requestedZone,
      resolvedZone: args.requestedZone,
      changed: false,
      reason: "unsupported-requested-zone",
      riskImprovement: 0,
      regions,
    };
  }

  const requested = regions.find((region) => region.zone === args.requestedZone)!;
  const safest = regions.reduce((best, region) =>
    region.risk < best.risk ? region : best,
  requested);
  const riskImprovement = requested.risk - safest.risk;
  const brightnessImprovement = requested.meanLuma - safest.meanLuma;
  const occupancyImprovement = requested.occupancy - safest.occupancy;
  const clearlySafer =
    safest.zone !== requested.zone &&
    riskImprovement >= 0.16 &&
    safest.meanLuma <= 175 &&
    safest.occupancy <= 0.62 &&
    (brightnessImprovement >= 28 || occupancyImprovement >= 0.18);

  return {
    contract: GOLDEN_THUMBNAIL_TEXT_ZONE_CONTRACT,
    requestedZone: args.requestedZone,
    resolvedZone: clearlySafer ? safest.zone : args.requestedZone,
    changed: clearlySafer,
    reason: clearlySafer ? "safer-negative-space" : "requested-zone-preserved",
    riskImprovement: clearlySafer ? rounded(riskImprovement) : 0,
    regions,
  };
}

/** Decode a tiny, canonical grayscale frame before local typography. */
export async function resolveGoldenThumbnailTextZoneFromImage(args: {
  imagePath: string;
  requestedZone: ThumbnailTextZone;
}): Promise<ThumbnailTextZoneResolution> {
  const ffmpeg = process.env.FFMPEG_BIN ?? "ffmpeg";
  const luma = await new Promise<Buffer>((resolve, reject) => {
    execFile(
      ffmpeg,
      [
        "-v", "error",
        "-i", args.imagePath,
        "-vf",
        `scale=${ANALYSIS_WIDTH}:${ANALYSIS_HEIGHT}:force_original_aspect_ratio=increase,` +
          `crop=${ANALYSIS_WIDTH}:${ANALYSIS_HEIGHT},format=gray`,
        "-frames:v", "1",
        "-f", "rawvideo",
        "-pix_fmt", "gray",
        "-",
      ],
      { encoding: null, maxBuffer: 256 * 1024, timeout: 30_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(
            `thumbnail safe-zone decode failed: ${String(stderr).slice(-500) || error.message}`,
          ));
          return;
        }
        resolve(stdout);
      },
    );
  });
  if (luma.length !== ANALYSIS_WIDTH * ANALYSIS_HEIGHT) {
    throw new Error(
      `thumbnail safe-zone decoder returned ${luma.length} bytes; expected ` +
      `${ANALYSIS_WIDTH * ANALYSIS_HEIGHT}`,
    );
  }
  return resolveGoldenThumbnailTextZone({
    luma,
    width: ANALYSIS_WIDTH,
    height: ANALYSIS_HEIGHT,
    requestedZone: args.requestedZone,
  });
}

export function trustedThumbnailTextZoneResolution(
  zone: ThumbnailTextZone,
): ThumbnailTextZoneResolution {
  return {
    contract: GOLDEN_THUMBNAIL_TEXT_ZONE_CONTRACT,
    requestedZone: zone,
    resolvedZone: zone,
    changed: false,
    reason: "trusted-safe-zone-provenance",
    riskImprovement: 0,
    regions: [],
  };
}
