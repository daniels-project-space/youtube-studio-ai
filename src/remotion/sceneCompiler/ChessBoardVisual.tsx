import { chessBoardPieces, type ChessReplayEvent } from "@/engine/chessReplay";
import type { ChessBoardScene } from "@/engine/chessScene";

const FILES = "abcdefgh";
const PIECE_NAMES = { p: "Pawn", n: "Knight", b: "Bishop", r: "Rook", q: "Queen", k: "King" };

/** Board coordinates are model state, not measurements of the browser layout. */
export function chessSquarePosition(square: string, orientation: "white" | "black") {
  if (!/^[a-h][1-8]$/.test(square)) throw new Error(`Invalid board square ${square}`);
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]) - 1;
  return orientation === "white" ? { x: file, y: 7 - rank } : { x: 7 - file, y: rank };
}

export function chessBoardFrame(event: ChessReplayEvent, progress: number, orientation: "white" | "black") {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) throw new Error("Invalid chess move progress");
  if (progress === 1) {
    return chessBoardPieces(event.afterFen).map((piece) => ({
      ...piece, ...chessSquarePosition(piece.square, orientation), moving: false,
    }));
  }
  const castle = event.piece === "k" && Math.abs(FILES.indexOf(event.to[0]) - FILES.indexOf(event.from[0])) === 2;
  const rookFrom = `${event.to[0] === "g" ? "h" : "a"}${event.from[1]}`;
  const rookTo = `${event.to[0] === "g" ? "f" : "d"}${event.from[1]}`;
  return chessBoardPieces(event.beforeFen).map((piece) => {
    const destination = piece.square === event.from ? event.to : castle && piece.square === rookFrom ? rookTo : undefined;
    const from = chessSquarePosition(piece.square, orientation);
    const to = destination ? chessSquarePosition(destination, orientation) : from;
    return { ...piece, x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress, moving: !!destination };
  }).sort((a, b) => Number(a.moving) - Number(b.moving));
}

/** Original vector pieces: no font-dependent chess glyphs or generated images. */
function Piece({ type, color }: { type: keyof typeof PIECE_NAMES; color: "w" | "b" }) {
  const fill = color === "w" ? "#fff6e6" : "#263335";
  const stroke = color === "w" ? "#52493d" : "#c3cdca";
  const shapes = {
    p: <><circle cx="50" cy="25" r="12" /><path d="M39 39H61L59 49Q57 59 68 70H32Q43 59 41 49Z" /></>,
    n: <><path d="M30 71Q27 54 39 45L28 47L24 39L43 17L48 8L55 19Q74 24 73 47L69 71Z" /><path d="M42 33L47 30M54 22Q66 31 61 44L50 56" fill="none" /></>,
    b: <><path d="M50 10Q76 31 59 45L59 53L68 71H32L41 53V45Q24 31 50 10Z" /><path d="M54 19L44 34M39 49H61" fill="none" /></>,
    r: <><path d="M29 16H40V27H46V16H55V27H61V16H72V39L63 46V61L70 71H30L38 61V46L29 39Z" /><path d="M36 41H65M37 62H64" fill="none" /></>,
    q: <><path d="M29 35L37 66H65L72 35L59 44L50 25L42 44Z" /><circle cx="27" cy="30" r="5" /><circle cx="50" cy="19" r="5" /><circle cx="74" cy="30" r="5" /><path d="M36 64H65L69 73H31Z" /></>,
    k: <><path d="M46 9H55V19H64V27H55V34H46V27H37V19H46Z" /><path d="M50 36Q31 24 29 41Q30 50 40 57L35 71H66L61 57Q73 50 72 41Q71 24 50 36Z" /><path d="M40 57H61" fill="none" /></>,
  };
  return <g fill={fill} stroke={stroke} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round">
    {shapes[type]}<path d="M30 74H70L77 84H23Z" /><path d="M25 89H75" fill="none" />
  </g>;
}

