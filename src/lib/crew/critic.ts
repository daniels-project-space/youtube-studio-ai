/**
 * Critic — a per-channel CREW SUB-MODULE. The critic authors the ValidationSpec the
 * VERIFY stage enforces. The spec is already wired; what was DEAD is the operator's
 * control over it — criticStrictness + marketAwareCritic never reached the spec.
 * This module exposes them as a surface and applies them via `applyCriticPolicy`:
 * strictness re-weights assertion severity (block↔warn), marketAware injects a real
 * competitor-benchmark assertion. (Verify calls applyCriticPolicy when it adopts this.)
 */
import { moduleParams, type ChannelProfile } from "@/engine/channelProfile";
import { resolveKnobs, type KnobValue, type CustomizationSurface } from "@/engine/customization";
import type { ValidationSpec, ValidationAssertion } from "@/engine/creative/types";

export const CRITIC_SURFACE: CustomizationSurface = {
  capabilities: [
    "critic strictness (re-weights ValidationSpec block↔warn)",
    "market-aware critic (inject a 'beats real competitors' assertion)",
    "authors the ValidationSpec the verify stage enforces",
  ],
  knobs: [
    { id: "strictness", type: "enum", values: ["lenient", "standard", "strict"], default: "standard", describes: "how hard the critic gates output (block↔warn severity)", servesStyles: ["documentary", "meditation"] },
    { id: "marketAware", type: "boolean", default: true, describes: "add a vision check that the video beats scraped top competitors", servesStyles: ["competitive"] },
  ],
  presets: {
    documentary: { strictness: "strict", marketAware: true },
    essay: {},
    hype: { strictness: "standard", marketAware: true },
    shorts: { strictness: "standard", marketAware: true },
    meditation: { strictness: "lenient", marketAware: false },
    lofi: { strictness: "lenient", marketAware: false },
  },
};

export type CriticStrictnessLevel = "lenient" | "standard" | "strict";

export interface CriticConfig {
  strictness: CriticStrictnessLevel;
  marketAware: boolean;
}

export const CRITIC_BLOCK = "critic_spec";

export function resolveCriticConfig(profile: ChannelProfile, block = CRITIC_BLOCK): CriticConfig {
  const raw = moduleParams(profile, block);
  const preset = typeof raw["preset"] === "string" ? (raw["preset"] as string) : undefined;
  const overrides: Record<string, KnobValue> = {};
  for (const k of CRITIC_SURFACE.knobs) {
    const v = raw[k.id];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") overrides[k.id] = v;
  }
  const r = resolveKnobs(CRITIC_SURFACE, preset, overrides);
  if (!r.ok) throw new Error(`resolveCriticConfig: ${r.errors.join("; ")}`);
  const k = r.values;
  return { strictness: String(k.strictness) as CriticStrictnessLevel, marketAware: Boolean(k.marketAware) };
}

const MARKET_ASSERTION: ValidationAssertion = {
  id: "market_benchmark",
  description: "beats the scraped top competitors on hook framing + thumbnail (vision-judged)",
  check: "vision",
  severity: "warn",
};

/**
 * Apply the critic config to a ValidationSpec — THE wire that closes criticStrictness /
 * marketAwareCritic into what Verify enforces. Pure.
 *   lenient → block assertions soften to warn (more permissive)
 *   strict  → warn assertions harden to block (more gating)
 *   marketAware → inject the competitor-benchmark assertion (idempotent)
 */
export function applyCriticPolicy(spec: ValidationSpec, cfg: CriticConfig): ValidationSpec {
  const assertions: ValidationAssertion[] = spec.assertions.map((a) => {
    if (cfg.strictness === "lenient" && a.severity === "block") return { ...a, severity: "warn" };
    if (cfg.strictness === "strict" && a.severity === "warn") return { ...a, severity: "block" };
    return a;
  });
  if (cfg.marketAware && !assertions.some((a) => a.id === MARKET_ASSERTION.id)) {
    assertions.push({ ...MARKET_ASSERTION });
  }
  return { assertions };
}

export const CRITIC_MODULE = {
  key: "critic_spec",
  title: "Crew · Critic",
  stage: "brief",
  does:
    "The critic authors the ValidationSpec the verify stage enforces. This module exposes the operator's " +
    "control over it — strictness re-weights assertion severity (block↔warn), marketAware injects a " +
    "competitor-benchmark check — via applyCriticPolicy(spec, config). Closes the criticStrictness/marketAware loop.",
  produces: { kind: "critic_policy", file: "n/a", returns: "CriticConfig + applyCriticPolicy(spec) → re-weighted ValidationSpec" },
  requires: { channelProfile: "ChannelProfile — supplies critic preset + overrides (moduleConfig['critic_spec'])" },
  optional: {},
  needs: { secrets: [] as string[], tools: [], note: "Pure transform; the verify stage applies it to the authored ValidationSpec (adopted at cutover)." },
  customization: CRITIC_SURFACE,
  rules: [
    "STRICTNESS WIRED: lenient softens block→warn, strict hardens warn→block (re-weights the verify gate).",
    "MARKET-AWARE: injects a real vision assertion (beats competitors) — not vaporware, an actual ValidationAssertion.",
    "PER-ACCOUNT: strictness + marketAware come from moduleConfig['critic_spec'] (preset + overrides).",
  ],
} as const;
