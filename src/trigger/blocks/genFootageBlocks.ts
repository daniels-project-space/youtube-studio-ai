/**
 * gen_footage â€” GENERATED b-roll: the visual engine for channels whose world
 * CANNOT come from a stock library (whiteboard draw-ons, painted worlds,
 * signature scenes). Drop-in producer-compatible with stock_footage (same
 * `footageClips` contract â†’ timeline_assemble just works), so the designer/
 * architect can SWAP stock for generation per channel identity.
 *
 * Per scene: DNA-locked FLUX still â†’ image-to-video (fal queue; model is
 * env-swappable via FAL_I2V_MODEL â€” Kling standard by default, point it at a
 * Veo endpoint for higher fidelity). The Scene Director plans one scene per
 * script beat in the channel's EXACT visual language; every prompt carries the
 * Style-DNA subject/setting/grade so clip #1 and clip #14 belong to one world.
 */
import type { Block } from "@/engine/types";
import { getVisualBrief } from "@/engine/creative/brief";
import { join } from "node:path";
import { makeRunTempDir, downloadTo } from "@/lib/files";
import { geminiJson, hasGeminiKey } from "@/lib/gemini";
import { generateFalFluxProImage, hasFalKey } from "@/lib/falImage";
import { FAL_I2V_MODEL } from "@/lib/falVideo";
import { generateI2V } from "@/lib/i2v";
import { COST_PATCH_KEY } from "@/engine/types";

const STILL_COST = Number(process.env.FAL_FLUX_COST_USD ?? 0.04);
const CLIP_COST = Number(process.env.FAL_I2V_COST_USD ?? 0.13);

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
 * HYBRID helper: K signature establishing shots of the channel's canonical
 * world (DNA-locked), for mixing into a stock body. Returns paths + cost.
 */
