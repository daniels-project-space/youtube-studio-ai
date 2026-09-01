/**
 * WHITEBOARDSYNC — the NARRATION-SYNCED whiteboard-scribe engine as ONE
 * standalone module (sibling to whiteboardcraft / documotion / footagecraft):
 * a topic in → a finished whiteboard explainer where a hand DRAWS each beat in
 * time with the narration, out. VISUAL+VOICE CRAFT for explainer content.
 *
 * The deterministic "write-on" reveal uses no video model: it traces the real
 * ink of each layer and reveals it under a moving hand. The bounded paid path
 * is caller-injected, attested Nano Banana Pro layer art plus TTS.
 *
 * Pipeline (one castWhiteboardSync() call):
 *   1. STORYBOARD — the non-Google structured planner designs the topic as PANELS, each a STACK OF
 *      LAYERS: composed art SCENES (style-locked, NO baked text) + label layers
 *      (dates/figures/terms). Every layer carries a verbatim narration CUE + box.
 *   2. ART — each art layer renders as isolated line-art on pure white (no
 *      segmentation: each layer's pixels are exactly known → reliable timing).
 *   3. NARRATION — the channel-selected Fish or ElevenLabs voice speaks the
 *      script; LOCAL Whisper force-aligns it to
 *      word timestamps; each cue → a millisecond start time.
 *   4. RENDER — scripts/wb_scribe_sync.py draws each layer at its cue, ONE hand
 *      at a time, paced to ink, with a minimum draw time + a guaranteed HOLD
 *      before each panel cuts; a persistent frame + topic header are drawn once;
 *      ffmpeg muxes the narration.
 *
 * Deps: ANTHROPIC_API_KEY or OPENROUTER_API_KEY (storyboard), sealed Nano
 * Banana Pro art admission,
 * FISH_AUDIO_API_KEY (default TTS) or ELEVENLABS_API_KEY (a selected
 * ElevenLabs voice), and python3
 * with faster-whisper + numpy/scipy/scikit-image/Pillow (the renderer + aligner).
 * A $0-spend preflight (src/lib/pydeps.ts) verifies python3 + the scripts +
 * pip deps BEFORE any paid generation, so a broken worker fails immediately.
 * Pure of R2/Convex — the caller owns `runDir` and persistence.
 *
 *   import { castWhiteboardSync, hasWhiteboardSync } from "@/lib/whiteboardSync";
 *   const { outPath } = await castWhiteboardSync({
 *     brief: { topic: "Why Chiquita is the 'banana republic' company", facts, header: "CHIQUITA" },
 *     runDir, log,
 *   });
 */
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  resolveSelfContainedStoryPlan,
  SELF_CONTAINED_WHITEBOARD_MAX_ART_LAYERS_PER_PANEL,
  type SelfContainedStoryReceiptBinding,
} from "@/engine/selfContainedStoryReceipt";
import {
  agentJson,
  MastraGenerationOutcomeUnknownError,
  MastraGenerationUnavailableError,
} from "@/agents/mastra";
import { hasAnthropicKey } from "@/lib/anthropic";
import { OpenRouterGenerationOutcomeUnknownError } from "@/lib/openRouter";
import { synthNarration } from "@/lib/tts";
import { preflightPythonRenderer } from "@/lib/pydeps";
import {
  assertNanoBananaProWhiteboardArtReceipt,
  type NanoBananaProWhiteboardArtReceipt,
} from "@/lib/nanoBananaWhiteboardArtContract";
import { rasterImageDimensions } from "@/lib/imageDimensions";
import { z } from "zod";

type Logger = (msg: string) => void;

export interface WhiteboardSyncBrief {
  topic: string;
  /** Grounding facts the narration must stay accurate to (strongly recommended). */
  facts?: string;
  /** Explicit beat list (one per panel). Omit to let the model structure it. */
  beats?: string[];
  /** Persistent top header text (default: derived from the topic). */
  header?: string;
  /** Whiteboard style-lock ref id (src/assets/whiteboard/<id>_ref.png). Default "history". */
  styleId?: string;
  /** Channel Style-DNA rendering language, used as a text-native style lock. */
  artStyle?: string;
  /** Fish voice id (default "sleepless_historian") — used when provider is Fish. */
  voiceId?: string;
  /** TTS engine: "fish" (default) | "elevenlabs". Lets a cast ElevenLabs voice narrate. */
  ttsProvider?: string;
  /** ElevenLabs voice id (when ttsProvider === "elevenlabs"). */
  elevenVoiceId?: string;
  /**
   * Board surface: "white" (cream whiteboard, default) or "chalk" (dark
   * chalkboard — dark-academic channels whose DNA demands chalk-on-dark). Chalk
   * mode inverts the board to `palette[0]` and draws the same line-art in a
   * light chalk ink instead of black marker.
   */
  boardMode?: "white" | "chalk";
  /** Channel palette [bg, ink/light, accent, …] — drives chalk-mode colors. */
  palette?: string[];
  /** Panel count (default 6) and total spoken words (default 150). */
  panels?: number;
  targetWords?: number;
  /** Render resolution (default 1920x1080). Art is generated at 2K, so 2560x1440 stays crisp. */
  width?: number;
  height?: number;
}

export interface SyncLayer {
  kind: "art" | "label";
  /** The planned role prevents a renderer from reducing an explanatory beat to generic decoration. */
  role?: "hero" | "evidence" | "reaction";
  art?: string;
  text?: string;
  color?: string;
  box: number[];
  cueStartMs: number;
}
export interface SyncPanel { idx: number; startMs: number; endMs: number; layers: SyncLayer[] }
export const WHITEBOARD_RENDER_SCHEDULE_VERSION = "whiteboard-render-schedule/v1" as const;
export const WhiteboardRenderScheduleSchema = z.object({
  version: z.literal(WHITEBOARD_RENDER_SCHEDULE_VERSION),
  narrationStartSec: z.number().finite().nonnegative(),
  storyReceiptFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  panels: z.array(z.object({
    idx: z.number().int().min(0).max(15),
    startMs: z.number().finite().nonnegative(),
    endMs: z.number().finite().positive(),
    completionSampleMs: z.number().finite().nonnegative(),
    layers: z.array(z.object({
      layerIdx: z.number().int().min(0).max(23),
      kind: z.enum(["art", "label"]),
      cueStartMs: z.number().finite().nonnegative(),
      drawStartMs: z.number().finite().nonnegative(),
      drawEndMs: z.number().finite().positive(),
      handLingerEndMs: z.number().finite().positive(),
      handSampleMs: z.number().finite().nonnegative(),
    })).min(1).max(24),
  })).min(1).max(16),
});
export type WhiteboardRenderSchedule = z.infer<typeof WhiteboardRenderScheduleSchema>;
export interface WhiteboardSyncResult {
  outPath: string;
  /** The authored source used by the deterministic write-on renderer. */
  narrationPath: string;
  /** The renderer's intentional hand/title pre-roll before speech begins. */
  narrationStartSec: number;
  timelinePath: string;
  title: string;
  narrationText: string;
  /** Source-relative per-word cues from the local forced alignment. */
  sentenceTimings: Array<{ text: string; start: number; end: number }>;
  panels: SyncPanel[];
  /** Exact renderer-authored hand-trace and completed-panel evidence times. */
  renderSchedule: WhiteboardRenderSchedule;
  durationMs: number;
  /** Characters sent to TTS during this invocation (zero when the cache hit). */
  ttsCharactersGenerated: number;
  /** Every local art layer is byte- and receipt-bound before the final scribe render. */
  artAssets: WhiteboardArtAsset[];
}

export interface WhiteboardArtRequest {
  id: string;
  prompt: string;
  negativePrompt: string;
  seed: number;
}

export interface WhiteboardGeneratedArt {
  bytes: Buffer;
  receipt: NanoBananaProWhiteboardArtReceipt;
}

/**
 * Preserve the provider's actual raster format in the durable asset name.
 * A filename is part of the renderer and preview contract: JPEG bytes called
 * `*.png` happen to open in Pillow, but fail in stricter video/preview tools.
 */
export function whiteboardArtFileExtension(contentType: string): "png" | "jpg" | "webp" {
  switch (contentType) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/webp": return "webp";
    default:
      throw new Error(`whiteboardSync: unsupported Nano Banana Pro art content type ${contentType}`);
  }
}

