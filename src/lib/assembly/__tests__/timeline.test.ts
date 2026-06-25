/**
 * Assembly Timeline/EDL contract test (runnable via tsx).
 *
 * Exercises REAL behavior of the module's validate-before-spend gate (no mocks):
 *   POSITIVE: a well-formed narrated plan validates, applies schema defaults, and
 *             projects the right runtime.
 *   NEGATIVE: every guard the renderer relies on MUST fail loud here —
 *             length band, overlay windows, body coverage, heal checkpoint,
 *             and structural shape (discriminated union + required fields).
 */
import assert from "node:assert/strict";
import {
  validateTimeline,
  projectedDurationSec,
  TimelineSchema,
  type Timeline,
} from "../timeline";

/** A complete, valid narrated plan. Override fields per case. */
function base(): unknown {
  return {
    format: { w: 1920, h: 1080 }, // fps defaults to 30
    segments: [
      { kind: "card", role: "intro", durSec: 5, title: "Hello" },
      { kind: "footage", src: "a.mp4", durSec: 25, onBeat: true },
      { kind: "entity", src: "marcus.jpg", durSec: 25 },
      { kind: "footage", src: "b.mp4", durSec: 25 },
    ],
    audio: { narrationSrc: "n.wav", musicSrc: "m.mp3", introSec: 5, bodySec: 60, tailSec: 3 },
    overlays: [{ kind: "caption", startSec: 5, endSec: 64 }],
    lengthBand: { minSec: 30, maxSec: 120 },
    checkpoints: { preOverlaySec: 64 },
  };
}

function valid(): void {
  const r = validateTimeline(base());
  assert.ok(r.ok, `valid plan should pass: ${r.errors.join("; ")}`);
  const t = r.timeline as Timeline;
  // schema defaults actually applied
  assert.equal(t.version, 1, "version defaults to 1");
  assert.equal(t.format.fps, 30, "fps defaults to 30");
  assert.equal(t.audio.duck.bodyVol, 0.1026, "duck default applied");
  assert.equal(t.lengthBand.tolSec, 30, "lengthBand tol default applied");
  // projection = intro + body + tail
  assert.equal(projectedDurationSec(t), 68, "projected runtime = 5+60+3");
  console.log("VALID PLAN PASS: parses, defaults applied, runtime projected");
}

function lengthGate(): void {
  // too long: body 200 → total 208 > max 120 (+30 tol)
  const longP = base() as { audio: Record<string, number>; segments: unknown[] };
  longP.audio.bodySec = 200;
  longP.segments = [{ kind: "footage", src: "a.mp4", durSec: 210 }];
  const a = validateTimeline(longP);
  assert.ok(!a.ok && a.errors.some((e) => /length/.test(e)), "over-max must fail length gate");

  // too short: total 13 < min 30 (-30 tol)? 13 < 0 is false; use min 60 → 13 < 30 → fail
  const shortP = base() as { audio: Record<string, number>; lengthBand: Record<string, number>; segments: unknown[]; overlays: unknown[]; checkpoints: unknown };
  shortP.audio.bodySec = 5;
  shortP.lengthBand = { minSec: 60, maxSec: 120 };
  shortP.segments = [{ kind: "footage", src: "a.mp4", durSec: 10 }];
  shortP.overlays = [];
  shortP.checkpoints = {};
  const b = validateTimeline(shortP);
  assert.ok(!b.ok && b.errors.some((e) => /length/.test(e)), "under-min must fail length gate");
  console.log("LENGTH GATE PASS: over-max and under-min both fail loud");
}

function overlayWindows(): void {
  // overlay end before start
  const p1 = base() as { overlays: unknown[] };
  p1.overlays = [{ kind: "caption", startSec: 30, endSec: 20 }];
  const a = validateTimeline(p1);
  assert.ok(!a.ok && a.errors.some((e) => /overlay/.test(e)), "inverted overlay window must fail");

  // overlay beyond runtime (68s)
  const p2 = base() as { overlays: unknown[] };
  p2.overlays = [{ kind: "insert", startSec: 60, endSec: 999 }];
  const b = validateTimeline(p2);
  assert.ok(!b.ok && b.errors.some((e) => /overlay/.test(e)), "overlay past runtime must fail");
  console.log("OVERLAY WINDOWS PASS: inverted + out-of-range both fail");
}

function coverage(): void {
  // clips total 40 < body 60 → would loop / dead-air
  const p = base() as { segments: unknown[]; overlays: unknown[]; checkpoints: unknown };
  p.segments = [
    { kind: "card", role: "intro", durSec: 5 },
    { kind: "footage", src: "a.mp4", durSec: 40 },
  ];
  p.overlays = [];
  p.checkpoints = {};
  const r = validateTimeline(p);
  assert.ok(!r.ok && r.errors.some((e) => /coverage/.test(e)), "under-coverage must fail loud (no silent loop)");
  console.log("COVERAGE PASS: clip time < body fails loud");
}

function healCheckpoint(): void {
  const p = base() as { checkpoints: Record<string, number> };
  p.checkpoints = { preOverlaySec: 999 }; // beyond 68s runtime
  const r = validateTimeline(p);
  assert.ok(!r.ok && r.errors.some((e) => /checkpoint/.test(e)), "out-of-range heal checkpoint must fail");
  console.log("HEAL CHECKPOINT PASS: out-of-range checkpoint fails");
}

function schemaShape(): void {
  // empty segments rejected (.min(1))
  const noSegs = base() as { segments: unknown[] };
  noSegs.segments = [];
  assert.ok(!validateTimeline(noSegs).ok, "empty segments must fail");

  // bad discriminator rejected
  const badKind = base() as { segments: unknown[] };
  badKind.segments = [{ kind: "bogus", src: "x.mp4", durSec: 10 }];
  assert.ok(!validateTimeline(badKind).ok, "unknown segment kind must fail the union");

  // card role enum enforced
  const badRole = base() as { segments: unknown[] };
  badRole.segments = [{ kind: "card", role: "banner", durSec: 5 }];
  assert.ok(!validateTimeline(badRole).ok, "invalid card role must fail");

  // a card-only intro + footage parses through the discriminated union
  const ok = TimelineSchema.safeParse(base());
  assert.ok(ok.success, "base plan parses through the schema");
  console.log("SCHEMA SHAPE PASS: union + required fields + enums enforced");
}

function main(): void {
  valid();
  lengthGate();
  overlayWindows();
  coverage();
  healCheckpoint();
  schemaShape();
  console.log("\nALL ASSEMBLY TIMELINE TESTS PASSED");
}

main();