export async function generateSignatureClips(
  ctx: Parameters<Block["run"]>[0],
  k: number,
): Promise<{ clips: string[]; cost: number }> {
  const dna = ctx.store["styleDNA"] as { recurringSubject?: string; setting?: string; colorGrade?: string; visualAvoid?: string[] } | null;
  if (!dna?.recurringSubject || !hasFalKey() || !hasGeminiKey()) return { clips: [], cost: 0 };
  const topic = String(ctx.store["topic"] ?? "");
  const world = [dna.recurringSubject, dna.setting, dna.colorGrade].filter(Boolean).join(". ");
  const plan = await geminiJson<{ scenes?: { still?: string; motion?: string }[] }>({
    prompt:
      `Plan ${k} SIGNATURE establishing shots for a video about "${topic}" â€” each a variation of the channel's ` +
      `canonical world: ${world}. ${dna.visualAvoid?.length ? `Never show: ${dna.visualAvoid.slice(0, 4).join(", ")}.` : ""}\n` +
      `Each: still (image prompt, no text in image) + motion (one sentence, subtle 5s movement). ` +
      `Return STRICT JSON {"scenes":[{"still","motion"}]}.`,
    maxTokens: 1200,
    temperature: 0.6,
  });
  const scenes = (plan.scenes ?? []).filter((s) => s.still && s.motion).slice(0, k);
  const tmp = await makeRunTempDir(ctx.runId);
  let cost = 0;
  const out = await pool(scenes, 2, async (s, i) => {
    try {
      const url = await generateFalFluxProImage({ prompt: `${s.still}. Absolutely NO text, NO words, NO letters.` });
      cost += STILL_COST;
      const clip = await generateI2V({ prompt: s.motion!, imageUrl: url, durationSec: 5, aspectRatio: "16:9" });
      cost += CLIP_COST;
      return await downloadTo(clip.url, join(tmp, `sig_${i}.mp4`));
    } catch (e) {
      ctx.log(`signature clip ${i + 1} failed: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  });
  return { clips: out.filter((p): p is string => Boolean(p)), cost };
}

export const genFootage: Block = {
  id: "gen_footage",
  consumes: ["topic", "script"],
  produces: ["footageClips"],
  paid: true,
  run: async (ctx) => {
    if (!hasGeminiKey() || !hasFalKey()) {
      throw new Error("gen_footage: GEMINI_API_KEY + FAL_KEY required (no stock fallback â€” this channel's world is generated)");
    }
    const topic = String(ctx.store["topic"] ?? "");
    const script = ctx.store["script"] as { sections?: { heading?: string; narration?: string }[] } | undefined;
    const dna = ctx.store["styleDNA"] as {
      recurringSubject?: string; setting?: string; colorGrade?: string;
      motifs?: string[]; visualAvoid?: string[];
    } | null;
    const visualBrief = getVisualBrief(ctx.store);
    const narrationSec = Number(ctx.store["narrationDurationSec"] ?? 0) || 300;

    const clipSec = Math.min(10, Math.max(5, Number(ctx.params["clipSec"] ?? 5)));
    // i2v fidelity tier (architect-chosen: quality bar vs budget).
    const I2V_MODELS: Record<string, string> = {
      kling: "fal-ai/kling-video/v1.6/standard/image-to-video",
      kling_pro: "fal-ai/kling-video/v1.6/pro/image-to-video",
      veo3_fast: "fal-ai/veo3/fast/image-to-video",
    };
    const i2vModel = I2V_MODELS[String(ctx.params["i2vModel"] ?? "")] || undefined;
    // Coverage: timeline cuts at the editor cadence; generated clips are short,
    // so plan enough to fill the body without looping (capped for cost).
    const maxClips = Math.max(6, Math.min(24, Number(ctx.params["maxClips"] ?? Math.ceil(narrationSec / 22))));
    const styleLock = [
      dna?.recurringSubject,
      dna?.setting,
      dna?.colorGrade,
      visualBrief?.look,
      (dna?.motifs ?? []).slice(0, 3).join(", "),
    ].filter(Boolean).join(". ");
    const avoid = (dna?.visualAvoid ?? []).slice(0, 6).join(", ");

    // ---- Scene Director: one scene per script beat, in the channel's world ----
    const beats = (script?.sections ?? [])
      .map((s) => `${s.heading ?? ""}: ${(s.narration ?? "").slice(0, 160)}`)
      .slice(0, 24);
    const planRaw = await geminiJson<{ scenes?: { still?: string; motion?: string }[] }>({
      prompt:
        `You are the SCENE DIRECTOR for a generated-visuals YouTube channel. Video: "${topic}".\n` +
        `THE CHANNEL'S LOCKED VISUAL WORLD (every scene MUST live in it): ${styleLock}\n` +
        (avoid ? `NEVER show: ${avoid}\n` : "") +
        `Script beats:\n${beats.map((b, i) => `${i + 1}. ${b}`).join("\n")}\n\n` +
        `Plan ${maxClips} scenes (roughly following the beats, spread across the video). Each scene:\n` +
        `- still: an image-generation prompt for the scene's KEY FRAME â€” concrete subject from the beat, ` +
        `rendered strictly in the locked visual world (repeat the world's style words in every prompt). ` +
        `No text/words/captions in the image.\n` +
        `- motion: one sentence for image-to-video â€” how the scene moves for ${clipSec}s (e.g. "the hand ` +
        `continues drawing, strokes appearing progressively; slight camera drift"). Motion must fit the world.\n` +
        `Return STRICT JSON {"scenes":[{"still":string,"motion":string}]}.`,
      maxTokens: 3000,
      temperature: 0.6,
    });
    const scenes = (planRaw.scenes ?? []).filter((s) => s.still && s.motion).slice(0, maxClips);
    if (scenes.length < 4) throw new Error(`gen_footage: scene director planned only ${scenes.length} scenes (need â‰¥4)`);
    ctx.log(`gen_footage: ${scenes.length} scenes planned (clip ${clipSec}s, i2v model ${FAL_I2V_MODEL})`);

    const tmp = await makeRunTempDir(ctx.runId);
    let cost = 0;
    const results = await pool(scenes, 3, async (s, i) => {
      try {
        const stillUrl = await generateFalFluxProImage({
          prompt: `${s.still}. Absolutely NO text, NO words, NO letters, NO watermark.`,
        });
        cost += STILL_COST;
        const clip = await generateI2V({
          prompt: s.motion!,
          imageUrl: stillUrl,
          durationSec: clipSec,
          aspectRatio: "16:9",
          model: i2vModel,
          runId: ctx.runId,
          log: ctx.log,
        });
        cost += CLIP_COST;
        const path = await downloadTo(clip.url, join(tmp, `gen_${i}.mp4`));
        ctx.log(`gen_footage: scene ${i + 1}/${scenes.length} âœ“`);
        return path;
      } catch (e) {
        ctx.log(`gen_footage: scene ${i + 1} failed (skipped): ${e instanceof Error ? e.message : e}`);
        return null;
      }
    });
    const clips = results.filter((p): p is string => Boolean(p));
    if (clips.length < 4) {
      throw new Error(`gen_footage: only ${clips.length}/${scenes.length} clips generated â€” failing loudly (no stock fallback)`);
    }
    ctx.log(`gen_footage: ${clips.length} generated clip(s), ~$${cost.toFixed(2)}`);
    return { footageClips: clips, [COST_PATCH_KEY]: cost };
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
  produces: ["signatureClips"],
  paid: true,
  run: async (ctx) => {
    const k = Math.max(0, Math.min(6, Number(ctx.params["count"] ?? ctx.params["signatureGenClips"] ?? 0)));
    if (k <= 0) return { signatureClips: [], [COST_PATCH_KEY]: 0 };
    const sig = await generateSignatureClips(ctx, k);
    ctx.log(`signature_clips: ${sig.clips.length} DNA-locked establishing shot(s) (~$${sig.cost.toFixed(2)})`);
    return { signatureClips: sig.clips, [COST_PATCH_KEY]: sig.cost };
  },
};

export const genFootageBlocks: Block[] = [genFootage, signatureClipsBlock];
