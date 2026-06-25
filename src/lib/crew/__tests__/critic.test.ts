/**
 * Critic crew sub-module test (tsx). Proves criticStrictness + marketAware (previously
 * never reaching the spec) now re-weight the ValidationSpec the verify stage enforces.
 */
import assert from "node:assert/strict";
import { buildChannelProfile, type ChannelProfile } from "@/engine/channelProfile";
import { configurableModules, moduleSurface } from "@/engine/moduleRegistry";
import { resolveCriticConfig, applyCriticPolicy, CRITIC_SURFACE } from "../critic";
import { resolveKnobs } from "@/engine/customization";
import type { ValidationSpec } from "@/engine/creative/types";

function profileWith(params: Record<string, unknown>): ChannelProfile {
  return buildChannelProfile({
    row: { _id: "c", name: "C", slug: "c", status: "active", template: "A", budget: 1, identity: {} },
    archetype: "narrated-essay",
    pipeline: [{ block: "critic_spec", params }],
  });
}

const spec: ValidationSpec = {
  assertions: [
    { id: "hook_2s", description: "hook lands by 2s", check: "vision", severity: "block" },
    { id: "loudness", description: "near -14 LUFS", check: "deterministic", metric: "lufs", op: ">=", threshold: -15, severity: "warn" },
  ],
};

function configResolves(): void {
  assert.equal(resolveCriticConfig(profileWith({ preset: "documentary" })).strictness, "strict", "documentary = strict critic");
  assert.equal(resolveCriticConfig(profileWith({ preset: "meditation" })).marketAware, false, "meditation drops market-aware");
  assert.equal(resolveCriticConfig(profileWith({})).strictness, "standard", "default standard");
  console.log("CONFIG PASS: critic presets resolve (strictness, marketAware)");
}

function strictnessReweights(): void {
  const strict = applyCriticPolicy(spec, { strictness: "strict", marketAware: false });
  assert.equal(strict.assertions.find((a) => a.id === "loudness")?.severity, "block", "strict: warn → block (harder gate)");
  assert.equal(strict.assertions.find((a) => a.id === "hook_2s")?.severity, "block", "strict keeps block");

  const lenient = applyCriticPolicy(spec, { strictness: "lenient", marketAware: false });
  assert.equal(lenient.assertions.find((a) => a.id === "hook_2s")?.severity, "warn", "lenient: block → warn (softer gate)");

  const std = applyCriticPolicy(spec, { strictness: "standard", marketAware: false });
  assert.equal(std.assertions.find((a) => a.id === "hook_2s")?.severity, "block", "standard: unchanged");
  console.log("STRICTNESS PASS: criticStrictness re-weights the ValidationSpec (was DEAD)");
}

function marketAwareInjects(): void {
  const on = applyCriticPolicy(spec, { strictness: "standard", marketAware: true });
  const m = on.assertions.find((a) => a.id === "market_benchmark");
  assert.ok(m && m.check === "vision" && m.severity === "warn", "marketAware injects a real vision assertion (not vaporware)");
  // idempotent
  const again = applyCriticPolicy(on, { strictness: "standard", marketAware: true });
  assert.equal(again.assertions.filter((a) => a.id === "market_benchmark").length, 1, "no duplicate market_benchmark");
  const off = applyCriticPolicy(spec, { strictness: "standard", marketAware: false });
  assert.ok(!off.assertions.some((a) => a.id === "market_benchmark"), "marketAware off ⇒ no competitor assertion");
  console.log("MARKET-AWARE PASS: flag injects a real competitor assertion (idempotent)");
}

function surfaceAndRegistry(): void {
  for (const name of Object.keys(CRITIC_SURFACE.presets)) assert.ok(resolveKnobs(CRITIC_SURFACE, name).ok, `critic preset '${name}' valid`);
  assert.ok(configurableModules().some((m) => m.blockId === "critic_spec"), "critic registered in MODULE_REGISTRY");
  assert.ok(moduleSurface("critic_spec")?.knobs.some((k) => k.id === "strictness"), "critic surface UI-enumerable");
  assert.throws(() => resolveCriticConfig(profileWith({ strictness: "brutal" })), /resolveCriticConfig/, "illegal strictness throws");
  console.log("SURFACE/REGISTRY PASS: presets valid + registered + illegal throws");
}

function main(): void {
  configResolves();
  strictnessReweights();
  marketAwareInjects();
  surfaceAndRegistry();
  console.log("\nALL CRITIC TESTS PASSED");
}

main();
