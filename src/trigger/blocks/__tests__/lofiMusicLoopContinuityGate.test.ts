import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MusicError, withMusicGenerationCost } from "@/lib/music";
import { taskErrorForRetryPolicy } from "@/trigger/taskRetryPolicy";

const source = readFileSync(join(process.cwd(), "src", "trigger", "blocks", "lofiBlocks.ts"), "utf8");
const musicStart = source.indexOf("music: Block = {");
const assembleStart = source.indexOf("assemble: Block = {", musicStart);

assert.ok(musicStart >= 0 && assembleStart > musicStart, "music block must remain independently inspectable");
const musicBlock = source.slice(musicStart, assembleStart);

assert.match(
  musicBlock,
  /const loopedMusicPath = join\(tmp, "music_loop\.mp3"\);[\s\S]*?await selfLoopAudio\(local, loopedMusicPath/,
  "music must create a sealed self-loop artifact before it can publish the bed",
);
assert.match(
  musicBlock,
  /if \(loopedMusic !== loopedMusicPath\)[\s\S]*?throw new MusicError\([\s\S]*?continuity proof/i,
  "a pass-through or otherwise unproven loop result must stop the music block",
);
assert.doesNotMatch(
  musicBlock,
  /shipping the plain mix|loop splices will be hard|self-loop fold FAILED/i,
  "music must never degrade a failed self-loop into a hard-spliced release",
);

// This is the same post-generation path used by the music block's outer catch:
// a loop-proof failure retains known spend but becomes a terminal task outcome,
// preventing a retry from buying another provider generation.
const failure = withMusicGenerationCost(
  new MusicError("self-loop continuity proof failed"),
  1,
  0.12,
) as Error & { retryable?: unknown; additionalObservedCostUsd?: unknown };
assert.equal(failure.retryable, false);
assert.equal(failure.additionalObservedCostUsd, 0.12);
const taskOutcome = taskErrorForRetryPolicy(failure);
assert.equal(taskOutcome.classification.kind, "deterministic");
if (!(taskOutcome.error instanceof Error)) {
  throw new Error("a terminal loop-proof failure must preserve an Error instance");
}
assert.equal(taskOutcome.error.name, "AbortTaskRunError");

console.log("lofi music-loop continuity gate tests passed");
