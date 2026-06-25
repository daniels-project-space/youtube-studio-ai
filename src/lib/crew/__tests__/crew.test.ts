/**
 * Crew module test (tsx). Proves the data-driven crew: presets compose different
 * crews per channel style, role toggles are live (profile → resolveCrew), doctrines
 * come from the ShowBible, missing doctrines surface as typed warnings (not silent),
 * and the customization surface validates.
 */
import assert from "node:assert/strict";
import { buildChannelProfile, type ChannelProfile } from "@/engine/channelProfile";
import { resolveKnobs } from "@/engine/customization";
import { configurableModules, moduleSurface } from "@/engine/moduleRegistry";
import type { ShowBible } from "@/engine/creative/types";
import { resolveCrew, crewHasRole, CREW_SURFACE } from "..";

function profileWith(params: Record<string, unknown>, overrides?: Record<string, Record<string, unknown>>): ChannelProfile {
  return buildChannelProfile({
    row: { _id: "c", name: "C", slug: "c", status: "active", template: "A", budget: 1, identity: {} },
    archetype: "narrated-essay",
    pipeline: [{ block: "show-bible", params }],
    moduleOverrides: overrides,
  });
}

const fullBible: ShowBible = {
  positioning: "p", vibe: "v", iconicMotif: "m", worksInSpace: [], avoidInSpace: [],
  activeCrew: ["director", "cinematographer", "editor", "composer", "critic"],
  directorDoctrine: "lead with story", dpDoctrine: "moody key light", editorDoctrine: "hold the beat",
  composerDoctrine: "warm pads", criticDoctrine: "gate punch >=7", refreshedAt: 1,
};

function essayFullCrew(): void {
  const rc = resolveCrew(profileWith({ preset: "essay" }), fullBible);
  assert.equal(rc.members.length, 5, "essay = full 5-role crew");
  assert.equal(rc.criticStrictness, "standard", "essay critic standard");
  assert.ok(rc.marketAwareCritic, "market-aware critic on by default");
  assert.ok(rc.members.every((m) => m.hasDoctrine), "every active role has its authored doctrine");
  assert.equal(rc.warnings.length, 0, "no warnings when fully authored");
  assert.equal(rc.members.find((m) => m.role === "critic")?.informs[0], "verify", "critic informs verify");
  console.log("ESSAY PASS: full crew, doctrines wired, critic→verify");
}

function shortsTrimsCrew(): void {
  const rc = resolveCrew(profileWith({ preset: "shorts" }), fullBible);
  assert.ok(!crewHasRole(rc, "cinematographer"), "shorts drops the cinematographer");
  assert.ok(crewHasRole(rc, "editor") && crewHasRole(rc, "director"), "shorts keeps director + editor");
  assert.equal(rc.editorCadence, "frenetic", "shorts editor is frenetic");
  assert.equal(rc.directorStyle, "kinetic", "shorts director is kinetic");
  console.log("SHORTS PASS: crew trimmed (no DP), frenetic kinetic style");
}

function meditationComposerLed(): void {
  const rc = resolveCrew(profileWith({ preset: "meditation" }), fullBible);
  const roles = rc.members.map((m) => m.role).sort();
  assert.deepEqual(roles, ["composer", "critic", "director"], "meditation = director + composer + critic");
  assert.equal(rc.criticStrictness, "lenient", "meditation critic lenient");
  console.log("MEDITATION PASS: composer-led trio, lenient critic");
}

function lofiMinimal(): void {
  const rc = resolveCrew(profileWith({ preset: "lofi" }), fullBible);
  assert.deepEqual(rc.members.map((m) => m.role).sort(), ["composer", "director"], "lofi = director + composer only");
  console.log("LOFI PASS: minimal 2-role crew");
}

function overrideBeatsPreset(): void {
  const rc = resolveCrew(profileWith({ preset: "shorts" }, { "show-bible": { cinematographer: true } }), fullBible);
  assert.ok(crewHasRole(rc, "cinematographer"), "channel override re-enables the DP over the preset");
  console.log("OVERRIDE PASS: per-channel toggle beats the preset");
}

function missingDoctrineWarns(): void {
  // active roles but NO bible → every active role warns (no silent generic brief)
  const rc = resolveCrew(profileWith({ preset: "essay" }), null);
  assert.equal(rc.members.length, 5, "roles still resolve active");
  assert.ok(rc.members.every((m) => !m.hasDoctrine), "no doctrines without a bible");
  assert.equal(rc.warnings.length, 5, "each active role surfaces a typed warning (fail-loud-ready)");
  console.log("MISSING-DOCTRINE PASS: no bible → 5 typed warnings, never silent");
}

function illegalThrows(): void {
  assert.throws(() => resolveCrew(profileWith({ preset: "essay" }, { "show-bible": { criticStrictness: "brutal" } }), fullBible), /resolveCrew/, "illegal knob fails loud");
  console.log("ILLEGAL PASS: bad crew knob throws");
}

function surfaceAndRegistry(): void {
  for (const name of Object.keys(CREW_SURFACE.presets)) assert.ok(resolveKnobs(CREW_SURFACE, name).ok, `preset '${name}' valid`);
  assert.ok(configurableModules().some((m) => m.blockId === "show-bible"), "crew registered in MODULE_REGISTRY");
  assert.ok(moduleSurface("show-bible")?.knobs.some((k) => k.id === "critic"), "crew surface exposes role toggles to the UI");
  console.log("SURFACE/REGISTRY PASS: presets valid + crew registered + UI-enumerable");
}

function main(): void {
  essayFullCrew();
  shortsTrimsCrew();
  meditationComposerLed();
  lofiMinimal();
  overrideBeatsPreset();
  missingDoctrineWarns();
  illegalThrows();
  surfaceAndRegistry();
  console.log("\nALL CREW TESTS PASSED");
}

main();
