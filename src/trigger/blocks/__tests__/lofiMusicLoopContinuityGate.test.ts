import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

import { MusicError, withMusicGenerationCost } from "@/lib/music";
import { taskErrorForRetryPolicy } from "@/trigger/taskRetryPolicy";

const source = readFileSync(join(process.cwd(), "src", "trigger", "blocks", "lofiBlocks.ts"), "utf8");
const parsed = ts.createSourceFile("lofiBlocks.ts", source, ts.ScriptTarget.Latest, true);
const loopFactory = parsed.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "createLoopClipsBlock");
const musicSource = readFileSync(join(process.cwd(), "src", "trigger", "blocks", "musicBlocks.ts"), "utf8");
const musicStart = musicSource.indexOf("export const music: Block = {");

assert.ok(loopFactory?.body, "visual loop block must remain independently inspectable");
assert.match(source, /export const loopClips = createLoopClipsBlock\(\);/, "legacy loop must use the inspected factory without overrides");
assert.ok(musicStart >= 0, "shared music block must remain independently inspectable");
const loopBlock = loopFactory.body.getText(parsed);
const musicBlock = musicSource.slice(musicStart);

assert.match(loopBlock, /minimaxH3Readiness\("novita"\)/, "H3 readiness must be checked before motion spend");
assert.match(loopBlock, /totalNativeClips = scaling\.sourceSegmentCount \* nativeClipsPerSegment/, "native H3 work must be budgeted before spend");
assert.match(loopBlock, /for \(let index = 0; index < scaling\.sourceSegmentCount; index\+\+\)/, "the source must render both sealed segments");
assert.match(loopBlock, /firstFrame: \{ r2Key: f1Key, sha256: firstFrameSha256 \}/, "each H3 take must bind to the exact accepted still");
assert.match(loopBlock, /await composeVideoSequenceUnit\(/, "native H3 takes must form each exact-duration half");
assert.match(loopBlock, /await composeLoopSourceUnit\(/, "the two segments must form one exact-duration source unit");
assert.match(loopBlock, /measureVideoBoundaryDiff\([\s\S]*?measureLoopSeamDiff\(/, "internal and wraparound seams must both be measured");
assert.match(loopBlock, /worstSeamDiff > scaling\.seamMaximumDiff/, "a visible source seam must fail before upscale");
assert.match(loopBlock, /additionalObservedCostUsd:[\s\S]*?retryable: false/, "post-spend source failures must retain cost and stop paid retries");

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
