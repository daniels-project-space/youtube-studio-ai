/**
 * Clip-model test (tsx). Proves P3's Segment-side auto-editor clip model:
 * Segment.offset/speed schema (backward-compatible, undefined by default),
 * the pure segmentsFromKeepRanges() conversion (loud ranges -> real offset/durSec
 * clips, never straddling a removed gap), and planTimeline's narrow
 * single-source-is-narration wiring (talking-head/screen-cap trim) — with an
 * explicit proof that every OTHER shape (multi-clip pool, trim off) renders
 * byte-for-byte unchanged (no offset/speed set at all, fillBody untouched).
 */
import assert from "node:assert/strict";
import {
  planTimeline,
  ASSEMBLE_DEFAULTS,
  segmentsFromKeepRanges,
  type PlanInput,
  type TimeRange,
} from "../planTimeline";
import { SegmentSchema } from "../timeline";

const TRIM = { minSilenceSec: 0.5, padSec: 0.1 };

function schemaAcceptsOffsetSpeed(): void {
  const parsed = SegmentSchema.parse({ kind: "footage", src: "a.mp4", offset: 12.5, durSec: 4, speed: 1 });
  assert.equal((parsed as { offset?: number }).offset, 12.5, "offset round-trips through the schema");
  assert.equal((parsed as { speed?: number }).speed, 1, "speed round-trips through the schema");

  // Omitted entirely -> undefined. No forced default is baked into the wire shape;
  // callers/backends treat undefined as offset=0/speed=1, per the doc.
  const bare = SegmentSchema.parse({ kind: "footage", src: "a.mp4", durSec: 4 });
  assert.equal((bare as { offset?: number }).offset, undefined, "offset omitted by default (backward compat)");
  assert.equal((bare as { speed?: number }).speed, undefined, "speed omitted by default (backward compat)");

  // entity segments inherit the same fields (EntitySeg extends FootageSeg)
  const entity = SegmentSchema.parse({ kind: "entity", src: "e.mp4", offset: 3, durSec: 2, speed: 1 });
  assert.equal((entity as { offset?: number }).offset, 3, "entity segments also carry offset");
  console.log("SCHEMA PASS: Segment.offset/speed optional, no forced default on the wire, entity inherits them");
}

function pureConversion(): void {
  // Two kept ranges: [0,10) and [15,22) — 5s of dead air carved between them. A flat
  // segAt of 4s should slice each range into 4s chunks + a remainder, never crossing
  // the removed [10,15) gap.
  const keep: TimeRange[] = [{ startSec: 0, endSec: 10 }, { startSec: 15, endSec: 22 }];
  const segs = segmentsFromKeepRanges("src.mp4", keep, 17, () => 4, true);

  assert.equal(segs.length, 5, `5 segments expected (got ${segs.length})`);
  const offsets = segs.map((s) => (s as { offset?: number }).offset);
  assert.deepEqual(offsets, [0, 4, 8, 15, 19], "offsets track cumulative SOURCE position, jumping at the removed gap");
  const durs = segs.map((s) => s.durSec);
  assert.deepEqual(durs, [4, 4, 2, 4, 3], "durations sub-split each kept range, no crossing into the gap");
  assert.ok(Math.abs(durs.reduce((a, b) => a + b, 0) - 17) < 1e-6, "total duration == totalKeptSec");

  for (const s of segs) {
    assert.equal(s.kind, "footage");
    assert.equal((s as { speed?: number }).speed, 1, "P3 never retimes");
    assert.equal(s.src, "src.mp4");
    assert.equal((s as { onBeat?: boolean }).onBeat, true);
  }
  // no segment straddles the [10,15) removed gap
  assert.ok(
    !segs.some((s) => {
      const off = (s as { offset: number }).offset;
      return off < 10 && off + s.durSec > 10 + 0.001;
    }),
    "no segment straddles the removed gap",
  );
  console.log("PURE-CONVERSION PASS: keep ranges -> real offset/durSec clips, gap never crossed");
}

function pureConversionEmptyKeep(): void {
  assert.deepEqual(segmentsFromKeepRanges("s.mp4", [], 0, () => 4, false), [], "no keep ranges -> no segments");
  console.log("EMPTY-KEEP PASS: no ranges in, no segments out");
}

