import { buildEpisodeGraph, compileSceneManifest } from "@/engine/episodeGraph";
import {
  assertChessNarrationPlan,
  assertChessNarrationTiming,
  bindChessNarrationTiming,
  buildChessNarrationPlan,
} from "@/engine/chessNarration";
import { assertChessReplay, buildChessReplay, ChessReplaySourceSchema } from "@/engine/chessReplay";
import type { Block } from "@/engine/types";
import type { Script } from "@/lib/scriptGen";

function sourceFromStore(store: Readonly<Record<string, unknown>>) {
  return ChessReplaySourceSchema.parse(store["chessReplaySource"]);
}

function boardPresentation(value: unknown, label: string, allowed: readonly string[]): string {
  const selected = value === undefined ? allowed[0]! : String(value);
  if (!allowed.includes(selected)) {
    throw new Error(`${label} must be one of ${allowed.join(", ")}`);
  }
  return selected;
}

/**
 * Source-only admission for the chess replay capability. It accepts a complete
 * operator/source packet; it neither discovers games nor asserts that a linked
 * game is historically authentic or licensed. The next block receives the
 * replay and source-derived spoken plan as typed durable artifacts.
 */
const chessReplaySource: Block = {
  id: "chess_replay_source",
  consumes: ["chessReplaySource"],
  produces: ["chessReplay", "chessNarrationPlan", "topic"],
  run: async (ctx) => {
    const source = sourceFromStore(ctx.store);
    const chessReplay = buildChessReplay(source);
    // EpisodeGraph's public renderer ABI is a causal sequence (minimum two
    // beats). Reject a one-ply source before it can enter paid TTS rather than
    // discovering the incompatible format after a voice purchase.
    if (chessReplay.events.length < 2) {
      throw new Error("chess_replay_source: the current native-board route requires at least two legal plies");
    }
    const chessNarrationPlan = buildChessNarrationPlan(chessReplay);
    ctx.log(
      `chess_replay_source: ${chessReplay.events.length} verified legal plies from ${source.id}; provider calls: 0`,
    );
    return { chessReplay, chessNarrationPlan, topic: source.label };
  },
};

/**
 * The legal-move track is deliberately not delegated to generic script_gen.
 * That model can add unsupported analysis or rewrite a move. This adapter
 * carries the exact source plan into the shared Script/Narration ABI, after
 * which the existing narration_tts block remains the only voice producer.
 */
const chessScript: Block = {
  id: "chess_script",
  consumes: ["chessNarrationPlan"],
  produces: ["script", "narrationText"],
  run: async (ctx) => {
    const plan = assertChessNarrationPlan(ctx.store["chessNarrationPlan"]);
    const [opening, ...remaining] = plan.segments;
    const script: Script = {
      hook: opening!.text,
      sections: remaining.map((segment, index) => ({
        heading: `Legal move ${index + 2}`,
        narration: segment.text,
        role: index === remaining.length - 1 ? "outro" : "body",
      })),
      narrationText: plan.narrationText,
      // This is only the legal minimum cue floor, never a claimed voice duration.
      estDurationSec: plan.segments.length * 1.2,
    };
    ctx.log(`chess_script: ${plan.segments.length} source-bound legal-move sentence(s); provider calls: 0`);
    return { script, narrationText: plan.narrationText };
  },
};

/**
 * A source-transcription integrity gate, not a substitute for a creative
 * narrative critic. It makes the source-only route eligible for the existing
 * paid narration_tts contract only when its Script ABI still equals the legal
 * replay plan. Any future analytical narration needs its own reviewed layer.
 */
const chessScriptIntegrity: Block = {
  id: "chess_script_integrity",
  consumes: ["chessNarrationPlan", "script", "narrationText"],
  produces: ["scriptApproved"],
  run: async (ctx) => {
    const plan = assertChessNarrationPlan(ctx.store["chessNarrationPlan"]);
    const script = ctx.store["script"] as Partial<Script> | undefined;
    if (!script || script.narrationText !== plan.narrationText || ctx.store["narrationText"] !== plan.narrationText) {
      throw new Error("chess_script_integrity: Script or narration differs from the immutable legal-move plan");
    }
    if (script.hook !== plan.segments[0]!.text || !Array.isArray(script.sections)) {
      throw new Error("chess_script_integrity: script does not retain the exact source-bound opening structure");
    }
    const spoken = [script.hook, ...script.sections.map((section) => section.narration)].join(" ");
    if (spoken !== plan.narrationText) {
      throw new Error("chess_script_integrity: script sections do not reproduce every source-bound legal move");
    }
    ctx.log("chess_script_integrity: source-bound transcript accepted for narration_tts");
    return { scriptApproved: true };
  },
};

