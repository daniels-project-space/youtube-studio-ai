/**
 * gen_footage â€” GENERATED b-roll: the visual engine for channels whose world
 * CANNOT come from a stock library (whiteboard draw-ons, painted worlds,
 * signature scenes). Drop-in producer-compatible with stock_footage (same
 * `footageClips` contract â†’ timeline_assemble just works), so the designer/
 * architect can SWAP stock for generation per channel identity.
 *
 * Per scene: a validated shared story plan â†’ the centrally attested Novita
 * image-to-video profile. This legacy adapter never chooses or advertises a
 * concrete video model: central runtime admission owns that decision.
 */
import type { Block } from "@/engine/types";
import { join } from "node:path";
import { makeRunTempDir, downloadTo, readBytes } from "@/lib/files";
import { putObject } from "@/lib/storage";
import { renderNovitaGeneratedScenes } from "@/lib/novitaMedia";
import { requireNovitaStageBudget } from "@/lib/novitaCostEnvelope";
import { SceneManifestSchema } from "@/engine/episodeGraph";
import { StorySpineSchema, type ShotPlan, validateStorySpine } from "@/engine/storySpine";
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

/* ── SHARED SCENE-PLAN ADAPTER ───────────────────────────────────────────────
 *
 * This module is intentionally a renderer, not a free-form scene director.
 * It accepts only the already validated plans emitted by the reusable
 * `story_spine` or `episode_graph` modules. That keeps the prompts source- and
 * continuity-grounded, avoids a second model call that can drift from the
 * editor's timing, and means no paid image/video call can begin without a
 * durable planning receipt.
 */
export interface PlannedScene {
  id: string;
  still: string;
  motion: string;
  durationSec: number;
  cameraMove: ShotPlan["cameraMove"];
  shotScale: ShotPlan["shotScale"];
  lens: string;
  negative?: string;
}

export interface ResolvedGeneratedFootageScenePlan {
  source: "story_spine" | "scene_manifest";
  scenes: PlannedScene[];
}

/** Prompts that ask for baked-in lettering fight the engine's own no-text clause. */
const TEXT_IN_IMAGE =
  /\b(text|caption|subtitle|title card|lettering|letters|typography|logo|watermark|signage|handwriting)\b/i;
const TEXT_FREE_INSTRUCTION =
  /\b(?:absolutely\s+)?(?:no|without|avoid)\s+(?:text|words?|letters?|captions?|logos?|watermarks?)[^.]*\.?/gi;

function withoutTextSafetyInstruction(value: string): string {
  return value.replace(TEXT_FREE_INSTRUCTION, " ").replace(/\s+/g, " ").trim();
}

function boundedSceneDuration(value: number, fallback: number): number {
  const seconds = Number.isFinite(value) ? value : fallback;
  return Math.min(10, Math.max(3, seconds));
}

function mergedNegativePrompt(...values: Array<string | undefined>): string | undefined {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const value of values) {
    for (const part of (value ?? "").split(",")) {
      const normalized = part.trim();
      if (!normalized || seen.has(normalized.toLowerCase())) continue;
      seen.add(normalized.toLowerCase());
      parts.push(normalized);
    }
  }
  return parts.join(", ") || undefined;
}

function storySpineFromStore(store: Readonly<Record<string, unknown>>) {
  const parsed = StorySpineSchema.safeParse({
    version: "1.0.0",
    timedScript: store["timedScript"],
    narrativeBeats: store["narrativeBeats"],
    continuityLedger: store["continuityLedger"],
    shotList: store["shotList"],
    dpVisualSpecs: store["dpVisualSpecs"],
    editorEdl: store["editorEdl"],
    coverage: store["storyCoverage"],
  });
  if (!parsed.success) return null;
  try {
    return validateStorySpine(parsed.data);
  } catch {
    return null;
  }
}

function scenePlanFromStorySpine(
  store: Readonly<Record<string, unknown>>,
  maxScenes: number,
  defaultDurationSec: number,
): PlannedScene[] | null {
  const spine = storySpineFromStore(store);
  if (!spine) return null;
  const visualSpecs = new Map(spine.dpVisualSpecs.map((spec) => [spec.shotId, spec]));
  return spine.shotList.slice(0, maxScenes).map((shot) => {
    const spec = visualSpecs.get(shot.id);
    return {
      id: shot.id,
      still: withoutTextSafetyInstruction(spec?.keyframePrompt ?? shot.prompt),
      motion: spec?.motionPrompt ?? shot.motion,
      durationSec: boundedSceneDuration(shot.seconds, defaultDurationSec),
      cameraMove: shot.cameraMove,
      shotScale: shot.shotScale,
      lens: shot.lens,
      negative: mergedNegativePrompt(shot.negative, spec?.negativePrompt),
    };
  });
}

