import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return source.slice(from, to);
}

function assertBefore(source: string, earlier: string, later: string, message: string): void {
  const earlierIndex = source.indexOf(earlier);
  const laterIndex = source.indexOf(later, earlierIndex + earlier.length);
  assert.notEqual(earlierIndex, -1, `missing earlier marker: ${earlier}`);
  assert.notEqual(laterIndex, -1, `missing later marker: ${later}`);
  assert.ok(earlierIndex < laterIndex, message);
}

async function main(): Promise<void> {
  const root = process.cwd();
  const [media, casefile, standard] = await Promise.all([
    readFile(join(root, "src/lib/novitaMedia.ts"), "utf8"),
    readFile(join(root, "src/trigger/blocks/genFootageBlocks.ts"), "utf8"),
    readFile(join(root, "src/trigger/blocks/novitaRenderBlocks.ts"), "utf8"),
  ]);

  const keyframeRecovery = between(
    media,
    "export async function reviewKeyframesBeforeVideo",
    "export async function reviewClipsBeforeAssembly",
  );
  assertBefore(
    keyframeRecovery,
    "await args.checkpointReview?.({\n          scene,\n          stillKey,\n          attempt,\n          verdict: \"rejected\"",
    "const replacement = await args.renderReplacement",
    "a rejected Casefile keyframe is checkpointed before its bounded replacement render",
  );
  const clipRecovery = between(
    media,
    "export async function reviewClipsBeforeAssembly",
    "function exactCandidateByShot",
  );
  assertBefore(
    clipRecovery,
    "await args.checkpointReview?.({\n          scene,\n          clipKey,\n          attempt,\n          verdict: \"rejected\"",
    "const replacement = await args.renderReplacement",
    "a rejected Casefile clip is checkpointed before its bounded replacement render",
  );

  const keyframeCheckpoint = between(
    casefile,
    "checkpointReview: async (event: NovitaKeyframeReviewCheckpoint)",
    "const clipGate = hasCinematicSequence",
  );
  const clipCheckpoint = between(
    casefile,
    "checkpointReview: async (event: NovitaClipReviewCheckpoint)",
    "const rendered = ltxScenes.length > 0",
  );
  for (const [label, checkpoint] of [
    ["keyframe", keyframeCheckpoint],
    ["clip", clipCheckpoint],
  ] as const) {
    assert.match(checkpoint, /checkpointCasefileVisualAttempt/);
    assert.doesNotMatch(
      checkpoint,
      /renderNovitaGeneratedScenes|renderImages\(|renderVideo\(|visionLocal\(/,
      `${label} checkpoint callback records existing review evidence without a provider call`,
    );
  }
  const sourceProofSetup = between(
    casefile,
    "const sourceProofBySceneId",
    "const ltxScenes = scenes.filter",
  );
  assert.doesNotMatch(
    sourceProofSetup,
    /checkpointCasefileVisualAttempt/,
    "approved source-proof media remains outside generated-candidate attempt tracking",
  );
  const transitionReview = between(
    casefile,
    "const transitionToNextReviewByIndex",
    "const generatedFootageSceneManifest",
  );
  assert.doesNotMatch(
    transitionReview,
    /checkpointCasefileVisualAttempt/,
    "transition review remains excluded from candidate attempt tracking",
  );

  const standardCheckpointHelper = between(
    standard,
    "async function checkpointStandardVisualAttempt",
    "function standardNovitaStillAttemptScopeFingerprint",
  );
  assert.doesNotMatch(
    standardCheckpointHelper,
    /renderImages\(|renderVideo\(|visionLocal\(|getObjectBytes\(/,
    "standard attempt persistence uses only the existing runner sink",
  );
  const qaAssets = between(
    standard,
    "export const qaAssets: Block = {",
    "export const novitaRenderVideo: Block = {",
  );
  assertBefore(
    qaAssets,
    "await checkpointStandardVisualAttempt(ctx, record)",
    "rendered = await renderImages(qualityRecoveryRenderCfg",
    "qa_assets persists its reviewed candidates before repair image rendering",
  );
  const qaShots = between(
    standard,
    "export const qaShots: Block = {",
    "export const novitaRenderBlocks",
  );
  assertBefore(
    qaShots,
    "await checkpointStandardVisualAttempt(ctx, visualAttempt)",
    "rendered = await renderVideo(qualityRecoveryRenderCfg",
    "qa_shots persists its reviewed candidate before repair video rendering",
  );

  console.log("visual artifact attempt adapter wiring tests passed");
}

main().catch((error) => {
  console.error("visual artifact attempt adapter wiring tests failed", error);
  process.exit(1);
});