/**
 * Builds the exact paid-image instruction from the sealed panel. The historic
 * topic/narration context is source material, not a licence for a model to
 * invent national symbols: an invented flag can make an otherwise accurate
 * explainer factually false.
 */
export function whiteboardArtPrompt(args: {
  styleLock: string;
  isScene: boolean;
  role?: "hero" | "evidence" | "reaction";
  draw?: string;
  cue?: string;
  narration: string;
}): string {
  const draw = args.draw?.trim();
  if (!draw) throw new Error("whiteboardSync: art prompt requires a non-empty sealed scene brief");
  const spokenClaim = args.cue?.trim();
  if (!spokenClaim) throw new Error("whiteboardSync: art prompt requires the sealed spoken claim cue");
  return (
    `A whiteboard marker line-art ${args.isScene ? "SCENE" : "SKETCH"} on a PURE WHITE (#ffffff) background, nothing else, filling the frame with a small margin. ` +
    `${args.styleLock}. CRITICAL: use this exact style and one consistent stroke weight throughout every asset. ` +
    (args.role === "reaction"
      ? `Draw a simple but expressive HUMAN reaction scene: ${draw}. Give the person a visible face and body posture that communicates the stated emotion through the argument; use exactly one direct prop, keep that prop clearly separated from the body outline, and leave a clean margin around the figure. Never use an emoji, a floating face, a generic stick-person icon, or a crowded mini-diagram behind the person. `
      : args.isScene
        ? `Draw a COMPOSED, designed scene: ${draw} — show at least three related objects or actors, their causal relationship, and clear foreground-to-background staging. Make it a relationship-rich editorial tableau, not a generic user-interface doodle or isolated symbol. `
        : `Draw a materially different supporting evidence scene of: ${draw}. Include the concrete object plus at least one contextual prop or causal connector; it must add new information rather than read as a lone icon. `) +
    `SPOKEN CLAIM TO MAKE LITERALLY VISIBLE: "${spokenClaim}". The drawing must make that specific causal mechanism or fact understandable without narration. Do not substitute a decorative stock metaphor (tree, seed, snowball, gear, lightbulb, or compass) unless that exact thing is the subject of the spoken claim. ` +
    `(Context for tone and historical grounding, do NOT write any text: "${args.narration}".) ` +
    `HISTORICAL ACCURACY: use only countries, eras, institutions, uniforms, flags, insignia, and political symbols explicitly named by the scene brief or narration. ` +
    `Do NOT invent or substitute a national flag, military insignia, or political symbol; if none is explicitly named, omit it. ` +
    `Simple line-art, NOT photorealistic, no shading. Use red for at most one or two accent marks. ` +
    `STRICTLY NO text of any kind: no words, no letters, no numbers, no labels, no captions, no signage, no book titles, no logos, no watermarks, no handwriting, no gibberish glyphs. Leave every sign, book, screen, banner and label BLANK. ` +
    `NO whiteboard, NO frame, NO border, NO grey edges — pure white #ffffff background ONLY.`
  );
}

export interface WhiteboardArtAsset {
  id: string;
  localPath: string;
  contentSha256: string;
  contentType: string;
  receipt: NanoBananaProWhiteboardArtReceipt;
}

export type WhiteboardImageGenerator = (request: WhiteboardArtRequest) => Promise<WhiteboardGeneratedArt>;

export const WHITEBOARD_MAX_PANELS = 16;
export const WHITEBOARD_MAX_ART_IMAGES_PER_PANEL = SELF_CONTAINED_WHITEBOARD_MAX_ART_LAYERS_PER_PANEL;
export const WHITEBOARD_MAX_WORDS_PER_PANEL = 120;
export const WHITEBOARD_MAX_CHARS_PER_WORD = 12;
export const WHITEBOARD_MAX_TTS_PROVIDER_RESPONSES = 3;

/**
 * The Golden Whiteboard reference is information-dense: a clear hero
 * composition accumulates supporting evidence sketches and a native label as
 * the narration advances. These minima stay below the existing five-image
 * spend ceiling, so better boards never expand a run's cost envelope.
 */
export const WHITEBOARD_GOLDEN_MIN_ART_LAYERS_PER_PANEL = 4;
export const WHITEBOARD_GOLDEN_MIN_VISUAL_EVENTS_PER_PANEL = 5;
/** Must match the production scribe's visible, non-pop-in pacing envelope. */
export const WHITEBOARD_VISIBLE_ART_DRAW_SEC = 4.5;
/** Every art arrival retains the hand briefly after its final stroke. */
export const WHITEBOARD_ART_HAND_LINGER_SEC = 1.0;
export const WHITEBOARD_VISIBLE_LABEL_DRAW_SEC = 2.6;
export const WHITEBOARD_VISIBLE_HOLD_SEC = 1.6;
/** Must match the final-art hand hold in wb_scribe_sync.py. */
export const WHITEBOARD_FINAL_ART_HAND_LINGER_SEC = 2.4;
/** Conservative upper-bound speech rate used only to reject an impossible board before art spend. */
export const WHITEBOARD_PRESPEND_MAX_WORDS_PER_SEC = 2.5;
/** Dense hand-drawn boards need their own time budget; this is not a generic slideshow cadence. */
export const WHITEBOARD_MIN_SECONDS_PER_DENSE_PANEL = 34;

type WhiteboardGoldenStyleLayer = {
  kind: string;
  role?: string;
  cue?: string;
  draw?: string;
  text?: string;
  box?: readonly unknown[];
};

type WhiteboardGoldenStylePlan = {
  panels: readonly {
    narration: string;
    layers: readonly WhiteboardGoldenStyleLayer[];
  }[];
};

function normalizedBox(box: readonly unknown[] | undefined): [number, number, number, number] | null {
  if (!box || box.length !== 4) return null;
  const values = box.map(Number);
  return values.every(Number.isFinite) ? values as [number, number, number, number] : null;
}

function visualBoxesOverlap(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean {
  const left = normalizedBox(a);
  const right = normalizedBox(b);
  if (!left || !right) return false;
  const [ax, ay, aw, ah] = left;
  const [bx, by, bw, bh] = right;
  const overlapWidth = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx));
  const overlapHeight = Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
  // Separate generated rasters cannot reliably share visible board space: a
  // reaction character or a factual detail may get painted over at runtime.
  return overlapWidth * overlapHeight > 0.001;
}

function whiteboardCueOffsets(narration: string, layers: readonly WhiteboardGoldenStyleLayer[]): number[] {
  const lower = narration.toLowerCase();
  let after = 0;
  const offsets: number[] = [];
  for (const layer of layers) {
    const cue = layer.cue?.trim().toLowerCase();
    if (!cue) continue;
    const offset = lower.indexOf(cue, after);
    if (offset < 0) continue;
    offsets.push(offset);
    after = offset + cue.length;
  }
  return offsets;
}

function whiteboardPlannedLabelDrawSec(text: string | undefined): number {
  // Mirrors the scribe's longer visible label trace without pretending a tiny
  // date and a long footer use the same amount of screen time.
  return Math.min(
    WHITEBOARD_VISIBLE_LABEL_DRAW_SEC,
    Math.max(0.9, (text ?? "").replace(/\s+/g, "").length / 16),
  );
}

// These motifs are attractive shorthand, but they erase the causal claim a
// whiteboard explainer is supposed to make legible.  They are allowed only
// when the exact spoken cue actually names the object (for example, a history
// episode about a compass), never as a decorative stand-in for growth, choice,
// complexity, or discovery.
const WHITEBOARD_UNGROUNDED_METAPHOR_TERMS = [
  "tree",
  "seed",
  "snowball",
  "gear",
  "lightbulb",
  "compass",
  "rocket",
  "ladder",
  "puzzle",
] as const;

function containsWhiteboardWord(value: string, word: string): boolean {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i").test(value);
}

function positiveWhiteboardArtDirection(draw: string): string {
  // Planner directions commonly include an explicit negative constraint such
  // as "no tree, seed, plant, or generic growth metaphor".  Do not mistake
  // that protection for an instruction to draw the metaphor.
  return draw.replace(/\b(?:no|not|never|without|avoid)\b[^.;]*/gi, " ");
}