const MANIFEST_CAMERA_MOVE: Record<"static" | "push" | "pull" | "pan" | "track" | "orbit", ShotPlan["cameraMove"]> = {
  static: "static",
  push: "dolly_push",
  pull: "dolly_pull",
  pan: "truck_left",
  track: "truck_right",
  orbit: "orbit_left",
};

function scenePlanFromManifest(
  store: Readonly<Record<string, unknown>>,
  maxScenes: number,
  defaultDurationSec: number,
): PlannedScene[] | null {
  const parsed = SceneManifestSchema.safeParse(store["sceneManifest"]);
  if (!parsed.success) return null;
  return parsed.data.scenes.slice(0, maxScenes).map((scene) => ({
    id: scene.id,
    still: [
      scene.label,
      scene.visualState.action,
      scene.visualState.props.length ? `with ${scene.visualState.props.join(", ")}` : "",
      `${scene.camera.framing} framing`,
      `${scene.visualState.mood} mood`,
    ].filter(Boolean).join(". "),
    motion: `${MANIFEST_CAMERA_MOVE[scene.camera.move].replaceAll("_", " ")} while ${scene.visualState.action}. Preserve the same setting, characters, props, and mood.`,
    durationSec: boundedSceneDuration(scene.t1 - scene.t0, defaultDurationSec),
    cameraMove: MANIFEST_CAMERA_MOVE[scene.camera.move],
    shotScale: scene.camera.framing,
    lens: scene.camera.framing === "close" ? "85mm portrait" : "35mm natural",
  }));
}

function sharedScenePlanIssues(scenes: readonly PlannedScene[], minScenes: number, avoid: string): string[] {
  const issues: string[] = [];
  if (scenes.length < minScenes) {
    issues.push(`only ${scenes.length} validated scenes are available (need at least ${minScenes})`);
  }
  const banned = avoid.split(",").map((term) => term.trim().toLowerCase()).filter((term) => term.length > 3);
  scenes.forEach((scene, index) => {
    if (scene.still.trim().length < 25) {
      issues.push(`scene ${index + 1}'s still prompt is too thin to render a concrete frame`);
    }
    if (scene.motion.trim().length < 15) {
      issues.push(`scene ${index + 1}'s motion prompt is too thin to animate safely`);
    }
    if (TEXT_IN_IMAGE.test(scene.still)) {
      issues.push(`scene ${index + 1}'s still asks for baked-in text or lettering`);
    }
    const hit = banned.find((term) => scene.still.toLowerCase().includes(term));
    if (hit) issues.push(`scene ${index + 1} plans "${hit}", which this channel must never show`);
  });
  return issues.slice(0, 8);
}

/**
 * Resolve the single source of truth for legacy generated-footage prompts.
 * There is intentionally no free-form planner fallback: callers must add
 * `story_spine`/`episode_graph` upstream before paid generation can begin.
 */
export function resolveGeneratedFootageScenePlan(args: {
  store: Readonly<Record<string, unknown>>;
  label: string;
  maxScenes: number;
  minScenes: number;
  defaultDurationSec: number;
  avoid?: string;
}): ResolvedGeneratedFootageScenePlan {
  const maxScenes = Math.max(1, Math.min(24, Math.floor(args.maxScenes)));
  const fromSpine = scenePlanFromStorySpine(args.store, maxScenes, args.defaultDurationSec);
  const source = fromSpine ? "story_spine" : "scene_manifest";
  const scenes = fromSpine ?? scenePlanFromManifest(args.store, maxScenes, args.defaultDurationSec);
  if (!scenes) {
    throw new Error(
      `${args.label}: requires a validated shared scene plan from story_spine ` +
      `(shotList + dpVisualSpecs) or episode_graph (sceneManifest) before paid rendering; ` +
      "add that module upstream. Free-form planning is retired and there is no Gemini fallback.",
    );
  }
  const issues = sharedScenePlanIssues(scenes, args.minScenes, args.avoid ?? "");
  if (issues.length) {
    throw new Error(`${args.label}: shared scene plan failed pre-render validation: ${issues.join("; ")}`);
  }
  return { source, scenes };
}

