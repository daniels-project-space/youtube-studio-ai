import type { SceneManifest } from "@/engine/episodeGraph";
import { preflightWorkedExampleLayout } from "./workedExampleLayout";

/** Local renderer profiles, not production admission or quality receipts. */
export const SCENE_LANDSCAPE_PROFILE = "scene-layout/landscape-v1" as const;
export const SCENE_PORTRAIT_PROFILE = "scene-layout/portrait-v1" as const;
export type SceneLayoutProfileId = typeof SCENE_LANDSCAPE_PROFILE | typeof SCENE_PORTRAIT_PROFILE;
export interface SceneLayoutRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export const SCENE_PORTRAIT_LAYOUT = Object.freeze({
  id: SCENE_PORTRAIT_PROFILE, width: 1080, height: 1920,
  safe: Object.freeze({ x: 72, y: 120, width: 936, height: 1680 }),
  disclosure: Object.freeze({ x: 72, y: 132, width: 936, height: 140 }),
  visual: Object.freeze({ x: 72, y: 336, width: 936, height: 1160 }),
  label: Object.freeze({ x: 72, y: 1560, width: 936, height: 224 }),
  labelFontSize: 56, labelLineHeight: 1.14, disclosureFontSize: 36,
});
export interface ResolvedSceneLayout { id: SceneLayoutProfileId; width: number; height: number }

export function resolveSceneLayout(input: { layoutProfile?: string; width?: number; height?: number } = {}): ResolvedSceneLayout {
  const id = input.layoutProfile ?? SCENE_LANDSCAPE_PROFILE;
  if (id !== SCENE_LANDSCAPE_PROFILE && id !== SCENE_PORTRAIT_PROFILE) {
    throw new Error(`Unsupported scene layout profile: ${id}.`);
  }
  const portrait = id === SCENE_PORTRAIT_PROFILE;
  const width = input.width ?? (portrait ? 1080 : 1920);
  const height = input.height ?? (portrait ? 1920 : 1080);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Scene compiler width and height must be positive finite values.");
  }
  if (portrait && (width !== 1080 || height !== 1920)) {
    throw new Error("scene-layout/portrait-v1 requires native 1080x1920 dimensions.");
  }
  // Preserve legacy explicit landscape sizes and the default historical pixels.
  if (!portrait && Math.abs(width / height - 16 / 9) > 0.001) {
    throw new Error(`Landscape scene compiler requires a 16:9 frame; received ${width}x${height}. Portrait requires an explicit versioned layoutProfile.`);
  }
  return { id, width, height };
}

export function rectContains(outer: SceneLayoutRect, inner: SceneLayoutRect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

/** Conservative line breaking shared with the actual DOM; no shrinking or ellipsis. */
export function portraitLabelLines(text: string): string[] {
  const normalized = text.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error("Portrait scene label must not be blank.");
  if (Array.from(normalized).length > 72) throw new Error("Portrait scene label exceeds 72 glyphs; revise presentation copy before rendering.");
  // Arial bold upper bound with a 12% width reserve. Wide/CJK glyphs use 1em.
  const units = (word: string) => [...word].reduce((total, glyph) => total + (/\s/.test(glyph) ? 0.34 : /[ilIjtfr.,'!:;]/.test(glyph) ? 0.44 : /[mwMW@#%]|[^\u0020-\u007E]/.test(glyph) ? 1.04 : /[A-Z0-9]/.test(glyph) ? 0.76 : 0.66), 0);
  const maximum = SCENE_PORTRAIT_LAYOUT.label.width * 0.88 / SCENE_PORTRAIT_LAYOUT.labelFontSize;
  const lines: string[] = [];
  for (const word of normalized.split(" ")) {
    if (units(word) > maximum) throw new Error("Portrait scene label has an unbreakable word outside its safe text region.");
    const previous = lines.at(-1);
    if (previous && units(`${previous} ${word}`) <= maximum) lines[lines.length - 1] = `${previous} ${word}`;
    else lines.push(word);
  }
  if (lines.length > 3) throw new Error("Portrait scene label exceeds its three-line safe region.");
  return lines;
}

const supportedKinds = new Set(["map", "chart", "diagram", "panel", "puppet", "screen", "context", "evidence", "hook", "reversal", "escalation", "opening", "question", "claim", "observation", "problem", "experiment", "choice", "result", "lesson", "resolution"]);
const scenarioKinds: Record<string, readonly string[]> = {
  ai_town: ["town_overview", "town_turn"], ai_decision: ["decision_options", "decision_outcome"], ai_pov: ["pov_hud"],
};

/** Fail before browser/bundling for unfinished portrait grammars and unsafe copy. */
export function preflightSceneLayout(manifest: SceneManifest, layout: ResolvedSceneLayout) {
  const workedExample = preflightWorkedExampleLayout(manifest, layout.width, layout.height);
  if (workedExample) return workedExample;
  if (layout.id !== SCENE_PORTRAIT_PROFILE) return;
  if (manifest.audience !== "general") throw new Error("Portrait children grammar is unfinished and is not admitted by this visual foundation.");
  if (!Number.isFinite(manifest.durationSec) || manifest.durationSec <= 0 || !manifest.scenes.length) throw new Error("Portrait manifest requires a positive duration and scenes.");
  const { safe, disclosure, visual, label } = SCENE_PORTRAIT_LAYOUT;
  for (const region of [disclosure, visual, label]) {
    if (!rectContains(safe, region)) throw new Error("Portrait layout region exceeds its safe area.");
  }
  let end = 0;
  for (const scene of [...manifest.scenes].sort((a, b) => a.t0 - b.t0)) {
    if (!Number.isFinite(scene.t0) || !Number.isFinite(scene.t1) || scene.t0 < 0 || scene.t1 <= scene.t0 || Math.abs(scene.t0 - end) > 1 / 30 || scene.t1 > manifest.durationSec + 1 / 30) throw new Error(`Portrait scene ${scene.id} has invalid or discontinuous timing.`);
    end = scene.t1;
    if (!supportedKinds.has(scene.kind)) throw new Error(`Unsupported portrait scene kind: ${scene.kind}.`);
    portraitLabelLines(scene.label);
    const state = scene.visualState as Record<string, unknown> | undefined;
    if (state?.evidenceVisualIntent !== undefined || state?.evidenceVisualManifest !== undefined) {
      throw new Error("Portrait factual-evidence attribution/geography grammar is unfinished; refuse before rendering.");
    }
    const profile = state?.syntheticScenarioProfile;
    const kind = state?.syntheticScenarioVisualKind;
    if (profile !== undefined || kind !== undefined) {
      if (typeof profile !== "string" || typeof kind !== "string" || !Object.hasOwn(scenarioKinds, profile) || !scenarioKinds[profile]!.includes(kind)) throw new Error("Unsupported or incomplete portrait fictional-scenario grammar/disclosure.");
    }
  }
  if (Math.abs(end - manifest.durationSec) > 1 / 30) throw new Error("Portrait scenes do not cover the complete manifest duration.");
}