function ungroundedWhiteboardMetaphors(layer: WhiteboardGoldenStyleLayer): string[] {
  const cue = layer.cue?.trim() ?? "";
  const draw = positiveWhiteboardArtDirection(layer.draw?.trim() ?? "");
  return WHITEBOARD_UNGROUNDED_METAPHOR_TERMS.filter((term) =>
    containsWhiteboardWord(draw, term) && !containsWhiteboardWord(cue, term),
  );
}

function whiteboardDirectionWordCount(draw: string | undefined): number {
  return positiveWhiteboardArtDirection(draw?.trim() ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

/**
 * Deterministic pre-spend style gate. It protects the whiteboard's visual
 * grammar from a cost-focused plan that compresses an argument into one
 * generic icon and a long static hold.
 */
export function whiteboardGoldenStyleDefects(plan: WhiteboardGoldenStylePlan): string[] {
  const defects: string[] = [];
  let reactionPanelCount = 0;
  plan.panels.forEach((panel, index) => {
    const art = panel.layers.filter((layer) => layer.kind === "art");
    const heroes = art.filter((layer) => layer.role === "hero");
    const evidence = art.filter((layer) => layer.role === "evidence");
    const reactions = art.filter((layer) => layer.role === "reaction");
    if (art.length < WHITEBOARD_GOLDEN_MIN_ART_LAYERS_PER_PANEL) {
      defects.push(
        `panel ${index + 1} has only ${art.length} art layer(s) — the Golden whiteboard grammar requires a composed hero, two evidence drawings, and a fourth meaningful drawing`,
      );
    }
    if (panel.layers.length < WHITEBOARD_GOLDEN_MIN_VISUAL_EVENTS_PER_PANEL) {
      defects.push(
        `panel ${index + 1} has only ${panel.layers.length} visual event(s) — build a dense board with four drawings and a native handwritten label`,
      );
    }
    if (!heroes.length) {
      defects.push(`panel ${index + 1} has no declared hero drawing — the main causal scene cannot be replaced by disconnected icons`);
    }
    if (heroes.length > 1) {
      defects.push(`panel ${index + 1} has ${heroes.length} hero drawings — use one large causal scene and reserve the other slots for readable supporting evidence`);
    }
    if (evidence.length < 2) {
      defects.push(`panel ${index + 1} has only ${evidence.length} evidence drawing(s) — two distinct supporting drawings are required`);
    }
    if (reactions.length) reactionPanelCount += 1;
    const labels = panel.layers.filter((layer) => layer.kind === "label");
    const estimatedSpeechSec = panel.narration.split(/\s+/).filter(Boolean).length / WHITEBOARD_PRESPEND_MAX_WORDS_PER_SEC;
    const requiredVisibleDrawSec =
      art.length * (WHITEBOARD_VISIBLE_ART_DRAW_SEC + WHITEBOARD_ART_HAND_LINGER_SEC) +
      labels.reduce((total, label) => total + whiteboardPlannedLabelDrawSec(label.text), 0) +
      // The final art beat receives the longer 2.4-second finish hold rather
      // than an additional hold on top of its ordinary one-second linger.
      (WHITEBOARD_FINAL_ART_HAND_LINGER_SEC - WHITEBOARD_ART_HAND_LINGER_SEC) +
      WHITEBOARD_VISIBLE_HOLD_SEC;
    if (estimatedSpeechSec < requiredVisibleDrawSec) {
      defects.push(
        `panel ${index + 1} has only ~${estimatedSpeechSec.toFixed(1)}s of spoken room for ~${requiredVisibleDrawSec.toFixed(1)}s of declared hand drawing — extend or split the beat before any art is purchased`,
      );
    }
    const smallSketches = art.filter((layer) => {
      const width = Number(layer.box?.[2]);
      return Number.isFinite(width) && width >= 0.10 && width <= 0.28;
    });
    if (art.length >= WHITEBOARD_GOLDEN_MIN_ART_LAYERS_PER_PANEL && smallSketches.length < 2) {
      defects.push(
        `panel ${index + 1} lacks two supporting small sketches — do not replace the whiteboard argument with a single oversized symbol`,
      );
    }
    const distinctDraws = new Set(art.map((layer) => layer.draw?.trim().toLowerCase()).filter(Boolean));
    if (art.length >= WHITEBOARD_GOLDEN_MIN_ART_LAYERS_PER_PANEL && distinctDraws.size < WHITEBOARD_GOLDEN_MIN_ART_LAYERS_PER_PANEL) {
      defects.push(`panel ${index + 1} repeats its art direction — supporting sketches must add new information rather than duplicate the hero`);
    }
    for (const layer of art) {
      const box = normalizedBox(layer.box);
      if (!box) {
        defects.push(`panel ${index + 1} has an art layer without a valid board box — its readability cannot be verified`);
        continue;
      }
      const [, , width, height] = box;
      const area = width * height;
      if (layer.role === "hero") {
        if (width < 0.32 || height < 0.34 || area < 0.12) {
          defects.push(`panel ${index + 1} makes its hero drawing too small to read — reserve a real causal scene, not a miniature diagram`);
        }
      } else {
        if (width < 0.16 || height < 0.18 || area < 0.03) {
          defects.push(`panel ${index + 1} puts a supporting drawing in an unreadable ${Math.round(width * 100)}%×${Math.round(height * 100)}% slot — enlarge, simplify, or split the board before art spend`);
        }
        if (area <= 0.05 && whiteboardDirectionWordCount(layer.draw) > 24) {
          defects.push(`panel ${index + 1} overloads a small supporting drawing with ${whiteboardDirectionWordCount(layer.draw)} direction words — a small slot may show one clear relationship, not a mini-diagram`);
        }
      }
      const metaphors = ungroundedWhiteboardMetaphors(layer);
      if (metaphors.length) {
        defects.push(
          `panel ${index + 1} uses ${metaphors.join(", ")} as an ungrounded visual metaphor at cue ${JSON.stringify(layer.cue ?? "")} — draw the literal fact or causal mechanism instead`,
        );
      }
    }
    for (let first = 0; first < art.length; first += 1) {
      for (let second = first + 1; second < art.length; second += 1) {
        if (visualBoxesOverlap(art[first].box, art[second].box)) {
          defects.push(`panel ${index + 1} stages overlapping generated drawings — give each illustration, especially a reaction character, its own clear board area`);
          first = art.length;
          break;
        }
      }
    }
    const offsets = whiteboardCueOffsets(panel.narration, art);
    if (art.length >= WHITEBOARD_GOLDEN_MIN_ART_LAYERS_PER_PANEL && new Set(offsets).size < WHITEBOARD_GOLDEN_MIN_ART_LAYERS_PER_PANEL) {
      defects.push(`panel ${index + 1} bunches its art at one narration cue — spread the drawing progression across the spoken beat`);
    } else if (offsets.length) {
      const lastProgress = Math.max(...offsets) / Math.max(1, panel.narration.length);
      if (lastProgress < 0.36 || lastProgress > 0.76) {
        defects.push(
          `panel ${index + 1} does not sustain visual progression through the narration — place its final drawing in the late body with room for a visible hand trace and a completed hold`,
        );
      }
    }
  });
  if (plan.panels.length >= 2 && reactionPanelCount < Math.ceil(plan.panels.length / 2)) {
    defects.push(
      `only ${reactionPanelCount}/${plan.panels.length} panel(s) contain an expressive reaction character — show a contextual human emotion regularly through the argument`,
    );
  }
  return defects;
}

export function assertWhiteboardGoldenStyle(plan: WhiteboardGoldenStylePlan): void {
  const defects = whiteboardGoldenStyleDefects(plan);
  if (defects.length) {
    throw new Error(`whiteboardSync: Golden whiteboard style gate rejected the storyboard: ${defects.slice(0, 3).join("; ")}`);
  }
}

export function whiteboardPanelCount(value: unknown): number {
  const parsed = Number(value ?? 6);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(WHITEBOARD_MAX_PANELS, Math.floor(parsed)))
    : 6;
}

/**
 * Derives a production-safe number of boards from a requested runtime.  The
 * prior 22-second rule was inherited from a sparse two-art layout; it forced
 * the richer plan to either compress the hand or waste paid images.  A short
 * whiteboard now uses fewer, fuller boards rather than pretending both goals
 * can be met at once.
 */
export function whiteboardPanelsForTargetSeconds(value: unknown): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return whiteboardPanelCount(undefined);
  return whiteboardPanelCount(Math.max(2, Math.floor(seconds / WHITEBOARD_MIN_SECONDS_PER_DENSE_PANEL)));
}

