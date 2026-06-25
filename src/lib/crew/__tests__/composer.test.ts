/**
 * Composer crew sub-module test (tsx). Proves the composer is a real, customizable
 * module AND that its mix directives are WIRED into Assembly's audio — closing the
 * dead loop where AudioBrief.duckDb / bedLufs were produced-and-ignored.
 */
import assert from "node:assert/strict";
import { buildChannelProfile, type ChannelProfile } from "@/engine/channelProfile";
import { configurableModules, moduleSurface } from "@/engine/moduleRegistry";
import { resolveComposerConfig, composerDirectives, COMPOSER_SURFACE } from "../composer";
import { resolveKnobs } from "@/engine/customization";
import { planTimeline, ASSEMBLE_DEFAULTS, type PlanInput } from "@/lib/assembly/planTimeline";

function profileWith(params: Record<string, unknown>): ChannelProfile {
  return buildChannelProfile({
    row: { _id: "c", name: "C", slug: "c", status: "active", template: "A", budget: 1, identity: {} },
    archetype: "narrated-essay",
    pipeline: [{ block: "composer_brief", params }],
  });
}

const body: PlanInput = { footageClips: ["f0", "f1", "f2"], narrationDurationSec: 120, narrationSrc: "n", musicSrc: "m", introCardSrc: "i.mp4" };

function configResolves(): void {
  const med = resolveComposerConfig(profileWith({ preset: "meditation" }));
  assert.equal(med.bodyMusicVol, 0.25, "meditation gentle duck → 0.25");
  assert.equal(med.targetLufs, -16, "meditation quieter master");
  assert.equal(med.voiceFx, "warm", "meditation warm voice");
  assert.equal(resolveComposerConfig(profileWith({ preset: "lofi" })).bodyMusicVol, 1.0, "lofi = music-forward (no duck)");
  assert.equal(resolveComposerConfig(profileWith({ preset: "essay" })).bodyMusicVol, 0.1026, "essay standard duck == legacy (parity)");
  console.log("CONFIG PASS: composer presets resolve (duckDepth→vol, loudness, voiceFx)");
}

function wiredIntoAssembly(): void {
  const cfg = resolveComposerConfig(profileWith({ preset: "meditation" }));
  const t = planTimeline({ ...body, composer: composerDirectives(cfg) }, ASSEMBLE_DEFAULTS);
  assert.equal(t.audio.duck.bodyVol, 0.25, "composer duckDepth → Assembly duck level (was DEAD)");
  assert.equal(t.audio.targetLufs, -16, "composer loudness → Assembly loudnorm target (was DEAD)");
  assert.equal(t.audio.voiceFx, "warm", "composer voiceFx → audio plan");
  // lofi music-forward: no duck
  const lofi = planTimeline({ ...body, composer: composerDirectives(resolveComposerConfig(profileWith({ preset: "lofi" }))) }, ASSEMBLE_DEFAULTS);
  assert.equal(lofi.audio.duck.bodyVol, 1.0, "lofi → music plays full under (music-forward)");
  console.log("WIRED PASS: composer duck/loudness/voiceFx all reach Assembly (dead loop CLOSED)");
}

function composerBeatsDefault(): void {
  const t = planTimeline({ ...body, composer: { bodyMusicVol: 0.04, targetLufs: -13 } }, ASSEMBLE_DEFAULTS);
  assert.equal(t.audio.duck.bodyVol, 0.04, "composer directive beats the channel duck default");
  assert.equal(t.audio.targetLufs, -13, "composer loudness beats the channel default");
  console.log("AUTHORITY PASS: the composer directs the mix");
}

function noComposerParity(): void {
  const t = planTimeline(body, ASSEMBLE_DEFAULTS);
  assert.equal(t.audio.duck.bodyVol, 0.1026, "no composer ⇒ legacy duck (parity)");
  assert.equal(t.audio.targetLufs, undefined, "no composer ⇒ no loudness override (parity)");
  console.log("PARITY PASS: no composer directive ⇒ Assembly audio unchanged");
}

function surfaceAndRegistry(): void {
  for (const name of Object.keys(COMPOSER_SURFACE.presets)) assert.ok(resolveKnobs(COMPOSER_SURFACE, name).ok, `composer preset '${name}' valid`);
  assert.ok(configurableModules().some((m) => m.blockId === "composer_brief"), "composer registered in MODULE_REGISTRY");
  assert.ok(moduleSurface("composer_brief")?.knobs.some((k) => k.id === "duckDepth"), "composer surface UI-enumerable");
  assert.throws(() => resolveComposerConfig(profileWith({ loudness: -40 })), /resolveComposerConfig/, "out-of-range loudness throws");
  console.log("SURFACE/REGISTRY PASS: presets valid + registered + illegal throws");
}

function main(): void {
  configResolves();
  wiredIntoAssembly();
  composerBeatsDefault();
  noComposerParity();
  surfaceAndRegistry();
  console.log("\nALL COMPOSER TESTS PASSED");
}

main();
