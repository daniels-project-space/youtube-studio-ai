/**
 * MODULE FORGE â€” runtime. Turns a validated ForgedModuleSpec into a real
 * engine Block. The interpreter is the trust boundary: specs can only invoke
 * the whitelisted primitives, read their declared store keys, spend up to
 * their cost ceiling, and produce overlay specs (appended to extraOverlays).
 * Failures are LOUD (the run fails honestly; the healer/architect can drop
 * the module next run) â€” never a silent skip.
 */
import { join } from "node:path";
import type { Block, StageContext } from "@/engine/types";
import { COST_PATCH_KEY } from "@/engine/types";
import { register as registerBlock, get as getRegistered } from "@/engine/registry";
import { makeRunTempDir, downloadTo, readBytes } from "@/lib/files";
import { putObject } from "@/lib/storage";
import { geminiJson, parseJsonLoose } from "@/lib/gemini";
import { PRICE } from "@/engine/pricing";
import { assertPipelineVideoRuntimeReady } from "@/engine/runtimeCapability";
import { generateI2V } from "@/lib/i2v";
import { renderNovitaImage } from "@/lib/novitaMedia";
import type { ForgedModuleSpec, ForgeStep } from "./spec";

// A forged module has no trusted parent pipeline allocation. Reserve the
// direct worker's immutable lifecycle ceiling up front, not the optimistic
// planning estimate, so an untrusted spec cannot spend first and discover its
// ceiling was too small only after receiving a provider bill.
const STILL_COST = PRICE.novitaImageMaxUsd;
const CLIP_COST = PRICE.novitaVideoMaxUsd;

type Scope = {
  store: Record<string, unknown>;
  params: Record<string, unknown>;
  steps: unknown[];
  item?: unknown;
};

/**
 * I2V may appear inside an authored foreach (and the interpreter deliberately
 * remains defensive if a future schema permits deeper nesting). Resolve the
 * runtime capability before any LLM can author an image plan or any still can
 * be provisioned for a later incompatible video step.
 */
export function forgedSpecUsesI2V(spec: Pick<ForgedModuleSpec, "steps">): boolean {
  const containsI2V = (steps: readonly ForgeStep[]): boolean => steps.some((step) => {
    if (step.op === "i2v") return true;
    return step.op === "foreach" && containsI2V(step.steps as readonly ForgeStep[]);
  });
  return containsI2V(spec.steps);
}

function assertForgedStageAdmission(spec: ForgedModuleSpec, ctx: StageContext): number {
  const admitted = ctx.stageBudgetUsd;
  if (!Number.isFinite(admitted) || admitted === undefined || admitted <= 0) {
    throw new Error(
      `forged module ${spec.id} requires a positive compiler-admitted stage budget before paid execution`,
    );
  }
  if (admitted + Number.EPSILON < spec.maxCostUsd) {
    throw new Error(
      `forged module ${spec.id} requires $${spec.maxCostUsd.toFixed(2)} but its compiler-admitted stage budget is only $${admitted.toFixed(2)}`,
    );
  }
  return admitted;
}

function assertForgedRuntimeAdmissible(spec: ForgedModuleSpec): void {
  if (!forgedSpecUsesI2V(spec)) return;
  // The runtime helper validates the exact production profile used in runStep.
  // It is intentionally called before even the first LLM/image primitive.
  //
  // This "production" literal is DELIBERATELY static and is NOT part of the
  // per-channel render-tier selection (DesignOptions.generationProfile). A
  // forged module has no parent channel and no compiled pipeline: the array
  // below is a synthetic admission probe, not a render configuration. It also
  // reads the profile's `video` block only, and draft/production/hero currently
  // share byte-identical video settings, so the verdict is tier-invariant.
  assertPipelineVideoRuntimeReady([
    { block: "novita_render_video", params: { generationProfile: "production" } },
  ]);
}

/** Resolve `$store.x` / `$params.x` / `$steps.N(.field)` / `$item(.field)` refs. */
function resolveRef(ref: unknown, scope: Scope): unknown {
  if (typeof ref !== "string" || !ref.startsWith("$")) return ref;
  const path = ref.slice(1).split(".");
  let cur: unknown =
    path[0] === "store" ? scope.store
    : path[0] === "params" ? scope.params
    : path[0] === "steps" ? scope.steps
    : path[0] === "item" ? { item: scope.item }
    : undefined;
  const rest = path[0] === "item" ? ["item", ...path.slice(1)] : path;
  for (let i = 1; i < rest.length; i++) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[rest[i]];
  }
  return cur;
}

