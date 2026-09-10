import assert from "node:assert/strict";
import { sha256Hex } from "../sha256";
import { assertNarrationSegmentClockBinding, assertNarrationSegmentClockOutputs, createNarrationSegmentClock,
  narrationClockBindingFingerprint, narrationSegmentClockFingerprint, NarrationSegmentClockSchema,
  type NarrationSegmentClock, type NarrationSegmentClockObservations } from "../narrationSegmentClock";

// Synthetic contract fixtures only. This suite cannot attest that JSON observations came from audio IO.
type Fixture = { binding: { spokenSequence: string[]; artifact: { sha256: string; byteLength: number }; timingFingerprint: string; segmentClock?: NarrationSegmentClock };
  outputs: { narrationDurationSec: number; narrationPerformanceEvidence: { durationSec: number }; sentenceTimings: Array<{ text: string; start: number; end: number }> } };
function fixture(): Fixture {
  const spokenSequence = ["The problem has values.", "Step one. Multiply two integers.", "The final answer is six."];
  let cursor = 0;
  const sentenceTimings = spokenSequence.map((text, index) => {
    const start = cursor, end = start + index + 2; cursor = end + (index < 2 ? 0.25 : 0);
    return { text, start, end };
  });
  const binding: Fixture["binding"] = { spokenSequence, artifact: { sha256: sha256Hex("synthetic-final-not-audio"), byteLength: 123 }, timingFingerprint: sha256Hex("synthetic-timing-core") };
  const observations: NarrationSegmentClockObservations = {
    mode: "sentence", segments: sentenceTimings.map((cue, index) => ({
      textSha256: sha256Hex(cue.text), audio: { sha256: sha256Hex(`synthetic-segment-${index}`), byteLength: 123 }, cueIndex: index, gapAfterSec: index < 2 ? 0.25 : 0,
      measurement: { source: "ffprobe_format_duration", durationSec: index + 2, wordCount: cue.text.split(/\s+/).length,
        attempts: [{ outcome: "measured", durationSec: index + 2, hasAudio: true }] },
    })),
    finalDuration: { source: "ffprobe_format_duration", usedSec: cursor, performanceProbeSec: cursor },
    reconciliation: { inputCursorSec: cursor, measuredDurationSec: cursor, scale: 1 },
  };
  binding.segmentClock = createNarrationSegmentClock(binding, observations);
  return { binding, outputs: { narrationDurationSec: cursor, narrationPerformanceEvidence: { durationSec: cursor }, sentenceTimings } };
}
let passed = 0;
function test(name: string, run: () => void) { run(); passed++; console.log(`PASS ${name}`); }
function rebind(value: Fixture) { value.binding.segmentClock!.bindingFingerprint = narrationClockBindingFingerprint(value.binding); }
function reject(name: string, mutate: (value: Fixture, clock: NarrationSegmentClock) => void) {
  test(name, () => { const value = fixture(); mutate(value, value.binding.segmentClock!); rebind(value);
    assert.throws(() => assertNarrationSegmentClockOutputs(value.binding, value.outputs), "recomputed core hash must not bypass semantic checks"); });
}
function estimatedFixture(finalDuration = 9.5) {
  const value = fixture(), clock = value.binding.segmentClock!;
  const measurement = clock.segments[0].measurement;
  measurement.source = "word_count_estimate"; measurement.durationSec = Math.max(1, measurement.wordCount / 2.5);
  measurement.attempts = [{ outcome: "unavailable" }, { outcome: "unavailable" }];
  const cursor = clock.segments.reduce((sum, segment) => sum + segment.measurement.durationSec + segment.gapAfterSec, 0);
  const scale = Math.abs(finalDuration - cursor) <= 1.5 ? 1 : finalDuration / cursor;
  clock.reconciliation = { inputCursorSec: cursor, measuredDurationSec: finalDuration, scale };
  clock.finalDuration = { source: "ffprobe_format_duration", usedSec: finalDuration, performanceProbeSec: finalDuration };
  value.outputs.narrationDurationSec = finalDuration; value.outputs.narrationPerformanceEvidence.durationSec = finalDuration;
  let start = 0;
  value.outputs.sentenceTimings = clock.segments.map((segment, index) => {
    const end = start + segment.measurement.durationSec;
    const cue = { text: value.binding.spokenSequence[index], start: start * scale, end: end * scale };
    start = end + segment.gapAfterSec; return cue;
  });
  rebind(value); return value;
}

