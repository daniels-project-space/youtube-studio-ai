/**
 * planTimeline parity + behavior test (tsx).
 *
 * Asserts the pure planner reproduces the god-block's MATH exactly (intro/body/tail
 * length, bodySegSeconds cadence, interleave, cards, duck levels) and that every
 * plan it emits passes the validate-before-spend gate.
 */
import assert from "node:assert/strict";
import { planTimeline, bodySegSeconds, resolveAssembleParams, ASSEMBLE_DEFAULTS, type PlanInput } from "../planTimeline";
import { validateTimeline, projectedDurationSec } from "../timeline";
import { buildChannelProfile } from "@/engine/channelProfile";

function baseInput(over: Partial<PlanInput> = {}): PlanInput {
  return {
    footageClips: ["f0.mp4", "f1.mp4", "f2.mp4", "f3.mp4"],
    entityClips: ["e0.jpg", "e1.jpg"],
    narrationSrc: "n.wav",
    narrationDurationSec: 120,
    musicSrc: "m.mp3",
    introCardSrc: "intro.mp4",
    sentenceTimings: [{ end: 10 }, { end: 20 }],
    closingLine: "Stay sharp.",
    channelName: "Test Channel",
    ...over,
  };
}

function cadenceFormula(): void {
  // matches narratedBlocks.bodySegSeconds exactly
  assert.equal(bodySegSeconds(120), 10, "short narration → 10s clips");
  assert.equal(bodySegSeconds(700), 25, "long narration (>600) → 25s clips");
  assert.equal(bodySegSeconds(120, { sections: [{ cutsPerMin: 6 }] }), 10, "6 cuts/min → 10s");
  assert.equal(bodySegSeconds(120, { sections: [{ cutsPerMin: 2 }] }), 30, "2 cuts/min → 30s (clamped max)");
  assert.equal(bodySegSeconds(120, { sections: [{ cutsPerMin: 20 }] }), 4, "20 cuts/min → 3 → clamped to 4 (min)");
  assert.equal(bodySegSeconds(120, { sections: [{ cutsPerMin: 4 }, { cutsPerMin: 8 }] }), 10, "avg 6 → 10s");
  console.log("CADENCE PASS: bodySegSeconds matches god-block formula");
}

function lengthAndStructure(): void {
  const t = planTimeline(baseInput());
  // intro 5 + narration 120 + tail 3
  assert.equal(t.audio.introSec, 5, "intro card → 5s");
  assert.equal(t.audio.bodySec, 120, "bodySec = narration");
  assert.equal(t.audio.tailSec, 3, "tail default 3");
  assert.equal(projectedDurationSec(t), 128, "total = 5+120+3 (parity with god-block videoSec)");
  assert.equal(t.format.w, 1920, "16:9 width");
  assert.equal(t.format.h, 1080, "16:9 height");
  // first = intro card, last = outro card
  assert.equal(t.segments[0].kind, "card", "first segment is a card");
  assert.equal((t.segments[0] as { role: string }).role, "intro", "…the intro card");
  const last = t.segments[t.segments.length - 1];
  assert.equal(last.kind, "card", "last segment is a card");
  assert.equal((last as { role: string }).role, "outro", "…the outro card");
  assert.equal((last as { title?: string }).title, "Stay sharp.", "outro uses the script closingLine");
  // duck levels preserved
  assert.equal(t.audio.duck.introVol, 0.513, "intro music vol preserved");
  assert.equal(t.audio.duck.bodyVol, 0.1026, "body music duck preserved");
  // the plan it emits must pass the render gate
  assert.ok(validateTimeline(t).ok, "planned timeline passes validateTimeline");
  console.log("LENGTH/STRUCTURE PASS: timing, format, cards, duck — parity + valid");
}