/**
 * A six-panel board needs room for dense narration and layer JSON, but not an
 * unbounded reasoning/completion window. Keeping the response proportional to
 * the requested panel count protects the planner connection and preserves a
 * useful final-answer reserve for the whole storyboard.
 */
export function whiteboardStoryboardTokenCeiling(panelCount: unknown): number {
  return Math.max(3_000, Math.min(8_000, whiteboardPanelCount(panelCount) * 1_100));
}

export function whiteboardImageCallCeiling(panelCount: unknown): number {
  return whiteboardPanelCount(panelCount) * WHITEBOARD_MAX_ART_IMAGES_PER_PANEL;
}

export function whiteboardNarrationCharacterCeiling(panelCount: unknown, targetWords: unknown): number {
  const panels = whiteboardPanelCount(panelCount);
  const parsedWords = Number(targetWords ?? 150);
  const requestedWords = Number.isFinite(parsedWords) && parsedWords > 0 ? Math.ceil(parsedWords) : 150;
  const boundedWords = Math.max(
    panels * 8,
    Math.min(panels * WHITEBOARD_MAX_WORDS_PER_PANEL, requestedWords),
  );
  return boundedWords * WHITEBOARD_MAX_CHARS_PER_WORD;
}

export function whiteboardTtsBillableCharacterCeiling(
  panelCount: unknown,
  targetWords: unknown,
): number {
  return (
    whiteboardNarrationCharacterCeiling(panelCount, targetWords)
  );
}

export function whiteboardTtsProviderCallCeiling(): number {
  return WHITEBOARD_MAX_TTS_PROVIDER_RESPONSES;
}

const ASSET_DIR = join(process.cwd(), "src", "assets", "whiteboard");

export function hasWhiteboardSync(options: {
  requiresStoryboard?: boolean;
  /** The already-resolved narration provider for this particular run. */
  ttsProvider?: "fish" | "elevenlabs";
} = {}): boolean {
  const requiresStoryboard = options.requiresStoryboard ?? true;
  const hasSelectedTts = options.ttsProvider === "elevenlabs"
    ? Boolean(process.env.ELEVENLABS_API_KEY)
    : Boolean(process.env.FISH_AUDIO_API_KEY);
  return Boolean(
    (!requiresStoryboard || hasAnthropicKey())
    && hasSelectedTts,
  );
}

/* ------------------------------ helpers -------------------------------- */

function clampBox(b: unknown): number[] {
  return Array.isArray(b) && b.length === 4 ? b.map(Number) : [0.1, 0.18, 0.8, 0.66];
}

function whiteboardSeed(styleId: string, artifactId: string): number {
  return createHash("sha256")
    .update(`whiteboard-v2\0${styleId}\0${artifactId}`)
    .digest()
    .readUInt32BE(0) & 0x7fffffff;
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) || 1 }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

function runPy(args: string[], log: Logger): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn("python3", args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    c.stdout.on("data", (d) => log(`py: ${d.toString().trim()}`));
    c.stderr.on("data", (d) => (err += d.toString()));
    c.on("error", reject);
    c.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`python ${args[0]} exited ${code}: ${err.slice(-400)}`))));
  });
}

/* ------------------------------ storyboard ----------------------------- */

interface RawLayer { kind?: string; role?: string; draw?: string; text?: string; color?: string; cue?: string; box?: unknown }
interface RawPanel { narration?: string; layers?: RawLayer[] }
interface RawPlan { title?: string; panels?: RawPanel[] }
interface NLayer {
  kind: "art" | "label";
  role?: "hero" | "evidence" | "reaction";
  draw?: string;
  text?: string;
  color: string;
  cue: string;
  box: number[];
  art?: string;
}
interface NPanel { idx: number; narration: string; layers: NLayer[] }

// Keep the native renderer's normalizer as the final bounded defence, but make
// the creative-provider boundary structured too. The response contract is
// deliberately renderer-native rather than a generic prose blob, so the
// planner cannot invent an unbounded art fan-out or a new schema on retry.
const whiteboardStoryboardResponseSchema: z.ZodType<RawPlan> = z.object({
  title: z.string().optional(),
  panels: z.array(z.object({
    narration: z.string().optional(),
    layers: z.array(z.object({
      kind: z.enum(["art", "label"]).optional(),
      role: z.enum(["hero", "evidence", "reaction"]).optional(),
      draw: z.string().optional(),
      text: z.string().optional(),
      color: z.enum(["black", "red"]).optional(),
      cue: z.string().optional(),
      box: z.array(z.number().finite()).min(4).max(4).optional(),
    })).optional(),
  })).optional(),
});

/**
 * THE PLAN/RENDER SEAM (pattern: documotion's `CraftDocuArgs.plan`).
 *
 * Everything in this storyboard section is CHEAP and text-only. Everything the
 * orchestrator does with the result below — per-layer attested image art, TTS,
 * the python scribe render — is PAID and irreversible.
 *
 * Exporting the storyboard as a first-class value is what lets a caller run a
 * produce→critique→regenerate loop at TEXT prices and then hand the ACCEPTED
 * plan to `castWhiteboardSync`, which renders it exactly once. Without this
 * seam the only way to get quality feedback was to critique a finished video,
 * i.e. to re-buy the whole render to fix one bad panel.
 */
export interface WhiteboardStoryboard {
  title: string;
  panels: NPanel[];
  /** Concatenated panel narration — the exact text that will be sent to TTS. */
  fullText: string;
}
export type WhiteboardStoryboardPanel = NPanel;
export type WhiteboardStoryboardLayer = NLayer;

function planContract(brief: WhiteboardSyncBrief, nPanels: number, words: number): string {
  const facts = brief.facts ? `GROUNDING FACTS (accurate, use only these):\n${brief.facts}\n\n` : "";
  const beats = brief.beats?.length
    ? `\nEXACTLY one panel per beat below — DO NOT STOP EARLY:\n${brief.beats.map((b, i) => `  P${i + 1}: ${b}`).join("\n")}`
    : "";
  return (
    `Design a punchy, INFORMATIVE ~60-second WHITEBOARD explainer. TOPIC: ${brief.topic}\n${facts}` +
    `Think like a motion-designer. Each panel is a STACK OF LAYERS drawn one at a time on a whiteboard, building an argument.\n` +
    `Output STRICT JSON: {"title":"...","panels":[ {"narration":"<~2 spoken sentences (~${Math.round(words / nPanels)} words), end with a small beat>",` +
    `"layers":[ {"kind":"art","role":"hero|evidence|reaction","draw":"<the required relationship-rich drawing; NO text/words in the art>",` +
    `"cue":"<verbatim phrase from THIS narration marking when to draw it>","box":[x,y,w,h]} , ` +
    `{"kind":"label","text":"<EXACT short words/number to hand-letter>","cue":"<verbatim phrase>","box":[x,y,w,h],"color":"black|red"} ]} ]}\n\n` +
    `RULES:\n- Output STRICTLY VALID minified JSON: double-quote every key and string, no comments, no trailing commas, escape any quotes inside strings.\n` +
    `- EXACTLY ${nPanels} panels. ~${words} words TOTAL. Plain spoken narration, NO audio tags. Never stop early.\n` +
    `- GOLDEN DENSITY (non-negotiable): every panel has EXACTLY FOUR drawings: one larger role:"hero" scene that makes the beat's causal relationship clear; two role:"evidence" drawings of materially different concrete facts; plus one fourth drawing. On alternate panel positions (1,3,5...), that fourth drawing MUST be role:"reaction": a small expressive human figure naturally reacting to the argument (worry at a leak, relief at a solution, surprise at a number, a grin at a win, or despair at a loss). On the remaining panels it may be a third distinct evidence drawing. PLUS at least one hand-lettered label. Never make a panel a single icon, empty infographic, or a long static board. For a list ("railroads, government, taxes") make a separate small drawing for EACH item, cued to its word. List layers IN THE ORDER their cue appears; every label needs non-empty "text".\n` +
    `- Every "cue" MUST be an exact substring of that panel's narration. Don't put the last cue at the very end (leave a trailing clause).\n` +
    `- A persistent TITLE HEADER lives in the top strip: ALL boxes (art + labels) MUST have y >= 0.17 (nothing in the top 0.16).\n` +
    `- Every art direction must depict the literal fact or mechanism at its cue—never a generic finance/history metaphor. box=[x,y,w,h] in 0..1 on a 16:9 board. The hero scene is LARGER (w ~ 0.38-0.56, center/left); evidence and reaction drawings are MEDIUM (w,h ~ 0.15-0.28) and spread around it (vary x AND y) so the completed board uses the usable space without overlap or a dead empty side. ART BOXES MUST NOT OVERLAP. A reaction character must be an actual small human figure with face and body posture, one direct prop only, never an emoji or a face icon. Labels are smaller, beside the thing they name. y >= 0.17 for everything.\n` +
    `- ART HAS NO TEXT — all words/numbers are label layers. color:"red" for money/danger emphasis, else black. Be accurate.${beats}`
  );
}

