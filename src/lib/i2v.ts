/**
 * Single AI-video runtime seam.
 *
 * Novita LTX remains the default sealed production path.  The only additional
 * route is an explicit OpenRelay MiniMax H3 request: it has its own fixed,
 * receipt-backed A100 profile and cannot be selected accidentally as a
 * substitute for LTX.  Fal/Salad/Higgsfield fallbacks remain rejected before
 * paid work starts.
 */
import { createHash } from "node:crypto";
import { renderNovitaI2V, type NovitaRenderLifecycle } from "@/lib/novitaMedia";
import { renderOpenRelayH3I2V } from "@/lib/openRelayH3I2v";
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
  if (req.provider && req.provider !== "novita" && req.provider !== "novita-ltx" && req.provider !== "openrelay-h3") {
    throw new Error(`i2v: provider ${JSON.stringify(req.provider)} is retired; select Novita LTX or the explicit OpenRelay H3 route`);
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
  if (req.provider === "openrelay-h3") {
    if (!req.imageKey || req.imageUrl) {
      throw new Error("i2v: OpenRelay H3 requires one existing R2 first-frame key, not a remote image URL");
    }
    if (req.endImageKey || endImageUrl || req.negativePrompt || req.motionPrompt || req.cameraMove ||
      req.cameraInstruction || req.shotScale || req.lens || req.styleId || req.creativeAdapter) {
      throw new Error("i2v: OpenRelay H3 only admits its exact first-frame Turbo8 contract; unsupported LTX controls are not silently dropped");
    }
    const identity = createHash("sha256")
      .update(req.runId ?? "shared")
      .update("\0")
      .update(req.prompt)
      .update("\0")
      .update(req.imageKey)
      .digest("hex")
      .slice(0, 20);
    const result = await renderOpenRelayH3I2V({
      prefix: `${(req.keyPrefix ?? "youtube-studio").replace(/\/$/, "")}/runs/${req.runId ?? "shared"}/i2v`,
      id: `clip-${identity}`,
      prompt: req.prompt,
      imageKey: req.imageKey,
      durationSec: req.durationSec,
      aspectRatio: req.aspectRatio,
      maxCostUsd: req.maxCostUsd,
    });
    req.log?.(`i2v: OpenRelay MiniMax H3 ${result.jobId} ${result.reused ? "reused" : "accepted"}`);
    return result;
  }
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
