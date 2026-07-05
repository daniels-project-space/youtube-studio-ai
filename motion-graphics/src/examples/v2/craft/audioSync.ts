/**
 * audioSync.ts — land each word ON the spoken word.
 *
 * Give it word onsets in SECONDS (relative to clip start) + fps, and it
 * converts to per-word startFrames so the animation cuts to the voiceover
 * instead of using arbitrary even staggers (the #1 reason code-animation
 * feels "off" against narration).
 *
 * ITERATION 1 onset source: HYBRID.
 *   - whisper (tiny.en, word_timestamps) gave audio-truth for FEEL..PROSPERITY.
 *   - tiny.en collapsed the fast opening cluster (I/DON'T/KNOW/WHAT/YOU) and
 *     merged GOSPEL onto PROSPERITY, so those were reconstructed from the
 *     Gemini second-by-second beat (relative spacing) anchored on the
 *     trustworthy whisper FEEL=2.42s, with GOSPEL placed +1.1s after PROSPERITY.
 *   See report / out/craft/ref_audio.json for the raw whisper output.
 *
 * Fully deterministic: pure arithmetic on the onset table + frame.
 */

export interface WordOnset {
  /** The display token (may differ from spoken word, e.g. "PRO$PERITY"). */
  word: string;
  /** Onset time in seconds, relative to clip start (t=0 == video frame 0). */
  onset: number;
}

export interface TimedWord extends WordOnset {
  /** Frame on which this word should LAND (its settle target). */
  startFrame: number;
  /** Index in sequence. */
  index: number;
}

/**
 * ITER 2: TRIM the dead ~0.9s lead-in. Iter1 had ~1s of empty screen before "I"
 * because the hybrid table front-loaded "I" to 1.07s while real speech onset is
 * ~1.6s. We subtract LEAD_TRIM_SEC (0.9s) from every onset AND trim the same
 * 0.9s off the head of the audio at re-mux time (`-ss 0.9`), so words still land
 * exactly on the voice but the screen fills almost immediately.
 *
 * Relative spacing is preserved (the part that worked in iter1). The audio-truth
 * anchor FEEL=2.42s becomes 1.52s; the audio is shifted identically.
 */
export const LEAD_TRIM_SEC = 0.9;

const RAW_ONSETS: WordOnset[] = [
  { word: "I", onset: 1.07 },
  { word: "DON'T", onset: 1.27 },
  { word: "KNOW", onset: 1.47 },
  { word: "WHAT", onset: 1.65 },
  { word: "YOU", onset: 1.83 },
  { word: "FEEL", onset: 2.42 },
  { word: "ABOUT", onset: 2.96 },
  { word: "THE", onset: 3.7 },
  { word: "PROSPERITY", onset: 4.54 },
  { word: "GOSPEL", onset: 5.64 },
];

export const PHRASE_ONSETS: WordOnset[] = RAW_ONSETS.map((w) => ({
  ...w,
  onset: Math.max(0.17, w.onset - LEAD_TRIM_SEC),
}));

/**
 * buildTimeline — convert onsets (sec) to per-word startFrames at a given fps.
 *
 * `lead` lets a word START its entrance a few frames BEFORE its onset so the
 * SETTLE lands on the spoken word (motion that arrives exactly on the beat
 * reads late; landing slightly ahead and settling on-beat reads tight). We
 * offset the start by `lead` and treat `startFrame` as the entrance-begin; the
 * caller's ease should resolve to ~1.0 around onsetFrame.
 */
export const buildTimeline = (
  onsets: WordOnset[],
  fps: number,
  lead = 0,
): TimedWord[] =>
  onsets.map((w, index) => ({
    ...w,
    index,
    startFrame: Math.max(0, Math.round(w.onset * fps) - lead),
  }));

/** The onset frame (where the word should be fully landed). */
export const onsetFrame = (w: WordOnset, fps: number): number =>
  Math.round(w.onset * fps);

/**
 * wordProgress — 0..1 entrance progress for a word given the current frame,
 * its start frame and an entrance duration (frames). Clamped. Caller applies
 * the easing curve; this is the raw local time.
 */
export const wordProgress = (
  frame: number,
  startFrame: number,
  durFrames: number,
): number => {
  const t = (frame - startFrame) / Math.max(1, durFrames);
  return t < 0 ? 0 : t > 1 ? 1 : t;
};

/** True once the word has begun (frame >= its startFrame). */
export const activeSinceOnset = (frame: number, startFrame: number): boolean =>
  frame >= startFrame;

/** Total spoken span in frames (last onset), for sizing the comp. */
export const lastOnsetFrame = (onsets: WordOnset[], fps: number): number =>
  Math.max(0, ...onsets.map((w) => Math.round(w.onset * fps)));

/* ------------------------------------------------------------------ */
/* ITER 2: BEAT GROUPING — never pile the whole phrase on screen.       */
/* ------------------------------------------------------------------ */

/**
 * A beat is a small group of words that share the screen, plus an optional
 * frame at which the beat FADES OUT to make room for the next. At any moment
 * the comp shows at most one beat (a tidy lead/mid cluster + one hero word).
 */
export interface Beat {
  id: string;
  /** display tokens belonging to this beat. */
  words: string[];
  /** frame the beat begins to fade OUT (its words clear). -1 = never. */
  fadeOutFrame: number;
}

/**
 * beatGroups — the 3 beats matching the reference:
 *   1. "I DON'T KNOW WHAT YOU" (lead column) + "FEEL" (hero)
 *   2. "ABOUT" "THE" (small) + "PRO$PERITY" (hero)
 *   3. "GOSPEL" (small, joins beat-2 hero briefly then everything holds)
 *
 * Beat 1 fades out as ABOUT's onset approaches; beat 2 holds through the end
 * (GOSPEL lands on it). Fade frames are derived from onsets so trimming the
 * lead-in shifts them automatically.
 */
export const beatGroups = (fps: number): Beat[] => {
  const f = (w: string): number => {
    const o = PHRASE_ONSETS.find((x) => x.word === w);
    return o ? Math.round(o.onset * fps) : 0;
  };
  return [
    {
      id: "beat1",
      words: ["I", "DON'T", "KNOW", "WHAT", "YOU", "FEEL"],
      // clear ~10 frames before ABOUT lands, so the screen is empty-ish for the
      // hero swap rather than overlapping the two beats.
      fadeOutFrame: f("ABOUT") - 10,
    },
    {
      id: "beat2",
      words: ["ABOUT", "THE", "PROSPERITY", "GOSPEL"],
      fadeOutFrame: -1, // holds to the end
    },
  ];
};

/** Which beat a given display word belongs to. */
export const beatOfWord = (word: string, fps: number): Beat | undefined =>
  beatGroups(fps).find((b) => b.words.includes(word));
