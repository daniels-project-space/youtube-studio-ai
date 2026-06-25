/**
 * Director crew sub-module test (tsx). Proves the director is a real, customizable
 * module AND that its beat map is WIRED into Assembly via a chapterPlan — closing the
 * dead loop where StructureBrief.beats `intentSec` was dropped.
 */
import assert from "node:assert/strict";
import { buildChannelProfile, type ChannelProfile } from "@/engine/channelProfile";
import { configurableModules, moduleSurface } from "@/engine/moduleRegistry";
import { resolveDirectorConfig, directorChapterPlan, DIRECTOR_SURFACE, type StructureBeat } from "../director";
import { resolveKnobs } from "@/engine/customization";
import { planTimeline, ASSEMBLE_DEFAULTS, type PlanInput } from "@/lib/assembly/planTimeline";

function profileWith(params: Record<string, unknown>): ChannelProfile {
  return buildChannelProfile({
    row: { _id: "c", name: "C", slug: "c", status: "active", template: "A", budget: 1, identity: {} },
    archetype: "narrated-essay",
    pipeline: [{ block: "director_brief", params }],
  });
}

const beats: StructureBeat[] = [
  { name: "Origins", intentSec: 30, note: "set the scene" },
  { name: "The Fall", intentSec: 40, note: "tension" },
  { name: "Aftermath", intentSec: 25, note: "resolve" },
];

function configResolves(): void {
  const doc = resolveDirectorConfig(profileWith({ preset: "documentary" }));
  assert.equal(doc.narrativeArc, "chronological", "documentary = chronological");
  assert.equal(doc.beatCount, 8, "documentary 8 beats");
  assert.equal(doc.useChapters, true, "documentary uses chapters");
  const sh = resolveDirectorConfig(profileWith({ preset: "shorts" }));
  assert.equal(sh.hookStyle, "in_media_res", "shorts hook = in_media_res");
  assert.equal(sh.useChapters, false, "shorts: no chapters");
  console.log("CONFIG PASS: director presets resolve (hook/arc/pacing/beats/chapters)");
}

function chaptersOffByDefault(): void {
  const cfg = resolveDirectorConfig(profileWith({ preset: "essay" }));
  assert.equal(directorChapterPlan(beats, cfg), undefined, "essay (useChapters false) → no chapterPlan");
  console.log("CHAPTERS-OFF PASS: no chapters ⇒ Assembly stays in beat-body mode");
}

function intentSecWiredToAssembly(): void {
  // THE dead-loop closure: director beats (intentSec) → chapterPlan → Assembly chapter windows
  const cfg = resolveDirectorConfig(profileWith({ preset: "documentary" })); // useChapters true
  const plan = directorChapterPlan(beats, cfg);
  assert.ok(plan && plan.length === 6, "3 beats → 3 card + 3 footage windows");
  assert.equal(plan!.filter((w) => w.kind === "card").length, 3, "one heading card per beat");
  assert.equal(plan!.find((w) => w.kind === "card")?.heading, "Origins", "beat name → chapter heading");
  // footage windows carry the beats' intended seconds (was DROPPED)
  const footageDurs = plan!.filter((w) => w.kind === "footage").map((w) => w.durSec);
  assert.deepEqual(footageDurs, [30, 40, 25], "footage windows = beat intentSec (intentSec now WIRED)");

  // and it flows through Assembly's chapter mode
  const t = planTimeline(
    { footageClips: ["f0", "f1", "f2", "f3", "f4"], narrationDurationSec: 95, narrationSrc: "n", musicSrc: "m", introCardSrc: "i.mp4", chapterPlan: plan },
    { ...ASSEMBLE_DEFAULTS, chapterCards: true },
  );
  const chapterCards = t.segments.filter((s) => s.kind === "card" && (s as { role: string }).role === "chapter");
  assert.equal(chapterCards.length, 3, "Assembly renders 3 chapter cards from the director's beats");
  assert.equal((chapterCards[0] as { title?: string }).title, "Origins", "director beat name → Assembly chapter title");
  console.log("INTENTSEC-WIRED PASS: beats(intentSec) → chapterPlan → Assembly chapters (dead loop CLOSED)");
}

function surfaceAndRegistry(): void {
  for (const name of Object.keys(DIRECTOR_SURFACE.presets)) assert.ok(resolveKnobs(DIRECTOR_SURFACE, name).ok, `director preset '${name}' valid`);
  assert.ok(configurableModules().some((m) => m.blockId === "director_brief"), "director registered in MODULE_REGISTRY");
  assert.ok(moduleSurface("director_brief")?.knobs.some((k) => k.id === "narrativeArc"), "director surface UI-enumerable");
  assert.throws(() => resolveDirectorConfig(profileWith({ beatCount: 99 })), /resolveDirectorConfig/, "out-of-range beatCount throws");
  console.log("SURFACE/REGISTRY PASS: presets valid + registered + illegal throws");
}

function main(): void {
  configResolves();
  chaptersOffByDefault();
  intentSecWiredToAssembly();
  surfaceAndRegistry();
  console.log("\nALL DIRECTOR TESTS PASSED");
}

main();
