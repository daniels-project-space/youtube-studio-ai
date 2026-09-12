/** Legal mainline replay only: no engine analysis or source-rights verification. */
import { Chess, DEFAULT_POSITION, type Square } from "chess.js";
import { z } from "zod";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export const CHESS_REPLAY_VERSION = "chess-replay/v1" as const;
export const CHESS_REPLAY_MAX_PLIES = 256;
const text = (max: number) => z.string().min(1).max(max).refine((value) => value.trim().length > 0);
const fen = text(160);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const square = z.string().regex(/^[a-h][1-8]$/);
const piece = z.enum(["p", "n", "b", "r", "q", "k"]);
const color = z.enum(["w", "b"]);

export const ChessReplaySourceSchema = z.object({
  id: z.string().max(96).regex(/^source-[a-z0-9]+(?:-[a-z0-9]+)*$/),
  label: text(180),
  locator: text(2_000),
  rightsNote: text(2_000),
  pgn: text(32_768),
  // Independent source expectations, never inferred from the parsed output.
  expectedPlyCount: z.number().int().min(1).max(CHESS_REPLAY_MAX_PLIES),
  expectedFinalFen: fen,
}).strict();
export type ChessReplaySource = z.infer<typeof ChessReplaySourceSchema>;

export const ChessReplayEventSchema = z.object({
  id: z.string().regex(/^ply-[1-9][0-9]{0,2}$/),
  ply: z.number().int().min(1).max(CHESS_REPLAY_MAX_PLIES),
  san: text(20),
  beforeFen: fen,
  afterFen: fen,
  from: square,
  to: square,
  piece,
  color,
  captured: piece.optional(),
  promotion: z.enum(["n", "b", "r", "q"]).optional(),
  check: z.boolean(),
  checkmate: z.boolean(),
}).strict();
export type ChessReplayEvent = z.infer<typeof ChessReplayEventSchema>;

const ReplayShape = z.object({
  version: z.literal(CHESS_REPLAY_VERSION),
  source: ChessReplaySourceSchema,
  sourceHash: digest,
  fingerprint: digest,
  initialFen: fen,
  finalFen: fen,
  events: z.array(ChessReplayEventSchema).min(1).max(CHESS_REPLAY_MAX_PLIES),
}).strict();
export type ChessReplay = z.infer<typeof ReplayShape>;

/**
 * Structural FEN and side-to-move legality; not proof of historical reachability.
 * Normalizes non-capturable en-passant targets using the pinned rules library.
 */
function canonicalFen(value: string): string {
  const normalized = value.trim().split(/\s+/).join(" ");
  if (normalized.split(" ").length !== 6) throw new Error("chess_replay: FEN requires all six fields");
  const position = new Chess(normalized);
  const [, active, castling, ep, halfmove, fullmove] = normalized.split(" ");
  for (const [right, kingSquare, rookSquare, owner] of [
    ["K", "e1", "h1", "w"], ["Q", "e1", "a1", "w"],
    ["k", "e8", "h8", "b"], ["q", "e8", "a8", "b"],
  ] as const) {
    if (!castling!.includes(right)) continue;
    const king = position.get(kingSquare);
    const rook = position.get(rookSquare);
    if (king?.type !== "k" || king.color !== owner || rook?.type !== "r" || rook.color !== owner) {
      throw new Error("chess_replay: castling right requires its king and rook on their home squares");
    }
  }
  if (ep !== "-") {
    const file = ep![0]!;
    const whiteToMove = active === "w";
    const target = `${file}${whiteToMove ? "6" : "3"}` as Square;
    const destination = `${file}${whiteToMove ? "5" : "4"}` as Square;
    const origin = `${file}${whiteToMove ? "7" : "2"}` as Square;
    const movedPawn = position.get(destination);
    if (
      ep !== target || position.get(target) || position.get(origin) ||
      movedPawn?.type !== "p" || movedPawn.color !== (whiteToMove ? "b" : "w") ||
      Number(halfmove) !== 0 || (whiteToMove && Number(fullmove) < 2)
    ) {
      throw new Error("chess_replay: en-passant target requires a coherent double-push pawn, empty origin/target and clocks");
    }
  }
  const inactiveKing = position.findPiece({ type: "k", color: position.turn() === "w" ? "b" : "w" })[0]!;
  if (position.isAttacked(inactiveKing, position.turn())) {
    throw new Error("chess_replay: side not to move cannot already be in check");
  }
  return position.fen();
}