function normalize(raw: RawPlan): NPanel[] {
  return (raw.panels ?? []).map((p, i) => {
    let artCount = 0;
    const layers = (p.layers ?? [])
      .map((l) => ({
        kind: l.kind === "label" ? ("label" as const) : ("art" as const),
        role: l.role === "hero" || l.role === "evidence" || l.role === "reaction"
          ? l.role as NLayer["role"]
          : undefined,
        draw: l.draw ? String(l.draw).trim() : undefined,
        text: l.text ? String(l.text).trim() : undefined,
        color: l.color === "red" ? "red" : "black",
        cue: String(l.cue ?? "").trim(),
        box: clampBox(l.box),
      }))
      .filter((l) => (l.kind === "art" && l.draw) || (l.kind === "label" && l.text))
      // The prompt asks for one hero + 2–4 keyword sketches. A model that
      // over-returns must not create an unbounded paid image fan-out.
      .filter((l) => {
        if (l.kind !== "art") return true;
        if (artCount >= WHITEBOARD_MAX_ART_IMAGES_PER_PANEL) return false;
        artCount += 1;
        return true;
      });
    let normalizedArtIndex = 0;
    for (const layer of layers) {
      if (layer.kind !== "art") continue;
      // Legacy plans lack role metadata. This compatibility inference does not
      // fabricate the new density/reaction requirement; the Golden gate below
      // will still reject a sparse cached plan before any new spend.
      layer.role ??= normalizedArtIndex === 0 ? "hero" : "evidence";
      normalizedArtIndex += 1;
    }
    return { idx: i, narration: String(p.narration ?? "").trim(), layers };
  });
}

export function boundWhiteboardNarration(panels: NPanel[], targetWords: unknown): NPanel[] {
  if (!panels.length) return panels;
  const charCeiling = whiteboardNarrationCharacterCeiling(panels.length, targetWords);
  const totalWordBudget = Math.floor(charCeiling / WHITEBOARD_MAX_CHARS_PER_WORD);
  const baseWords = Math.floor(totalWordBudget / panels.length);
  const remainder = totalWordBudget % panels.length;

  return panels.map((panel, index) => {
    const wordBudget = baseWords + (index < remainder ? 1 : 0);
    const words = panel.narration.split(/\s+/).filter(Boolean).slice(0, wordBudget);
    const rawNarration = words.join(" ");
    const charBudget = wordBudget * WHITEBOARD_MAX_CHARS_PER_WORD;
    const narration = rawNarration.length <= charBudget
      ? rawNarration
      : rawNarration.slice(0, charBudget).replace(/\s+\S*$/, "").trim();
    const lowerNarration = narration.toLowerCase();
    const omittedLayers = panel.layers.filter((layer) =>
      Boolean(layer.cue) && !lowerNarration.includes(layer.cue!.toLowerCase()),
    );
    // A layer whose anchor is beyond the bounded narration used to disappear
    // silently. That produces a false "passing" whiteboard: the narration
    // explains a point while its promised visual never arrives. Reject it
    // before artwork, TTS, or rendering spend so a planner/fixture must place
    // every visual cue inside its actual panel narration budget.
    if (omittedLayers.length) {
      const cues = omittedLayers.map((layer) => JSON.stringify(layer.cue)).join(", ");
      throw new Error(
        `whiteboardSync: panel ${index + 1} has ${omittedLayers.length} visual cue(s) outside its bounded narration: ${cues}`,
      );
    }
    let previousCueOffset = -1;
    for (const layer of panel.layers) {
      if (!layer.cue) continue;
      const cue = layer.cue.toLowerCase();
      const cueOffset = lowerNarration.indexOf(cue, previousCueOffset + 1);
      if (cueOffset < 0) {
        throw new Error(
          `whiteboardSync: panel ${index + 1} visual cues are out of narration order at ${JSON.stringify(layer.cue)}`,
        );
      }
      previousCueOffset = cueOffset;
    }
    const layers = panel.layers;
    return { ...panel, narration, layers };
  });
}

/**
 * A rejected storyboard's issues, folded back into the writer's prompt. Empty
 * notes render "" so an un-critiqued call sends the byte-identical old prompt.
 */
function revisionClause(revisionNotes: readonly string[]): string {
  const notes = revisionNotes.map((note) => String(note ?? "").trim()).filter(Boolean).slice(0, 8);
  if (!notes.length) return "";
  return (
    `\n\nREVISION — a director REJECTED your previous storyboard before any art or voice was bought. ` +
    `Rewrite it so that EVERY issue below is fixed; do not repeat the rejected draft:\n` +
    notes.map((note, index) => `${index + 1}. ${note}`).join("\n")
  );
}

/** Generate ONE chunk of panels (retry on short/invalid output). */
async function genChunk(brief: WhiteboardSyncBrief, beats: string[], nP: number, words: number, cont: string, log: Logger, revisionNotes: readonly string[] = []): Promise<{ title: string; panels: NPanel[] }> {
  const sub: WhiteboardSyncBrief = { ...brief, beats, panels: nP, targetWords: words };
  for (let attempt = 0; attempt < 3; attempt++) {
    const extra =
      (cont ? `\n\nThis is PART of a longer video already in progress; the previous panel's narration ended: "${cont.slice(-160)}". Continue naturally — do NOT repeat the intro or title.` : "") +
      revisionClause(revisionNotes) +
      (attempt ? `\n\nFIX: output EXACTLY ${nP} panels as STRICTLY VALID minified JSON.` : "");
    try {
      const raw = await agentJson<RawPlan>({
        role: "producer",
        schema: whiteboardStoryboardResponseSchema,
        prompt: planContract(sub, nP, words) + extra,
        maxTokens: whiteboardStoryboardTokenCeiling(nP),
        temperature: 0.5,
        log,
      });
      const panels = normalize(raw).slice(0, nP);
      if (panels.length >= nP) return { title: String(raw.title ?? brief.topic), panels };
      log(`  chunk got ${panels.length}/${nP} panels — retry`);
      if (attempt === 2 && panels.length) return { title: String(raw.title ?? brief.topic), panels };
    } catch (e) {
      // The gateway may have accepted the provider request but dropped the
      // response. Replaying that request here could buy the same storyboard
      // twice, so let the caller persist/review the ambiguous outcome instead
      // of treating it as a routine malformed-plan retry.
      if (
        e instanceof OpenRouterGenerationOutcomeUnknownError
        || e instanceof MastraGenerationOutcomeUnknownError
        || e instanceof MastraGenerationUnavailableError
      ) throw e;
      log(`  chunk failed (${(e instanceof Error ? e.message : String(e)).slice(0, 90)}) — retry`);
    }
  }
  return { title: brief.topic, panels: [] };
}

