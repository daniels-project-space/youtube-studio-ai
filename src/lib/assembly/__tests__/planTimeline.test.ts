/**
 * planTimeline parity + behavior test (tsx).
 *
 * Asserts the pure planner reproduces the god-block's MATH exactly (intro/body/tail
 * length, bodySegSeconds cadence, interleave, cards, duck levels) and that every
 * plan it emits passes the validate-before-spend gate.
 */
import assert from "node:assert/strict";
import {
  planTimeline,
  bodySegSeconds,
  resolveAssembleParams,
  ASSEMBLE_DEFAULTS,
  cutSheetPacingCurve,
  composeHookCurve,
  type PlanInput,
} from "../planTimeline";
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
  // 10s clips covering narration + tail + the 3s ANTI-LOOP BUFFER = 126s
  // → 13 clips (12×10 + 1×6). The buffer is god-block parity
  // (`targetSec: narrationSec + tailSec + 3`, narratedBlocks.ts:2122): clips that
  // come up short of their planned window would otherwise leave the body under
  // length, and composeWithIntro LOOPS a short body back to clip 1 at the tail.
  assert.equal(body.length, 13, "body covers narration+tail+buffer at 10s cadence");
  assert.ok(body.slice(0, 12).every((s) => s.durSec === 10), "full body clips are 10s");
  assert.equal(body[12].durSec, 6, "last body clip is the 6s remainder (3s tail + 3s buffer)");
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

