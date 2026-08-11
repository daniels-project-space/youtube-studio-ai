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

/**
 * CUTOVER SWITCH IS OFF — the safety proof for `useAssemblyEdl`, the per-channel
 * operator flag that makes `timeline_assemble` compose via the standalone
 * Assembly EDL module instead of the legacy god-block (narratedBlocks.ts).
 *
 * The flag exists so the cutover can be piloted on ONE channel with a config
 * write. This test pins the "off" state so it cannot drift into a default:
 * default false, absent from every preset, INERT on param resolution, and —
 * critically — never even present in `ctx.params` for a channel that has not
 * explicitly written it (the exact predicate the block branches on).
 */
function cutoverFlagDefaultsOff(): void {
  const knob = ASSEMBLY_SURFACE.knobs.find((k) => k.id === "useAssemblyEdl");
  assert.ok(knob, "useAssemblyEdl knob exists on the surface");
  assert.equal(knob.type, "boolean", "cutover switch is a boolean knob");
  assert.equal(knob.default, false, "CUTOVER SWITCH DEFAULT MUST BE false");

  // No preset may turn it on — not even implicitly, via an Architect preset pick.
  for (const [name, values] of Object.entries(ASSEMBLY_SURFACE.presets)) {
    assert.ok(
      !("useAssemblyEdl" in values),
      `preset '${name}' must not mention the cutover switch at all`,
    );
    assert.equal(
      resolveKnobs(ASSEMBLY_SURFACE, name).values.useAssemblyEdl,
      false,
      `preset '${name}' resolves the cutover switch to false`,
    );
  }
  assert.equal(
    resolveKnobs(ASSEMBLY_SURFACE).values.useAssemblyEdl,
    false,
    "no preset ⇒ cutover switch false",
  );

  // INERT: the switch selects a code path, it must not perturb ANY resolved
  // AssembleParams — off, explicitly-off, and on must all produce identical params.
  const base = resolveAssembleParams(profileWith({ preset: "essay" }));
  const explicitOff = resolveAssembleParams(profileWith({ preset: "essay", useAssemblyEdl: false }));
  const explicitOn = resolveAssembleParams(profileWith({ preset: "essay", useAssemblyEdl: true }));
  assert.deepEqual(explicitOff, base, "useAssemblyEdl=false does not perturb AssembleParams");
  assert.deepEqual(explicitOn, base, "useAssemblyEdl=true does not perturb AssembleParams (path switch only)");

  // THE DEFAULT PATH IS UNCHANGED. Replays runPipeline.ts's moduleConfig→params
  // merge (runPipeline.ts:479-496): only knobs the channel EXPLICITLY chose (via
  // preset keys or overrides) are folded into ctx.params. A channel that never
  // wrote this knob therefore has no `useAssemblyEdl` key in ctx.params at all,
  // so narratedBlocks' `ctx.params["useAssemblyEdl"] === true` is false.
  const mergeLikeRunPipeline = (cfg: { preset?: string } & Record<string, unknown>) => {
    const { preset, ...overrides } = cfg;
    const r = resolveKnobs(ASSEMBLY_SURFACE, preset, overrides as Parameters<typeof resolveKnobs>[2]);
    assert.ok(r.ok, `moduleConfig must validate: ${r.errors.join("; ")}`);
    const chosen = new Set([
      ...(preset ? Object.keys(ASSEMBLY_SURFACE.presets[preset] ?? {}) : []),
      ...Object.keys(overrides),
    ]);
    return Object.fromEntries(
      Object.entries(r.values as Record<string, unknown>).filter(([k]) => chosen.has(k)),
    );
  };

  for (const cfg of [{}, { preset: "essay" }, { preset: "documentary" }, { preset: "shorts" }, { captions: false }]) {
    const params = mergeLikeRunPipeline(cfg);
    assert.ok(
      !("useAssemblyEdl" in params),
      `channel config ${JSON.stringify(cfg)} must not put the cutover switch into ctx.params`,
    );
    assert.notEqual(params["useAssemblyEdl"], true, "legacy god-block path taken");
  }

  // Only an EXPLICIT per-channel opt-in reaches the branch.
  assert.equal(mergeLikeRunPipeline({ useAssemblyEdl: true })["useAssemblyEdl"], true, "explicit opt-in propagates");

  // `=== true`, not truthiness: half-written / legacy-shaped config stays legacy.
  const takesEdl = (params: Record<string, unknown>) => params["useAssemblyEdl"] === true;
  for (const v of [undefined, false, 0, 1, "true", "yes", null, ""]) {
    assert.equal(takesEdl({ useAssemblyEdl: v }), false, `non-boolean-true ${JSON.stringify(v)} ⇒ legacy path`);
  }
  assert.equal(takesEdl({}), false, "absent key ⇒ legacy path");
  assert.equal(takesEdl({ useAssemblyEdl: true }), true, "explicit true ⇒ EDL path");

  console.log(
    "CUTOVER FLAG PASS: useAssemblyEdl default false, in no preset, inert on params, " +
      "absent from ctx.params unless a channel explicitly opts in (===true gate)",
  );
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
  cutoverFlagDefaultsOff();
  illegalOverrideThrows();
  console.log("\nALL CUSTOMIZATION TESTS PASSED");
}

main();