/** Interpolate ${...} refs inside a template string. */
function interp(tpl: string, scope: Scope): string {
  return tpl.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
    const v = resolveRef(`$${expr.trim()}`, scope);
    if (v == null) return "";
    return typeof v === "string" ? v : JSON.stringify(v);
  });
}

function interpProps(obj: Record<string, unknown>, scope: Scope): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") out[k] = v.startsWith("$") ? resolveRef(v, scope) : interp(v, scope);
    else if (Array.isArray(v)) out[k] = v.map((x) => (typeof x === "string" ? interp(x, scope) : x));
    else if (v && typeof v === "object") out[k] = interpProps(v as Record<string, unknown>, scope);
    else out[k] = v;
  }
  return out;
}

async function runStep(
  step: ForgeStep,
  scope: Scope,
  ctx: StageContext,
  state: { tmp: string; blockId: string; cost: number; imageCost: number; maxCost: number; overlays: { path: string; startSec: number; durSec: number; noBlur?: boolean; text?: string }[]; n: number },
): Promise<unknown> {
  const guardCost = (add: number) => {
    if (state.cost + add > state.maxCost) {
      throw new Error(`forged module exceeded its cost ceiling ($${state.maxCost}) â€” step skipped the budget gate`);
    }
    state.cost += add;
  };
  const reconcileProviderCost = (reserved: number, actual: number, label: string) => {
    if (!Number.isFinite(actual) || actual < 0) {
      throw new Error(`${label} returned an invalid provider billing receipt`);
    }
    state.cost += actual - reserved;
    if (state.cost > state.maxCost) {
      const error = new Error(`${label} provider receipt exceeded the forged module cost ceiling ($${state.maxCost})`);
      throw Object.assign(error, { additionalObservedCostUsd: actual, retryable: false });
    }
  };

  if (step.op === "llm_json") {
    const raw = await geminiJson<Record<string, unknown>>({
      prompt: interp(step.prompt, scope),
      maxTokens: step.maxTokens ?? 1500,
      temperature: 0.4,
    });
    return typeof raw === "string" ? parseJsonLoose(raw) : raw;
  }
  if (step.op === "image") {
    guardCost(STILL_COST);
    const rendered = await renderNovitaImage({
      prefix: `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/forge`,
      id: `forge-image-${state.n++}`,
      prompt: `${interp(step.prompt, scope)} Absolutely NO text, NO words, NO letters, NO watermark.`,
      profileId: "production",
      maxCostUsd: STILL_COST,
      lifecycle: {
        ownerId: ctx.ownerId,
        channelId: ctx.channelId,
        runId: ctx.runId,
        blockId: state.blockId,
      },
    });
    reconcileProviderCost(STILL_COST, rendered.costUsd, "forged Novita image");
    state.imageCost += rendered.costUsd;
    return rendered;
  }
  if (step.op === "i2v") {
    guardCost(CLIP_COST);
    const img = resolveRef(step.imageFrom, scope) as { url?: string; key?: string } | string | undefined;
    const imageUrl = typeof img === "string" ? img : img?.url;
    const imageKey = typeof img === "string" ? undefined : img?.key;
    if (!imageUrl && !imageKey) throw new Error(`forged i2v: imageFrom "${step.imageFrom}" resolved to nothing`);
    const clip = await generateI2V({
      prompt: interp(step.prompt, scope),
      imageUrl,
      imageKey,
      durationSec: step.durationSec ?? 5,
      aspectRatio: "16:9",
      maxCostUsd: CLIP_COST,
      runId: ctx.runId,
      keyPrefix: ctx.keyPrefix,
      lifecycle: {
        ownerId: ctx.ownerId,
        channelId: ctx.channelId,
        runId: ctx.runId,
        blockId: state.blockId,
      },
    });
    reconcileProviderCost(CLIP_COST, clip.costUsd, "forged Novita i2v");
    const path = await downloadTo(clip.url, join(state.tmp, `forge_${state.n++}.mp4`));
    return { path, url: clip.url };
  }
  if (step.op === "remotion") {
    const props = interpProps(step.props, scope);
    const dur = step.durationSec ?? 5;
    const out = join(state.tmp, `forge_${state.n++}.webm`);
    const r = await import("@/lib/remotionRender");
    if (step.comp === "DataInsert") {
      await r.renderDataInsert({ ...(props as object), outPath: out, durationSec: dur } as Parameters<typeof r.renderDataInsert>[0]);
    } else if (step.comp === "TitleCard") {
      await r.renderTitleCard({ ...(props as object), outPath: out, durationSec: dur } as Parameters<typeof r.renderTitleCard>[0]);
    } else if (step.comp === "QuoteOverlay") {
      await r.renderQuoteOverlay({ ...(props as object), outPath: out, durationSec: dur } as Parameters<typeof r.renderQuoteOverlay>[0]);
    } else {
      const png = join(state.tmp, `forge_${state.n++}.png`);
      await r.renderThumbTextLayer({ props, outPng: png });
      return { path: png };
    }
    return { path: out };
  }
  if (step.op === "emit_overlays") {
    for (const o of step.overlays) {
      const media = resolveRef(o.pathFrom, scope) as { path?: string } | string | undefined;
      const path = typeof media === "string" ? media : media?.path;
      const startSec = Number(resolveRef(o.startSec, scope));
      const durSec = Number(resolveRef(o.durSec, scope));
      if (!path || !Number.isFinite(startSec) || !Number.isFinite(durSec) || durSec <= 0) {
        ctx.log(`forge: emit_overlays skipped one entry (unresolved path/timing)`);
        continue;
      }
      state.overlays.push({ path, startSec, durSec, noBlur: o.noBlur, text: o.text });
    }
    return { emitted: state.overlays.length };
  }
  // foreach
  const arrRaw = resolveRef(step.overFrom, scope);
  const arr = Array.isArray(arrRaw) ? arrRaw.slice(0, step.max) : [];
  if (!arr.length) throw new Error(`forged foreach: "${step.overFrom}" resolved to an empty/non-array â€” failing loudly`);
  const results: unknown[] = [];
  for (const item of arr) {
    const inner: Scope = { ...scope, item, steps: [] };
    for (const s of step.steps) inner.steps.push(await runStep(s, inner, ctx, state));
    results.push(inner.steps[inner.steps.length - 1]);
  }
  return results;
}

