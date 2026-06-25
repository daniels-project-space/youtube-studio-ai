/**
 * Rigor / adversarial test (tsx) — the edge cases the happy-path suites missed,
 * each pinned to a real defect the audit found (docs/AUDIT_MODULES_RIGOR.md).
 */
import assert from "node:assert/strict";
import { planTimeline, ASSEMBLE_DEFAULTS, type PlanInput } from "../planTimeline";
import { validateTimeline, projectedDurationSec, type Overlay } from "../timeline";
import { hashTimeline } from "../renderTimeline";

const base: PlanInput = {
  footageClips: ["f0", "f1", "f2"],
  narrationDurationSec: 120,
  narrationSrc: "n",
  musicSrc: "m",
  introCardSrc: "i.mp4",
};

function noOom(): void {
  assert.throws(() => planTimeline({ ...base, narrationDurationSec: Infinity }), /finite/, "Infinity narration must throw, not OOM");
  assert.throws(() => planTimeline({ ...base, narrationDurationSec: NaN }), /finite/, "NaN narration must throw");
  assert.throws(() => planTimeline({ ...base, narrationDurationSec: -5 }), /finite|within/, "negative narration must throw");
  assert.throws(() => planTimeline({ ...base, narrationDurationSec: 1e7 }), /within/, "absurd narration (1e7) must throw, not make 1e6 segments");
  // a long-but-valid video still works (cadence 25s for >600s)
  const t = planTimeline({ ...base, narrationDurationSec: 700 });
  const clip = t.segments.find((s) => s.kind !== "card");
  assert.equal((clip as { durSec: number }).durSec, 25, ">600s narration → 25s cadence, no crash");
  console.log("NO-OOM PASS: Infinity/NaN/negative/absurd narration fail loud; long video still renders");
}

function hashStableAcrossRoundTrip(): void {
  const t = planTimeline(base); // has undefined fields (bgSrc, targetLufs, audioFadeOutSec…)
  const h1 = hashTimeline(t, "v1");
  const h2 = hashTimeline(JSON.parse(JSON.stringify(t)), "v1"); // persistence drops undefined keys
  assert.equal(h1, h2, "hash must be stable across a JSON round-trip (else reload → double-render)");
  // and order-independent
  const reordered = JSON.parse(JSON.stringify({ ...t }));
  assert.equal(hashTimeline(reordered, "v1"), h1, "hash is key-order independent");
  console.log("HASH-STABLE PASS: idempotency key survives persistence + key reordering");
}

function deadAirRejected(): void {
  // 0 footage → body fills with empty-src clips → must FAIL validation (not pass on duration alone)
  const t = planTimeline({ ...base, footageClips: [], entityClips: [] });
  const v = validateTimeline(t);
  assert.ok(!v.ok, "0-footage plan (empty-src clips) must fail validation");
  assert.ok(v.errors.some((e) => /empty media src/.test(e)), "the failure names dead-air / empty media");
  console.log("DEAD-AIR PASS: empty-src clips rejected (coverage = real media, not just duration)");
}

function squareAspect(): void {
  const t = planTimeline(base, { ...ASSEMBLE_DEFAULTS, aspect: "1:1" });
  assert.equal(t.format.w, 1080, "1:1 width");
  assert.equal(t.format.h, 1080, "1:1 height (was silently downgraded to 16:9)");
  assert.equal(t.reframe?.aspect, "1:1", "1:1 sets a reframe target");
  console.log("SQUARE PASS: aspect 1:1 → 1080×1080 (no silent downgrade)");
}

function overlayDensityCaps(): void {
  const overlays: Overlay[] = [
    { kind: "caption", startSec: 2, endSec: 8 },
    { kind: "caption", startSec: 10, endSec: 16 },
    { kind: "quote", startSec: 20, endSec: 28 },
    { kind: "quote", startSec: 30, endSec: 38 },
    { kind: "insert", startSec: 40, endSec: 48 },
    { kind: "insert", startSec: 50, endSec: 58 },
  ];
  const sparse = planTimeline({ ...base, overlays, editor: { overlayDensity: "sparse" } });
  const q = sparse.overlays.filter((o) => o.kind !== "caption").length;
  const c = sparse.overlays.filter((o) => o.kind === "caption").length;
  assert.equal(q, 2, "sparse caps quote/insert overlays to 2 (was DEAD knob)");
  assert.equal(c, 2, "captions are never capped by density");
  const rich = planTimeline({ ...base, overlays, editor: { overlayDensity: "rich" } });
  assert.equal(rich.overlays.filter((o) => o.kind !== "caption").length, 4, "rich keeps all quote/insert overlays");
  console.log("OVERLAY-DENSITY PASS: editor overlayDensity now live (sparse caps, rich keeps all)");
}

function overlayBoundary(): void {
  const total = projectedDurationSec(planTimeline(base)); // 128
  const ok = planTimeline(base);
  ok.overlays = [{ kind: "caption", startSec: total - 5, endSec: total }];
  assert.ok(validateTimeline(ok).ok, "overlay ending exactly at runtime is valid");
  ok.overlays = [{ kind: "caption", startSec: total - 5, endSec: total + 2 }];
  assert.ok(!validateTimeline(ok).ok, "overlay past runtime is rejected");
  console.log("BOUNDARY PASS: overlay-at-runtime ok, overlay-past-runtime rejected");
}

function main(): void {
  noOom();
  hashStableAcrossRoundTrip();
  deadAirRejected();
  squareAspect();
  overlayDensityCaps();
  overlayBoundary();
  console.log("\nALL RIGOR TESTS PASSED");
}

main();
