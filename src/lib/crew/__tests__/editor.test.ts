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
  // ASSEMBLE_DEFAULTS.transitions is "crossfade" (god-block parity: the live block
  // passes no crossfadeSec, so composeWithIntro's 0.8s default applies). Override
  // with "hardcut" — the value that DIFFERS from the default — so this still proves
  // the editor wins rather than just re-asserting the default.
  const t = planTimeline({ ...body, editor: { transitions: "hardcut", cutsPerMin: 8 } }, ASSEMBLE_DEFAULTS);
  assert.equal(t.renderHints?.transitions, "hardcut", "editor directive beats the channel assemble default");
  const firstClip = t.segments.find((s) => s.kind !== "card");
  assert.equal((firstClip as { durSec: number }).durSec, 8, "editor cadence (8 cuts/min) → ~8s cuts");
  console.log("AUTHORITY PASS: the editor directs Assembly (overrides the channel default)");
}

function noEditorParity(): void {
  // no editor directive ⇒ Assembly behaves exactly as before (parity)
  const t = planTimeline(body, ASSEMBLE_DEFAULTS);
  // Parity is "crossfade", NOT "hardcut": the god-block passes no crossfadeSec to
  // composeWithIntro, whose default is 0.8s — so every legacy video dissolves
  // title→body. "hardcut" here used to lock in a mismatch (the EDL path forced
  // crossfadeSec 0 against a legacy path that never did).
  assert.equal(t.renderHints?.transitions, "crossfade", "no editor ⇒ channel default transition (god-block's 0.8s dissolve)");
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

function hookKnobResolvesAndWires(): void {
  // P2: shorts preset carries an explicit retention hook (8s @ 16cpm, the doc's own example).
  const sh = resolveEditorConfig(profileWith({ preset: "shorts" }));
  assert.equal(sh.hookSec, 8, "shorts preset hookSec = 8");
  assert.equal(sh.hookCutsPerMin, 16, "shorts preset hookCutsPerMin = 16");
  const shDir = editorDirectives(sh);
  assert.equal(shDir.hookSec, 8, "hookSec reaches EditorDirectives");
  assert.equal(shDir.hookCutsPerMin, 16, "hookCutsPerMin reaches EditorDirectives");

  // presets that don't set a hook default to 0/0 ⇒ no hook directive emitted (parity)
  const doc = resolveEditorConfig(profileWith({ preset: "documentary" }));
  assert.equal(doc.hookSec, 0, "documentary default hookSec = 0 (off)");
  assert.equal(doc.hookCutsPerMin, 0, "documentary default hookCutsPerMin = 0 (off)");
  const docDir = editorDirectives(doc);
  assert.equal(docDir.hookSec, undefined, "off ⇒ no hookSec directive");
  assert.equal(docDir.hookCutsPerMin, undefined, "off ⇒ no hookCutsPerMin directive");

  // end-to-end through Assembly: the hook produces measurably shorter early clips than later ones
  const t = planTimeline({ ...body, editor: shDir }, ASSEMBLE_DEFAULTS);
  const durs = bodyDurs(t);
  assert.ok(durs.length >= 4, "hook-driven plan produced enough body clips");
  assert.ok(durs[0] < durs[durs.length - 2], `hook: first clip (${durs[0]}s) shorter than a settled late clip (${durs[durs.length - 2]}s)`);
  console.log("HOOK PASS: hookSec/hookCutsPerMin knob resolves, wires into EditorDirectives, and reaches Assembly (P2)");
}

/** Each preset's emitted pacingCurve is a SANE shape: hype climbs, shorts front-loads,
 * documentary/essay/meditation/lofi stay flat (no curve = parity, matching their pacingShape default). */
function presetsEmitSaneCurveShapes(): void {
  const FLAT_PRESETS = ["documentary", "essay", "meditation", "lofi"];
  for (const name of FLAT_PRESETS) {
    const dir = editorDirectives(resolveEditorConfig(profileWith({ preset: name })));
    assert.equal(dir.pacingCurve, undefined, `${name}: flat pacingShape ⇒ no curve`);
  }

  const hype = editorDirectives(resolveEditorConfig(profileWith({ preset: "hype" })));
  assert.ok(hype.pacingCurve && hype.pacingCurve.length >= 2, "hype emits a curve");
  const hypePts = [...(hype.pacingCurve ?? [])].sort((a, b) => a.atFrac - b.atFrac);
  assert.ok(hypePts[hypePts.length - 1].cutsPerMin > hypePts[0].cutsPerMin, "hype: climbs from a slower start to a faster climax");

  const shorts = editorDirectives(resolveEditorConfig(profileWith({ preset: "shorts" })));
  assert.ok(shorts.pacingCurve && shorts.pacingCurve.length >= 2, "shorts emits a curve");
  const shortsPts = [...(shorts.pacingCurve ?? [])].sort((a, b) => a.atFrac - b.atFrac);
  assert.ok(shortsPts[0].cutsPerMin >= shortsPts[shortsPts.length - 1].cutsPerMin, "shorts: front-loaded (starts at/above its settled cadence)");
  assert.equal(shorts.hookSec, 8, "shorts ALSO carries an explicit retention hook on top of its curve");

  // every preset's curve (when present) is well-formed: sorted-safe, positive cadence, valid fracs
  for (const name of Object.keys(EDITOR_SURFACE.presets)) {
    const dir = editorDirectives(resolveEditorConfig(profileWith({ preset: name })));
    if (!dir.pacingCurve) continue;
    for (const p of dir.pacingCurve) {
      assert.ok(p.atFrac >= 0 && p.atFrac <= 1, `${name}: curve point atFrac in [0,1]`);
      assert.ok(p.cutsPerMin > 0, `${name}: curve point cutsPerMin > 0`);
    }
  }
  console.log("PRESET-SHAPE PASS: hype climbs, shorts front-loads(+hook), flat presets emit no curve");
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
  hookKnobResolvesAndWires();
  presetsEmitSaneCurveShapes();
  silenceTrimWires();
  surfaceAndRegistry();
  console.log("\nALL EDITOR TESTS PASSED");
}

main();
