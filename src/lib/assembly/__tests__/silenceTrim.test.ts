/**
 * Silence-trim test (tsx). Proves the editor's auto-editor depth end-to-end through the
 * PURE planner: keep-range math, narration shortening, overlay time-remap, parity when
 * off / chapter-mode, and the ffmpeg silencedetect stderr parser.
 */
import assert from "node:assert/strict";
import {
  planTimeline,
  ASSEMBLE_DEFAULTS,
  computeKeepRanges,
  sumRanges,
  mapTimeThroughKeep,
  type PlanInput,
  type TimeRange,
} from "../planTimeline";
import { parseSilenceDetect } from "../silenceProbe";

const base: PlanInput = {
  footageClips: ["f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9"],
  narrationDurationSec: 120,
  narrationSrc: "n.wav",
  musicSrc: "m",
  introCardSrc: "i.mp4", // ⇒ introSec = 5
};
const TRIM = { minSilenceSec: 0.5, padSec: 0.1 };

function bodySec(t: ReturnType<typeof planTimeline>): number {
  return t.audio.bodySec;
}

function keepRangeMath(): void {
  // 5s silence at [20,25], padded inward by 0.1 ⇒ remove [20.1,24.9]
  const keep = computeKeepRanges(100, [{ startSec: 20, endSec: 25 }], TRIM);
  assert.deepEqual(keep, [{ startSec: 0, endSec: 20.1 }, { startSec: 24.9, endSec: 100 }], "complement of one padded silence");
  assert.ok(Math.abs(sumRanges(keep) - 95.2) < 1e-6, "trimmed length = 100 - 4.8");

  // too-short silence (< minSilenceSec) is left alone
  assert.deepEqual(computeKeepRanges(100, [{ startSec: 30, endSec: 30.3 }], TRIM), [{ startSec: 0, endSec: 100 }], "sub-threshold gap untouched");
  // padding wider than the gap ⇒ nothing removable
  assert.deepEqual(computeKeepRanges(100, [{ startSec: 40, endSec: 40.6 }], { minSilenceSec: 0.5, padSec: 0.4 }), [{ startSec: 0, endSec: 100 }], "pad swallows the gap");
  console.log("KEEPRANGE PASS: padded complement, threshold + pad-collapse guards");
}

function timeRemap(): void {
  const keep: TimeRange[] = [{ startSec: 0, endSec: 20.1 }, { startSec: 24.9, endSec: 100 }];
  assert.equal(mapTimeThroughKeep(10, keep), 10, "before any cut: unchanged");
  assert.ok(Math.abs(mapTimeThroughKeep(22, keep) - 20.1) < 1e-6, "inside removed gap: snaps to cut point");
  assert.ok(Math.abs(mapTimeThroughKeep(30, keep) - 25.2) < 1e-6, "after cut: shifted earlier by removed amount");
  console.log("REMAP PASS: raw narration time → trimmed time");
}

function planTrimsNarration(): void {
  const t = planTimeline(
    { ...base, editor: { trim: TRIM }, silenceIntervals: [{ startSec: 10, endSec: 20 }, { startSec: 60, endSec: 75 }] },
    ASSEMBLE_DEFAULTS,
  );
  // removed = [10.1,19.9] (9.8) + [60.1,74.9] (14.8) = 24.6 ⇒ effective 95.4
  assert.ok(Math.abs(bodySec(t) - 95.4) < 0.05, `bodySec trimmed to ~95.4 (got ${bodySec(t)})`);
  assert.ok(t.audio.narrationKeepRanges && t.audio.narrationKeepRanges.length === 3, "3 keep ranges carried to the renderer");
  // body coverage still covers the (trimmed) narration — no dead air, no loop
  const clipCover = t.segments.filter((s) => s.kind !== "card").reduce((a, s) => a + s.durSec, 0);
  assert.ok(clipCover + 0.5 >= bodySec(t), "clips still cover the trimmed body");
  console.log("PLAN-TRIM PASS: narration carved (bodySec shrinks, keep ranges emitted)");
}

