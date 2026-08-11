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
import { createHash } from "node:crypto";
import { makeRunTempDir, downloadTo, readBytes } from "@/lib/files";
import { putObject, getObjectBytes } from "@/lib/storage";
import { geminiJson, hasGeminiKey } from "@/lib/gemini";
import {
  channelCritiqueBrief,
  produceAndCritique,
  type ChannelCritiqueContext,
} from "@/engine/critiqueLoop";
import { laneQualityPolicy } from "@/engine/contentLane";
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

/* ── PRODUCE → CRITIQUE → REGENERATE for the SHOT PLAN (P1-4) ──────────────────
 *
 * Both blocks in this file used to plan scenes once and hand the plan straight
 * to a batch Novita render — a single unreviewed model output decided how ~$100
 * of video generation was spent.
 *
 * The loop is deliberately placed on the PLAN, not on the rendered clips. This
 * block's paid work is one batch `renderNovitaGeneratedScenes` call covering
 * every scene, so critiquing rendered output would mean re-purchasing the whole
 * batch to fix one bad shot. Critiquing the plan is the same quality feedback
 * bought entirely with cheap text calls, spent BEFORE the irreversible render —
 * the codebase's validate-before-spend discipline.
 *
 * Cost safety (both blocks are `paid: true`):
 *   - Every iteration is text-only. No iteration can reach a paid image/video
 *     provider, so a regenerate cannot re-purchase generation by construction.
 *   - The ACCEPTED plan is written to a content-addressed, immutable R2
 *     checkpoint keyed by a hash of every planning input. A healer replay or
 *     Trigger retry reloads that exact plan, re-runs zero critique calls, and
 *     re-sends byte-identical scene prompts to the render farm, whose own
 *     prefix idempotency then returns the already-paid-for clips instead of
 *     buying them again. Before this, plan nondeterminism (temperature 0.6)
 *     meant a replay could legitimately re-render.
 *   - Hard cap of 2 iterations (one informed retry), lane-tunable downward.
 *   - Grader outage accepts the current plan rather than looping or failing the
 *     run: the next candidate would be ungraded too, and the deterministic
 *     defect checks below still run unconditionally.
 */
const SCENE_PLAN_CHECKPOINT_VERSION = "gen-footage-scene-plan/v1";

interface PlannedScene {
  still: string;
  motion: string;
}

