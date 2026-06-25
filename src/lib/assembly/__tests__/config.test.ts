/**
 * Module-config wiring test (tsx). Proves the customization is UI-ready AND live:
 *   - the MODULE_REGISTRY exposes Assembly's surface (so onboarding/settings can render toggles)
 *   - a channel toggle (e.g. captions OFF) flows profile → resolveAssembleParams →
 *     planTimeline and actually changes the plan — NOT dead code.
 */
import assert from "node:assert/strict";
import { configurableModules, moduleSurface } from "@/engine/moduleRegistry";
import { buildChannelProfile } from "@/engine/channelProfile";
import { resolveAssembleParams, planTimeline, type PlanInput } from "../planTimeline";
import type { Overlay } from "../timeline";

function profileWith(params: Record<string, unknown>, moduleOverrides?: Record<string, Record<string, unknown>>) {
  return buildChannelProfile({
    row: { _id: "c", name: "C", slug: "c", status: "active", template: "A", budget: 1, identity: {} },
    archetype: "narrated-essay",
    pipeline: [{ block: "timeline_assemble", params }],
    moduleOverrides,
  });
}

function registryExposesSurface(): void {
  const mods = configurableModules();
  assert.ok(mods.some((m) => m.blockId === "timeline_assemble"), "assembly is registered");
  const surf = moduleSurface("timeline_assemble");
  assert.ok(surf, "assembly surface resolvable by block id (UI reads this)");
  assert.ok(surf!.knobs.some((k) => k.id === "captions"), "captions knob is enumerable for the UI toggle");
  assert.ok(surf!.knobs.some((k) => k.id === "cutEnergy" && k.type === "enum"), "enum knobs carry options for a <select>");
  assert.equal(moduleSurface("nope"), undefined, "unknown block → no surface");
  console.log("REGISTRY PASS: assembly surface + captions knob enumerable for onboarding/settings UI");
}

function captionsToggleEndToEnd(): void {
  const input: PlanInput = {
    footageClips: ["f0", "f1", "f2"],
    narrationDurationSec: 60,
    narrationSrc: "n",
    musicSrc: "m",
    introCardSrc: "i.mp4",
    overlays: [
      { kind: "caption", startSec: 5, endSec: 30 },
      { kind: "quote", startSec: 35, endSec: 45 },
    ] as Overlay[],
  };

  // default ON
  const on = resolveAssembleParams(profileWith({}));
  assert.equal(on.captions, true, "captions default ON");
  assert.ok(planTimeline(input, on).overlays.some((o) => o.kind === "caption"), "captions present when ON");

  // one-click OFF via channel moduleConfig (what the settings toggle writes → moduleOverrides)
  const off = resolveAssembleParams(profileWith({}, { timeline_assemble: { captions: false } }));
  assert.equal(off.captions, false, "settings toggle flows to params");
  const planned = planTimeline(input, off);
  assert.ok(!planned.overlays.some((o) => o.kind === "caption"), "NO caption overlays when toggled off (live, not dead code)");
  assert.ok(planned.overlays.some((o) => o.kind === "quote"), "only captions dropped — quotes survive");
  console.log("CAPTIONS TOGGLE PASS: channel config → profile → params → plan (one-click off works)");
}

function presetCaptions(): void {
  assert.equal(resolveAssembleParams(profileWith({ preset: "meditation" })).captions, false, "meditation preset ships caption-free");
  assert.equal(resolveAssembleParams(profileWith({ preset: "essay" })).captions, true, "essay preset keeps captions");
  console.log("PRESET CAPTIONS PASS: presets carry the captions default per style");
}

function main(): void {
  registryExposesSurface();
  captionsToggleEndToEnd();
  presetCaptions();
  console.log("\nALL CONFIG-WIRING TESTS PASSED");
}

main();
