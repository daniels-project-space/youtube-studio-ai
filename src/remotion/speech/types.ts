/**
 * Speech-TV golden module — the pipeline-facing input contract.
 *
 * This module renders REAL speech footage in a vintage broadcast look with
 * word-synced captions, a segment "channel bug", and motion graphics that are
 * timed to the script (each cue mounts only within its [start,end] window — i.e.
 * "on screen for as long as it is script-relevant").
 *
 * Everything below is the contract the LATER pipeline stages must produce:
 *   - source discovery/download → `sourceVideoSrc`
 *   - transcription (AssemblyAI)  → `words`
 *   - logical-part segmentation   → `segments`
 *   - LLM cue-track generation    → `cues`
 * Keeping these as plain serialisable types means they can be passed straight
 * through Convex/Trigger as `inputProps` with zero adaptation.
 */

/** Word-level transcript entry. ms timestamps — mirrors `Word` in src/lib/assemblyai.ts. */
export type SpeechWord = { text: string; start: number; end: number };

/** A logical part of the speech. Drives the top-right channel bug `index/total` + its progress ring. */
export type SpeechSegment = {
  /** 1-based. */
  index: number;
  /** total number of segments, e.g. 8 → bug reads "1/8". */
  total: number;
  /** ms span of this part. */
  start: number;
  end: number;
  /** optional short title (used by lowerThird cues / future chapters). */
  label?: string;
};

export type MotionCueType =
  | "wavyUnderline" // animated underline that draws under a key phrase
  | "lineGraph" // spike-and-return line graph
  | "iconPop" // a themed icon pops in
  | "stepBoxes" // up to 3 boxes with pixelated reveal + glow on the active step
  | "glitch" // brief VHS RGB-split / scanline burst (topic hard-cut)
  | "lowerThird"; // labeled lower-third strap

/**
 * MotionCue — one timed motion-graphic event. The LLM cue-track is `MotionCue[]`.
 *
 * Timing law: a cue is visible iff `start <= t < end` (ms). Authors set `end`
 * to the moment the phrase stops being relevant — nothing lingers past its line.
 * Cues may overlap (e.g. captions + an underline + the channel bug coexist).
 *
 * Per-type payload:
 *   wavyUnderline → { text }                     (the phrase being underlined)
 *   lowerThird    → { text }                     (the strap label)
 *   iconPop       → { icon }                     (which icon; optional text caption)
 *   stepBoxes     → { steps[1..3], highlightStep }
 *   lineGraph     → { points[] }                 (y-values, auto-scaled)
 *   glitch        → {}                           (no payload; uses [start,end])
 */
export type MotionCue = {
  type: MotionCueType;
  /** ms. */
  start: number;
  /** ms — visible until here, then removed. */
  end: number;
  /** phrase for wavyUnderline / lowerThird, or optional caption for iconPop. */
  text?: string;
  /** iconPop. */
  icon?: IconId;
  /** stepBoxes — 1 to 3 short labels. */
  steps?: string[];
  /** stepBoxes — 1-based index of the step that glows; 0/undefined = none. */
  highlightStep?: number;
  /** lineGraph — series of y-values (any scale; normalised at render). */
  points?: number[];
};

export type IconId =
  | "money"
  | "person"
  | "lightbulb"
  | "book"
  | "eye"
  | "ear"
  | "growth";

/** Visual theme. The exported VINTAGE_THEME is the exact reference clone. */
export type SpeechTheme = {
  /** 0..1 desaturation (1 = full B&W). */
  grayscale: number;
  /** 0..1 strength of the cold blue tint laid over the footage. */
  blueTint: number;
  /** 0..1 vignette darkness at the edges. */
  vignette: number;
  /** 0..1 film-grain opacity. */
  grain: number;
  /** caption / UI font stack (system fonts only — no external font dep). */
  fontFamily: string;
  /** caption colour. */
  captionColor: string;
  /** accent used by graphics (underlines, graph stroke, glow). */
  accent: string;
  /** thin inset broadcast border. */
  border: boolean;
};

export const SANS_STACK =
  '"Helvetica Neue", Helvetica, Arial, "Segoe UI", Roboto, sans-serif';

/** Exact-clone defaults for the reference (Jim Rohn vintage VHS look). */
export const VINTAGE_THEME: SpeechTheme = {
  grayscale: 1,
  blueTint: 0.18,
  vignette: 0.55,
  grain: 0.12,
  fontFamily: SANS_STACK,
  captionColor: "#f4f6f8",
  accent: "#ffffff",
  border: true,
};

export type MotivationalSpeechProps = {
  /**
   * The pre-cut speech montage. http(s) R2 url (pipeline) or file:// (local).
   * Absent → renders on a vintage dark background, so the overlay/look is fully
   * testable before the footage stage exists, and degrades gracefully.
   */
  sourceVideoSrc?: string;
  /** Optional low orchestral bed mixed under the speech. */
  musicSrc?: string;
  /** Music bed volume 0..1 (default 0.12). */
  musicVolume?: number;
  /** Mute the source video's own audio (e.g. when speech is muxed separately). */
  muteSource?: boolean;
  words: SpeechWord[];
  segments: SpeechSegment[];
  cues: MotionCue[];
  /** Theme overrides; merged onto VINTAGE_THEME. */
  theme?: Partial<SpeechTheme>;
  /** default true. */
  showChannelBug?: boolean;
  // durationInFrames / width / height are injected at render via calculateMetadata.
};

/** Merge partial overrides onto the vintage default. */
export function resolveTheme(theme?: Partial<SpeechTheme>): SpeechTheme {
  return { ...VINTAGE_THEME, ...(theme ?? {}) };
}

/** ms → frame helpers (single source of truth for caption/cue timing). */
export const msToFrame = (ms: number, fps: number) => (ms / 1000) * fps;
export const frameToMs = (frame: number, fps: number) => (frame / fps) * 1000;