async function buildStoryboard(brief: WhiteboardSyncBrief, log: Logger, revisionNotes: readonly string[] = []): Promise<WhiteboardStoryboard> {
  const nPanels = whiteboardPanelCount(brief.panels);
  const words = brief.targetWords ?? 150;
  const beats = (brief.beats ?? []).slice(0, nPanels);
  const CHUNK = 4;
  let title = brief.topic;
  const all: NPanel[] = [];
  if (beats.length > 6) {
    // CHUNKED: one LLM call can't reliably emit many dense panels — build in groups.
    for (let i = 0; i < beats.length; i += CHUNK) {
      const grp = beats.slice(i, i + CHUNK);
      const cont = all.length ? all[all.length - 1].narration : "";
      const { title: t, panels } = await genChunk(brief, grp, grp.length, Math.round((words * grp.length) / beats.length), cont, log, revisionNotes);
      if (i === 0 && t) title = t;
      all.push(...panels);
      log(`storyboard chunk ${Math.floor(i / CHUNK) + 1}: +${panels.length} panels (total ${all.length})`);
    }
  } else {
    const { title: t, panels } = await genChunk(brief, beats, nPanels, words, "", log, revisionNotes);
    if (t) title = t;
    all.push(...panels);
    log(`storyboard: ${all.length} panels, ${all.reduce((n, p) => n + p.layers.length, 0)} layers`);
  }
  const bounded = boundWhiteboardNarration(all.slice(0, nPanels), brief.targetWords);
  assertWhiteboardGoldenStyle({ panels: bounded });
  bounded.forEach((p, i) => (p.idx = i));
  if (!bounded.length) throw new Error("whiteboardSync: storyboard produced no panels");
  return { title, panels: bounded, fullText: bounded.map((p) => p.narration).join(" ") };
}

/**
 * Write the storyboard and NOTHING else — the CHEAP half of the engine.
 *
 * This makes ONLY non-Google structured text calls: no image generator is touched, no TTS
 * provider is called, no python renderer runs. It is therefore safe to call
 * repeatedly inside a produce→critique→regenerate loop; the resulting ACCEPTED
 * storyboard is then passed to `castWhiteboardSync({ plan })`, which spends
 * once. `revisionNotes` are a critic's prior issues; omit them and the prompt
 * is byte-identical to the storyboard `castWhiteboardSync` writes for itself.
 */
export async function planWhiteboardStoryboard(
  brief: WhiteboardSyncBrief,
  log: Logger = () => {},
  revisionNotes: readonly string[] = [],
): Promise<WhiteboardStoryboard> {
  if (!hasAnthropicKey()) throw new Error("whiteboardSync: non-Google storyboard planner is unavailable");
  return buildStoryboard(brief, log, revisionNotes);
}

/* ------------------------------ timing --------------------------------- */

function alignCues(panels: NPanel[], fullText: string, words: { text: string; start: number; end: number }[], log: Logger = () => {}): {
  audioEnd: number;
  degraded: boolean;
  misses: number;
  totalCues: number;
} {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const eq = (a: string, b: string) => Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
  const mw = fullText.split(/\s+/).map(norm);
  const wn = words.map((w) => norm(w.text));
  const mwTime: (number | null)[] = new Array(mw.length).fill(null);
  let j = 0;
  for (let i = 0; i < mw.length; i++) for (let k = j; k < Math.min(j + 6, words.length); k++) if (eq(mw[i], wn[k])) { mwTime[i] = words[k].start; j = k + 1; break; }
  const known = mwTime.map((t, i) => ({ t, i })).filter((x) => x.t != null) as { t: number; i: number }[];
  for (let i = 0; i < mw.length; i++) {
    if (mwTime[i] != null) continue;
    const prev = [...known].reverse().find((x) => x.i < i), next = known.find((x) => x.i > i);
    mwTime[i] = prev && next ? prev.t + (next.t - prev.t) * ((i - prev.i) / (next.i - prev.i)) : (prev || next || { t: 0 }).t;
  }
  const audioEnd = words.length ? words[words.length - 1].end : 60000;
  // WINDOW MATCHER — the old greedy FIRST-word match desynced on any repeated
  // common word ("the", "a"): the pointer ran away, every later cue fell to the
  // +700ms stack, later panel windows collapsed, and the render FROZE on the
  // last drawn layer for the rest of the audio (seen live: 48% of a probe was
  // a static hold). Require 2 of the cue's first 3 words to match in sequence.
  let mp = 0;
  const cueTime = (cue: string): number | null => {
    const cw = cue.split(/\s+/).map(norm).filter(Boolean).slice(0, 3);
    if (!cw.length) return null;
    for (let i = mp; i < mw.length; i++) {
      let hits = 0;
      for (let k = 0; k < cw.length && i + k < mw.length; k++) if (eq(mw[i + k], cw[k])) hits++;
      if (hits >= Math.min(2, cw.length)) { mp = i + 1; return Math.round(mwTime[i] as number); }
    }
    return null;
  };
  let last = 0;
  let misses = 0;
  let totalCues = 0;
  for (const p of panels)
    for (const l of p.layers as (NLayer & { cueStartMs?: number })[]) {
      totalCues++;
      const t = cueTime(l.cue);
      if (t == null) misses++;
      l.cueStartMs = t != null ? t : last + 700;
      if (l.cueStartMs < last) l.cueStartMs = last + 250;
      last = l.cueStartMs;
    }
  // DETERMINISTIC BACKSTOP: if matching still degraded (many misses, or the
  // final panel starts in the last 8% of the audio), redistribute panel
  // windows proportionally to each panel's narration word count and space the
  // layers evenly inside. Slightly less word-exact, but it CANNOT freeze.
  const lastPanelFirst = Number((panels[panels.length - 1]?.layers[0] as (NLayer & { cueStartMs?: number }) | undefined)?.cueStartMs ?? 0);
  const degraded = totalCues > 0 && (
    misses / totalCues > 0.3 ||
    (panels.length > 1 && lastPanelFirst > audioEnd * 0.92)
  );
  if (degraded) {
    log(`alignCues: DEGRADED matching (${misses}/${totalCues} misses, last panel @${Math.round(lastPanelFirst / 1000)}s of ${Math.round(audioEnd / 1000)}s) — proportional redistribution`);
    const wordsPer = panels.map((p) => p.narration.split(/\s+/).filter(Boolean).length || 1);
    const totWords = wordsPer.reduce((a, b) => a + b, 0);
    let cum = 0;
    for (let i = 0; i < panels.length; i++) {
      const start = (cum / totWords) * audioEnd;
      cum += wordsPer[i];
      const end = (cum / totWords) * audioEnd;
      const ls = panels[i].layers as (NLayer & { cueStartMs?: number })[];
      ls.forEach((l, k) => {
        l.cueStartMs = Math.round(start + ((end - start) * k) / Math.max(1, ls.length + 1));
      });
    }
  }
  return { audioEnd, degraded, misses, totalCues };
}

/* ------------------------------ orchestrator --------------------------- */

