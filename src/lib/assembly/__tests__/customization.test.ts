/**
 * Customization-surface test (tsx). Proves: the surface validates knobs/presets,
 * preset+override resolution works, and resolveAssembleParams maps the surface to
 * AssembleParams per channel style — with the `essay`/default path matching the
 * legacy god-block (parity) and illegal config failing loud.
 */
import assert from "node:assert/strict";
import { validateKnobs, resolveKnobs } from "@/engine/customization";
import { buildChannelProfile, type ChannelProfile } from "@/engine/channelProfile";
import { ASSEMBLY_SURFACE } from "../module";
import { resolveAssembleParams, planTimeline, type PlanInput } from "../planTimeline";

function profileWith(params: Record<string, unknown>): ChannelProfile {
  return buildChannelProfile({
    row: { _id: "c", name: "C", slug: "c", status: "active", template: "A", budget: 1, identity: {} },
    archetype: "narrated-essay",
    pipeline: [{ block: "timeline_assemble", params }],
  });
}

function surfaceValidation(): void {
  assert.ok(validateKnobs(ASSEMBLY_SURFACE, { aspect: "9:16" }).ok, "valid enum passes");
  assert.equal(validateKnobs(ASSEMBLY_SURFACE, { aspect: "9:16" }).values.cutEnergy, "steady", "omitted knobs fall to default");
  assert.ok(!validateKnobs(ASSEMBLY_SURFACE, { aspect: "4:3" }).ok, "illegal enum rejected");
  assert.ok(!validateKnobs(ASSEMBLY_SURFACE, { targetLufs: -30 }).ok, "out-of-range number rejected");
  assert.ok(!validateKnobs(ASSEMBLY_SURFACE, { chapterCards: "yes" }).ok, "wrong type rejected");
  assert.ok(!validateKnobs(ASSEMBLY_SURFACE, { bogusKnob: 1 }).ok, "unknown knob rejected");
  console.log("SURFACE VALIDATION PASS: enum/range/type/unknown all fail loud, defaults fill");
}

function presetResolution(): void {
  assert.equal(resolveKnobs(ASSEMBLY_SURFACE, "shorts").values.aspect, "9:16", "preset applied");
  assert.equal(resolveKnobs(ASSEMBLY_SURFACE, "shorts", { aspect: "16:9" }).values.aspect, "16:9", "override beats preset");
  assert.ok(!resolveKnobs(ASSEMBLY_SURFACE, "nope").ok, "unknown preset rejected");
  // every shipped preset must be internally valid
  for (const name of Object.keys(ASSEMBLY_SURFACE.presets)) {
    assert.ok(resolveKnobs(ASSEMBLY_SURFACE, name).ok, `preset '${name}' must contain only valid knob values`);
  }
  console.log("PRESET RESOLUTION PASS: preset+override + all 6 presets internally valid");
}

function essayParity(): void {
  const p = resolveAssembleParams(profileWith({ preset: "essay" }));
  assert.equal(p.introSec, 5, "essay intro = title_card 5s");
  assert.equal(p.introMusicVol, 0.513, "essay duck intro = god-block 0.513");
  assert.equal(p.bodyMusicVol, 0.1026, "essay duck body = god-block 0.1026");
  assert.equal(p.cutsPerMin, undefined, "essay/steady ⇒ legacy length-based cadence (parity)");
  assert.equal(p.outroCard, true, "essay outro card on");
  assert.equal(p.aspect, "16:9", "essay horizontal");
  // default (no preset) also reproduces the duck + intro defaults
  const d = resolveAssembleParams(profileWith({}));
  assert.equal(d.introMusicVol, 0.513, "default duck = god-block");
  assert.equal(d.cutsPerMin, undefined, "default cadence legacy (parity)");
  console.log("ESSAY PARITY PASS: essay/default == legacy god-block behavior");
}

function shortsStyle(): void {
  const p = resolveAssembleParams(profileWith({ preset: "shorts" }));
  assert.equal(p.aspect, "9:16", "shorts vertical");
  assert.equal(p.cutsPerMin, 15, "frenetic ⇒ 15 cuts/min");
  assert.equal(p.introSec, 0, "shorts introStyle none ⇒ 0s");
  assert.equal(p.outroCard, false, "shorts outroStyle none ⇒ no outro card");
  assert.equal(p.tailSec, 1, "shorts tail 1s");

  const input: PlanInput = {
    footageClips: ["f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7"],
    narrationDurationSec: 30,
    narrationSrc: "n",
    musicSrc: "m",
    introCardSrc: "intro.mp4", // present, but introStyle none collapses it
  };
  const t = planTimeline(input, p);
  assert.equal(t.format.w, 1080, "9:16 portrait");
  assert.equal(t.format.h, 1920, "9:16 portrait");
  const hasIntroCard = t.segments.some((s) => s.kind === "card" && (s as { role: string }).role === "intro");
  const hasOutroCard = t.segments.some((s) => s.kind === "card" && (s as { role: string }).role === "outro");
  assert.ok(!hasIntroCard, "no intro card (style none)");
  assert.ok(!hasOutroCard, "no outro card (style none)");
  const firstClip = t.segments.find((s) => s.kind !== "card");
  assert.equal((firstClip as { durSec: number }).durSec, 4, "frenetic ⇒ ~4s clips (60/15)");
  console.log("SHORTS STYLE PASS: 9:16, frenetic 4s cuts, no intro/outro cards");
}

function meditationStyle(): void {
  const p = resolveAssembleParams(profileWith({ preset: "meditation" }));
  assert.equal(p.introMusicVol, 0.55, "gentle duck intro");
  assert.equal(p.bodyMusicVol, 0.25, "gentle duck body (music stays present)");
  assert.equal(p.tailSec, 6, "long ambient tail");
  assert.equal(p.targetLufs, -16, "quieter loudness target");
  assert.equal(p.cutsPerMin, 2, "still ⇒ 2 cuts/min (long holds)");
  console.log("MEDITATION STYLE PASS: gentle duck, long tail, quiet, slow holds");
}

function illegalOverrideThrows(): void {
  assert.throws(() => resolveAssembleParams(profileWith({ preset: "essay", aspect: "4:3" })), /resolveAssembleParams/, "illegal knob override fails loud");
  console.log("ILLEGAL OVERRIDE PASS: bad per-channel knob throws (no silent wrong config)");
}

function main(): void {
  surfaceValidation();
  presetResolution();
  essayParity();
  shortsStyle();
  meditationStyle();
  illegalOverrideThrows();
  console.log("\nALL CUSTOMIZATION TESTS PASSED");
}

main();