export function assertCentralNovitaSelection(value: unknown, label: string): void {
  if (value === undefined || value === "novita" || value === "novita-ltx") return;
  throw new Error(
    `${label}: model-specific i2vModel ${JSON.stringify(value)} is retired; ` +
    "omit it and use the centrally attested Novita production profile.",
  );
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
  const avoid = (dna.visualAvoid ?? []).slice(0, 4).join(", ");
  const plan = resolveGeneratedFootageScenePlan({
    store: ctx.store,
    label: "signature_clips",
    // Signature shots are a fixed-size set: the caller prepends exactly k.
    maxScenes: k,
    minScenes: k,
    defaultDurationSec: 5,
    avoid,
  });
  const scenes = plan.scenes;
  ctx.log(`signature_clips: using ${plan.source} (${scenes.length} validated scene(s))`);
  const stageBudgetUsd = requireNovitaStageBudget(ctx.stageBudgetUsd, "signature_clips");
  const rendered = await renderNovitaGeneratedScenes({
    prefix: `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/signature-clips`,
    profileId: "production",
    maxCostUsd: stageBudgetUsd,
    maxConcurrent: Math.min(8, Math.max(1, scenes.length)),
    lifecycle: {
      ownerId: ctx.ownerId,
      channelId: ctx.channelId,
      runId: ctx.runId,
      blockId: "signature_clips",
    },
    scenes: scenes.map((scene, index) => ({
      id: `signature-${index + 1}`,
      imagePrompt: `${scene.still}. Absolutely NO text, NO words, NO letters.`,
      motionPrompt: scene.motion,
      ...(scene.negative ? { negativePrompt: scene.negative } : {}),
      durationSec: 5,
      cameraMove: scene.cameraMove,
      shotScale: scene.shotScale,
      lens: scene.lens,
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
  // The engine's Block ABI has only an all-of `consumes` list, while this
  // renderer deliberately accepts either a Story Spine or Scene Manifest.
  // Both alternatives are declared as optional manifest inputs; the resolver
  // below validates the complete handoff and fails before paid work if absent.
  consumes: [],
  produces: ["footageClips", "footageKeys"],
  paid: true,
  run: async (ctx) => {
    assertCentralNovitaSelection(ctx.params["i2vModel"], "gen_footage");
    const dna = ctx.store["styleDNA"] as {
      visualAvoid?: string[];
    } | null;
    const narrationSec = Number(ctx.store["narrationDurationSec"] ?? 0) || 300;
    const clipSec = Math.min(10, Math.max(5, Number(ctx.params["clipSec"] ?? 5)));
    const maxClips = Math.max(
      6,
      Math.min(24, Number(ctx.params["maxClips"] ?? Math.ceil(narrationSec / 22))),
    );
    const avoid = (dna?.visualAvoid ?? []).slice(0, 6).join(", ");
    if (ctx.params["dpCoverage"] === true) {
      ctx.log("gen_footage: dpCoverage is retired; using the required shared scene plan");
    }
    const plan = resolveGeneratedFootageScenePlan({
      store: ctx.store,
      label: "gen_footage",
      maxScenes: maxClips,
      minScenes: 4,
      defaultDurationSec: clipSec,
      avoid,
    });
    const scenes = plan.scenes;
    ctx.log(`gen_footage: using ${plan.source} (${scenes.length} validated scene(s))`);

    const requestedConcurrency = Number(ctx.params["maxConcurrent"] ?? 3);
    const maxConcurrent = Math.min(8, Math.max(1, Math.floor(requestedConcurrency)));
    const stageBudgetUsd = requireNovitaStageBudget(ctx.stageBudgetUsd, "gen_footage");
    const rendered = await renderNovitaGeneratedScenes({
      prefix: `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/generated-footage`,
      profileId: "production",
      maxCostUsd: stageBudgetUsd,
      maxConcurrent,
      lifecycle: {
        ownerId: ctx.ownerId,
        channelId: ctx.channelId,
        runId: ctx.runId,
        blockId: "gen_footage",
      },
      scenes: scenes.map((scene, index) => ({
        id: `scene-${index + 1}`,
        imagePrompt: `${scene.still}. Absolutely NO text, NO words, NO letters, NO watermark.`,
        motionPrompt: scene.motion,
        ...(scene.negative ? { negativePrompt: scene.negative } : {}),
        durationSec: scene.durationSec,
        cameraMove: scene.cameraMove,
        shotScale: scene.shotScale,
        lens: scene.lens,
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
  // See gen_footage: a validated plan is an alternative input contract, so it
  // cannot be represented as a single all-of legacy `consumes` requirement.
  consumes: [],
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