export function ChessBoardVisual({ event, binding, localSeconds, durationSec }: {
  event: ChessReplayEvent;
  binding: ChessBoardScene;
  localSeconds: number;
  durationSec: number;
}) {
  // The board spends the whole source-bound spoken cue on this legal move. It
  // never uses a fixed global 0.2–0.6s window: move onset and settle scale
  // only with the measured narration interval assigned to this scene.
  const cueDuration = Math.max(1.2, durationSec);
  const cueProgress = Math.max(0, Math.min(1, localSeconds / cueDuration));
  const linear = Math.max(0, Math.min(1, (cueProgress - 0.18) / 0.44));
  const progress = linear * linear * (3 - 2 * linear);
  const settled = progress === 1;
  const pieces = chessBoardFrame(event, progress, binding.orientation);
  const walnut = binding.theme === "walnut";
  const light = walnut ? "#e5d7bd" : "#c5d5db";
  const dark = walnut ? "#9b8064" : "#576e81";
  const accent = walnut ? "#eed794" : "#8de4d7";
  const from = chessSquarePosition(event.from, binding.orientation);
  const to = chessSquarePosition(event.to, binding.orientation);
  const status = settled && event.checkmate ? "CHECKMATE" : settled && event.check ? "CHECK" : event.captured ? "CAPTURE" : "REPLAY";
  return <svg viewBox="0 0 1400 850" width="100%" height="100%" role="img"
    aria-label={`${event.color === "w" ? "White" : "Black"}: ${event.san}`} data-chess-event={event.id}>
    <rect x="26" y="27" width="798" height="798" rx="22" fill="#0b1518" stroke="#ffffff25" strokeWidth="2" />
    {Array.from({ length: 64 }, (_, index) => {
      const x = index % 8;
      const y = Math.floor(index / 8);
      const highlighted = (x === from.x && y === from.y) || (x === to.x && y === to.y);
      return <g key={index}>
        <rect x={65 + x * 90} y={65 + y * 90} width="90" height="90" fill={(x + y) % 2 ? dark : light} />
        {highlighted ? <rect x={65 + x * 90} y={65 + y * 90} width="90" height="90" fill={accent} opacity="0.48" /> : null}
      </g>;
    })}
    {pieces.map((piece) => <g key={piece.square} data-square={piece.square} data-piece={`${piece.color}${piece.type}`}
      transform={`translate(${65 + piece.x * 90},${65 + piece.y * 90}) scale(.9)`}>
      <Piece type={piece.type} color={piece.color} />
    </g>)}
    {Array.from({ length: 8 }, (_, i) => <g key={i} fill="#acbcb8" fontSize="18" textAnchor="middle" fontFamily="Arial, sans-serif">
      <text x={110 + i * 90} y="811">{FILES[binding.orientation === "white" ? i : 7 - i]}</text>
      <text x="45" y={119 + i * 90}>{binding.orientation === "white" ? 8 - i : i + 1}</text>
    </g>)}
    <g fontFamily="Arial, Helvetica, sans-serif">
      <text x="884" y="192" fill="#9aafaa" fontSize="23" letterSpacing="5">{event.color === "w" ? "WHITE" : "BLACK"} · MOVE {event.beforeFen.split(" ")[5]}</text>
      <text x="878" y="307" fill="#f3f0e7" fontSize="94" fontWeight="700" letterSpacing="-3">{event.san}</text>
      <path d="M886 359H1316" stroke="#ffffff25" strokeWidth="2" />
      <text x="884" y="424" fill="#d6dfd9" fontSize="31">{PIECE_NAMES[event.piece]}</text>
      <text x="884" y="492" fill={accent} fontSize="48">{event.from} → {event.to}</text>
      <rect x="884" y="557" width={status === "CHECKMATE" ? 212 : 167} height="49" rx="24" fill={`${accent}18`} stroke={`${accent}55`} />
      <text x="909" y="589" fill={accent} fontSize="21" letterSpacing="2">{status}</text>
      {settled && event.promotion ? <text x="884" y="671" fill="#d6dfd9" fontSize="25">Promoted to {PIECE_NAMES[event.promotion].toLowerCase()}</text> : null}
    </g>
  </svg>;
}