function overlaysFollowTheCut(): void {
  // caption over narration-relative [30,33] ⇒ absolute [35,38] (introSec 5). One 10s silence
  // at narration-rel [10,20] sits before it, so the window slides ~9.8s earlier.
  const t = planTimeline(
    {
      ...base,
      editor: { trim: TRIM },
      silenceIntervals: [{ startSec: 10, endSec: 20 }],
      overlays: [{ kind: "caption", startSec: 35, endSec: 38, text: "hi" }],
    },
    ASSEMBLE_DEFAULTS,
  );
  const cap = t.overlays.find((o) => o.kind === "caption");
  assert.ok(cap, "caption survived the trim");
  assert.ok((cap as { startSec: number }).startSec < 35 && Math.abs((cap as { startSec: number }).startSec - 25.2) < 0.1, `caption slid earlier to ~25.2 (got ${(cap as { startSec: number }).startSec})`);
  assert.ok(Math.abs(((cap as { endSec: number }).endSec - (cap as { startSec: number }).startSec) - 3) < 0.05, "caption keeps its ~3s duration");
  console.log("OVERLAY PASS: overlay windows follow the carved content");
}

function parityAndGuards(): void {
  // no intervals ⇒ no trim (parity)
  const noProbe = planTimeline({ ...base, editor: { trim: TRIM } }, ASSEMBLE_DEFAULTS);
  assert.equal(bodySec(noProbe), 120, "no silenceIntervals ⇒ full narration (parity)");
  assert.equal(noProbe.audio.narrationKeepRanges, undefined, "parity ⇒ no keep ranges");

  // intervals but no trim directive ⇒ no trim
  const noDirective = planTimeline({ ...base, silenceIntervals: [{ startSec: 10, endSec: 40 }] }, ASSEMBLE_DEFAULTS);
  assert.equal(bodySec(noDirective), 120, "no editor.trim ⇒ no trim (parity)");

  // chapter mode owns timing ⇒ trim sits out
  const chapter = planTimeline(
    {
      ...base,
      editor: { trim: TRIM },
      silenceIntervals: [{ startSec: 10, endSec: 40 }],
      chapterPlan: [{ kind: "footage", durSec: 60 }, { kind: "card", durSec: 4 }, { kind: "footage", durSec: 56 }],
    },
    ASSEMBLE_DEFAULTS,
  );
  assert.equal(chapter.audio.narrationKeepRanges, undefined, "chapter mode skips silence-trim (director owns timing)");
  console.log("PARITY PASS: no-probe / no-directive / chapter-mode all skip trim");
}

function probeParser(): void {
  const stderr = [
    "[silencedetect @ 0x55] silence_start: 12.5",
    "[silencedetect @ 0x55] silence_end: 15.2 | silence_duration: 2.7",
    "frame= 100 fps=0.0",
    "[silencedetect @ 0x55] silence_start: 40.0",
    "[silencedetect @ 0x55] silence_end: 41.1 | silence_duration: 1.1",
  ].join("\n");
  const iv = parseSilenceDetect(stderr);
  assert.equal(iv.length, 2, "two silence intervals parsed");
  assert.deepEqual(iv[0], { startSec: 12.5, endSec: 15.2 }, "first interval paired correctly");
  assert.deepEqual(iv[1], { startSec: 40.0, endSec: 41.1 }, "second interval paired correctly");

  // dangling start (file ends mid-silence) closes at fallback only
  const dangling = "silence_start: 90.0";
  assert.deepEqual(parseSilenceDetect(dangling), [], "dangling start with no fallback ⇒ dropped");
  assert.deepEqual(parseSilenceDetect(dangling, 100), [{ startSec: 90, endSec: 100 }], "dangling start closed at fallback");
  console.log("PROBE PASS: silencedetect stderr → typed intervals (pairing + dangling)");
}

function main(): void {
  keepRangeMath();
  timeRemap();
  planTrimsNarration();
  overlaysFollowTheCut();
  parityAndGuards();
  probeParser();
  console.log("\nALL SILENCE-TRIM TESTS PASSED");
}

main();