/**
 * This version accepts one mainline, not recursively annotated variations.
 * Parentheses in ordinary comments or quoted tag values remain harmless.
 * chess.js still parses and validates the ORIGINAL PGN, not this inspection copy.
 */
function assertMainlineOnly(pgn: string): void {
  const moves = pgn.replace(/\{[^}]*\}|;[^\r\n]*|\[\s*[A-Za-z0-9_]+\s+"(?:\\.|[^"\\])*"\s*\]/g, " ");
  if (/[()]/.test(moves)) {
    throw new Error("chess_replay: variations are not supported; supply one explicit mainline");
  }
}

export function buildChessReplay(input: unknown): ChessReplay {
  const parsed = ChessReplaySourceSchema.parse(input);
  const source = { ...parsed, expectedFinalFen: canonicalFen(parsed.expectedFinalFen) };
  assertMainlineOnly(source.pgn);
  const game = new Chess();
  game.loadPgn(source.pgn, { strict: true });
  const headers = game.getHeaders();
  if (
    (headers.SetUp === "1") !== Boolean(headers.FEN) ||
    Object.keys(headers).some((key) => key.toLowerCase() === "fen" && key !== "FEN")
  ) {
    throw new Error("chess_replay: a setup FEN requires matching SetUp and FEN tags");
  }
  // Validate the supplied state BEFORE history() undoes/replays moves. The
  // upstream library can invent a missing EP pawn during undo of a bad FEN.
  const initialFen = canonicalFen(headers.FEN ?? DEFAULT_POSITION);
  const finalFen = game.fen();
  const moves = game.history({ verbose: true });
  if (moves.length !== source.expectedPlyCount || moves.length > CHESS_REPLAY_MAX_PLIES) {
    throw new Error(`chess_replay: expected ${source.expectedPlyCount} plies, parsed ${moves.length}`);
  }
  if (finalFen !== source.expectedFinalFen) {
    throw new Error("chess_replay: final FEN differs from the source expectation");
  }
  if (canonicalFen(moves[0]!.before) !== initialFen) {
    throw new Error("chess_replay: reconstructed history changes the supplied initial FEN");
  }
  const replay = new Chess(initialFen);
  const events = moves.map((move, index) => {
    const beforeFen = replay.fen();
    const accepted = replay.move(move.san, { strict: true });
    return {
      id: `ply-${index + 1}`,
      ply: index + 1,
      san: accepted.san,
      beforeFen,
      afterFen: replay.fen(),
      from: accepted.from,
      to: accepted.to,
      piece: accepted.piece,
      color: accepted.color,
      ...(accepted.captured ? { captured: accepted.captured } : {}),
      ...(accepted.promotion ? { promotion: accepted.promotion } : {}),
      check: replay.isCheck(),
      checkmate: replay.isCheckmate(),
    };
  });
  if (replay.fen() !== finalFen) throw new Error("chess_replay: reconstructed replay changes the final FEN");
  const payload = {
    version: CHESS_REPLAY_VERSION,
    source,
    sourceHash: sha256Hex(canonicalJson(source)),
    initialFen,
    finalFen,
    events,
  };
  return ReplayShape.parse({ ...payload, fingerprint: sha256Hex(canonicalJson(payload)) });
}

/** Rebuild from source even when a caller has recomputed a forged trace's hash. */
export const ChessReplaySchema = ReplayShape.superRefine((value, ctx) => {
  try {
    const rebuilt = buildChessReplay(value.source);
    if (canonicalJson(rebuilt) !== canonicalJson(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "chess_replay: trace differs from its frozen source" });
    }
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `chess_replay: invalid source replay (${error instanceof Error ? error.message : String(error)})`,
    });
  }
});

export function assertChessReplay(value: unknown): ChessReplay {
  return ChessReplaySchema.parse(value);
}

/** Rank 8→1, file a→h; orientation belongs to the renderer, never the position. */
export function chessBoardPieces(fenValue: string): Array<{ square: string; type: z.infer<typeof piece>; color: z.infer<typeof color> }> {
  return new Chess(canonicalFen(fenValue)).board().flatMap((rank) =>
    rank.flatMap((entry) => entry ? [{ square: entry.square, type: entry.type, color: entry.color }] : []),
  );
}