/** Idempotently register forged blocks into the engine registry. */
export function registerForgedSpecs(specs: ForgedModuleSpec[]): void {
  for (const spec of specs) {
    if (getRegistered(spec.id)) continue;
    registerBlock(makeForgedBlock(spec));
  }
}

/** Build a real engine Block from a validated spec. */
export function makeForgedBlock(spec: ForgedModuleSpec): Block {
  return {
    id: spec.id,
    consumes: [...spec.consumes],
    produces: ["extraOverlays"],
    paid: true,
    run: async (ctx) => {
      assertForgedRuntimeAdmissible(spec);
      const admittedStageBudgetUsd = assertForgedStageAdmission(spec, ctx);
      const tmp = await makeRunTempDir(ctx.runId);
      const params: Record<string, unknown> = {};
      for (const p of spec.params) {
        const v = Number(ctx.params[p.key] ?? p.default);
        params[p.key] = Math.max(p.min, Math.min(p.max, Number.isFinite(v) ? v : p.default));
      }
      // Expose ONLY the declared store keys to the spec.
      const store: Record<string, unknown> = {};
      for (const k of spec.consumes) store[k] = ctx.store[k];

      const scope: Scope = { store, params, steps: [] };
      const state = { tmp, blockId: spec.id, cost: 0, imageCost: 0, maxCost: spec.maxCostUsd, overlays: [] as { path: string; startSec: number; durSec: number; noBlur?: boolean; text?: string }[], n: 0 };
      ctx.log(`${spec.id}: forged module starting (${spec.steps.length} steps, ceiling $${spec.maxCostUsd}, admitted $${admittedStageBudgetUsd.toFixed(2)})`);
      for (const step of spec.steps) {
        scope.steps.push(await runStep(step, scope, ctx, state));
      }
      // RENDER-SPLIT CONTRACT: overlays must be restorable on the compose
      // worker — R2-back each media file and carry its key (a local-only path
      // was silently uncompositable there, wasting the forged module's spend).
      const keyed = [] as (typeof state.overlays[number] & { key?: string })[];
      for (let i = 0; i < state.overlays.length; i++) {
        const ov = { ...state.overlays[i] } as typeof state.overlays[number] & { key?: string };
        try {
          const key = `${ctx.keyPrefix}runs/${ctx.runId}/forged_${spec.id}_${i}.webm`;
          await putObject(key, await readBytes(ov.path), { contentType: "video/webm" });
          ov.key = key;
        } catch (e) {
          ctx.log(`${spec.id}: overlay R2 backup failed (compose may drop it): ${e instanceof Error ? e.message : e}`);
        }
        keyed.push(ov);
      }
      // APPEND to extraOverlays (forged modules compose; they never clobber).
      const prior = (ctx.store["extraOverlays"] as unknown[] | undefined) ?? [];
      const exactCost = Math.max(0, state.cost);
      ctx.log(`${spec.id}: done â€” ${keyed.length} overlay(s), $${exactCost.toFixed(2)}`);
      return { extraOverlays: [...prior, ...keyed], [COST_PATCH_KEY]: exactCost };
    },
  };
}
