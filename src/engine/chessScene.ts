import { z } from "zod";
import { assertChessReplay, type ChessReplay, type ChessReplayEvent } from "./chessReplay";

/** A board can point only at a verified replay event, never supply its own pieces. */
export const ChessBoardSceneSchema = z.object({
  version: z.literal("chess-board-scene/v1"),
  replayFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  eventId: z.string().regex(/^ply-[1-9]\d*$/),
  orientation: z.enum(["white", "black"]),
  theme: z.enum(["walnut", "midnight"]),
}).strict();
export type ChessBoardScene = z.infer<typeof ChessBoardSceneSchema>;

export function chessSceneEvent(binding: ChessBoardScene, replay: ChessReplay): ChessReplayEvent {
  if (binding.replayFingerprint !== replay.fingerprint) {
    throw new Error("chess scene: replay fingerprint mismatch");
  }
  const event = replay.events.find((candidate) => candidate.id === binding.eventId);
  if (!event) throw new Error(`chess scene: unknown event ${binding.eventId}`);
  return event;
}

interface TimedChessScene {
  t0: number;
  t1: number;
  sourceRefs: string[];
  camera: { move: string };
  transition: string;
  visualState: {
    chessBoard?: ChessBoardScene;
    evidenceVisualIntent?: unknown;
    evidenceVisualManifest?: unknown;
    syntheticScenarioProfile?: unknown;
    syntheticScenarioVisualKind?: unknown;
  };
}

/** Full-sequence gate: one source-bound board event per timed scene, in order. */
export function assertChessSceneSequence(
  scenes: readonly TimedChessScene[],
  rawReplay: unknown,
): ChessReplay | undefined {
  const hasChess = scenes.some((scene) => scene.visualState.chessBoard !== undefined);
  if (rawReplay === undefined) {
    if (hasChess) throw new Error("chess scene: the immutable replay is required");
    return undefined;
  }
  const replay = assertChessReplay(rawReplay);
  if (scenes.length !== replay.events.length) {
    throw new Error("chess scene: every source ply must have exactly one timed scene");
  }
  const ordered = [...scenes].sort((a, b) => a.t0 - b.t0);
  let identity: string | undefined;
  for (const [index, scene] of ordered.entries()) {
    const binding = ChessBoardSceneSchema.parse(scene.visualState.chessBoard);
    const event = chessSceneEvent(binding, replay);
    if (event.id !== replay.events[index].id) throw new Error("chess scene: skipped, duplicated or reordered ply");
    if (!scene.sourceRefs.includes(replay.source.id)) throw new Error("chess scene: missing original game source");
    if (scene.t1 - scene.t0 < 1.2 - 1e-6) throw new Error("chess scene: less than 1.2 seconds to read the move");
    if (scene.camera.move !== "static" || scene.transition !== "cut") {
      throw new Error("chess scene: board coordinates require a static camera and cut transition");
    }
    const state = scene.visualState;
    if (state.evidenceVisualIntent !== undefined || state.evidenceVisualManifest !== undefined ||
      state.syntheticScenarioProfile !== undefined || state.syntheticScenarioVisualKind !== undefined) {
      throw new Error("chess scene: cannot mix a legal board with factual-chart or fictional-scene data");
    }
    const currentIdentity = `${binding.orientation}:${binding.theme}`;
    if (identity !== undefined && currentIdentity !== identity) throw new Error("chess scene: board identity changes between moves");
    identity = currentIdentity;
  }
  return replay;
}
