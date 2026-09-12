import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildChessReplay } from "@/engine/chessReplay";
import { assertEpisodeGraph, assertSceneManifest, assertSceneManifestMatchesEpisodeGraph, compileSceneManifest } from "@/engine/episodeGraph";
import { ChessBoardVisual, chessBoardFrame, chessSquarePosition } from "@/remotion/sceneCompiler/ChessBoardVisual";
import { sceneKindFor } from "@/remotion/sceneCompiler/SceneCompiler";
import { assertSceneCompilerAdmission } from "@/trigger/blocks/sceneCompilerBlocks";
import { castleSource, chessDiagnosticGraph, openingSource, enPassantSource, promotionSource } from "../../../test-fixtures/chess-replay/fixture";

const graph = chessDiagnosticGraph();
const manifest = compileSceneManifest(graph);
const minimumDwell = structuredClone(manifest);
minimumDwell.durationSec = minimumDwell.scenes.length * 1.2;
minimumDwell.scenes.forEach((scene, i) => { scene.t0 = i * 1.2; scene.t1 = (i + 1) * 1.2; });
assert.doesNotThrow(() => assertSceneManifest(minimumDwell), "nominal minimum dwell must not fail on floating-point subtraction");
assert.equal(sceneKindFor(manifest.scenes[0]), "chess");
assert.equal(manifest.chessReplay?.fingerprint, graph.chessReplay?.fingerprint);
assert.deepEqual(assertSceneManifestMatchesEpisodeGraph(manifest, graph), manifest);
assert.equal(assertSceneCompilerAdmission({ manifest, narrationDurationSec: 12 }).durationSec, 12);
assert.deepEqual(chessSquarePosition("a8", "white"), { x: 0, y: 0 });
assert.deepEqual(chessSquarePosition("a8", "black"), { x: 7, y: 7 });
assert.deepEqual(chessSquarePosition("h1", "black"), { x: 0, y: 0 });
assert.throws(() => chessSquarePosition("i9", "white"));

for (const orientation of ["white", "black"] as const) {
  const event = buildChessReplay(openingSource).events[0];
  const before = chessBoardFrame(event, 0, orientation);
  const moving = chessBoardFrame(event, 0.5, orientation).find((piece) => piece.square === "e2")!;
  const after = chessBoardFrame(event, 1, orientation);
  assert.equal(before.find((piece) => piece.square === "e2")?.type, "p");
  assert.equal(after.some((piece) => piece.square === "e2"), false);
  assert.equal(after.find((piece) => piece.square === "e4")?.type, "p");
  assert.equal(moving.y, orientation === "white" ? 5 : 2);
  assert.deepEqual(chessBoardFrame(event, 1, orientation), after, "random seeking must be deterministic");
  const castles = buildChessReplay(castleSource);
  const whiteCastle = chessBoardFrame(castles.events[0], 0.5, orientation);
  assert.equal(whiteCastle.filter((piece) => piece.moving).length, 2, "castle moves rook and king together");
  const complete = chessBoardFrame(castles.events[1], 1, orientation);
  assert.equal(complete.find((piece) => piece.square === "c8")?.type, "k");
  assert.equal(complete.find((piece) => piece.square === "d8")?.type, "r");
  assert.equal(complete.some((piece) => piece.square === "a8"), false);
  const capture = buildChessReplay(enPassantSource).events[0];
  assert.equal(chessBoardFrame(capture, 0, orientation).find((piece) => piece.square === "d5")?.color, "b");
  const captured = chessBoardFrame(capture, 1, orientation);
  assert.equal(captured.some((piece) => piece.square === "d5"), false, "en passant removes the adjacent pawn");
  assert.equal(captured.find((piece) => piece.square === "d6")?.color, "w");
  const promotion = buildChessReplay(promotionSource).events[0];
  assert.equal(chessBoardFrame(promotion, 0, orientation).find((piece) => piece.square === "a7")?.type, "p");
  assert.equal(chessBoardFrame(promotion, 1, orientation).find((piece) => piece.square === "a8")?.type, "n");
  const markup = renderToStaticMarkup(createElement(ChessBoardVisual, {
    event: promotion, binding: { ...manifest.scenes[0].visualState.chessBoard!, orientation }, localSeconds: 1,
  }));
  assert.match(markup, /MOVE 7</, "move label must use the source position's fullmove number, not replay array index");
  assert.match(markup, /Promoted to knight/);
  const blackMarkup = renderToStaticMarkup(createElement(ChessBoardVisual, {
    event: buildChessReplay(promotionSource).events[1],
    binding: { ...manifest.scenes[0].visualState.chessBoard!, orientation }, localSeconds: 1,
  }));
  assert.match(blackMarkup, /BLACK · MOVE 7</);
}

let rejected = 0;
for (const mutate of [
  (m: typeof manifest) => { delete m.chessReplay; },
  (m: typeof manifest) => { m.scenes[1].visualState.chessBoard!.eventId = "ply-1"; },
  (m: typeof manifest) => { m.scenes[0].visualState.chessBoard!.replayFingerprint = "a".repeat(64); },
  (m: typeof manifest) => { m.scenes[1].visualState.chessBoard!.orientation = "black"; },
  (m: typeof manifest) => { m.scenes[1].visualState.chessBoard!.theme = "midnight"; },
  (m: typeof manifest) => { delete m.scenes[1].visualState.chessBoard; },
  (m: typeof manifest) => { m.scenes[0].sourceRefs = ["source-wrong-game"]; },
  (m: typeof manifest) => { m.scenes[0].camera.move = "pan"; },
  (m: typeof manifest) => { m.scenes[0].transition = "dissolve"; },
  (m: typeof manifest) => { m.scenes[0].t1 = 1; m.scenes[1].t0 = 1; },
  (m: typeof manifest) => { m.chessReplay!.events[0].afterFen = m.chessReplay!.initialFen; },
  (m: typeof manifest) => { m.scenes[0].visualState.syntheticScenarioProfile = "ai_town"; },
  (m: typeof manifest) => { m.scenes.pop(); m.durationSec -= 2; },
]) {
  const changed = structuredClone(manifest);
  mutate(changed);
  assert.throws(() => assertSceneManifest(changed), `mutation ${rejected} must not become a successful board render`);
  rejected++;
}
const forgedGraph = structuredClone(graph);
forgedGraph.beats[0].visualState.chessBoard!.eventId = "ply-2";
assert.throws(() => assertEpisodeGraph(forgedGraph));
console.log(`Chess scene: ${rejected + 1} corrupt handoffs rejected; source→graph→manifest→renderer admission and both orientations verified`);