function authoredShotMapping(): void {
  const generation = {
    contractVersion: "1.0.0" as const,
    profileId: "production" as const,
    model: "Lightricks/LTX-2.5",
    revision: "ce298b1259d61ce6c87e05154b9ad339b16f32a0",
    checkpoint: "ltx-2.5-22b-distilled-transformer-bf16.safetensors",
    precision: "bf16" as const,
    width: 1280,
    height: 704,
    steps: 8,
    allowFallback: false as const,
    fps: 25,
    guidanceScale: 1,
    pipeline: "distilled" as const,
    twoStageRefine: true as const,
    textEncoderCheckpoint: "gemma4-12b-with-proj-ltx-2.5-bf16.safetensors",
    videoVaeCheckpoint: "ltx-2.5-video-vae-bf16.safetensors",
    audioVaeCheckpoint: "ltx-2.5-audio-vae-bf16.safetensors",
    spatialUpscalerCheckpoint: "ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors",
    quantization: "fp8-cast" as const,
    offload: "cpu" as const,
    spatialUpscaleFactor: 2 as const,
    stageOneWidth: 640,
    stageOneHeight: 352,
    outputWidth: 1280,
    outputHeight: 704,
  };
  const shotRenderManifest = {
    version: "1.0.0" as const,
    generation,
    durationSec: 120,
    items: [
      { shotId: "shot-a", clipKey: "r2/a.mp4", t0: 0, t1: 47.5, sourceSentenceIds: ["sentence-1"], continuityState: "state-a" },
      { shotId: "shot-b", clipKey: "r2/b.mp4", t0: 47.5, t1: 120, sourceSentenceIds: ["sentence-2"], continuityState: "state-b" },
    ],
  };
  const shotQaReport = {
    version: "1.1.0" as const,
    required: true as const,
    graderRan: true as const,
    passed: true as const,
    shots: ["shot-a", "shot-b"].map((shotId, index) => ({
      shotId, score: 0.9, threshold: 0.8, semanticAlignment: 0.9, continuity: 0.9,
      motionIntegrity: 0.9, artifactFree: 0.9, notes: [],
      temporalDynamism: {
        contract: "ltx-shot-temporal-qa/v1" as const,
        source: "ffmpeg/freezedetect" as const,
        verdict: "pass" as const,
        maxFreezeFraction: 0.04,
        maxStaticHoldSec:
          (shotRenderManifest.items[index]!.t1 - shotRenderManifest.items[index]!.t0) * 0.04,
        maxFrozenHoldSec: 0,
        openingFrozenHoldSec: 0,
        frozenIntervals: [],
        violatingIntervals: [],
      },
    })),
  };
  const visualCoverage = {
    version: "1.0.0" as const,
    mappedSec: 120,
    totalSec: 120,
    ratio: 1 as const,
    missingShotIds: [],
    duplicateShotIds: [],
  };
  const input = baseInput({
    chapterPlan: [{ kind: "card", durSec: 10, heading: "must not replace authored shots" }],
    shotRenderManifest,
    shotQaReport,
    visualCoverage,
  });
  const timeline = planTimeline(input);
  const body = timeline.segments.filter((segment) => segment.kind === "footage");
  assert.deepEqual(body.map((segment) => (segment as { src: string }).src), ["r2/a.mp4", "r2/b.mp4"]);
  assert.deepEqual(body.map((segment) => segment.durSec), [47.5, 72.5]);
  assert.equal(body.reduce((sum, segment) => sum + segment.durSec, 0), 120, "authored body covers narration exactly");
  assert.throws(
    () => planTimeline({ ...input, shotQaReport: undefined }),
    /Required|expected|invalid_type/i,
    "authored assembly fails closed without per-shot QA proof",
  );
  console.log("AUTHORED PASS: exact shot identity/order/timecodes + fail-closed QA proof");
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

/** P1/P2 unit-level interpolation: cutSheetPacingCurve + composeHookCurve produce the exact
 * cadence a step/hook curve implies at several posFrac points (before feeding cpmAtFrac). */
function pacingCurveInterpolation(): void {
  const curve = cutSheetPacingCurve([{ cutsPerMin: 2 }, { cutsPerMin: 8 }, { cutsPerMin: 20 }]);
  assert.ok(curve && curve.length > 0, "varying sections produce a curve");
  // step-shaped: flat within each third, jumps at the boundary
  const at = (frac: number): number => {
    const pts = [...(curve as { atFrac: number; cutsPerMin: number }[])].sort((a, b) => a.atFrac - b.atFrac);
    if (frac <= pts[0].atFrac) return pts[0].cutsPerMin;
    if (frac >= pts[pts.length - 1].atFrac) return pts[pts.length - 1].cutsPerMin;
    for (let i = 1; i < pts.length; i++) {
      if (frac <= pts[i].atFrac) {
        const a = pts[i - 1], b = pts[i];
        const t = (frac - a.atFrac) / Math.max(1e-6, b.atFrac - a.atFrac);
        return a.cutsPerMin + t * (b.cutsPerMin - a.cutsPerMin);
      }
    }
    return pts[pts.length - 1].cutsPerMin;
  };
  assert.equal(at(0), 2, "section 1 (2cpm) holds at the very start");
  assert.equal(at(0.1), 2, "still inside section 1 at frac 0.1");
  assert.equal(at(0.5), 8, "section 2 (8cpm) holds mid-body");
  assert.equal(at(0.9), 20, "section 3 (20cpm) holds late-body");
  assert.equal(at(1), 20, "final section holds through the end");

  // uniform sections ⇒ no curve (nothing to gain, falls back to flat legacy math)
  assert.equal(cutSheetPacingCurve([{ cutsPerMin: 8 }, { cutsPerMin: 8 }]), undefined, "uniform cadence ⇒ no curve");
  assert.equal(cutSheetPacingCurve([{ cutsPerMin: 8 }]), undefined, "single section ⇒ no curve");
  assert.equal(cutSheetPacingCurve(undefined), undefined, "no sections ⇒ no curve");

  // hook composition: first hookSec/bodyTargetSec of the body pinned to hookCutsPerMin, then hands off
  const hooked = composeHookCurve(undefined, 8, 16, 120, 6);
  assert.ok(hooked && hooked.length > 0, "hook seeds a curve even with no base curve");
  const hookFrac = 8 / 120;
  const atH = (frac: number): number => {
    const pts = [...(hooked as { atFrac: number; cutsPerMin: number }[])].sort((a, b) => a.atFrac - b.atFrac);
    if (frac <= pts[0].atFrac) return pts[0].cutsPerMin;
    if (frac >= pts[pts.length - 1].atFrac) return pts[pts.length - 1].cutsPerMin;
    for (let i = 1; i < pts.length; i++) {
      if (frac <= pts[i].atFrac) {
        const a = pts[i - 1], b = pts[i];
        const t = (frac - a.atFrac) / Math.max(1e-6, b.atFrac - a.atFrac);
        return a.cutsPerMin + t * (b.cutsPerMin - a.cutsPerMin);
      }
    }
    return pts[pts.length - 1].cutsPerMin;
  };
  assert.equal(atH(0), 16, "hook cadence at the very start");
  assert.equal(atH(hookFrac * 0.5), 16, "still inside the hook window");
  assert.equal(atH(hookFrac + 0.01), 6, "settles to the fallback cadence after the hook");
  assert.equal(atH(0.9), 6, "stays settled for the rest of the body");
  // no-op guards
  assert.equal(composeHookCurve(undefined, undefined, undefined, 120, 6), undefined, "no hookSec/hookCutsPerMin ⇒ no-op");
  assert.equal(composeHookCurve(undefined, 8, undefined, 120, 6), undefined, "hookCutsPerMin missing ⇒ no-op");
  assert.equal(composeHookCurve(undefined, 8, 16, 0, 6), undefined, "zero body length ⇒ no-op");
  console.log("INTERPOLATION PASS: cutSheetPacingCurve + composeHookCurve interpolate correctly at multiple posFrac points");
}

/** P1 end-to-end: a per-video CutSheet with DIFFERENT section cadences must no longer be
 * averaged into one flat clip length — each section's own cadence drives its own clips. */
function cutSheetUnaveraged(): void {
  const t = planTimeline(
    baseInput({
      cutSheet: { sections: [{ name: "cold-open", cutsPerMin: 2 }, { name: "mid", cutsPerMin: 8 }, { name: "climax", cutsPerMin: 20 }] },
    }),
  );
  const body = t.segments.filter((s) => s.kind !== "card").map((s) => (s as { durSec: number }).durSec);
  // OLD behavior (averaged): bodySegSeconds(120,{sections:[2,8,20]}) === round(60/avg(10)) === 6s FLAT.
  const legacyFlatSeg = bodySegSeconds(120, { sections: [{ cutsPerMin: 2 }, { cutsPerMin: 8 }, { cutsPerMin: 20 }] });
  assert.equal(legacyFlatSeg, 6, "sanity: the averaged formula alone would have produced a flat 6s cadence");
  assert.ok(!body.every((d) => d === body[0]), "NEW: body clips are NOT all the same length (un-averaged)");
  assert.equal(body[0], 30, "first clip uses section 1's OWN cadence (2cpm → 30s, clamped)");
  assert.ok(body.some((d) => d === 3), "a clip uses section 3's OWN cadence (20cpm → 3s) later in the body");
  assert.equal(body.reduce((a, b) => a + b, 0), 126, "full coverage: narration(120)+tail(3)+buffer(3)");
  console.log("CUTSHEET-UNAVERAGED PASS: varying per-section CutSheet cadence drives per-clip length (P1)");
}

/** Sections that all agree on ONE cadence carry nothing a curve could add — falls back to the
 * exact legacy `bodySegSeconds` flat math (not just "some other flat value"). */
function cutSheetUniformParity(): void {
  const t = planTimeline(baseInput({ cutSheet: { sections: [{ name: "a", cutsPerMin: 8 }, { name: "b", cutsPerMin: 8 }] } }));
  const body = t.segments.filter((s) => s.kind !== "card").map((s) => (s as { durSec: number }).durSec);
  const legacyFlatSeg = bodySegSeconds(120, { sections: [{ cutsPerMin: 8 }, { cutsPerMin: 8 }] });
  assert.equal(legacyFlatSeg, 8, "sanity: uniform 8cpm sections → legacy flat 8s");
  const fullLen = body.slice(0, -1);
  assert.ok(fullLen.every((d) => d === 8), "uniform sections ⇒ flat 8s clips, exactly the legacy bodySegSeconds path");
  console.log("CUTSHEET-UNIFORM PASS: sections that agree on one cadence ⇒ exact legacy flat math (parity)");
}

/** P2 end-to-end: editor.hookSec/hookCutsPerMin front-load faster cuts for the opening seconds
 * of the body, then hand off to the normal (here: legacy flat) cadence for the rest. */
function hookFrontLoad(): void {
  const t = planTimeline(baseInput({ editor: { hookSec: 8, hookCutsPerMin: 16 } }));
  const body = t.segments.filter((s) => s.kind !== "card").map((s) => (s as { durSec: number }).durSec);
  // bodyTargetSec = 126; hookFrac = 8/126 ≈ 0.0635. Hook cadence 16cpm → 3.75s clips while
  // posFrac < hookFrac; settle cadence 6cpm (bodyMaxSeg=10 legacy fallback) → 10s clips after.
  assert.equal(body[0], 3.75, "first clip inside the hook window (16cpm)");
  assert.equal(body[1], 3.75, "second clip still inside the hook window");
  assert.ok(body.slice(3, -1).every((d) => d === 10), "clips well after the hook settle to the legacy 10s cadence");
  // "measurably shorter" check: average duration of segments that START before hookSec vs. after
  let cursor = 0;
  const early: number[] = [];
  const late: number[] = [];
  for (const d of body) {
    if (cursor < 8) early.push(d); else late.push(d);
    cursor += d;
  }
  const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.ok(avg(early) < avg(late), `hook segments (avg ${avg(early)}s) measurably shorter than post-hook segments (avg ${avg(late)}s)`);
  assert.equal(body.reduce((a, b) => a + b, 0), 126, "hook composition still covers the full body target exactly");
  console.log("HOOK PASS: hookSec/hookCutsPerMin front-load faster cuts, then settle (P2)");
}

/** CRITICAL backward-compat check: a directives object with NO pacingCurve/hookSec, and a
 * CutSheet with no variation, must produce output IDENTICAL to the pre-P1/P2 flat behavior. */
function noCurveNoHookParity(): void {
  const withNoDirectives = planTimeline(baseInput());
  const withUnrelatedEditorFields = planTimeline(baseInput({ editor: { transitions: "hardcut", captionStyle: "minimal" } }));
  const durs = (t: ReturnType<typeof planTimeline>): number[] => t.segments.filter((s) => s.kind !== "card").map((s) => (s as { durSec: number }).durSec);
  assert.deepEqual(durs(withUnrelatedEditorFields), durs(withNoDirectives), "editor directives with no curve/hook fields ⇒ identical body durations");
  // exactly the pre-change fixture from bodyCoverageAndCadence(): 12×10s + 1×6s
  const d = durs(withNoDirectives);
  assert.equal(d.length, 13, "13 body clips (unchanged)");
  assert.ok(d.slice(0, 12).every((x) => x === 10), "12 full 10s clips (unchanged)");
  assert.equal(d[12], 6, "6s remainder clip (unchanged)");
  console.log("NO-CURVE/NO-HOOK PARITY PASS: absent directives ⇒ byte-identical pre-change behavior");
}

function main(): void {
  cadenceFormula();
  lengthAndStructure();
  bodyCoverageAndCadence();
  verticalReframe();
  chapterMode();
  noIntroCollapses();
  authoredShotMapping();
  perAccountParams();
  pacingCurveInterpolation();
  cutSheetUnaveraged();
  cutSheetUniformParity();
  hookFrontLoad();
  noCurveNoHookParity();
  console.log("\nALL PLANTIMELINE TESTS PASSED");
}

main();
