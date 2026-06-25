/**
 * Editor crew sub-module test (tsx). Proves the editor is a real, customizable module
 * AND that its output is WIRED into Assembly — closing the dead loop where
 * CutSheet.transitions/cadence/captionStyle were produced-and-ignored.
 */
import assert from "node:assert/strict";
import { buildChannelProfile, type ChannelProfile } from "@/engine/channelProfile";
import { configurableModules, moduleSurface } from "@/engine/moduleRegistry";
import { resolveEditorConfig, editorDirectives, EDITOR_SURFACE } from "../editor";
import { resolveKnobs } from "@/engine/customization";
import { planTimeline, ASSEMBLE_DEFAULTS, type PlanInput } from "@/lib/assembly/planTimeline";

function profileWith(params: Record<string, unknown>): ChannelProfile {
  return buildChannelProfile({
    row: { _id: "c", name: "C", slug: "c", status: "active", template: "A", budget: 1, identity: {} },
    archetype: "narrated-essay",
    pipeline: [{ block: "editor_brief", params }],
  });
}

const body: PlanInput = {
  footageClips: ["f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9"],
  narrationDurationSec: 120,
  narrationSrc: "n",
  musicSrc: "m",
  introCardSrc: "i.mp4",
};

function configResolves(): void {
  const doc = resolveEditorConfig(profileWith({ preset: "documentary" }));
  assert.equal(doc.cadence, "slow", "documentary editor = slow");
  assert.equal(doc.cutsPerMin, 3, "slow → 3 cuts/min");
  assert.equal(doc.transitions, "crossfade", "documentary crossfades");
  const sh = resolveEditorConfig(profileWith({ preset: "shorts" }));
  assert.equal(sh.cutsPerMin, 15, "shorts frenetic → 15 cuts/min");
  assert.equal(sh.captionStyle, "karaoke", "shorts karaoke captions");
  const measured = resolveEditorConfig(profileWith({}));
  assert.equal(measured.cutsPerMin, undefined, "measured ⇒ legacy length-based cadence (parity)");
  console.log("CONFIG PASS: editor presets resolve (cadence→cpm, transitions, captionStyle)");
}

function wiredIntoAssembly(): void {
  // THE dead-loop closure: editor directives → Assembly plan
  const cfg = resolveEditorConfig(profileWith({ preset: "documentary" })); // crossfade, cpm 3, captionStyle minimal
  const t = planTimeline({ ...body, editor: editorDirectives(cfg) }, ASSEMBLE_DEFAULTS);
  assert.equal(t.renderHints?.transitions, "crossfade", "editor.transitions → Assembly renderHints (was DEAD)");
  assert.equal(t.renderHints?.captionStyle, "minimal", "editor.captionStyle → renderHints (was DEAD)");
  const firstClip = t.segments.find((s) => s.kind !== "card");
  assert.equal((firstClip as { durSec: number }).durSec, 20, "editor cadence (3 cuts/min) → 20s cuts (was only partially wired)");
  console.log("WIRED PASS: editor.transitions/captionStyle/cadence all reach Assembly (dead loop CLOSED)");
}

function editorBeatsChannelDefault(): void {
  // ASSEMBLE_DEFAULTS.transitions = hardcut; the editor overrides it.
  const t = planTimeline({ ...body, editor: { transitions: "crossfade", cutsPerMin: 8 } }, ASSEMBLE_DEFAULTS);
  assert.equal(t.renderHints?.transitions, "crossfade", "editor directive beats the channel assemble default");
  const firstClip = t.segments.find((s) => s.kind !== "card");
  assert.equal((firstClip as { durSec: number }).durSec, 8, "editor cadence (8 cuts/min) → ~8s cuts");
  console.log("AUTHORITY PASS: the editor directs Assembly (overrides the channel default)");
}

function noEditorParity(): void {
  // no editor directive ⇒ Assembly behaves exactly as before (parity)
  const t = planTimeline(body, ASSEMBLE_DEFAULTS);
  assert.equal(t.renderHints?.transitions, "hardcut", "no editor ⇒ channel default transition");
  const firstClip = t.segments.find((s) => s.kind !== "card");
  assert.equal((firstClip as { durSec: number }).durSec, 10, "no editor ⇒ legacy 10s cadence (parity)");
  console.log("PARITY PASS: no editor directive ⇒ Assembly unchanged");
}

