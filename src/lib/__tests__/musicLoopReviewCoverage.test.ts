import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { assertMusicLoopReviewCoverage, musicLoopReviewGap, MUSIC_LOOP_REVIEW_JOIN_TIMES } from "../musicLoopReviewCoverage";

const { elapsedMs: _elapsedMs, ...historicalProof } = JSON.parse(readFileSync("test-fixtures/music-composer/assembly/natural-loop-8h-video-packets.json", "utf8"));
void _elapsedMs;
// Schema fixture only. The integrated test obtains this stronger witness from
// the actual scanner; historical packet receipts do not acquire it retroactively.
const repetition = { ...historicalProof, stableDecoderParametersVerified: true };
const frameTimes = [...Array.from({ length: 18 }, (_, index) => index * 5 + 2.5), ...MUSIC_LOOP_REVIEW_JOIN_TIMES];
const coverage = { version: "music-loop-review-coverage/v1", sampledDurationSec: 90,
  maxGapSec: musicLoopReviewGap(frameTimes), maxAllowedGapSec: 6, repetition };
const source = { sha256: repetition.masterSha256, durationSec: 28800, byteLength: repetition.masterBytes };
test("full-length repetition coverage requires the exact master, all layout counts and every join witness", () => {
  assert.doesNotThrow(() => assertMusicLoopReviewCoverage({ coverage, source, frameTimes }));
  for (const field of ["packetCount", "bodyUnitCount", "comparedBodyPackets", "masterBytes", "durationSec"]) {
    assert.throws(() => assertMusicLoopReviewCoverage({ source, frameTimes,
      coverage: { ...coverage, repetition: { ...repetition, [field]: repetition[field] + 1 } } }));
  }
  assert.throws(() => assertMusicLoopReviewCoverage({ coverage, frameTimes, source: { ...source, sha256: "0".repeat(64) } }));
  for (const join of MUSIC_LOOP_REVIEW_JOIN_TIMES) {
    assert.throws(() => assertMusicLoopReviewCoverage({ coverage, source, frameTimes: frameTimes.filter(time => time !== join) }));
  }
  const sparse = [...MUSIC_LOOP_REVIEW_JOIN_TIMES];
  assert.throws(() => assertMusicLoopReviewCoverage({ source, frameTimes: sparse, coverage: { ...coverage, maxGapSec: musicLoopReviewGap(sparse) } }));
  assert.throws(() => assertMusicLoopReviewCoverage({ source, frameTimes, coverage: { ...coverage, maxGapSec: 0 } }));
});