function bodyCoverageAndCadence(): void {
  const t = planTimeline(baseInput());
  const body = t.segments.filter((s) => s.kind !== "card");
  // 10s clips covering narration+tail = 123s → 13 clips (12×10 + 1×3)
  assert.equal(body.length, 13, "body covers narration+tail at 10s cadence");
  assert.ok(body.slice(0, 12).every((s) => s.durSec === 10), "full body clips are 10s");
  assert.equal(body[12].durSec, 3, "last body clip is the 3s remainder");
  // interleave order: f0, e0, f1, e1, f2, f3, then cycle
  const srcs = body.map((s) => (s as { src: string }).src);
  assert.deepEqual(srcs.slice(0, 6), ["f0.mp4", "e0.jpg", "f1.mp4", "e1.jpg", "f2.mp4", "f3.mp4"], "footage⇄entity interleave");
  assert.equal((body.find((s) => (s as { src: string }).src === "e0.jpg") as { kind: string }).kind, "entity", "entity clip tagged entity");
  console.log("BODY PASS: coverage count, remainder, interleave order, entity tagging");
}

function verticalReframe(): void {
  const t = planTimeline(baseInput(), { ...ASSEMBLE_DEFAULTS, aspect: "9:16" });
  assert.equal(t.format.w, 1080, "9:16 width");
  assert.equal(t.format.h, 1920, "9:16 height");
  assert.equal(t.reframe?.aspect, "9:16", "reframe set for vertical");
  console.log("VERTICAL PASS: 9:16 sets portrait format + reframe");
}

function chapterMode(): void {
  const t = planTimeline(
    baseInput({
      chapterPlan: [
        { kind: "card", durSec: 4, heading: "Origins" },
        { kind: "footage", durSec: 30 },
        { kind: "card", durSec: 4, heading: "The Fall" },
        { kind: "footage", durSec: 20 },
      ],
    }),
  );
  const chapterCards = t.segments.filter((s) => s.kind === "card" && (s as { role: string }).role === "chapter");
  assert.equal(chapterCards.length, 2, "two chapter cards rendered");
  assert.equal((chapterCards[0] as { title?: string }).title, "Origins", "chapter heading used as title");
  console.log("CHAPTER PASS: chapter windows → chapter cards + footage fills");
}

function noIntroCollapses(): void {
  const t = planTimeline(baseInput({ introCardSrc: "" }));
  assert.equal(t.audio.introSec, 0, "no intro card → introSec collapses to 0 (god-block parity)");
  assert.notEqual(t.segments[0].kind === "card" && (t.segments[0] as { role: string }).role === "intro", true, "no intro card segment");
  console.log("NO-INTRO PASS: missing intro card collapses introSec to 0");
}

function perAccountParams(): void {
  // a channel that runs assemble at 9:16 with a tight max + custom duck
  const profile = buildChannelProfile({
    row: { _id: "ch1", name: "Shorts Co", slug: "shorts-co", status: "active", template: "D", budget: 5, identity: {} },
    archetype: "shorts",
    pipeline: [{ block: "timeline_assemble", params: { aspect: "9:16", tailSec: 1, maxSeconds: 60, bodyMusicVol: 0.2 } }],
  });
  const p = resolveAssembleParams(profile);
  assert.equal(p.aspect, "9:16", "aspect read from profile pipeline params");
  assert.equal(p.tailSec, 1, "tailSec read from profile");
  assert.equal(p.maxSeconds, 60, "maxSeconds read from profile");
  assert.equal(p.bodyMusicVol, 0.2, "duck override read from profile");
  assert.equal(p.introMusicVol, 0.513, "unspecified param falls back to default");
  console.log("PER-ACCOUNT PASS: resolveAssembleParams reads ChannelProfile, defaults fill gaps");
}

function main(): void {
  cadenceFormula();
  lengthAndStructure();
  bodyCoverageAndCadence();
  verticalReframe();
  chapterMode();
  noIntroCollapses();
  perAccountParams();
  console.log("\nALL PLANTIMELINE TESTS PASSED");
}

main();
