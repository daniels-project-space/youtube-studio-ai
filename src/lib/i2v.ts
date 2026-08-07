/**
 * Single AI-video runtime seam.
 *
 * Provider routing is intentionally not configurable: every generated clip is
 * submitted to the authenticated Novita spot render farm and the farm attests
 * the pinned local-disk LTX contract before output is accepted. Legacy
 * Fal/Salad/Higgsfield fallbacks are rejected before paid work starts.
 */
import { createHash } from "node:crypto";
import { renderNovitaI2V } from "@/lib/novitaMedia";

export interface I2VRequest {
  prompt: string;
  imageUrl?: string;
  imageKey?: string;
  tailImageUrl?: string;
  durationSec?: number;
  aspectRatio?: string;
  negativePrompt?: string;
  model?: string;
  provider?: string;
  runId?: string;
  keyPrefix?: string;
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
  if (req.tailImageUrl) {
    throw new Error("i2v: first/last-frame provider fallback is retired; use the Novita clip plus deterministic loop assembly");
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
    .digest("hex")
    .slice(0, 20);
  const result = await renderNovitaI2V({
    prefix: `${(req.keyPrefix ?? "youtube-studio").replace(/\/$/, "")}/runs/${req.runId ?? "shared"}/novita-i2v`,
    id: `clip-${identity}`,
    prompt: req.prompt,
    imageKey: req.imageKey,
    imageUrl: req.imageKey ? undefined : req.imageUrl,
    durationSec: req.durationSec,
    negativePrompt: req.negativePrompt,
    profileId: "production",
  });
  req.log?.(`i2v: Novita LTX-2.3 ${result.jobId} accepted`);
  return result;
}