/** Binds the existing TTS block's measured cues back to the immutable replay. */
const chessNarrationTiming: Block = {
  id: "chess_narration_timing",
  consumes: ["chessNarrationPlan", "sentenceTimings", "narrationDurationSec"],
  produces: ["chessNarrationTiming"],
  run: async (ctx) => {
    const chessNarrationTiming = bindChessNarrationTiming({
      narrationPlan: ctx.store["chessNarrationPlan"],
      sentenceTimings: ctx.store["sentenceTimings"],
      narrationDurationSec: ctx.store["narrationDurationSec"],
    });
    ctx.log(
      `chess_narration_timing: ${chessNarrationTiming.segments.length} measured source-bound TTS cue(s); provider calls: 0`,
    );
    return { chessNarrationTiming };
  },
};

/** Creates the only admitted native-board graph/manifest from the real TTS cue receipt. */
const chessEpisodeGraph: Block = {
  id: "chess_episode_graph",
  consumes: ["chessReplay", "chessNarrationPlan", "chessNarrationTiming", "topic"],
  produces: ["episodeGraph", "sceneManifest"],
  run: async (ctx) => {
    const chessReplay = assertChessReplay(ctx.store["chessReplay"]);
    const chessNarrationPlan = assertChessNarrationPlan(ctx.store["chessNarrationPlan"]);
    if (chessNarrationPlan.replayFingerprint !== chessReplay.fingerprint) {
      throw new Error("chess_episode_graph: source narration plan is not bound to the current legal replay");
    }
    const timing = assertChessNarrationTiming(ctx.store["chessNarrationTiming"], chessNarrationPlan);
    const orientation = boardPresentation(ctx.params["boardOrientation"], "chess_episode_graph: boardOrientation", ["white", "black"] as const) as "white" | "black";
    const theme = boardPresentation(ctx.params["boardTheme"], "chess_episode_graph: boardTheme", ["walnut", "midnight"] as const) as "walnut" | "midnight";
    const source = chessReplay.source;
    const episodeGraph = buildEpisodeGraph({
      chessReplay,
      chessNarrationPlan,
      chessNarrationTiming: timing,
      seriesId: "series-chess-replay",
      episodeId: `episode-${source.id.slice("source-".length)}`,
      topic: typeof ctx.store["topic"] === "string" && ctx.store["topic"].trim() ? ctx.store["topic"].trim() : source.label,
      audience: "general",
      durationSec: timing.narrationDurationSec,
      characterIds: [],
      settingIds: [],
      characters: [],
      settings: [],
      sources: [{ id: source.id, kind: "primary", label: source.label, locator: source.locator }],
      beats: chessReplay.events.map((event, index) => {
        const cue = timing.segments[index]!;
        const segment = chessNarrationPlan.segments[index]!;
        return {
          id: `beat-ply-${event.ply}`,
          kind: index === 0 ? "opening" as const : "observation" as const,
          t0: cue.start,
          t1: cue.end,
          scenePurpose: `Display legal move ${event.san}`,
          text: segment.text,
          sourceRefs: [source.id],
          characterIds: [],
          camera: { framing: "wide" as const, move: "static" as const },
          transition: "cut" as const,
          storySpineBeatIds: [`beat-ply-${event.ply}`],
          storySpineSentenceIds: [`sentence-ply-${event.ply}`],
          visualState: {
            action: `${event.from} to ${event.to}`,
            props: [],
            chessBoard: {
              version: "chess-board-scene/v1" as const,
              replayFingerprint: chessReplay.fingerprint,
              narrationPlanFingerprint: chessNarrationPlan.fingerprint,
              narrationSegmentId: segment.id,
              eventId: event.id,
              orientation,
              theme,
            },
          },
        };
      }),
      causalEdges: chessReplay.events.slice(1).map((event, index) => ({
        id: `edge-ply-${event.ply}`,
        fromBeatId: `beat-ply-${index + 1}`,
        toBeatId: `beat-ply-${event.ply}`,
        relation: "enables" as const,
        rationale: "The prior legal position enables the next recorded move.",
        sourceRefs: [source.id],
      })),
    });
    const sceneManifest = compileSceneManifest(episodeGraph);
    ctx.log(`chess_episode_graph: ${sceneManifest.scenes.length} legal-board scene(s) → deterministic manifest; provider calls: 0`);
    return { episodeGraph, sceneManifest };
  },
};

export const chessReplayBlocks: Block[] = [
  chessReplaySource,
  chessScript,
  chessScriptIntegrity,
  chessNarrationTiming,
  chessEpisodeGraph,
];
