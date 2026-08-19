import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertNarrationPerformanceEvidence,
  assertNarrationTimingMeasurementIntegrity,
  evaluateNarrationCadence,
  planNarrationCadence,
  preflightNarrationPerformance,
  reconcileNarrationCadenceAfterDurationMeasurement,
} from "@/lib/narrationPerformance";

async function main(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "narration-performance-"));
  const audioPath = join(directory, "take.wav");
  // This controlled fixture exercises the local evidence parser and thresholds;
  // it intentionally does not claim to test acting or narration taste.
  execFileSync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=4",
    "-af", "volume=0.8", audioPath,
  ], { stdio: "ignore" });

  const text = "This is a controlled narration take used only for local timing evidence.";
  const evidence = await preflightNarrationPerformance({ audioPath, text, speed: 1 });
  assert.equal(evidence.source, "local_ffmpeg");
  assert.equal(evidence.wordCount, 12);
  assert.ok(evidence.durationSec >= 3.9);
  assert.ok(evidence.integratedLufs >= -36 && evidence.integratedLufs <= -6);
  assert.deepEqual(assertNarrationPerformanceEvidence(evidence), evidence);
  assert.throws(
    () => assertNarrationPerformanceEvidence({ ...evidence, source: "untrusted" }),
    /current local_ffmpeg receipt/,
  );
  assert.throws(
    () => assertNarrationPerformanceEvidence({ ...evidence, wordsPerSec: evidence.wordsPerSec + 1 }),
    /does not bind its wordCount and durationSec/,
    "a stale or substituted rate may not masquerade as final-audio evidence",
  );

  await assert.rejects(
    preflightNarrationPerformance({ audioPath, text: "word ".repeat(180), speed: 1 }),
    /implausible delivery duration/,
  );

  const silentAudioPath = join(directory, "silent-take.wav");
  execFileSync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=44100",
    "-t", "4", silentAudioPath,
  ], { stdio: "ignore" });
  await assert.rejects(
    preflightNarrationPerformance({ audioPath: silentAudioPath, text, speed: 1 }),
    /integrated loudness|speech-window mean/,
    "a final narration with an audio stream but no audible content must fail closed",
  );

  const sentences = [
    "The police had one explanation.",
    "But the phone record proved it was impossible.",
    "What happened next changed the case?",
  ];
  const cadence = planNarrationCadence({ sentences, baseGapSec: 0.8, jitterSec: 0.2 });
  assert.deepEqual(
    cadence,
    planNarrationCadence({ sentences, baseGapSec: 0.8, jitterSec: 0.2 }),
    "narration cadence must survive a retry without changing the edit timeline",
  );
  assert.equal(cadence.purposes[0], "turn");
  const timings = [
    { start: 0, end: 1 },
    { start: 1 + cadence.gapsSec[0]!, end: 2 + cadence.gapsSec[0]! },
    {
      start: 2 + cadence.gapsSec[0]! + cadence.gapsSec[1]!,
      end: 3 + cadence.gapsSec[0]! + cadence.gapsSec[1]!,
    },
  ];
  const cadenceEvidence = evaluateNarrationCadence({ sentences, sentenceTimings: timings, plan: cadence });
  assert.ok(cadenceEvidence.distinctGapCount >= 1);
  assert.equal(cadenceEvidence.maxGapSec, Math.max(cadence.gapsSec[0]!, cadence.gapsSec[1]!));

  const stableReconciliation = reconcileNarrationCadenceAfterDurationMeasurement({
    sentences,
    sentenceTimings: timings,
    plan: cadence,
    estimatedDurationSec: timings.at(-1)!.end,
    measuredDurationSec: timings.at(-1)!.end + 0.4,
  });
  assert.equal(stableReconciliation.scale, 1, "minor encoder variance must preserve the certified cue timeline");
  assert.throws(
    () => reconcileNarrationCadenceAfterDurationMeasurement({
      sentences,
      sentenceTimings: timings,
      plan: cadence,
      estimatedDurationSec: timings.at(-1)!.end,
      measuredDurationSec: timings.at(-1)!.end * 2,
      reconcileThresholdSec: 0,
    }),
    /pause .* does not match its planned/,
    "a post-probe timing scale that changes semantic pause rhythm must fail instead of being silently accepted",
  );

  assert.doesNotThrow(
    () => assertNarrationTimingMeasurementIntegrity({ sentenceCount: 12, estimatedDurationCount: 2 }),
    "a bounded pair of probe misses can still be reconciled against the measured full narration",
  );
  assert.throws(
    () => assertNarrationTimingMeasurementIntegrity({ sentenceCount: 12, estimatedDurationCount: 3 }),
    /caption and edit sync would be fiction/,
    "a visual/caption timeline must not be planned from several estimated sentence durations",
  );
  assert.throws(
    () => assertNarrationTimingMeasurementIntegrity({ sentenceCount: 2, estimatedDurationCount: 3 }),
    /estimated-duration count is invalid/,
    "a malformed timing receipt cannot use a permissive threshold",
  );
}

void main();
