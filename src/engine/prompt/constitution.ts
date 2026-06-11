/**
 * The Kling "constitution" — prompt-engineering constants + composers.
 *
 * This is the lowest, most reusable layer of the framework and is
 * prompt-engineering, NOT plumbing. It encodes the hard rules legacy AutoStudio
 * applied to every image→video (i2v) call so the camera stays locked and only
 * the subject/environment animates — independent of whatever an LLM wrote for
 * the per-scene narrative prompt.
 *
 * Ported VERBATIM from legacy `autostudio/orchestrator/providers/kling_video.py`:
 *   - STATIC_CAMERA_POSITIVE / STATIC_CAMERA_NEGATIVE
 *   - PIXEL_ART_POSITIVE / AI_VIDEO_POSITIVE
 *   - VISUAL_STYLE_PRESETS (pixel_art, ai_video)  ← legacy
 *   - plus a `lofi` (anime/cozy) preset added for Template C (this framework).
 *
 * The single most important detail the first rewrite lost: the per-clip
 * narrative prompt is ALWAYS suffixed with the locked-camera + motion directives
 * via {@link composeKlingPrompt}, and the negative prompt is attached whenever a
 * known visual-style preset is used (legacy `animate_image` composition rule).
 */

/* --------------------------- ported constants --------------------------- */

/** Verbatim from kling_video.py — forces a locked-off, tripod-style shot. */
export const STATIC_CAMERA_POSITIVE =
  "static camera, locked-off shot, fixed framing, tripod shot, " +
  "only subject and environment animate in place";

/** Verbatim from kling_video.py — strips every camera-motion artifact. */
export const STATIC_CAMERA_NEGATIVE =
  "camera pan, camera zoom, camera dolly, camera tracking, camera shake, " +
  "handheld, parallax, dolly zoom, orbiting camera, motion blur of the frame, " +
  "framing drift, crop change";

/** Verbatim from kling_video.py — pixel-art channels. */
export const PIXEL_ART_POSITIVE =
  "preserve pixel-art aesthetic, clean 16-bit sprites, " +
  "animate characters with subtle motion (breathing, blinking, idle loop), " +
  "animate environmental elements (flames, water, leaves, torches, clouds)";

/** Verbatim from kling_video.py — generic ai_video channels. */
export const AI_VIDEO_POSITIVE =
  "subject and foreground elements animate naturally, background remains steady";

/**
 * Lofi / anime cozy preset (Template C). NOT in the legacy file — added here so
 * the lofi loop gets the same locked-camera discipline plus ambient-motion cues
 * (drifting rain/clouds/steam, flickering neon, gentle parallax-free sway) that
 * make a seamless A→B→A loop read as "alive but still".
 */
export const LOFI_POSITIVE =
  "preserve hand-painted anime/lofi aesthetic, soft cel shading, warm ambient glow, " +
  "animate ONLY the natural atmospheric elements actually present in the scene " +
  "(such as light, particles, water, steam, or foliage where they exist), " +
  "do NOT add new elements, keep all structures and the composition perfectly still, " +
  "slow gentle looping motion, cozy and calm";

/**
 * Visual-style presets keyed by channel `visualStyle`. The two legacy entries
 * are ported verbatim; `lofi` is the Template C addition. Each value is the
 * positive suffix appended after the narrative prompt.
 */
export const VISUAL_STYLE_PRESETS: Record<string, string> = {
  pixel_art: `${STATIC_CAMERA_POSITIVE}, ${PIXEL_ART_POSITIVE}`,
  ai_video: `${STATIC_CAMERA_POSITIVE}, ${AI_VIDEO_POSITIVE}`,
  lofi: `${STATIC_CAMERA_POSITIVE}, ${LOFI_POSITIVE}`,
};

/* ------------------------------ composers ------------------------------- */

export interface KlingPromptInput {
  /** The narrative / motion description for this clip (motion-only is ideal). */
  sceneDescription: string;
  /** Optional channel style-grammar string blended into the prompt. */
  styleGrammar?: string;
  /** Visual-style preset key (pixel_art | ai_video | lofi). Unknown = no suffix. */
  visualStyle?: string;
  /** Optional character/consistency clause appended before the constitution. */
  characterStyle?: string;
  /** Extra negative terms appended after the preset negative (legacy parity). */
  extraNegative?: string;
}