export async function castWhiteboardSync(args: {
  brief: WhiteboardSyncBrief;
  runDir: string;
  outPath?: string;
  generateImage: WhiteboardImageGenerator;
  log?: Logger;
  /**
   * A caller-approved storyboard from `planWhiteboardStoryboard` (typically the
   * winner of a produce→critique loop). When supplied the engine does ZERO
   * planning calls and renders exactly this plan; omit it and the engine plans
  * for itself exactly as it always has.
  */
  plan?: WhiteboardStoryboard;
  /**
   * A strict, route/lane/topic-bound version of an approved plan. When present
   * it is the sole planning authority: an invalid receipt must fail before the
   * legacy plan/cache/planner paths are considered.
   */
  approvedStoryReceipt?: unknown;
  storyReceiptBinding?: SelfContainedStoryReceiptBinding;
}): Promise<WhiteboardSyncResult> {
  const log = args.log ?? (() => {});
  const brief = args.brief;
  const requestedPanels = whiteboardPanelCount(brief.panels);
  const approved = resolveSelfContainedStoryPlan({
    family: "whiteboard",
    receipt: args.approvedStoryReceipt,
    binding: args.storyReceiptBinding,
    legacyPlan: args.plan,
  });
  const approvedPlan = approved.plan as WhiteboardStoryboard | undefined;
  const usesElevenLabsVoice =
    brief.ttsProvider === "elevenlabs" && Boolean(brief.elevenVoiceId?.trim());
  // A validated supplied plan is already the planning authority, whether it
  // arrived from a sealed receipt or a local approved-plan handoff. Requiring
  // a remote planner here would make renderer-only recovery depend on an
  // unrelated model even though `buildStoryboard` is never called.
  if (!approvedPlan && !hasAnthropicKey()) {
    throw new Error("whiteboardSync: non-Google storyboard planner is unavailable");
  }
  if (usesElevenLabsVoice ? !process.env.ELEVENLABS_API_KEY : !process.env.FISH_AUDIO_API_KEY) {
    throw new Error(
      usesElevenLabsVoice
        ? "whiteboardSync: ELEVENLABS_API_KEY missing for the selected ElevenLabs voice"
        : "whiteboardSync: FISH_AUDIO_API_KEY missing for the selected Fish voice",
    );
  }
  if (typeof args.generateImage !== "function") {
    throw new Error("whiteboardSync: an explicit attested image generator is required");
  }
  // $0-spend gate: verify python3 + the baked renderer/aligner scripts + pip
  // deps BEFORE the storyboard/art/TTS spend. The render is the LAST step —
  // without this, a worker missing the scripts burned the whole budget first.
  await preflightPythonRenderer({
    scripts: [join("scripts", "wb_scribe_sync.py"), join("scripts", "whisper_align.py")],
    packages: ["numpy", "pillow", "scikit-image", "scipy", "faster-whisper"],
    marker: ".ysa_wb_pydeps_ready",
    log,
  });
  await mkdir(args.runDir, { recursive: true });

  // 1. storyboard — SUPPLIED (already critiqued) → cached → planned here.
  const planPath = join(args.runDir, "plan.json");
  let title: string, panels: NPanel[], fullText: string;
  if (approvedPlan) {
    // Deep clone: the render mutates panel layers in place (`l.art`, cue
    // timings), and the caller keeps this object for its frozen checkpoint.
    ({ title, panels, fullText } = JSON.parse(JSON.stringify(approvedPlan)) as WhiteboardStoryboard);
    const serialized = JSON.stringify({ title, panels, fullText }, null, 2);
    // This engine's art cache is INDEX-keyed (art_<panel>_<layer>.png), so art
    // bought for a different storyboard would be silently reused for the wrong
    // layer. A resume that supplies the same frozen plan hits the equal branch
    // and re-buys nothing; only a genuinely different plan drops the art.
    const onDisk = existsSync(planPath) ? await readFile(planPath, "utf8") : null;
    if (onDisk !== null && onDisk !== serialized) {
      const stale = (await readdir(args.runDir)).filter((name) =>
        /^(?:art_\d+_\d+\.(?:png|jpg|webp)|narration\.mp3|wwords\.json)$/.test(name),
      );
      await Promise.all(stale.map((name) => unlink(join(args.runDir, name)).catch(() => {})));
      log(`storyboard: supplied plan differs from this runDir's cached plan — dropped ${stale.length} index-keyed art/audio cache file(s)`);
    }
    await writeFile(planPath, serialized, "utf8");
    log(`storyboard: using the supplied approved plan (${panels.length} panels) — zero planning calls`);
  } else if (existsSync(planPath)) {
    ({ title, panels, fullText } = JSON.parse(await readFile(planPath, "utf8")) as WhiteboardStoryboard);
    log(`storyboard: loaded cached plan (${panels.length} panels)`);
  } else {
    ({ title, panels, fullText } = await buildStoryboard(brief, log));
    await writeFile(planPath, JSON.stringify({ title, panels, fullText }, null, 2), "utf8");
  }
  // Old cached plans and model output both pass through the same spend bound.
  // Rebuild the narration from the accepted panels so discarded over-returned
  // panels cannot still incur TTS or appear in downstream metadata.
  const boundedPanels = boundWhiteboardNarration(panels.slice(0, requestedPanels), brief.targetWords);
  const boundedFullText = boundedPanels.map((panel) => panel.narration).join(" ");
  const cachedNarrationChanged =
    boundedPanels.length !== panels.length || boundedFullText !== fullText;
  panels = boundedPanels;
  panels.forEach((panel, index) => { panel.idx = index; });
  fullText = boundedFullText;
  // Applies equally to fresh planner output, local smoke plans, cached plans,
  // and sealed route receipts. No sparse board reaches image or TTS spend.
  assertWhiteboardGoldenStyle({ panels });
  if (cachedNarrationChanged) {
    await writeFile(planPath, JSON.stringify({ title, panels, fullText }, null, 2), "utf8");
  }

  // 2. art layers (text-native style lock, no hidden img2img/provider route).
  // Every request repeats one canonical channel style clause and a stable seed;
  // this is cheaper and more deterministic than re-uploading a generated image
  // as a paid input on every panel.
  const styleId = brief.styleId?.trim() || "history";
  const styleLock = brief.artStyle?.trim()
    ? `CHANNEL STYLE-DNA (${styleId}): ${brief.artStyle.trim()}`
    : `CHANNEL STYLE (${styleId}): clean editorial black-marker line art, bold simple silhouettes, uniform stroke weight, sparse red accents`;
  const artJobs: { p: NPanel; l: NLayer }[] = [];
  for (const p of panels) for (const l of p.layers) if (l.kind === "art") artJobs.push({ p, l });
  const isSceneJob = (j: { l: NLayer }) => Number(j.l.box?.[2] ?? 0) >= 0.32;
  const artAssets: WhiteboardArtAsset[] = [];
  const renderArt = async ({ p, l }: { p: NPanel; l: NLayer }) => {
    const artId = `art_${p.idx}_${p.layers.indexOf(l)}`;
    const receiptPath = join(args.runDir, `${artId}.receipt.json`);
    const cachedNames = ["png", "jpg", "webp"]
      .map((extension) => `${artId}.${extension}`)
      .filter((name) => existsSync(join(args.runDir, name)));
    if (cachedNames.length > 1) {
      throw new Error(`whiteboardSync: ${artId} has multiple cached raster formats; refusing ambiguous reuse`);
    }
    let fn = cachedNames[0] ?? `${artId}.png`;
    let out = join(args.runDir, fn);
    const recordArt = async (receiptInput: unknown) => {
      const bytes = await readFile(out);
      const contentSha256 = createHash("sha256").update(bytes).digest("hex");
      const receipt = assertNanoBananaProWhiteboardArtReceipt(receiptInput, contentSha256);
      const dimensions = rasterImageDimensions(bytes);
      if (
        receipt.width !== dimensions.width ||
        receipt.height !== dimensions.height ||
        receipt.sourceContentType !== dimensions.contentType
      ) {
        throw new Error(`whiteboardSync: ${fn} bytes do not match their Nano Banana Pro receipt geometry`);
      }
      artAssets.push({
        id: artId,
        localPath: out,
        contentSha256,
        contentType: receipt.sourceContentType,
        receipt,
      });
      l.art = fn;
    };
    if (existsSync(out)) {
      // A cache without a matching receipt may be a pre-migration Novita asset
      // or a partial local write after a paid request. Never repurchase it on a
      // retry and never let it enter a Nano Banana Pro Whiteboard master.
      if (!existsSync(receiptPath)) {
        throw new Error(`whiteboardSync: cached ${fn} has no Nano Banana Pro receipt; refusing reuse or regeneration`);
      }
      await recordArt(JSON.parse(await readFile(receiptPath, "utf8")));
      return;
    }
    if (existsSync(receiptPath)) {
      throw new Error(`whiteboardSync: ${artId} has a Nano Banana Pro receipt but no local bytes; refusing a duplicate paid submission`);
    }
    const isScene = isSceneJob({ l });
    const prompt = whiteboardArtPrompt({
      styleLock,
      isScene,
      role: l.role,
      draw: l.draw,
      cue: l.cue,
      narration: p.narration,
    });
    let generated: WhiteboardGeneratedArt;
    try {
      generated = await args.generateImage({
        id: artId,
        prompt,
        negativePrompt: "text, letters, numbers, labels, logos, watermark, frame, border, grey background, photorealism, shading",
        seed: whiteboardSeed(styleId, fn),
      });
    } catch (e) {
      // A missing layer produces a visually false explainer. More importantly,
      // a provider/mode mismatch must never become an invisible lower-quality
      // fallback. The block-level retry policy handles only known-safe work.
      throw e;
    }
    const contentSha256 = createHash("sha256").update(generated.bytes).digest("hex");
    const receipt = assertNanoBananaProWhiteboardArtReceipt(generated.receipt, contentSha256);
    fn = `${artId}.${whiteboardArtFileExtension(receipt.sourceContentType)}`;
    out = join(args.runDir, fn);
    // Publish bytes first, then their receipt. If either I/O step fails after
    // a paid response, a retry sees an incomplete cache and fails closed rather
    // than sending the same art prompt again.
    try {
      await writeFile(out, generated.bytes);
      await writeFile(receiptPath, JSON.stringify(receipt));
    } catch (error) {
      const persistenceError = new Error(
        `whiteboardSync: paid ${fn} could not be persisted with its Nano Banana Pro receipt`,
        { cause: error },
      ) as Error & { retryable?: boolean };
      persistenceError.retryable = false;
      throw persistenceError;
    }
    await recordArt(receipt);
    log(`art ${fn} ✓`);
  };
  await pool(artJobs, 3, renderArt);

  // 3. narration + alignment (cached → resumable)
  const mp3Path = join(args.runDir, "narration.mp3");
  const wpath = join(args.runDir, "wwords.json");
  if (cachedNarrationChanged) {
    await Promise.all([unlink(mp3Path).catch(() => {}), unlink(wpath).catch(() => {})]);
    log("storyboard: bounded cached plan changed narration — invalidated stale TTS/alignment cache");
  }
  let ttsCharactersGenerated = 0;
  if (!existsSync(mp3Path)) {
    // Honor a cast ElevenLabs voice when the channel was cast one; else Fish.
    // (The cast winner used to be dropped here — every scribe spoke the Fish
    // default no matter the channel's audition result.)
    const useEleven = usesElevenLabsVoice;
    log(useEleven ? `TTS (ElevenLabs ${brief.elevenVoiceId})…` : "TTS (Fish)…");
    const mp3 = await synthNarration(
      useEleven
        ? {
            text: fullText,
            provider: "elevenlabs",
            elevenVoiceId: brief.elevenVoiceId,
            onBillableCharacters: (characters: number) => { ttsCharactersGenerated += characters; },
          }
        : {
            text: fullText,
            voiceId: brief.voiceId ?? "sleepless_historian",
            speed: 0.95,
            onBillableCharacters: (characters: number) => { ttsCharactersGenerated += characters; },
          },
    );
    await writeFile(mp3Path, Buffer.from(mp3));
  } else log("TTS cached");
  if (!existsSync(wpath)) {
    log("aligning (Whisper)…");
    await runPy([join("scripts", "whisper_align.py"), mp3Path, wpath], log);
  } else log("alignment cached");
  const words = JSON.parse(await readFile(wpath, "utf8")) as { text: string; start: number; end: number }[];
  const { audioEnd, degraded, misses, totalCues } = alignCues(panels, fullText, words, log);
  if (degraded) {
    throw new Error(
      `whiteboardSync: cue alignment degraded (${misses}/${totalCues} misses); refusing to render a timing-fallback master`,
    );
  }

  // 4. timeline
  const panelStart: Record<number, number> = {};
  for (const p of panels) {
    const first = p.layers[0] as NLayer & { cueStartMs: number };
    panelStart[p.idx] = first ? Math.max(0, first.cueStartMs - 250) : 0;
  }
  const tlPanels: SyncPanel[] = panels.map((p, i) => ({
    idx: p.idx,
    startMs: panelStart[p.idx],
    endMs: i + 1 < panels.length ? panelStart[panels[i + 1].idx] : audioEnd + 1800,
    layers: p.layers.map((l) => ({ kind: l.kind, role: l.role, art: l.art, text: l.text, color: l.color, box: l.box, cueStartMs: (l as NLayer & { cueStartMs: number }).cueStartMs })),
  }));
  const header = brief.header ?? title.toUpperCase().slice(0, 40);
  // CHALK MODE: dark-academic channels (styleGrammar chalkboard/dark) render the
  // same line-art as light chalk on a dark board instead of black marker on
  // cream. palette = [bg, ink/light, accent]. The python renderer reads these
  // hex fields; absent/white mode keeps the legacy cream board untouched.
  const chalk = brief.boardMode === "chalk";
  const pal = brief.palette ?? [];
  const board = chalk ? (pal[0] ?? "#1a1c23") : "#f3f1eb";
  const ink = chalk ? (pal[1] ?? "#f0f0f0") : "#000000";
  const accent = pal[2] ?? "#c0392b";
  const timeline = {
    title, header, headerBox: [0.14, 0.035, 0.72, 0.092], dir: args.runDir, audio: "narration.mp3",
    width: brief.width ?? 1920, height: brief.height ?? Math.round((brief.width ?? 1920) * 9 / 16),
    prerollSec: 2.6, fps: 25, audioEndMs: audioEnd, tailMs: 1800, panels: tlPanels,
    boardMode: chalk ? "chalk" : "white", board, ink, accent,
    ...(approved.receipt ? { storyReceiptFingerprint: approved.receipt.fingerprint } : {}),
  };
  const timelinePath = join(args.runDir, "timeline.json");
  await writeFile(timelinePath, JSON.stringify(timeline, null, 2), "utf8");

  // 5. render (deterministic scribe + audio mux)
  const outPath = args.outPath ?? join(args.runDir, "whiteboard-sync.mp4");
  const hand = join(ASSET_DIR, "hand.png");
  log("rendering synced scribe…");
  await runPy([join("scripts", "wb_scribe_sync.py"), timelinePath, outPath, hand], log);
  const renderSchedule = WhiteboardRenderScheduleSchema.parse(
    JSON.parse(await readFile(`${outPath}.draw-receipt.json`, "utf8")),
  );
  if (Math.abs(renderSchedule.narrationStartSec - timeline.prerollSec) > 0.001) {
    throw new Error("whiteboardSync: renderer schedule narration offset diverges from the authored timeline");
  }
  if (renderSchedule.storyReceiptFingerprint !== approved.receipt?.fingerprint) {
    throw new Error("whiteboardSync: renderer schedule does not bind the approved story receipt");
  }
  if (renderSchedule.panels.length !== tlPanels.length) {
    throw new Error("whiteboardSync: renderer schedule omitted an authored panel");
  }
  for (const [panelIndex, scheduled] of renderSchedule.panels.entries()) {
    const authored = tlPanels[panelIndex];
    if (
      !authored || scheduled.idx !== authored.idx ||
      scheduled.startMs !== authored.startMs || scheduled.endMs !== authored.endMs ||
      scheduled.layers.length !== authored.layers.length
    ) {
      throw new Error(`whiteboardSync: renderer schedule diverges from authored panel ${panelIndex}`);
    }
    for (const [layerIndex, layer] of scheduled.layers.entries()) {
      const authoredLayer = authored.layers[layerIndex];
      if (
        !authoredLayer || layer.layerIdx !== layerIndex || layer.kind !== authoredLayer.kind ||
        Math.abs(layer.cueStartMs - authoredLayer.cueStartMs) > 1 ||
        layer.drawStartMs < scheduled.startMs || layer.drawEndMs <= layer.drawStartMs ||
        layer.handSampleMs <= layer.drawStartMs || layer.handSampleMs >= layer.drawEndMs ||
        layer.handLingerEndMs < layer.drawEndMs || layer.handLingerEndMs > scheduled.endMs
      ) {
        throw new Error(`whiteboardSync: renderer schedule has invalid layer ${panelIndex}.${layerIndex}`);
      }
    }
    const lastVisibleEnd = Math.max(...scheduled.layers.map((layer) => layer.handLingerEndMs));
    if (
      scheduled.completionSampleMs <= lastVisibleEnd ||
      scheduled.completionSampleMs >= scheduled.endMs
    ) {
      throw new Error(`whiteboardSync: renderer schedule lacks a completed hold for panel ${panelIndex}`);
    }
  }
  log(`whiteboardSync done → ${outPath}`);
  return {
    outPath,
    narrationPath: mp3Path,
    narrationStartSec: 2.6,
    timelinePath,
    title,
    narrationText: fullText,
    sentenceTimings: words.map((word) => ({
      text: word.text,
      start: word.start / 1000,
      end: word.end / 1000,
    })),
    panels: tlPanels,
    renderSchedule,
    durationMs: 2600 + audioEnd + 1800,
    ttsCharactersGenerated,
    artAssets,
  };
}