test("complete directly measured observations reconstruct every bound cue", () => {
  const value = fixture(); assert.deepEqual(assertNarrationSegmentClockOutputs(value.binding, value.outputs, true), value.binding.segmentClock);
  const changed = structuredClone(value.binding.segmentClock!); changed.segments[0].audio.sha256 = "d".repeat(64);
  assert.notEqual(narrationSegmentClockFingerprint(changed), narrationSegmentClockFingerprint(value.binding.segmentClock!));
});
test("old binding without a clock is compatible for restoration but not arithmetic reveals", () => {
  const value = fixture(); delete value.binding.segmentClock;
  assert.equal(assertNarrationSegmentClockOutputs(value.binding, value.outputs), undefined);
  assert.throws(() => assertNarrationSegmentClockOutputs(value.binding, value.outputs, true), /unavailable.*retain audio/);
});
test("successful bounded retry preserves the failed attempt rather than erasing it", () => {
  const value = fixture(); value.binding.segmentClock!.segments[0].measurement.attempts.unshift({ outcome: "unavailable" });
  assert.doesNotThrow(() => assertNarrationSegmentClockOutputs(value.binding, value.outputs, true));
});
for (const finalDuration of [9.5, 12.5]) test(`final measurement ${finalDuration} cannot upgrade estimated parts, even after reconciliation`, () => {
  const value = estimatedFixture(finalDuration);
  assert.doesNotThrow(() => assertNarrationSegmentClockOutputs(value.binding, value.outputs));
  assert.throws(() => assertNarrationSegmentClockOutputs(value.binding, value.outputs, true), /all-measured/);
  assert.equal(value.binding.segmentClock!.reconciliation.scale !== 1, finalDuration === 12.5);
});
for (const durationSec of [0, -1, NaN, Infinity]) reject(`invalid segment duration ${durationSec}`, (_value, clock) => {
  clock.segments[0].measurement.durationSec = durationSec;
  clock.segments[0].measurement.attempts = [{ outcome: "measured", durationSec, hasAudio: true }];
});
reject("no-audio observation cannot masquerade as a successful clock", (_value, clock) => { Object.assign(clock.segments[0].measurement.attempts[0], { hasAudio: false }); });
reject("local-path metadata is not a receipt extension", (_value, clock) => { Object.assign(clock.segments[0].audio, { localPath: "/tmp/nonportable-part.mp3" }); });
reject("missing source segment", (_value, clock) => { clock.segments.pop(); });
reject("reordered cue indices", (_value, clock) => { [clock.segments[0].cueIndex, clock.segments[1].cueIndex] = [1, 0]; });
reject("sentence segment cannot be an unclocked heading", (_value, clock) => { clock.segments[0].cueIndex = null; });
reject("unsubmitted text with recomputed core hash", (value) => { value.binding.spokenSequence[0] = "A foreign current narration has replaced it."; });
reject("wrong word-count identity", (_value, clock) => { clock.segments[0].measurement.wordCount++; });
reject("measured label without a measured observation", (_value, clock) => { clock.segments[0].measurement.attempts = [{ outcome: "unavailable" }]; });
reject("measurement cannot predate a later failed attempt", (_value, clock) => { clock.segments[0].measurement.attempts.push({ outcome: "unavailable" }); });
reject("retry bound cannot be silently expanded", (_value, clock) => { clock.segments[0].measurement.attempts.unshift({ outcome: "unavailable" }, { outcome: "unavailable" }); });
reject("duration differs from the direct observation", (_value, clock) => { clock.segments[0].measurement.durationSec += 0.1; });
reject("final duration differs from actual bound output", (_value, clock) => { clock.finalDuration.usedSec++; });
reject("performance duration cannot be substituted", (_value, clock) => { clock.finalDuration.performanceProbeSec++; });
reject("gap missing from input cursor", (_value, clock) => { clock.segments[0].gapAfterSec += 0.25; });
reject("trailing unassembled gap", (_value, clock) => { clock.segments.at(-1)!.gapAfterSec = 0.1; });
reject("unchanged outputs cannot admit a rehashed different gap", (_value, clock) => {
  clock.segments[0].gapAfterSec += 0.25; clock.reconciliation.inputCursorSec += 0.25; clock.reconciliation.measuredDurationSec += 0.25;
});
reject("unmeasured duration transform cannot be invented", (_value, clock) => { clock.reconciliation.measuredDurationSec += 0.5; });
reject("all-measured parts cannot be scaled into guessed cue endpoints", (_value, clock) => { clock.reconciliation.scale = 2; });
reject("missing output cue", (value) => { value.outputs.sentenceTimings.pop(); });
reject("changed output cue", (value) => { value.outputs.sentenceTimings[1].end += 0.001; });
test("core binding hash detects a foreign artifact without claiming external authority", () => {
  const value = fixture(); value.binding.artifact.sha256 = "e".repeat(64);
  assert.throws(() => assertNarrationSegmentClockBinding(value.binding), /different audio/);
  rebind(value);
  // Self-consistent JSON is not cryptographic evidence of IO: actual bytes are separately checked by the production restore validator.
  assert.doesNotThrow(() => assertNarrationSegmentClockBinding(value.binding));
});
test("estimated method must keep the actual word-count fallback formula", () => {
  const value = estimatedFixture(); value.binding.segmentClock!.segments[0].measurement.durationSec += 0.1;
  assert.throws(() => NarrationSegmentClockSchema.parse(value.binding.segmentClock));
});
test("final-only measurement metadata cannot qualify any old missing per-part clock", () => {
  const value = fixture(); delete value.binding.segmentClock;
  value.outputs.narrationDurationSec = value.outputs.narrationPerformanceEvidence.durationSec = 100;
  assert.throws(() => assertNarrationSegmentClockOutputs(value.binding, value.outputs, true), /unavailable/);
});
console.log(JSON.stringify({ passed, contractOnlySyntheticObservations: true, speechOrFrameAlignmentProof: false, networkCalls: 0 }));
