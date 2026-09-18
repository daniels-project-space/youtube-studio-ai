/**
 * Single AI-video runtime seam.
 *
 * Provider routing is intentionally not configurable: every generated clip is
 * submitted to the authenticated Novita MiniMax H3 route and the worker
 * attests the pinned R2 model manifest before output is accepted. Legacy
 * Fal/Salad/Higgsfield and direct-LTX fallbacks are rejected before paid work
 * starts.
 */
import { createHash } from "node:crypto";
import type { CameraMove, ShotScale } from "@/lib/novitaRenderFarm";
import {
  MINIMAX_H3_PROFILE,
  MINIMAX_H3_RUNTIME_ID,
  renderMiniMaxH3,
} from "@/lib/minimaxH3";
import { sha256BytesHex } from "@/lib/sha256";
import { getObjectBytes, presignDownload } from "@/lib/storage";

export interface I2VRequest {
  prompt: string;
  imageUrl?: string;
  imageKey?: string;
  /** Retained input shape for migration; MiniMax H3 supports one accepted opening frame. */
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
  /** Retained input shape for migration; MiniMax H3 does not accept a legacy style adapter. */
  styleId?: string;
  model?: string;
  provider?: string;
  runId?: string;
  keyPrefix?: string;
  /** Conservative signed envelope for the one direct Novita video worker. */
  maxCostUsd: number;
  /** Retained input shape for migration; MiniMax H3 does not accept a legacy adapter. */
  /** Retained only to give old callers a precise migration error. */
  creativeAdapter?: unknown;
  log?: (message: string) => void;
}

export interface I2VResult {
  url: string;
  jobId: string;
  model: string;
  key: string;
  costUsd: number;
  /** Exact receipt-validated bytes, avoiding a second R2 download by the Forge. */
  outputBytes: Uint8Array;
}

export async function generateI2V(req: I2VRequest): Promise<I2VResult> {
  if (req.provider && req.provider !== "novita") {
    throw new Error(`i2v: provider ${JSON.stringify(req.provider)} is retired; Novita MiniMax H3 is mandatory`);
  }
  if (req.endImageUrl && req.tailImageUrl) {
    throw new Error("i2v: supply only one of endImageUrl or the legacy tailImageUrl alias");
  }
  const endImageUrl = req.endImageUrl ?? req.tailImageUrl;
  if (req.endImageKey && endImageUrl) {
    throw new Error("i2v: supply only one of endImageKey or endImageUrl");
  }
  if (req.endImageKey || endImageUrl || req.styleId || req.creativeAdapter) {
    throw new Error(
      "i2v: terminal-frame, style, and adapter controls belong to the retired video path; MiniMax H3 accepts only the reviewed opening frame",
    );
  }
  if (req.aspectRatio && req.aspectRatio !== "16:9") {
    throw new Error(`i2v: aspect ratio ${JSON.stringify(req.aspectRatio)} is not covered by the pinned Novita production profile`);
  }
  if (!req.prompt.trim()) throw new Error("i2v: prompt is required");
  if (req.imageUrl && !req.imageKey) {
    throw new Error("i2v: MiniMax H3 requires an immutable R2 imageKey, not an external image URL");
  }
  const imageKey = req.imageKey;
  if (!imageKey) throw new Error("i2v: imageKey is required");
  const nativeDurationSec = MINIMAX_H3_PROFILE.frames / MINIMAX_H3_PROFILE.fps;
  if (
    req.durationSec !== undefined &&
    (!Number.isFinite(req.durationSec) || Math.abs(req.durationSec - nativeDurationSec) > 0.25)
  ) {
    throw new Error(`i2v: MiniMax H3 emits a native ${nativeDurationSec.toFixed(2)}s take; requested duration is not admissible`);
  }
  const identity = createHash("sha256")
    .update(req.runId ?? "shared")
    .update("\0")
    .update(req.prompt)
    .update("\0")
    .update(imageKey)
    .update("\0")
    .update(MINIMAX_H3_RUNTIME_ID)
    .digest("hex")
    .slice(0, 20);
  const firstFrame = await getObjectBytes(imageKey);
  const seed = Number.parseInt(identity.slice(0, 8), 16) % 2_147_483_647;
  const prompt = [
    req.prompt.trim(),
    req.motionPrompt?.trim(),
    req.cameraInstruction?.trim(),
    req.cameraMove ? `Camera move: ${req.cameraMove}.` : "",
    req.shotScale ? `Shot scale: ${req.shotScale}.` : "",
    req.lens ? `Lens: ${req.lens}.` : "",
    req.negativePrompt?.trim() ? `Avoid: ${req.negativePrompt.trim()}.` : "",
  ].filter(Boolean).join("\n");
  const keyPrefix = (req.keyPrefix ?? "youtube-studio").replace(/\/$/, "");
  const outputKey = `${keyPrefix}/runs/${req.runId ?? "shared"}/minimax-h3-i2v/clip-${identity}.mp4`;
  const result = await renderMiniMaxH3({
    provider: "novita",
    execution: "on-demand",
    prompt,
    seed,
    firstFrame: { r2Key: imageKey, sha256: sha256BytesHex(firstFrame) },
    output: { r2Key: outputKey },
    maxCostUsd: req.maxCostUsd,
  });
  const url = await presignDownload(result.receipt.output.r2Key);
  req.log?.(`i2v: Novita MiniMax H3 ${result.receipt.jobId} accepted`);
  return {
    url,
    jobId: result.receipt.jobId,
    model: MINIMAX_H3_RUNTIME_ID,
    key: result.receipt.output.r2Key,
    costUsd: result.receipt.runtime.costUsd,
    outputBytes: result.outputBytes,
  };
}