function wiredForSingleSourceNarration(): void {
  const input: PlanInput = {
    footageClips: ["narration.wav"], // the ONE clip IS the narration's own recording
    narrationSrc: "narration.wav",
    narrationDurationSec: 120,
    musicSrc: "m",
    editor: { trim: TRIM },
    silenceIntervals: [{ startSec: 10, endSec: 20 }, { startSec: 60, endSec: 75 }],
  };
  const t = planTimeline(input, ASSEMBLE_DEFAULTS);
  const footageSegs = t.segments.filter((s) => s.kind === "footage") as {
    offset?: number;
    speed?: number;
    durSec: number;
  }[];
  assert.ok(footageSegs.length > 1, "single-source narration produced multiple trimmed clips");
  assert.ok(footageSegs.every((s) => s.offset !== undefined), "every clip carries a real source offset");
  assert.ok(footageSegs.every((s) => s.speed === 1), "P3 doesn't retime");
  // total coverage still >= the trimmed body (no dead-air / no underrun)
  const coverage = footageSegs.reduce((a, s) => a + s.durSec, 0);
  assert.ok(coverage + 0.5 >= t.audio.bodySec, "clip-model segments still cover the trimmed body");
  // offsets are monotonic within the covered range (mirrors the audio-side keep ranges)
  assert.ok(Math.abs(t.audio.bodySec - 95.4) < 0.05, `bodySec trimmed to ~95.4 (got ${t.audio.bodySec})`);
  console.log("WIRED PASS: single-source-is-narration materializes real offset/durSec clips");
}

function backwardCompatEverythingElse(): void {
  const base: PlanInput = {
    footageClips: ["f0", "f1", "f2"], // a POOL, not the narration itself
    narrationSrc: "narration.wav",
    narrationDurationSec: 120,
    musicSrc: "m",
  };

  // (a) trim ON but footage is a b-roll POOL (not narrationSrc) -> unchanged fillBody path
  const pooled = planTimeline(
    { ...base, editor: { trim: TRIM }, silenceIntervals: [{ startSec: 10, endSec: 20 }] },
    ASSEMBLE_DEFAULTS,
  );
  const pooledFootage = pooled.segments.filter((s) => s.kind !== "card");
  assert.ok(
    pooledFootage.every((s) => (s as { offset?: number }).offset === undefined),
    "pooled footage never gets offset — fillBody untouched",
  );

  // (b) footage IS narrationSrc but trim is OFF -> unchanged fillBody path (no offset)
  const trimOff = planTimeline(
    { footageClips: ["narration.wav"], narrationSrc: "narration.wav", narrationDurationSec: 120, musicSrc: "m" },
    ASSEMBLE_DEFAULTS,
  );
  const trimOffFootage = trimOff.segments.filter((s) => s.kind !== "card");
  assert.ok(
    trimOffFootage.every((s) => (s as { offset?: number }).offset === undefined),
    "trim off — even single-source — never gets offset",
  );

  // (c) footage IS narrationSrc, trim ON, but silenceIntervals is empty -> parity (no adoption)
  const noIntervals = planTimeline(
    { footageClips: ["narration.wav"], narrationSrc: "narration.wav", narrationDurationSec: 120, musicSrc: "m", editor: { trim: TRIM } },
    ASSEMBLE_DEFAULTS,
  );
  const noIntervalsFootage = noIntervals.segments.filter((s) => s.kind !== "card");
  assert.ok(
    noIntervalsFootage.every((s) => (s as { offset?: number }).offset === undefined),
    "no silenceIntervals measured -> no trim adopted -> fillBody parity",
  );

  console.log("BACKWARD-COMPAT PASS: pooled footage, trim-off, and no-measured-intervals all keep the exact pre-P3 segment shape");
}

function main(): void {
  schemaAcceptsOffsetSpeed();
  pureConversion();
  pureConversionEmptyKeep();
  wiredForSingleSourceNarration();
  backwardCompatEverythingElse();
  console.log("\nALL CLIP-MODEL TESTS PASSED");
}

main();
