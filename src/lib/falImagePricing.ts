/** Authoritative Fal image model routing, dimensions, and public-rate pricing. */

export const FAL_FLUX_PRO_V11_MODEL = "fal-ai/flux-pro/v1.1";
export const FAL_SCHNELL_MODEL = "fal-ai/flux/schnell";
export const FAL_KONTEXT_MODEL = "fal-ai/flux-pro/kontext";

export type FalImageRoute = "flux-pro-v1.1" | "schnell" | "kontext";

export interface FalImageDimensions {
  width: number;
  height: number;
}

export const FAL_IMAGE_PRESET_DIMENSIONS = {
  square_hd: { width: 1024, height: 1024 },
  square: { width: 512, height: 512 },
  portrait_4_3: { width: 768, height: 1024 },
  portrait_16_9: { width: 576, height: 1024 },
  landscape_4_3: { width: 1024, height: 768 },
  landscape_16_9: { width: 1024, height: 576 },
} as const;

export type FalImagePreset = keyof typeof FAL_IMAGE_PRESET_DIMENSIONS;

const PRESET_FOR_ASPECT: Readonly<Record<string, FalImagePreset>> = {
  "16:9": "landscape_16_9",
  "9:16": "portrait_16_9",
  "4:3": "landscape_4_3",
  "3:4": "portrait_4_3",
  "1:1": "square_hd",
};

function normalizedModel(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/^https:\/\/fal\.run\//, "")
    .replace(/^\/+|\/+$/g, "");
}

export function falImageRoute(model: string): FalImageRoute {
  const normalized = normalizedModel(model);
  if (normalized === FAL_SCHNELL_MODEL) return "schnell";
  if (normalized === FAL_KONTEXT_MODEL) return "kontext";
  if (normalized === FAL_FLUX_PRO_V11_MODEL) return "flux-pro-v1.1";
  throw new Error(
    `unsupported Fal image model "${model}"; add an authoritative request schema and price before enabling it`,
  );
}

export function normalizeFalAspectRatio(aspectRatio: string | undefined): string {
  const normalized = (aspectRatio ?? "16:9").trim();
  return PRESET_FOR_ASPECT[normalized] ? normalized : "16:9";
}

export function falPresetForAspect(aspectRatio: string | undefined): FalImagePreset {
  return PRESET_FOR_ASPECT[normalizeFalAspectRatio(aspectRatio)];
}

export function falDimensionsForAspect(aspectRatio: string | undefined): FalImageDimensions {
  return { ...FAL_IMAGE_PRESET_DIMENSIONS[falPresetForAspect(aspectRatio)] };
}

function rate(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
): number {
  const parsed = Number(env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function falImageRates(
  env: Readonly<Record<string, string | undefined>> = process.env,
): {
  schnellUsdPerMegapixel: number;
  kontextUsdPerImage: number;
  fluxProV11UsdPerMegapixel: number;
} {
  return {
    schnellUsdPerMegapixel: rate(env, "PRICE_FAL_SCHNELL_USD_PER_MP", 0.003),
    kontextUsdPerImage: rate(env, "PRICE_FAL_KONTEXT_USD_PER_IMAGE", 0.04),
    fluxProV11UsdPerMegapixel: rate(env, "PRICE_FAL_FLUX_PRO_USD_PER_MP", 0.04),
  };
}

export function falImageCostUsd(
  args: {
    model: string;
    width: number;
    height: number;
    images?: number;
  },
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const width = Number(args.width);
  const height = Number(args.height);
  const images = Math.max(1, Math.floor(Number(args.images ?? 1)));
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error(`Fal image pricing requires positive output dimensions, got ${width}x${height}`);
  }
  const route = falImageRoute(args.model);
  const rates = falImageRates(env);
  if (route === "kontext") return images * rates.kontextUsdPerImage;
  const megapixels = (width * height * images) / 1_000_000;
  return megapixels * (
    route === "schnell"
      ? rates.schnellUsdPerMegapixel
      : rates.fluxProV11UsdPerMegapixel
  );
}

export function selectedFalImageModel(
  args: { tier: "pro" | "flash"; hasReferences?: boolean },
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (args.hasReferences) return env.FAL_IMAGE_I2I_MODEL || FAL_KONTEXT_MODEL;
  return args.tier === "flash"
    ? env.FAL_IMAGE_MODEL_FLASH || FAL_SCHNELL_MODEL
    : env.FAL_IMAGE_MODEL || FAL_FLUX_PRO_V11_MODEL;
}

export function selectedFalImageCostUsd(
  args: {
    tier: "pro" | "flash";
    aspectRatio?: string;
    hasReferences?: boolean;
  },
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const dimensions = falDimensionsForAspect(args.aspectRatio);
  return falImageCostUsd(
    {
      model: selectedFalImageModel(args, env),
      ...dimensions,
      images: 1,
    },
    env,
  );
}

export function falFluxProV11CostUsd(
  width = 1344,
  height = 768,
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  return falImageCostUsd(
    { model: FAL_FLUX_PRO_V11_MODEL, width, height, images: 1 },
    env,
  );
}
