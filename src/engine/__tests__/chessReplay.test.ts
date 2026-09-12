import assert from "node:assert/strict";
import {
  ChessReplaySchema,
  ChessReplaySourceSchema,
  assertChessReplay,
  buildChessReplay,
  chessBoardPieces,
  type ChessReplay,
} from "@/engine/chessReplay";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

let cases = 0;
function test(name: string, run: () => void): void {
  run();
  cases++;
  console.log(`PASS ${name}`);
}

const opening = {
  id: "source-opening",
  label: "Four legal opening plies",
  locator: "fixture://chess/opening",
  rightsNote: "Locally authored rules fixture; not third-party rights verification",
  pgn: "1. e4 e5 2. Nf3 Nc6 *",
  expectedPlyCount: 4,
  // Independently written expectations, not obtained from the producer under test.
  expectedFinalFen: "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
};
const setup = (initial: string, moves: string, final: string, plies = 1) => ({
  ...opening,
  pgn: `[SetUp "1"]\n[FEN "${initial}"]\n${moves}`,
  expectedPlyCount: plies,
  expectedFinalFen: final,
});

test("strict legal opening, independent intermediate board and deterministic hashes", () => {
  const first = buildChessReplay(opening);
  assert.deepEqual(first, buildChessReplay(structuredClone(opening)));
  assert.deepEqual(assertChessReplay(first), first);
  assert.equal(first.sourceHash, sha256Hex(canonicalJson(first.source)));
  assert.deepEqual(first.events.map((event) => event.id), ["ply-1", "ply-2", "ply-3", "ply-4"]);
  assert.equal(first.initialFen, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  assert.equal(first.events[0]!.afterFen, "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");
  assert.deepEqual(first.events.map(({ from, to, color, piece }) => ({ from, to, color, piece })), [
    { from: "e2", to: "e4", color: "w", piece: "p" },
    { from: "e7", to: "e5", color: "b", piece: "p" },
    { from: "g1", to: "f3", color: "w", piece: "n" },
    { from: "b8", to: "c6", color: "b", piece: "n" },
  ]);
  for (let i = 1; i < first.events.length; i++) assert.equal(first.events[i]!.beforeFen, first.events[i - 1]!.afterFen);
  assert.equal(chessBoardPieces(first.finalFen).length, 32);
});

test("both castling moves change king AND rook squares", () => {
  const trace = buildChessReplay(setup(
    "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
    "1. O-O O-O-O *",
    "2kr3r/8/8/8/8/8/8/R4RK1 w - - 2 2", 2,
  ));
  assert.equal(trace.events[0]!.afterFen, "r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1");
  assert.deepEqual(chessBoardPieces(trace.finalFen), [
    { square: "c8", type: "k", color: "b" },
    { square: "d8", type: "r", color: "b" },
    { square: "h8", type: "r", color: "b" },
    { square: "a1", type: "r", color: "w" },
    { square: "f1", type: "r", color: "w" },
    { square: "g1", type: "k", color: "w" },
  ]);
});

test("en passant removes the captured pawn from its distinct square", () => {
  const trace = buildChessReplay(setup(
    "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2", "2. exd6 *",
    "4k3/8/3P4/8/8/8/8/4K3 b - - 0 2",
  ));
  assert.equal(trace.initialFen, "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2");
  assert.equal(trace.events[0]!.captured, "p");
  assert.deepEqual(chessBoardPieces(trace.finalFen), [
    { square: "e8", type: "k", color: "b" },
    { square: "d6", type: "p", color: "w" },
    { square: "e1", type: "k", color: "w" },
  ]);
});

test("black-to-move source preserves turn and full-move counters", () => {
  const trace = buildChessReplay(setup(
    "r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1", "1... O-O *",
    "r4rk1/8/8/8/8/8/8/R3K2R w KQ - 1 2",
  ));
  assert.equal(trace.events[0]!.color, "b");
  assert.equal(trace.events[0]!.from, "e8");
  assert.equal(trace.events[0]!.to, "g8");
  assert.deepEqual(chessBoardPieces(trace.finalFen).filter((entry) => entry.color === "b"), [
    { square: "a8", type: "r", color: "b" },
    { square: "f8", type: "r", color: "b" },
    { square: "g8", type: "k", color: "b" },
  ]);
});

test("castling through an attacked square is rejected", () => {
  assert.throws(() => buildChessReplay(setup(
    "4kr2/8/8/8/8/8/8/4K2R w K - 0 1", "1. O-O *",
    "4kr2/8/8/8/8/8/8/5RK1 b - - 1 1",
  )));
});

for (const promotion of [
  { move: "a8=Q+", fen: "Q6k/8/8/8/8/8/8/7K b - - 0 1", type: "q", check: true },
  { move: "a8=N", fen: "N6k/8/8/8/8/8/8/7K b - - 0 1", type: "n", check: false },
] as const) test(`promotion ${promotion.type} replaces pawn and reports check accurately`, () => {
  const trace = buildChessReplay(setup("7k/P7/8/8/8/8/8/7K w - - 0 1", `1. ${promotion.move} *`, promotion.fen));
  assert.equal(trace.events[0]!.promotion, promotion.type);
  assert.equal(trace.events[0]!.check, promotion.check);
  assert.equal(trace.events[0]!.checkmate, false);
  assert.deepEqual(chessBoardPieces(trace.finalFen)[0], { square: "a8", type: promotion.type, color: "w" });
});

test("capture-promotion preserves BOTH capture and promotion evidence", () => {
  const trace = buildChessReplay(setup("1r5k/P7/8/8/8/8/8/7K w - - 0 1", "1. axb8=Q+ *", "1Q5k/8/8/8/8/8/8/7K b - - 0 1"));
  assert.equal(trace.events[0]!.captured, "r");
  assert.equal(trace.events[0]!.promotion, "q");
  assert.deepEqual(chessBoardPieces(trace.finalFen)[0], { square: "b8", type: "q", color: "w" });
});

test("actual checkmate is distinguished from merely a source result", () => {
  const trace = buildChessReplay({ ...opening, pgn: "1. f3 e5 2. g4 Qh4# 0-1", expectedFinalFen: "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3" });
  assert.equal(trace.events[3]!.check, true);
  assert.equal(trace.events[3]!.checkmate, true);
  const resigned = buildChessReplay({ ...opening, pgn: "1. e4 e5 2. Nf3 Nc6 1-0" });
  assert.equal(resigned.events[3]!.checkmate, false, "Result tag cannot invent a board checkmate");
});

test("canonical final FEN accepts insignificant spacing and non-capturable EP field", () => {
  const input = { ...opening, pgn: "1. e4 *", expectedPlyCount: 1, expectedFinalFen: "  rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR   b KQkq e3 0 1  " };
  const trace = buildChessReplay(input);
  assert.equal(trace.finalFen, "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");
  assert.equal(trace.source.expectedFinalFen, trace.finalFen);
  assert.deepEqual(assertChessReplay(trace), trace);
});

test("ordinary annotations survive but variations are explicitly rejected", () => {
  const annotated = { ...opening, pgn: '[Event "Opening (mainline)"]\n1. e4 {a comment (not a variation)} e5 $1\n; another (comment)\n2. Nf3 Nc6 *' };
  assert.deepEqual(buildChessReplay(annotated).events, buildChessReplay(opening).events);
  for (const pgn of ["1. e4 (1. d4 d5) e5 2. Nf3 Nc6 *", "1. e4 (1. d4 (1. c4) d5) e5 2. Nf3 Nc6 *"]) {
    assert.throws(() => buildChessReplay({ ...opening, pgn }), /variations/);
  }
  assert.throws(() => buildChessReplay({
    ...opening,
    // A tag-like string inside comments must not hide a real intervening RAV.
    pgn: '1. e4 { [Event "} (1. d4 d5) { "] } e5 2. Nf3 Nc6 *',
  }), /variations/);
});

for (const [name, patch] of [
  ["illegal move", { pgn: "1. e5 e5 2. Nf3 Nc6 *" }],
  ["non-SAN coordinate move", { pgn: "1. e2e4 e7e5 2. g1f3 b8c6 *" }],
  ["missing late ply", { pgn: "1. e4 e5 2. Nf3 *" }],
  ["extra ply", { pgn: "1. e4 e5 2. Nf3 Nc6 3. Bb5 *" }],
  ["wrong expected count", { expectedPlyCount: 3 }],
  ["wrong final board", { expectedFinalFen: opening.expectedFinalFen.replace("2n5", "8") }],
  ["wrong side to move", { expectedFinalFen: opening.expectedFinalFen.replace(" w KQkq", " b KQkq") }],
  ["missing FEN fields", { expectedFinalFen: "8/8/8/8/8/8/8/8 w - -" }],
  ["invalid FEN", { expectedFinalFen: "8/8/8/8/8/8/8/8 w - - 0 1" }],
  ["no legal plies", { pgn: "*" }],
  ["multiple games", { pgn: "1. e4 e5 * 1. e4 e5 2. Nf3 Nc6 *" }],
  ["trailing garbage", { pgn: `${opening.pgn} discard-this` }],
  ["overlong source", { pgn: " ".repeat(32_769) }],
  ["unbounded expected moves", { expectedPlyCount: 257 }],
  ["empty rights provenance", { rightsNote: " " }],
  ["uppercase source id", { id: "source-Opening" }],
  ["incompatible source id", { id: "source-opening_replay" }],
  ["overlong source label", { label: "A".repeat(181) }],
  ["unsupported source field", { approvedForPublish: true }],
] as const) test(`source rejects ${name}`, () => assert.throws(() => buildChessReplay({ ...opening, ...patch })));

function rehash(trace: ChessReplay): void {
  trace.sourceHash = sha256Hex(canonicalJson(trace.source));
  const payload: Partial<ChessReplay> = { ...trace };
  delete payload.fingerprint;
  trace.fingerprint = sha256Hex(canonicalJson(payload));
}
for (const [name, mutate] of [
  ["missing middle event", (trace: ChessReplay) => { trace.events.splice(1, 1); }],
  ["missing late event", (trace: ChessReplay) => { trace.events.pop(); }],
  ["duplicate event", (trace: ChessReplay) => { trace.events[2] = { ...trace.events[1]! }; }],
  ["reordered events", (trace: ChessReplay) => { trace.events.reverse(); }],
  ["wrong event id", (trace: ChessReplay) => { trace.events[0]!.id = "ply-2"; }],
  ["wrong ply", (trace: ChessReplay) => { trace.events[0]!.ply = 2; }],
  ["wrong before board", (trace: ChessReplay) => { trace.events[0]!.beforeFen = trace.finalFen; }],
  ["wrong after board", (trace: ChessReplay) => { trace.events[0]!.afterFen = trace.finalFen; }],
  ["wrong SAN", (trace: ChessReplay) => { trace.events[0]!.san = "d4"; }],
  ["wrong color", (trace: ChessReplay) => { trace.events[0]!.color = "b"; }],
  ["wrong piece", (trace: ChessReplay) => { trace.events[0]!.piece = "q"; }],
  ["invented capture", (trace: ChessReplay) => { trace.events[0]!.captured = "q"; }],
  ["invented check", (trace: ChessReplay) => { trace.events[0]!.check = true; }],
  ["invented mate", (trace: ChessReplay) => { trace.events[0]!.checkmate = true; }],
  ["wrong initial board", (trace: ChessReplay) => { trace.initialFen = trace.finalFen; }],
  ["mutated source moves", (trace: ChessReplay) => { trace.source.pgn = "1. e4 e5 *"; }],
] as const) test(`reconstruction rejects ${name}, even with recomputed hashes`, () => {
  const trace = buildChessReplay(opening);
  mutate(trace);
  rehash(trace);
  assert.throws(() => assertChessReplay(trace));
  assert.equal(ChessReplaySchema.safeParse(trace).success, false);
});

test("source provenance mutation invalidates existing hashes", () => {
  const trace = buildChessReplay(opening);
  trace.source.locator = "fixture://unrelated-source";
  assert.throws(() => assertChessReplay(trace));
  const changed = buildChessReplay({ ...opening, locator: trace.source.locator });
  assert.notEqual(changed.sourceHash, buildChessReplay(opening).sourceHash);
});

test("strict trace schema rejects undeclared analysis and event fields", () => {
  const trace = buildChessReplay(opening);
  assert.equal(ChessReplaySchema.safeParse({ ...trace, bestMove: "Nf3" }).success, false);
  assert.equal(ChessReplaySchema.safeParse({ ...trace, events: [{ ...trace.events[0], evaluation: 1 }, ...trace.events.slice(1)] }).success, false);
  assert.equal(ChessReplaySourceSchema.safeParse({ ...opening, expectedPlyCount: 0 }).success, false);
});

test("board input must be valid full FEN and board snapshots do not mutate trace", () => {
  assert.throws(() => chessBoardPieces("8/8/8/8/8/8/8/8 w - - 0 1"));
  assert.throws(() => chessBoardPieces("start"));
  const trace = buildChessReplay(opening);
  const board = chessBoardPieces(trace.finalFen);
  board.pop();
  assert.equal(chessBoardPieces(trace.finalFen).length, 32);
  assert.deepEqual(assertChessReplay(trace), trace);
});

test("adjacent kings and checked inactive king cannot be starting positions", () => {
  assert.throws(() => chessBoardPieces("8/8/8/8/8/8/4k3/4K3 w - - 0 1"), /side not to move/);
  assert.throws(() => chessBoardPieces("4k3/8/8/8/8/8/8/4R1K1 w - - 0 1"), /side not to move/);
  assert.throws(() => buildChessReplay(setup(
    "8/8/8/8/8/8/4k3/4K3 w - - 0 1", "1. Kd1 *",
    "8/8/8/8/8/8/4k3/3K4 b - - 1 1",
  )));
});

test("source cannot castle without a rook or invent an EP pawn during history undo", () => {
  assert.throws(() => buildChessReplay(setup(
    "4k3/8/8/8/8/8/8/4K3 w K - 0 1", "1. O-O *",
    "4k3/8/8/8/8/8/8/6K1 b - - 1 1",
  )), /castling right requires/);
  // Use a coherent clock to ensure this rejects the missing pawn itself.
  assert.throws(() => buildChessReplay(setup(
    "4k3/8/8/4P3/8/8/8/4K3 w - d6 0 2", "2. exd6 *",
    "4k3/8/3P4/8/8/8/8/4K3 b - - 0 2",
  )), /en-passant target requires/);
});

for (const [name, fenValue] of [
  ["missing white queenside rook", "4k3/8/8/8/8/8/8/4K3 w Q - 0 1"],
  ["missing black kingside rook", "4k3/8/8/8/8/8/8/4K3 b k - 0 1"],
  ["missing black queenside rook", "4k3/8/8/8/8/8/8/4K3 b q - 0 1"],
  ["wrong-color home rook", "4k3/8/8/8/8/8/8/4K2r w K - 0 1"],
  ["non-rook on rook home", "4k3/8/8/8/8/8/8/4K2N w K - 0 1"],
  ["king away from home", "4k3/8/8/8/8/8/4K3/7R w K - 0 1"],
  ["missing white EP pawn", "4k3/8/8/8/4p3/8/8/4K3 b - d3 0 1"],
  ["wrong-color EP pawn", "4k3/8/8/3PP3/8/8/8/4K3 w - d6 0 2"],
  ["occupied EP target", "4k3/8/3n4/3pP3/8/8/8/4K3 w - d6 0 2"],
  ["occupied EP origin", "4k3/3p4/8/3pP3/8/8/8/4K3 w - d6 0 2"],
  ["nonzero EP halfmove clock", "4k3/8/8/3pP3/8/8/8/4K3 w - d6 1 2"],
  ["impossible white EP fullmove clock", "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1"],
  ["EP target rank for wrong side", "4k3/8/8/3pP3/8/8/8/4K3 b - d6 0 2"],
] as const) test(`current FEN state rejects ${name}`, () => assert.throws(() => chessBoardPieces(fenValue)));

test("valid black EP removes white pawn and preserves the ORIGINAL supplied board", () => {
  const initialFen = "4k3/8/8/8/3Pp3/8/8/4K3 b - d3 0 1";
  const trace = buildChessReplay(setup(initialFen, "1... exd3 *", "4k3/8/8/8/8/3p4/8/4K3 w - - 0 2"));
  assert.equal(trace.initialFen, initialFen);
  assert.equal(trace.events[0]!.beforeFen, initialFen);
  assert.equal(trace.events[0]!.captured, "p");
  assert.deepEqual(chessBoardPieces(trace.finalFen), [
    { square: "e8", type: "k", color: "b" },
    { square: "d3", type: "p", color: "b" },
    { square: "e1", type: "k", color: "w" },
  ]);
  assert.deepEqual(assertChessReplay(trace), trace);
});

test("white queenside and black kingside castling remain admitted with real home rooks", () => {
  const initialFen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
  const trace = buildChessReplay(setup(initialFen, "1. O-O-O O-O *", "r4rk1/8/8/8/8/8/8/2KR3R w - - 2 2", 2));
  assert.equal(trace.initialFen, initialFen);
  assert.deepEqual(chessBoardPieces(trace.finalFen), [
    { square: "a8", type: "r", color: "b" },
    { square: "f8", type: "r", color: "b" },
    { square: "g8", type: "k", color: "b" },
    { square: "c1", type: "k", color: "w" },
    { square: "d1", type: "r", color: "w" },
    { square: "h1", type: "r", color: "w" },
  ]);
});

test("coherent non-capturable EP target is allowed, without inventing a capturing pawn", () => {
  const trace = buildChessReplay(setup(
    "4k3/8/8/3p4/8/8/8/4K3 w - d6 0 2", "2. Kd2 *",
    "4k3/8/8/3p4/8/8/3K4/8 b - - 1 2",
  ));
  assert.equal(trace.initialFen, "4k3/8/8/3p4/8/8/8/4K3 w - - 0 2");
  assert.equal(chessBoardPieces(trace.initialFen).length, 3);
  assert.equal(trace.events[0]!.captured, undefined);
});

test("setup FEN is not silently ignored when its required header is absent", () => {
  const defaultFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  for (const prefix of [`[FEN "${defaultFen}"]`, `[fen "${defaultFen}"]`, `[SetUp "0"]\n[FEN "${defaultFen}"]`]) {
    assert.throws(() => buildChessReplay({ ...opening, pgn: `${prefix}\n${opening.pgn}` }), /setup FEN requires/);
  }
});

console.log(`Chess replay core: ${cases} cases passed (legal state only; no native-render or narration qualification).`);
