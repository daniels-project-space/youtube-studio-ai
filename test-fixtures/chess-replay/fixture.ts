/** Self-authored diagnostic positions, not narration/audio or channel qualification. */
import { buildChessReplay, type ChessReplaySource } from "@/engine/chessReplay";
import { buildEpisodeGraph, compileSceneManifest } from "@/engine/episodeGraph";
import type { ChessBoardScene } from "@/engine/chessScene";

export const openingSource: ChessReplaySource = {
  id: "source-opening-diagnostic",
  label: "Six-move opening diagnostic",
  locator: "fixture://chess-replay/opening-v1",
  rightsNote: "Self-authored rule-test move sequence; no external commentary or artwork.",
  pgn: "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *",
  expectedPlyCount: 6,
  expectedFinalFen: "r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4",
};

export const castleSource: ChessReplaySource = {
  ...openingSource,
  id: "source-castling-diagnostic",
  label: "Both castling directions",
  locator: "fixture://chess-replay/castling-v1",
  pgn: '[SetUp "1"]\n[FEN "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"]\n\n1. O-O O-O-O *',
  expectedPlyCount: 2,
  expectedFinalFen: "2kr3r/8/8/8/8/8/8/R4RK1 w - - 2 2",
};

export const enPassantSource: ChessReplaySource = {
  ...openingSource, id: "source-en-passant-diagnostic", label: "En passant capture",
  locator: "fixture://chess-replay/en-passant-v1",
  pgn: '[SetUp "1"]\n[FEN "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2"]\n\n2. exd6 Kf7 *',
  expectedPlyCount: 2,
  expectedFinalFen: "8/5k2/3P4/8/8/8/8/4K3 w - - 1 3",
};

export const promotionSource: ChessReplaySource = {
  ...openingSource, id: "source-promotion-diagnostic", label: "Underpromotion",
  locator: "fixture://chess-replay/promotion-v1",
  pgn: '[SetUp "1"]\n[FEN "4k2r/P7/8/8/8/8/8/4K3 w - - 0 7"]\n\n7. a8=N Kf7 *',
  expectedPlyCount: 2,
  expectedFinalFen: "N6r/5k2/8/8/8/8/8/4K3 w - - 1 8",
};

export function chessDiagnosticGraph(
  source = openingSource,
  orientation: ChessBoardScene["orientation"] = "white",
  theme: ChessBoardScene["theme"] = "walnut",
) {
  const replay = buildChessReplay(source);
  return buildEpisodeGraph({
    seriesId: "series-chess-diagnostic", episodeId: "episode-chess-diagnostic",
    topic: source.label, audience: "general", durationSec: replay.events.length * 2,
    chessReplay: replay,
    characterIds: [], settingIds: [], characters: [], settings: [],
    sources: [{ id: source.id, kind: "primary", label: source.label, locator: source.locator }],
    beats: replay.events.map((event, index) => ({
      id: `beat-ply-${event.ply}`, kind: index === 0 ? "opening" : "observation",
      t0: index * 2, t1: (index + 1) * 2,
      scenePurpose: `Display source move ${event.san}`, text: `Source move: ${event.san}`,
      sourceRefs: [source.id], characterIds: [],
      camera: { framing: "wide", move: "static" }, transition: "cut",
      // Synthetic timing IDs for this visual-only fixture, not an upstream TTS receipt.
      storySpineBeatIds: [`beat-ply-${event.ply}`], storySpineSentenceIds: [`sentence-ply-${event.ply}`],
      visualState: { action: `${event.from} to ${event.to}`, props: [], chessBoard: {
        version: "chess-board-scene/v1", replayFingerprint: replay.fingerprint,
        eventId: event.id, orientation, theme,
      } },
    })),
    causalEdges: replay.events.slice(1).map((event, index) => ({
      id: `edge-ply-${event.ply}`, fromBeatId: `beat-ply-${index + 1}`, toBeatId: `beat-ply-${event.ply}`,
      relation: "enables", rationale: "The previous legal position enables the next recorded move.", sourceRefs: [source.id],
    })),
  });
}

export function chessDiagnosticManifest(source = openingSource, orientation: ChessBoardScene["orientation"] = "white", theme: ChessBoardScene["theme"] = "walnut") {
  return compileSceneManifest(chessDiagnosticGraph(source, orientation, theme));
}
