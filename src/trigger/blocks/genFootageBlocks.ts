/**
 * gen_footage â€” GENERATED b-roll: the visual engine for channels whose world
 * CANNOT come from a stock library (whiteboard draw-ons, painted worlds,
 * signature scenes). Drop-in producer-compatible with stock_footage (same
 * `footageClips` contract â†’ timeline_assemble just works), so the designer/
 * architect can SWAP stock for generation per channel identity.
 *
 * Per scene: DNA-locked local Z-Image-Turbo still â†’ pinned LTX-2.3 HQ video
 * on the attested Novita spot fleet. The Scene Director plans one scene per
 * script beat in the channel's EXACT visual language; every prompt carries the
 * Style-DNA subject/setting/grade so clip #1 and clip #14 belong to one world.
 */
import type { Block } from "@/engine/types";
import { getVisualBrief } from "@/engine/creative/brief";
import { join } from "node:path";
import { makeRunTempDir, downloadTo, readBytes } from "@/lib/files";
import { putObject } from "@/lib/storage";
import { geminiJson, hasGeminiKey } from "@/lib/gemini";
import { hasNovitaRenderBridge } from "@/lib/novitaRenderFarm";
import { renderNovitaGeneratedScenes } from "@/lib/novitaMedia";
import { planCoverage, defaultCinematographerConfig } from "@/lib/crew/cinematographer";
import { COST_PATCH_KEY } from "@/engine/types";

