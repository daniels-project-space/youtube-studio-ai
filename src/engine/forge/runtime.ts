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
import { makeRunTempDir, downloadTo } from "@/lib/files";
import { geminiJson, parseJsonLoose } from "@/lib/gemini";
import { generateFalFluxProImage } from "@/lib/falImage";
import { generateI2V } from "@/lib/i2v";
import type { ForgedModuleSpec, ForgeStep } from "./spec";

const STILL_COST = Number(process.env.FAL_FLUX_COST_USD ?? 0.04);
const CLIP_COST = Number(process.env.FAL_I2V_COST_USD ?? 0.13);

type Scope = {
  store: Record<string, unknown>;
  params: Record<string, unknown>;
  steps: unknown[];
  item?: unknown;
};

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
  state: { tmp: string; cost: number; maxCost: number; overlays: { path: string; startSec: number; durSec: number; noBlur?: boolean; text?: string }[]; n: number },
): Promise<unknown> {
  const guardCost = (add: number) => {
    if (state.cost + add > state.maxCost) {
      throw new Error(`forged module exceeded its cost ceiling ($${state.maxCost}) â€” step skipped the budget gate`);
    }
    state.cost += add;
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
    const url = await generateFalFluxProImage({
      prompt: `${interp(step.prompt, scope)} Absolutely NO text, NO words, NO letters, NO watermark.`,
    });
    return { url };
  }
  if (step.op === "i2v") {
    guardCost(CLIP_COST);
    const img = resolveRef(step.imageFrom, scope) as { url?: string } | string | undefined;
    const imageUrl = typeof img === "string" ? img : img?.url;
    if (!imageUrl) throw new Error(`forged i2v: imageFrom "${step.imageFrom}" resolved to nothing`);
    const clip = await generateI2V({
      prompt: interp(step.prompt, scope),
      imageUrl,
      durationSec: step.durationSec ?? 5,
      aspectRatio: "16:9",
    });
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
      const state = { tmp, cost: 0, maxCost: spec.maxCostUsd, overlays: [] as { path: string; startSec: number; durSec: number; noBlur?: boolean; text?: string }[], n: 0 };
      ctx.log(`${spec.id}: forged module starting (${spec.steps.length} steps, ceiling $${spec.maxCostUsd})`);
      for (const step of spec.steps) {
        scope.steps.push(await runStep(step, scope, ctx, state));
      }
      // APPEND to extraOverlays (forged modules compose; they never clobber).
      const prior = (ctx.store["extraOverlays"] as unknown[] | undefined) ?? [];
      ctx.log(`${spec.id}: done â€” ${state.overlays.length} overlay(s), $${state.cost.toFixed(2)}`);
      return { extraOverlays: [...prior, ...state.overlays], [COST_PATCH_KEY]: state.cost };
    },
  };
}