/** Channel doctrine + lane grounding for every critique in this file (P1-1/P1-17). */
function sceneCritiqueChannel(ctx: Parameters<Block["run"]>[0]): ChannelCritiqueContext {
  const lane = ctx.store["contentLane"];
  const laneKey = typeof (lane as { key?: unknown } | null)?.key === "string"
    ? String((lane as { key?: unknown }).key)
    : undefined;
  const text = (key: string): string | undefined => {
    const value = ctx.store[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  return {
    ...(text("channelName") ? { channelName: text("channelName")! } : {}),
    ...(text("persona") ? { persona: text("persona")! } : {}),
    ...(text("styleGrammar") ? { styleGrammar: text("styleGrammar")! } : {}),
    ...(text("criticDoctrine") ? { criticDoctrine: text("criticDoctrine")! } : {}),
    ...(laneKey ? { contentLaneKey: laneKey } : {}),
    laneEmphasis: laneQualityPolicy(lane).emphasis,
  };
}

/** Prompts that ask for baked-in lettering fight the engine's own NO-text clause. */
const TEXT_IN_IMAGE =
  /\b(text|caption|subtitle|title card|lettering|letters|typography|logo|watermark|signage|handwriting)\b/i;

function planTokens(value: string): Set<string> {
  return new Set(
    value.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((word) => word.length > 3),
  );
}

function planSimilarity(a: string, b: string): number {
  const left = planTokens(a);
  const right = planTokens(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return shared / (left.size + right.size - shared);
}

/**
 * DETERMINISTIC defects, computed in code per critiqueLoop's design rule — the
 * Director is never asked to count, dedupe, or spot a banned term.
 */
function deterministicScenePlanIssues(
  scenes: PlannedScene[],
  want: number,
  avoid: string,
): string[] {
  const issues: string[] = [];
  if (scenes.length < want) {
    issues.push(`only ${scenes.length} of the ${want} requested scenes came back — return exactly ${want}`);
  }
  scenes.forEach((scene, index) => {
    if (scene.still.trim().length < 25) {
      issues.push(`scene ${index + 1}'s still prompt is too thin to render a concrete frame — describe subject, setting and framing`);
    }
    if (scene.motion.trim().length < 15) {
      issues.push(`scene ${index + 1}'s motion prompt is too thin — name one grounded camera or subject move`);
    }
    if (TEXT_IN_IMAGE.test(scene.still)) {
      issues.push(`scene ${index + 1}'s still asks for text/lettering, which the renderer is hard-instructed to omit — describe the image without any words`);
    }
  });
  const banned = avoid.split(",").map((term) => term.trim().toLowerCase()).filter((term) => term.length > 3);
  scenes.forEach((scene, index) => {
    const hit = banned.find((term) => scene.still.toLowerCase().includes(term));
    if (hit) issues.push(`scene ${index + 1} plans "${hit}", which this channel must never show`);
  });
  for (let i = 1; i < scenes.length; i++) {
    if (planSimilarity(scenes[i - 1].still, scenes[i].still) > 0.75) {
      issues.push(`scenes ${i} and ${i + 1} are near-duplicates — change the subject, shot scale or angle between consecutive shots`);
    }
  }
  return issues.slice(0, 8);
}

/**
 * Subjective grade from the Director, grounded in this channel's doctrine.
 * Returns null when the grader is unavailable so the caller can accept rather
 * than blind-spend another iteration.
 */
async function gradeScenePlan(args: {
  scenes: PlannedScene[];
  topic: string;
  styleLock: string;
  avoid: string;
  beats: string[];
  channel: ChannelCritiqueContext;
}): Promise<{ score: number; pass: boolean; issues: string[] } | null> {
  try {
    const verdict = await geminiJson<{ score?: unknown; pass?: unknown; issues?: unknown }>({
      prompt:
        `You are the DIRECTOR reviewing a shot plan for "${args.topic}" BEFORE any paid render. ` +
        `Rendering this plan is expensive and irreversible — reject a plan that would waste it.\n` +
        `THE CHANNEL'S LOCKED VISUAL WORLD: ${args.styleLock}\n` +
        (args.avoid ? `NEVER show: ${args.avoid}\n` : "") +
        channelCritiqueBrief(args.channel) +
        (args.beats.length
          ? `\nScript beats this plan must illustrate, in order:\n${args.beats.map((beat, index) => `${index + 1}. ${beat}`).join("\n")}\n`
          : "") +
        `\nTHE PLAN (${args.scenes.length} scenes):\n` +
        args.scenes
          .map((scene, index) => `${index + 1}. STILL: ${scene.still}\n   MOTION: ${scene.motion}`)
          .join("\n") +
        `\n\nJudge ONLY these: (a) every still sits inside the channel's locked visual world; ` +
        `(b) the plan tracks the script beats in order without leaving a long stretch unillustrated; ` +
        `(c) shot variety — scale, subject or angle genuinely change between consecutive scenes; ` +
        `(d) each still is a CONCRETE renderable frame, not an abstract concept a model cannot draw; ` +
        `(e) each motion is a small grounded move an image-to-video model can actually execute in a few seconds.\n` +
        `Return STRICT JSON {"score":0.0,"pass":true,"issues":["..."]}. Each issue must name the scene number and give ` +
        `a concrete instruction the planner can act on. Use [] when the plan passes.`,
      maxTokens: 1200,
      temperature: 0.2,
    });
    const score = Number(verdict.score);
    const issues = Array.isArray(verdict.issues)
      ? verdict.issues.map((issue) => String(issue ?? "").trim()).filter(Boolean).slice(0, 6)
      : [];
    return {
      score: Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0.5,
      pass: verdict.pass === true,
      issues,
    };
  } catch {
    return null;
  }
}

function scenePlanCheckpointKey(ctx: Parameters<Block["run"]>[0], label: string, inputs: unknown): string {
  const hash = createHash("sha256").update(JSON.stringify(inputs)).digest("hex").slice(0, 32);
  return `${ctx.keyPrefix}runs/${ctx.runId}/scene-plans/${label}-${hash}.json`;
}

async function loadScenePlanCheckpoint(key: string, minScenes: number): Promise<PlannedScene[] | null> {
  try {
    const parsed = JSON.parse(Buffer.from(await getObjectBytes(key)).toString("utf8")) as {
      version?: unknown;
      scenes?: unknown;
    };
    if (parsed.version !== SCENE_PLAN_CHECKPOINT_VERSION || !Array.isArray(parsed.scenes)) return null;
    const scenes = parsed.scenes.flatMap((scene) => {
      const typed = scene as { still?: unknown; motion?: unknown };
      return typeof typed?.still === "string" && typed.still.trim() &&
        typeof typed?.motion === "string" && typed.motion.trim()
        ? [{ still: typed.still, motion: typed.motion }]
        : [];
    });
    return scenes.length >= minScenes ? scenes : null;
  } catch {
    return null;
  }
}

/**
 * Plan scenes with the Director in the loop, then freeze the accepted plan.
 * Every call site here renders the returned plan and nothing else.
 */
async function planScenesWithCritique(args: {
  ctx: Parameters<Block["run"]>[0];
  label: string;
  topic: string;
  want: number;
  minScenes: number;
  styleLock: string;
  avoid: string;
  beats: string[];
  buildPrompt: (priorIssues: string[]) => string;
}): Promise<PlannedScene[]> {
  const { ctx, label, want, minScenes } = args;
  const channel = sceneCritiqueChannel(ctx);
  const checkpointKey = scenePlanCheckpointKey(ctx, label, {
    contract: SCENE_PLAN_CHECKPOINT_VERSION,
    topic: args.topic,
    want,
    styleLock: args.styleLock,
    avoid: args.avoid,
    beats: args.beats,
    criticDoctrine: channel.criticDoctrine ?? null,
    contentLaneKey: channel.contentLaneKey ?? null,
  });

  const cached = await loadScenePlanCheckpoint(checkpointKey, minScenes);
  if (cached) {
    ctx.log(`${label}: reused the frozen shot plan (${cached.length} scenes) — no re-planning, no re-render`);
    return cached;
  }

  const laneQuality = laneQualityPolicy(ctx.store["contentLane"]);
  const maxIters = Math.max(1, Math.min(2, laneQuality.maxCritiqueIters));

  const loop = await produceAndCritique<PlannedScene[]>({
    label,
    threshold: laneQuality.critiqueThreshold,
    maxIters,
    log: (message) => ctx.log(message),
    channel,
    produce: async (priorIssues) => {
      const plan = await geminiJson<{ scenes?: { still?: string; motion?: string }[] }>({
        prompt: args.buildPrompt(priorIssues),
        maxTokens: 3000,
        temperature: 0.6,
      });
      return (plan.scenes ?? [])
        .filter((scene): scene is PlannedScene => Boolean(scene.still && scene.motion))
        .slice(0, want);
    },
    critique: async (scenes, iter) => {
      const hard = deterministicScenePlanIssues(scenes, want, args.avoid);
      const graded = await gradeScenePlan({
        scenes,
        topic: args.topic,
        styleLock: args.styleLock,
        avoid: args.avoid,
        beats: args.beats,
        channel,
      });
      if (!graded) {
        // Grader outage: another paid-render-bound iteration cannot be judged
        // either, so accept and let the deterministic issues stand as the record.
        ctx.log(`${label}: plan grader unavailable — accepting candidate ${iter} on deterministic checks alone`);
        return { score: iter === 1 ? 1 : 0, pass: true, issues: hard };
      }
      const issues = [...hard, ...graded.issues].slice(0, 8);
      const pass = graded.pass && hard.length === 0;
      if (!pass) {
        ctx.log(
          `${label}: shot plan ${iter} REJECTED (${issues.slice(0, 2).join("; ").slice(0, 160)})` +
          (iter < maxIters ? " — replanning with the defects fed back" : " — iteration cap reached"),
        );
      }
      // Deterministic defects always drag the score down so a clean-but-graded
      // plan outranks a pretty one that violates a hard rule.
      const score = Math.max(0, graded.score - Math.min(0.5, hard.length * 0.1));
      return { score, pass, issues };
    },
  });

  const scenes = loop.value;
  if (scenes.length < minScenes) {
    throw new Error(`${label}: scene director planned only ${scenes.length} scenes (need at least ${minScenes})`);
  }
  ctx.log(
    `${label}: shot plan settled after ${loop.iterations} candidate(s) ` +
    `(${loop.accepted ? "accepted" : "best of the rejected set"}, score ${loop.critique.score.toFixed(2)})`,
  );
  await putObject(
    checkpointKey,
    Buffer.from(JSON.stringify({ version: SCENE_PLAN_CHECKPOINT_VERSION, scenes })),
    { contentType: "application/json" },
  );
  return scenes;
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
  const avoid = (dna.visualAvoid ?? []).slice(0, 4).join(", ");
  const scenes = await planScenesWithCritique({
    ctx,
    label: "signature_clips",
    topic,
    want: k,
    // Signature shots are a fixed-size set: the caller prepends exactly k.
    minScenes: k,
    styleLock: world,
    avoid,
    beats: [],
    buildPrompt: (priorIssues) =>
      `Plan ${k} SIGNATURE establishing shots for a video about "${topic}" — each a variation of the channel's ` +
      `canonical world: ${world}. ${avoid ? `Never show: ${avoid}.` : ""}\n` +
      `Each: still (image prompt, no text in image) + motion (one sentence, subtle 5s movement). ` +
      (priorIssues.length
        ? `\nThe DIRECTOR REJECTED your previous plan. Fix every one of these defects:\n` +
          `${priorIssues.map((issue) => `- ${issue}`).join("\n")}\n`
        : "") +
      `Return STRICT JSON {"scenes":[{"still","motion"}]}.`,
  });
  if (scenes.length !== k) {
    throw new Error(`signature_clips: scene director returned ${scenes.length}/${k} complete scenes`);
  }
  const rendered = await renderNovitaGeneratedScenes({
    prefix: `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/signature-clips`,
    profileId: "production",
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
      // planCoverage is the deterministic cinematographer, not a free-form model
      // plan: replanning it with critique feedback returns the same coverage, so
      // the defects are surfaced as a pre-spend warning instead of a loop.
      const coverageIssues = deterministicScenePlanIssues(scenes, scenes.length, avoid);
      if (coverageIssues.length) {
        ctx.log(`gen_footage: DP coverage defects before render — ${coverageIssues.slice(0, 3).join("; ")}`);
      }
    } else {
      scenes = await planScenesWithCritique({
        ctx,
        label: "gen_footage",
        topic,
        want: maxClips,
        minScenes: 4,
        styleLock,
        avoid,
        beats,
        buildPrompt: (priorIssues) =>
          `You are the SCENE DIRECTOR for a generated-visuals YouTube channel. Video: "${topic}".\n` +
          `THE CHANNEL'S LOCKED VISUAL WORLD: ${styleLock}\n` +
          (avoid ? `NEVER show: ${avoid}\n` : "") +
          `Script beats:\n${beats.map((beat, index) => `${index + 1}. ${beat}`).join("\n")}\n\n` +
          `Plan ${maxClips} scenes. Each still must be a concrete, text-free key frame in the locked world; ` +
          `each motion must describe grounded image-to-video movement for ${clipSec}s. ` +
          (priorIssues.length
            ? `\nThe DIRECTOR REJECTED your previous plan before it could be rendered. Fix every one of these ` +
              `defects and keep everything that was already working:\n${priorIssues.map((issue) => `- ${issue}`).join("\n")}\n\n`
            : "") +
          `Return STRICT JSON {"scenes":[{"still":string,"motion":string}]}.`,
      });
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
