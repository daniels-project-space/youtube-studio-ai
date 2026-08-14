import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluateNarrationCadence,
  planNarrationCadence,
  preflightNarrationPerformance,
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

  await assert.rejects(
    preflightNarrationPerformance({ audioPath, text: "word ".repeat(180), speed: 1 }),
    /implausible delivery duration/,
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
}

void main();
