/**
 * ltx-render — CLOUD-NATIVE LTX-2.3 render. Runs the Salad RTX-5090 GPU engine
 * from a Trigger.dev task (NOT the VPS): image-to-video with native audio, output
 * straight to R2. Any pipeline block or a Convex action can call
 * `tasks.trigger("ltx-render", payload)`; nothing touches the VPS.
 *
 * Config comes from the deploy-forwarded env (vault-sourced): SALAD_API_KEY,
 * SALAD_LTX_GATEWAY, SALAD_R2_BUCKET/PREFIX, R2_* (for presigning the result).
 * Prompts must follow docs/LTX-2.3-GENERATION-RULES.md (audio-first paragraph,
 * dims ÷32, frames 8n+1).
 */
import { task } from "@trigger.dev/sdk";
import { renderGpuVideo } from "@/lib/gpuVideo";
import { presignDownload } from "@/lib/storage";
import { bootstrapSecrets } from "@/lib/bootstrap";

export interface LtxRenderPayload {
  /** Source still — a public URL / R2 presigned URL (the container fetches it). */
  imageUrl: string;
  /** Audio-first cinematographer prompt (LTX-2.3-GENERATION-RULES §1–2). */
  prompt: string;
  negativePrompt?: string;
  /** Clip length in seconds (snapped to the LTX grid). */
  durationSec?: number;
  /** "720p" | "1080p" — mapped to ÷32 dims in the workflow. */
  resolution?: string;
  seed?: number;
  /** Free-form tag for logs / downstream naming. */
  label?: string;
}

export interface LtxRenderResult {
  /** R2 object key of the rendered clip (null only if R2 upload was skipped). */
  r2Key?: string;
  /** Fetchable https link (presigned, 7-day) — or the raw s3:// if R2 env absent. */
  url: string;
  provider: string;
  hasAudio: boolean;
  model: string;
  label?: string;
}

export const ltxRenderTask = task({
  id: "ltx-render",
  // cold model-load + two-stage render + native upscale on a 5090
  maxDuration: 1800,
  run: async (payload: LtxRenderPayload): Promise<LtxRenderResult> => {
    const tag = payload.label ? `:${payload.label}` : "";
    // hydrate SALAD_* + R2_* from the vault (cloud task has no forwarded env)
    await bootstrapSecrets(() => {}, { required: ["SALAD_API_KEY", "SALAD_LTX_GATEWAY", "SALAD_R2_BUCKET"] });
    const r = await renderGpuVideo({
      provider: "salad-ltx",
      imageUrl: payload.imageUrl,
      prompt: payload.prompt,
      negativePrompt: payload.negativePrompt,
      durationSec: payload.durationSec,
      resolution: payload.resolution,
      seed: payload.seed,
      log: (m) => console.log(`[ltx-render${tag}] ${m}`),
    });

    // Durable 7-day link (re-presign in case the provider fell back to s3://).
    let url = r.url;
    if (r.r2Key) {
      try {
        url = await presignDownload(r.r2Key, { expiresIn: 7 * 24 * 3600 });
      } catch {
        /* keep the provider url */
      }
    }
    console.log(`[ltx-render${tag}] done → ${r.r2Key ?? url}`);
    return {
      r2Key: r.r2Key,
      url,
      provider: r.provider,
      hasAudio: r.hasAudio,
      model: r.model,
      label: payload.label,
    };
  },
});
