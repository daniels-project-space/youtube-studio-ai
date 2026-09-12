import assert from "node:assert/strict";

import { artifactContract } from "@/engine/artifactSchemas";
import { registerAllBlocks } from "@/engine/blocks";
import { assertChessNarrationPlan } from "@/engine/chessNarration";
import { get, getManifest } from "@/engine/registry";
import { runPipeline } from "@/engine/runner";
import type { StageContext } from "@/engine/types";
import { validatePipeline } from "@/engine/validate";
import { openingSource } from "../../../../test-fixtures/chess-replay/fixture";

function context(store: Readonly<Record<string, unknown>>): StageContext {
  return {
    ownerId: "owner-chess-pipeline-test",
    channelId: "channel-chess-pipeline-test",
    runId: "run-chess-pipeline-test",
    keyPrefix: "owners/owner-chess-pipeline-test",
    budgetUsd: 1,
    params: { boardOrientation: "black", boardTheme: "midnight" },
    store,
    log: () => {},
  };
}

async function main(): Promise<void> {
  registerAllBlocks();
  const source = get("chess_replay_source");
  const script = get("chess_script");
  const integrity = get("chess_script_integrity");
  const timing = get("chess_narration_timing");
  const graph = get("chess_episode_graph");
  assert(source && script && integrity && timing && graph, "all chess handoff blocks must be registered in the production registry");

  const sourcePatch = await source.run(context({ chessReplaySource: openingSource }));
  const narrationPlan = assertChessNarrationPlan(sourcePatch.chessNarrationPlan);
  const scriptPatch = await script.run(context(sourcePatch));
  assert.equal(scriptPatch.narrationText, narrationPlan.narrationText);
  assert.equal((scriptPatch.script as { hook: string }).hook, narrationPlan.segments[0].text);
  assert.deepEqual(
    await integrity.run(context({ ...sourcePatch, ...scriptPatch })),
    { scriptApproved: true },
    "only an exact source-derived Script may admit the shared narration_tts stage",
  );
  await assert.rejects(
    () => integrity.run(context({
      ...sourcePatch,
      ...scriptPatch,
      narrationText: `${scriptPatch.narrationText} Unsupported engine analysis.`,
    })),
    /differs from the immutable legal-move plan/,
    "the source-only route must not be able to smuggle creative analysis into paid TTS",
  );

  const cues = narrationPlan.segments.map((segment, index) => ({
    text: segment.text,
    start: index * 2,
    end: (index + 1) * 2,
  }));
  const timingPatch = await timing.run(context({
    ...sourcePatch,
    sentenceTimings: cues,
    narrationDurationSec: cues.length * 2,
  }));
  await assert.rejects(
    () => timing.run(context({
      ...sourcePatch,
      sentenceTimings: [{ ...cues[0]!, text: "White plays a fabricated move." }, ...cues.slice(1)],
      narrationDurationSec: cues.length * 2,
    })),
    /differs from the source-bound legal move/,
    "the post-TTS cue binder must reject a spoken sentence that is not the legal replay sentence",
  );
  const graphPatch = await graph.run(context({ ...sourcePatch, ...timingPatch }));
  const manifest = graphPatch.sceneManifest as { scenes: Array<{ visualState: { chessBoard: { orientation: string; theme: string } } }>; chessNarrationTiming: unknown };
  assert.equal(manifest.scenes.length, openingSource.expectedPlyCount);
  assert.equal(manifest.scenes[0]!.visualState.chessBoard.orientation, "black");
  assert.equal(manifest.scenes[0]!.visualState.chessBoard.theme, "midnight");
  assert.deepEqual(manifest.chessNarrationTiming, timingPatch.chessNarrationTiming, "the graph carries the exact typed TTS timing receipt");

  await assert.rejects(
    () => source.run(context({ chessReplaySource: {
      ...openingSource,
      id: "source-one-ply",
      label: "One-ply unsupported current route",
      pgn: '[SetUp "1"]\n[FEN "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"]\n\n1. O-O *',
      expectedPlyCount: 1,
      expectedFinalFen: "r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1",
    } })),
    /requires at least two legal plies/,
    "an incompatible single-ply replay must fail before it can enter paid TTS",
  );

  // The complete executable route reaches the existing paid TTS block and the
  // real Scene Compiler; this is a compiler-level wiring proof, not a mocked
  // provider completion or a claim of production narration qualification.
  assert.doesNotThrow(() => validatePipeline([
    { block: "chess_replay_source" },
    { block: "chess_script" },
    { block: "chess_script_integrity" },
    { block: "narration_tts" },
    { block: "chess_narration_timing" },
    { block: "chess_episode_graph" },
    { block: "scene_compiler" },
  ], ["chessReplaySource", "musicUrl"]));

  const sourceOnlyResult = await runPipeline(validatePipeline([
    { block: "chess_replay_source" },
    { block: "chess_script" },
    { block: "chess_script_integrity" },
  ], ["chessReplaySource"]), {
    ownerId: "owner-chess-pipeline-test",
    channelId: "channel-chess-pipeline-test",
    runId: "run-chess-pipeline-test",
    keyPrefix: "owners/owner-chess-pipeline-test",
    budgetUsd: 1,
    defaultRetries: 0,
    seedStore: { chessReplaySource: openingSource },
    sink: { async upsert() {} },
  });
  assert.equal(sourceOnlyResult.ok, true, sourceOnlyResult.error);
  assert.equal(sourceOnlyResult.store.scriptApproved, true);

  for (const key of ["chessReplaySource", "chessReplay", "chessNarrationPlan", "chessNarrationTiming"]) {
    assert.equal(artifactContract(key).opaque, false, `${key} must be a typed durable artifact, not a migration blob`);
  }
  for (const id of ["chess_replay_source", "chess_script", "chess_script_integrity", "chess_narration_timing", "chess_episode_graph"]) {
    assert.equal(getManifest(id)?.certification.status, "contract", `${id} must have a non-legacy executable contract`);
  }
  console.log("chess replay pipeline wiring PASS: source → script → existing TTS ABI → measured cue → native board graph");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