/** Ordered pool (same as narratedBlocks.mapPool â€” local copy, no cross-import). */
async function pool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
      for (;;) {
        const idx = next++;
        if (idx >= items.length) return;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

/**
 * Mark paid work that is not represented by the runner's model/image scopes.
 * The runner adds this amount after reconciling those scopes, exactly once.
 */
function withAdditionalObservedCost(error: unknown, costUsd: number): Error {
  const source = error instanceof Error ? error : new Error(String(error));
  if (!Number.isFinite(costUsd) || costUsd <= 0) return source;
  const target = Object.isExtensible(source)
    ? source
    : Object.assign(new Error(source.message), { cause: source });
  const previous = (target as { additionalObservedCostUsd?: unknown }).additionalObservedCostUsd;
  const previousCost = typeof previous === "number" && Number.isFinite(previous) && previous > 0
    ? previous
    : 0;
  return Object.assign(target, {
    additionalObservedCostUsd: previousCost + costUsd,
    // A whole-block retry would buy the accepted clips again. Recovery should
    // resume from persisted outputs instead of silently duplicating spend.
    retryable: false,
  });
}

/**
 * HYBRID helper: K signature establishing shots of the channel's canonical
 * world (DNA-locked), for mixing into a stock body. Returns paths + cost.
 */
export async function generateSignatureClips(
  ctx: Parameters<Block["run"]>[0],
  k: number,
): Promise<{ clips: string[]; cost: number }> {
  const dna = ctx.store["styleDNA"] as {
    recurringSubject?: string;
    setting?: string;
    colorGrade?: string;
    visualAvoid?: string[];
  } | null;
  if (k <= 0 || !dna?.recurringSubject) return { clips: [], cost: 0 };
  if (!hasGeminiKey()) throw new Error("signature_clips: GEMINI_API_KEY is required for the scene plan");
  if (!(await hasNovitaRenderBridge())) {
    throw new Error("signature_clips: the attested Novita render bridge is not configured");
  }
  const topic = String(ctx.store["topic"] ?? "");
  const world = [dna.recurringSubject, dna.setting, dna.colorGrade].filter(Boolean).join(". ");
  const plan = await geminiJson<{ scenes?: { still?: string; motion?: string }[] }>({
    prompt:
      `Plan ${k} SIGNATURE establishing shots for a video about "${topic}" — each a variation of the channel's ` +
      `canonical world: ${world}. ${dna.visualAvoid?.length ? `Never show: ${dna.visualAvoid.slice(0, 4).join(", ")}.` : ""}\n` +
      `Each: still (image prompt, no text in image) + motion (one sentence, subtle 5s movement). ` +
      `Return STRICT JSON {"scenes":[{"still","motion"}]}.`,
    maxTokens: 1200,
    temperature: 0.6,
  });
  const scenes = (plan.scenes ?? []).filter(
    (scene): scene is { still: string; motion: string } => Boolean(scene.still && scene.motion),
  ).slice(0, k);
  if (scenes.length !== k) {
    throw new Error(`signature_clips: scene director returned ${scenes.length}/${k} complete scenes`);
  }
  const rendered = await renderNovitaGeneratedScenes({
    prefix: `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/signature-clips`,
    profileId: "production",
    maxConcurrent: Math.min(8, Math.max(1, scenes.length)),
    scenes: scenes.map((scene, index) => ({
      id: `signature-${index + 1}`,
      imagePrompt: `${scene.still}. Absolutely NO text, NO words, NO letters.`,
      motionPrompt: scene.motion,
      durationSec: 5,
      cameraMove: "static",
      shotScale: "wide",
      lens: "35mm",
    })),
  });
  const tmp = await makeRunTempDir(ctx.runId);
  try {
    const clips = await pool(rendered.scenes, 3, (scene, index) =>
      downloadTo(scene.clipUrl, join(tmp, `sig_${index}.mp4`)));
    return { clips, cost: rendered.costUsd };
  } catch (error) {
    throw withAdditionalObservedCost(error, rendered.costUsd);
  }
}

export const genFootage: Block = {
  id: "gen_footage",
  consumes: ["topic", "script"],
  produces: ["footageClips", "footageKeys"],
  paid: true,
  run: async (ctx) => {
    if (!hasGeminiKey()) {
      throw new Error("gen_footage: GEMINI_API_KEY is required for the scene plan");
    }
    if (!(await hasNovitaRenderBridge())) {
      throw new Error("gen_footage: the attested Novita render bridge is not configured");
    }
    const requestedProvider = ctx.params["i2vModel"];
    if (
      requestedProvider !== undefined
      && requestedProvider !== "novita"
      && requestedProvider !== "novita-ltx"
      && requestedProvider !== "Lightricks/LTX-2.3"
    ) {
      throw new Error(`gen_footage: legacy video provider ${JSON.stringify(requestedProvider)} is retired`);
    }

    const topic = String(ctx.store["topic"] ?? "");
    const script = ctx.store["script"] as {
      sections?: { heading?: string; narration?: string }[];
    } | undefined;
    const dna = ctx.store["styleDNA"] as {
      recurringSubject?: string;
      setting?: string;
      colorGrade?: string;
      motifs?: string[];
      visualAvoid?: string[];
    } | null;
    const visualBrief = getVisualBrief(ctx.store);
    const narrationSec = Number(ctx.store["narrationDurationSec"] ?? 0) || 300;
    const clipSec = Math.min(10, Math.max(5, Number(ctx.params["clipSec"] ?? 5)));
    const maxClips = Math.max(
      6,
      Math.min(24, Number(ctx.params["maxClips"] ?? Math.ceil(narrationSec / 22))),
    );
    const styleLock = [
      dna?.recurringSubject,
      dna?.setting,
      dna?.colorGrade,
      visualBrief?.look,
      (dna?.motifs ?? []).slice(0, 3).join(", "),
    ].filter(Boolean).join(". ");
    const avoid = (dna?.visualAvoid ?? []).slice(0, 6).join(", ");
    const beats = (script?.sections ?? [])
      .map((section) => `${section.heading ?? ""}: ${(section.narration ?? "").slice(0, 160)}`)
      .slice(0, 24);

    let scenes: { still: string; motion: string }[];
    if (ctx.params["dpCoverage"]) {
      const shots = await planCoverage({
        script: script ?? { sections: [] },
        cfg: defaultCinematographerConfig(),
        styleLock,
        avoid,
        targetShots: maxClips,
        clipSec,
        log: ctx.log,
      });
      scenes = shots.slice(0, maxClips).map((shot) => ({
        still: shot.keyframePrompt,
        motion: shot.i2vPrompt,
      }));
      ctx.log(`gen_footage: DP coverage → ${scenes.length} shots`);
    } else {
      const plan = await geminiJson<{ scenes?: { still?: string; motion?: string }[] }>({
        prompt:
          `You are the SCENE DIRECTOR for a generated-visuals YouTube channel. Video: "${topic}".\n` +
          `THE CHANNEL'S LOCKED VISUAL WORLD: ${styleLock}\n` +
          (avoid ? `NEVER show: ${avoid}\n` : "") +
          `Script beats:\n${beats.map((beat, index) => `${index + 1}. ${beat}`).join("\n")}\n\n` +
          `Plan ${maxClips} scenes. Each still must be a concrete, text-free key frame in the locked world; ` +
          `each motion must describe grounded image-to-video movement for ${clipSec}s. ` +
          `Return STRICT JSON {"scenes":[{"still":string,"motion":string}]}.`,
        maxTokens: 3000,
        temperature: 0.6,
      });
      scenes = (plan.scenes ?? []).filter(
        (scene): scene is { still: string; motion: string } => Boolean(scene.still && scene.motion),
      ).slice(0, maxClips);
    }
    if (scenes.length < 4) {
      throw new Error(`gen_footage: scene director planned only ${scenes.length} scenes (need at least 4)`);
    }

    const requestedConcurrency = Number(ctx.params["maxConcurrent"] ?? 3);
    const maxConcurrent = Math.min(8, Math.max(1, Math.floor(requestedConcurrency)));
    const rendered = await renderNovitaGeneratedScenes({
      prefix: `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/generated-footage`,
      profileId: "production",
      maxConcurrent,
      scenes: scenes.map((scene, index) => ({
        id: `scene-${index + 1}`,
        imagePrompt: `${scene.still}. Absolutely NO text, NO words, NO letters, NO watermark.`,
        motionPrompt: scene.motion,
        durationSec: clipSec,
        cameraMove: "static",
        shotScale: "medium",
        lens: "35mm",
      })),
    });
    const tmp = await makeRunTempDir(ctx.runId);
    try {
      const clips = await pool(rendered.scenes, 3, async (scene, index) => {
        const path = await downloadTo(scene.clipUrl, join(tmp, `gen_${index}.mp4`));
        ctx.log(`gen_footage: scene ${index + 1}/${rendered.scenes.length} complete`);
        return path;
      });
      const footageKeys = rendered.scenes.map((scene) => scene.clipKey);
      ctx.log(
        `gen_footage: ${clips.length} Novita Z-Image/LTX clip(s), ` +
        `provider receipt $${rendered.costUsd.toFixed(4)}`,
      );
      return {
        footageClips: clips,
        footageKeys,
        [COST_PATCH_KEY]: rendered.costUsd,
      };
    } catch (error) {
      throw withAdditionalObservedCost(error, rendered.costUsd);
    }
  },
};

/**
 * SIGNATURE CLIPS — the channel's canonical, DNA-locked establishing shots
 * (Flux still → i2v), generated to PREPEND to the stock body. Extracted from
 * stock_footage so footage SELECTION and signature GENERATION are separate
 * single-responsibility blocks. Produces `signatureClips`; stock_footage (the
 * next block) prepends them. Default count 0 → no-op (produces []).
 */
export const signatureClipsBlock: Block = {
  id: "signature_clips",
  consumes: ["topic"], // also reads styleDNA from the store
  produces: ["signatureClips", "signatureKeys"],
  paid: true,
  run: async (ctx) => {
    const k = Math.max(0, Math.min(6, Number(ctx.params["count"] ?? ctx.params["signatureGenClips"] ?? 0)));
    if (k <= 0) return { signatureClips: [], signatureKeys: [], [COST_PATCH_KEY]: 0 };
    const sig = await generateSignatureClips(ctx, k);
    // R2-back for resume: without keys, any retry/heal re-SPENT the generation.
    const signatureKeys: string[] = [];
    for (let i = 0; i < sig.clips.length; i++) {
      const key = `${ctx.keyPrefix}footage/run/${ctx.runId}/sig_${i}.mp4`;
      await putObject(key, await readBytes(sig.clips[i]), { contentType: "video/mp4" });
      signatureKeys.push(key);
    }
    ctx.log(`signature_clips: ${sig.clips.length} DNA-locked establishing shot(s) (~$${sig.cost.toFixed(2)})`);
    return { signatureClips: sig.clips, signatureKeys, [COST_PATCH_KEY]: sig.cost };
  },
};

export const genFootageBlocks: Block[] = [genFootage, signatureClipsBlock];