function bodyDurs(t: ReturnType<typeof planTimeline>): number[] {
  return t.segments.filter((s) => s.kind === "footage" || s.kind === "entity").map((s) => (s as { durSec: number }).durSec);
}

function pacingCurveShapesBody(): void {
  // P1/P2: the editor's pacingShape produces a CURVE that varies per-clip length over
  // the body — replacing the single averaged cuts/min. Proven end-to-end through Assembly.
  const front = planTimeline({ ...body, editor: editorDirectives(resolveEditorConfig(profileWith({ preset: "shorts" }))) }, ASSEMBLE_DEFAULTS);
  const fd = bodyDurs(front);
  assert.ok(fd.length >= 4, "frontload produced enough body clips");
  assert.ok(fd[0] < fd[fd.length - 2], `frontload: first clip (${fd[0]}s) faster/shorter than settled clip (${fd[fd.length - 2]}s)`);

  const accel = planTimeline({ ...body, editor: editorDirectives(resolveEditorConfig(profileWith({ preset: "hype" }))) }, ASSEMBLE_DEFAULTS);
  const ad = bodyDurs(accel);
  assert.ok(ad.length >= 4, "accelerate produced enough body clips");
  assert.ok(ad[0] > ad[ad.length - 2], `accelerate: first clip (${ad[0]}s) slower/longer than late clip (${ad[ad.length - 2]}s)`);

  // flat (documentary has no pacingShape) ⇒ constant cadence = parity (no curve emitted)
  assert.equal(editorDirectives(resolveEditorConfig(profileWith({ preset: "documentary" }))).pacingCurve, undefined, "flat ⇒ no pacingCurve (parity)");
  const flat = planTimeline({ ...body, editor: editorDirectives(resolveEditorConfig(profileWith({ preset: "documentary" }))) }, ASSEMBLE_DEFAULTS);
  const fullLen = bodyDurs(flat).slice(0, -1); // drop the final remainder clip
  assert.ok(fullLen.length > 0 && fullLen.every((d) => d === fullLen[0]), "flat ⇒ all full body clips identical (parity, no curve)");
  console.log("CURVE PASS: pacingShape varies per-clip length (frontload fast→settle, accelerate build); flat = parity");
}

function silenceTrimWires(): void {
  const sh = resolveEditorConfig(profileWith({ preset: "shorts" }));
  assert.equal(sh.silenceTrim, "aggressive", "shorts trims dead air aggressively");
  const d = editorDirectives(sh);
  assert.ok(d.trim && d.trim.minSilenceSec === 0.4 && d.trim.padSec === 0.08, "aggressive → trim thresholds directive");

  const hype = editorDirectives(resolveEditorConfig(profileWith({ preset: "hype" })));
  assert.ok(hype.trim && hype.trim.minSilenceSec === 0.8, "hype → gentle trim");

  const doc = resolveEditorConfig(profileWith({ preset: "documentary" }));
  assert.equal(doc.silenceTrim, "off", "documentary default = no trim");
  assert.equal(editorDirectives(doc).trim, undefined, "off ⇒ no trim directive (parity)");
  console.log("TRIM PASS: silenceTrim knob → trim thresholds directive (off ⇒ none)");
}

function surfaceAndRegistry(): void {
  for (const name of Object.keys(EDITOR_SURFACE.presets)) assert.ok(resolveKnobs(EDITOR_SURFACE, name).ok, `editor preset '${name}' valid`);
  assert.ok(configurableModules().some((m) => m.blockId === "editor_brief"), "editor registered in MODULE_REGISTRY");
  assert.ok(moduleSurface("editor_brief")?.knobs.some((k) => k.id === "transitions"), "editor surface UI-enumerable");
  assert.throws(() => resolveEditorConfig(profileWith({ transitions: "wipe" })), /resolveEditorConfig/, "illegal knob throws");
  console.log("SURFACE/REGISTRY PASS: presets valid + registered + illegal throws");
}

function main(): void {
  configResolves();
  wiredIntoAssembly();
  editorBeatsChannelDefault();
  noEditorParity();
  pacingCurveShapesBody();
  silenceTrimWires();
  surfaceAndRegistry();
  console.log("\nALL EDITOR TESTS PASSED");
}

main();