export interface ComposedKlingPrompt {
  /** Full positive prompt (narrative + style-grammar + character + constitution). */
  prompt: string;
  /**
   * Negative prompt — STATIC_CAMERA_NEGATIVE (+ extraNegative) ONLY when the
   * visual style is a known preset, else just extraNegative (legacy rule).
   */
  negativePrompt: string;
}

/**
 * Compose the FULL Kling i2v prompt for a clip. This is the function every
 * loop-clip / i2v call must use so the constitution is appended to EVERY call.
 *
 * Composition rule (faithful to legacy `animate_image`):
 *   full = "<scene>[. <styleGrammar>][. <characterStyle>]. <preset-suffix>"
 *   negative = STATIC_CAMERA_NEGATIVE (+ extraNegative) iff visualStyle ∈ presets
 */
export function composeKlingPrompt(input: KlingPromptInput): ComposedKlingPrompt {
  const parts: string[] = [];
  const scene = (input.sceneDescription ?? "").trim();
  if (scene) parts.push(scene);
  const sg = (input.styleGrammar ?? "").trim();
  if (sg) parts.push(sg);
  const cs = (input.characterStyle ?? "").trim();
  if (cs) parts.push(cs);

  const suffix = VISUAL_STYLE_PRESETS[input.visualStyle ?? ""] ?? "";
  if (suffix) parts.push(suffix);

  const prompt = parts.join(". ");

  const knownPreset =
    input.visualStyle !== undefined && input.visualStyle in VISUAL_STYLE_PRESETS;
  let negativePrompt = knownPreset ? STATIC_CAMERA_NEGATIVE : "";
  const extra = (input.extraNegative ?? "").trim();
  if (extra) {
    negativePrompt = negativePrompt ? `${negativePrompt}, ${extra}` : extra;
  }

  return { prompt, negativePrompt };
}

export interface FluxPromptInput {
  /** The scene description for the still keyframe. */
  sceneDescription: string;
  /** Optional channel style-grammar string blended into the prompt. */
  styleGrammar?: string;
  /** Visual-style preset key — only its aesthetic cues are useful for a still. */
  visualStyle?: string;
  /** Optional character/consistency clause. */
  characterStyle?: string;
}

/**
 * Aesthetic-only clauses for the FLUX still per visual style. The camera-motion
 * directives are irrelevant to a still, so we keep only the look/quality cues.
 */
const FLUX_STYLE_CLAUSE: Record<string, string> = {
  pixel_art: "clean 16-bit pixel-art, crisp sprites, retro game aesthetic",
  ai_video: "photoreal cinematic still, natural lighting, high detail",
  lofi:
    "hand-painted anime/lofi illustration, soft cel shading, warm cozy ambient lighting, " +
    "cinematic composition, atmospheric depth, highly detailed background, " +
    "no people, no text, no signs, no letters, no watermark, no UI",
};

const FLUX_QUALITY_SUFFIX =
  "ultra detailed, sharp focus, 8k, masterpiece quality, no text, no watermark";

/**
 * Compose the FLUX still prompt for a keyframe. Mirrors {@link composeKlingPrompt}
 * but appends a visual aesthetic clause + a quality suffix instead of the
 * locked-camera motion constitution (which is meaningless for a still image).
 */
export function composeFluxPrompt(input: FluxPromptInput): string {
  const parts: string[] = [];
  const scene = (input.sceneDescription ?? "").trim();
  if (scene) parts.push(scene);
  const sg = (input.styleGrammar ?? "").trim();
  if (sg) parts.push(sg);
  const cs = (input.characterStyle ?? "").trim();
  if (cs) parts.push(cs);
  const clause = FLUX_STYLE_CLAUSE[input.visualStyle ?? ""];
  if (clause) parts.push(clause);
  parts.push(FLUX_QUALITY_SUFFIX);
  return parts.join(". ");
}
