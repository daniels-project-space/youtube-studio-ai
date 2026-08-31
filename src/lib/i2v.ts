/**
 * Single AI-video runtime seam.
 *
 * Provider routing is intentionally not configurable: every generated clip is
 * submitted to the authenticated Novita spot render farm and the farm attests
 * the pinned local-disk LTX contract before output is accepted. Legacy
 * Fal/Salad/Higgsfield fallbacks are rejected before paid work starts.
 */
import { createHash } from "node:crypto";
import { renderNovitaI2V, type NovitaRenderLifecycle } from "@/lib/novitaMedia";
import type { LtxCreativeAdapterInput } from "@/lib/ltxCreativeAdapter";
import type { CameraMove, ShotScale } from "@/lib/novitaRenderFarm";

export interface I2VRequest {
  prompt: string;
  imageUrl?: string;
  imageKey?: string;
  /** Exact first/last-frame conditioning now supported by the sealed LTX worker. */
  endImageUrl?: string;
  endImageKey?: string;
  /** @deprecated Use endImageUrl; retained as an input alias for older callers. */
  tailImageUrl?: string;
  durationSec?: number;
  aspectRatio?: string;
  negativePrompt?: string;
  /** Independent action/particle direction for the I2V contract. */
  motionPrompt?: string;
  cameraMove?: CameraMove;
  /** Concrete source-grounded camera path, preserving real depth/parallax. */
  cameraInstruction?: string;
  shotScale?: ShotScale;
  lens?: string;
  /** Optional LTX visual-treatment preset; defaults are resolved by the sealed I2V contract. */
  styleId?: string;
  model?: string;
  provider?: string;
  runId?: string;
  keyPrefix?: string;
  /** Conservative signed envelope for the one direct Novita video worker. */
  maxCostUsd: number;
  lifecycle?: NovitaRenderLifecycle;
  /** Optional exact-base/benchmarked LTX adapter for this I2V shot. */
  creativeAdapter?: LtxCreativeAdapterInput;
  log?: (message: string) => void;
}

export interface I2VResult {
  url: string;
  jobId: string;
  model: string;
  key: string;
  costUsd: number;
}

export async function generateI2V(req: I2VRequest): Promise<I2VResult> {
  if (req.provider && req.provider !== "novita" && req.provider !== "novita-ltx") {
    throw new Error(`i2v: provider ${JSON.stringify(req.provider)} is retired; Novita LTX is mandatory`);
  }
  if (req.endImageUrl && req.tailImageUrl) {
    throw new Error("i2v: supply only one of endImageUrl or the legacy tailImageUrl alias");
  }
  const endImageUrl = req.endImageUrl ?? req.tailImageUrl;
  if (req.endImageKey && endImageUrl) {
    throw new Error("i2v: supply only one of endImageKey or endImageUrl");
  }
  if (req.aspectRatio && req.aspectRatio !== "16:9") {
    throw new Error(`i2v: aspect ratio ${JSON.stringify(req.aspectRatio)} is not covered by the pinned Novita production profile`);
  }
  if (!req.prompt.trim()) throw new Error("i2v: prompt is required");
  const imageIdentity = req.imageKey ?? req.imageUrl ?? "";
  if (!imageIdentity) throw new Error("i2v: imageKey or imageUrl is required");
  const identity = createHash("sha256")
    .update(req.runId ?? "shared")
    .update("\0")
    .update(req.prompt)
    .update("\0")
    .update(imageIdentity)
    .update("\0")
    .update(req.endImageKey ?? endImageUrl ?? "")
    .digest("hex")
    .slice(0, 20);
  const result = await renderNovitaI2V({
    prefix: `${(req.keyPrefix ?? "youtube-studio").replace(/\/$/, "")}/runs/${req.runId ?? "shared"}/novita-i2v`,
    id: `clip-${identity}`,
    prompt: req.prompt,
    imageKey: req.imageKey,
    imageUrl: req.imageKey ? undefined : req.imageUrl,
    endImageKey: req.endImageKey,
    endImageUrl,
    durationSec: req.durationSec,
    negativePrompt: req.negativePrompt,
    motionPrompt: req.motionPrompt,
    cameraMove: req.cameraMove,
    cameraInstruction: req.cameraInstruction,
    shotScale: req.shotScale,
    lens: req.lens,
    styleId: req.styleId,
    profileId: "production",
    creativeAdapter: req.creativeAdapter,
    maxCostUsd: req.maxCostUsd,
    lifecycle: req.lifecycle,
  });
  req.log?.(`i2v: Novita LTX-2.5 distilled x2 ${result.jobId} accepted`);
  return result;
}
