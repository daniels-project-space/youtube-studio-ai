/**
 * novita_render_images / novita_render_video — thin blocks over the Novita
 * Render Farm module (src/lib/novitaRenderFarm.ts). The actual render runs
 * on the VPS 8×4090 farm via `/root/ltx-build/novita/orchestrator.py`; these
 * blocks just POST the shot list to the VPS render-API bridge and wait.
 *
 * `novita_render_video` mirrors `gen_footage`'s produces contract
 * (footageClips/footageKeys) so `timeline_assemble` consumes it unmodified —
 * Novita render is a drop-in swap for gen_footage / stock_footage.
 */
import type { Block } from "@/engine/types";
import { COST_PATCH_KEY } from "@/engine/types";
import { renderImages, renderVideo, type Shot, type NovitaRenderCfg } from "@/lib/novitaRenderFarm";

const STILL_COST = Number(process.env.NOVITA_IMAGE_COST_USD ?? 0.02);
const CLIP_COST = Number(process.env.NOVITA_VIDEO_COST_USD ?? 0.08);

export const novitaRenderImages: Block = {
  id: "novita_render_images",
  consumes: ["shotList"],
  produces: ["stillKeys"],
  paid: true,
  run: async (ctx) => {
    const shots = ctx.store["shotList"] as Shot[] | undefined;
    if (!shots?.length) throw new Error("novita_render_images: shotList is empty");
    const cfg: NovitaRenderCfg = {
      prefix: String(ctx.params["prefix"] ?? ctx.runId),
      shots,
      style: ctx.params["style"] as string | undefined,
      negative: ctx.params["negative"] as string | undefined,
      director: ctx.params["director"] as string | undefined,
      width: ctx.params["width"] as number | undefined,
      height: ctx.params["height"] as number | undefined,
      steps: ctx.params["steps"] as number | undefined,
      nshard: ctx.params["nshard"] as number | undefined,
      jobs: ctx.params["jobs"] as "val" | "full" | undefined,
      maxConcurrent: ctx.params["maxConcurrent"] as number | undefined,
    };
    const result = await renderImages(cfg);
    ctx.log(`novita_render_images: ${result.outputs} still(s) in ${result.durationSec}s`);
    return {
      stillKeys: result.stillKeys ?? [],
      [COST_PATCH_KEY]: (result.stillKeys?.length ?? 0) * STILL_COST,
    };
  },
};

export const novitaRenderVideo: Block = {
  id: "novita_render_video",
  consumes: ["shotList", "stillKeys"],
  produces: ["footageClips", "footageKeys"],
  paid: true,
  run: async (ctx) => {
    const shots = ctx.store["shotList"] as Shot[] | undefined;
    const stillKeys = ctx.store["stillKeys"] as string[] | undefined;
    if (!shots?.length) throw new Error("novita_render_video: shotList is empty");
    if (!stillKeys?.length) throw new Error("novita_render_video: stillKeys is empty (run novita_render_images first)");
    // attach the still each shot rendered to, in shot order
    const shotsWithStills = shots.map((s, i) => ({ ...s, stillKey: s.stillKey ?? stillKeys[i] }));
    const cfg: NovitaRenderCfg = {
      prefix: String(ctx.params["prefix"] ?? ctx.runId),
      shots: shotsWithStills,
      negative: ctx.params["negative"] as string | undefined,
      fps: ctx.params["fps"] as number | undefined,
      width: ctx.params["width"] as number | undefined,
      height: ctx.params["height"] as number | undefined,
      nshard: ctx.params["nshard"] as number | undefined,
      jobs: ctx.params["jobs"] as "val" | "full" | undefined,
      maxConcurrent: ctx.params["maxConcurrent"] as number | undefined,
    };
    const result = await renderVideo(cfg);
    ctx.log(`novita_render_video: ${result.outputs} clip(s) in ${result.durationSec}s`);
    return {
      footageClips: result.footageClips ?? [],
      footageKeys: result.footageKeys ?? [],
      [COST_PATCH_KEY]: (result.footageKeys?.length ?? 0) * CLIP_COST,
    };
  },
};

export const novitaRenderBlocks: Block[] = [novitaRenderImages, novitaRenderVideo];
