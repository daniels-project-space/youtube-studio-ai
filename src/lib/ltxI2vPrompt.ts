import type { Shot } from "@/lib/novitaRenderFarm";
import { getLtxStyle, LTX_STYLES } from "@/engine/ltxStylePresets";

/**
 * LTX receives a source still, not a storyboard. This compact prompt structure
 * is applied at the final shared video boundary so every LTX caller asks for
 * one legible, continuous take that the timeline can cut together later.
 *
 * It follows the transferable first-frame I2V pattern: source-frame anchors,
 * action onset, continuous development, then a readable result or reaction.
 *
 * Style-adaptive (Wave 1): the caller may pass a `styleId` (see
 * src/engine/ltxStylePresets.ts) to merge that visual world's appearance,
 * lighting/color, camera-move vocabulary, and default soundscape into the
 * contract's existing clauses. Omitting `styleId` resolves to
 * DEFAULT_LTX_STYLE_ID via getLtxStyle's own fallback — the required clause
 * *labels* REQUIRED_CONTRACT_CLAUSES checks for never change, only the prose
 * merged inside them.
 */
export const LTX_I2V_PROMPT_CONTRACT_VERSION = "ltx-i2v-directing/v4" as const;

const CONTRACT_MARKER_PREFIX = "[ltx-i2v-directing/";
const LEGACY_V3_MARKER = "[ltx-i2v-directing/v3]";
const REQUIRED_CONTRACT_CLAUSES = [
  "Source-frame anchor:",
  "Action onset:",
  "Continuous development:",
  "End beat:",
  "Diegetic soundscape:",
  "Do not generate narration, dialogue, score, lyrics, or musical cues;",
  "Keep the take cinematic and physically plausible.",
] as const;
const TERMINAL_FRAME_CLAUSE = "Terminal-frame anchor:";

function markerForStyle(styleId: string): string {
  return `[${LTX_I2V_PROMPT_CONTRACT_VERSION} style=${styleId}]`;
}

function clean(value: string | undefined, fallback: string): string {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

/**
 * A version marker alone is never evidence that an I2V take received the
 * continuity contract. Keep this deliberately text-level: the shared render
 * boundary needs an inexpensive, provider-free proof before any LTX spend.
 */
export function hasCompleteLtxI2vPromptContract(
  shot: Pick<Shot, "prompt" | "motion" | "endStillKey">,
  styleId?: string,
): boolean {
  if (styleId !== undefined && !Object.hasOwn(LTX_STYLES, styleId)) return false;
  const styleMarkerMatches = styleId === undefined
    ? Object.keys(LTX_STYLES).some((id) => {
      const marker = markerForStyle(id);
      return shot.motion.includes(marker) && shot.prompt.includes(marker);
    })
    : (() => {
      const marker = markerForStyle(getLtxStyle(styleId).id);
      return shot.motion.includes(marker) && shot.prompt.includes(marker);
    })();
  return REQUIRED_CONTRACT_CLAUSES.every((clause) => shot.motion.includes(clause)) &&
    styleMarkerMatches &&
    (!shot.endStillKey || shot.motion.includes(TERMINAL_FRAME_CLAUSE));
}

function hasCompleteLegacyV3PromptContract(shot: Pick<Shot, "prompt" | "motion" | "endStillKey">): boolean {
  return REQUIRED_CONTRACT_CLAUSES.every((clause) => shot.motion.includes(clause)) &&
    shot.motion.includes(LEGACY_V3_MARKER) &&
    shot.prompt.includes(LEGACY_V3_MARKER) &&
    (!shot.endStillKey || shot.motion.includes(TERMINAL_FRAME_CLAUSE));
}

function visualPromptBeforeContract(prompt: string): string {
  const contractStart = prompt.indexOf(CONTRACT_MARKER_PREFIX);
  return contractStart < 0 ? prompt : prompt.slice(0, contractStart).trim();
}

/**
 * Add the model-agnostic part of good I2V direction without discarding the
 * director's subject, camera, wardrobe, evidence, or negative constraints.
 * It is idempotent because controlled recovery paths re-submit a Shot.
 *
 * @param styleId Optional src/engine/ltxStylePresets.ts style id. Resolved
 * via getLtxStyle, which already falls back to DEFAULT_LTX_STYLE_ID when
 * omitted or unknown — callers never need to guard this themselves.
 */
export function applyLtxI2vPromptContract(shot: Shot, styleId?: string): Shot {
  if (styleId !== undefined && !Object.hasOwn(LTX_STYLES, styleId)) {
    throw new Error(`LTX I2V prompt contract received unknown requested visual style ${styleId}`);
  }
  const style = getLtxStyle(styleId);
  const marker = markerForStyle(style.id);
  let upgradingLegacyV3 = false;
  if (shot.motion.includes(CONTRACT_MARKER_PREFIX)) {
    if (shot.motion.includes(marker)) {
      if (!hasCompleteLtxI2vPromptContract(shot, style.id)) {
        throw new Error(
          "LTX I2V prompt contract marker is present but its required continuity, style, or audio clauses are incomplete",
        );
      }
      return shot;
    }
    if (!shot.motion.includes(LEGACY_V3_MARKER)) {
      throw new Error(
        `LTX I2V prompt contract is bound to a different or unsupported visual style; expected ${style.id}`,
      );
    }
    if (!hasCompleteLegacyV3PromptContract(shot)) {
      throw new Error(
        "legacy LTX I2V prompt contract is incomplete and cannot be safely upgraded to the current style-bound contract",
      );
    }
    upgradingLegacyV3 = true;
  }
  const visual = clean(visualPromptBeforeContract(shot.prompt), "the supplied source frame");
  // A v3 contract replaced the original free-form motion in `shot.motion`.
  // Do not leak that prior style doctrine back into a v4 prompt during the
  // one safe migration path; a fresh, bounded action is more faithful than a
  // stacked and contradictory directing instruction.
  const action = clean(upgradingLegacyV3 ? undefined : shot.motion, "subtle natural motion appropriate to the shot");
  const camera = clean(shot.cameraInstruction ?? shot.cameraMove, "the planned camera position");
  const scale = clean(shot.shotScale, "the planned composition");
  const lens = clean(shot.lens, "the planned lens");
  const soundscape = clean(shot.diegeticSoundscape, style.promptGuidance.soundscapeDefault);
  const contract = [
    marker,
    `Source-frame anchor: begin exactly from the supplied image; preserve the visible subject, faceless identity treatment, wardrobe, palette, props, environment, lighting, ${scale} framing, and ${lens}. Visual world appearance doctrine: ${style.promptGuidance.appearance}`,
    `Action onset: ${action}`,
    `Continuous development: perform one coherent physical action in the same place and time while the camera executes ${camera}; no jump cut, subject replacement, wardrobe/prop swap, time skip, or invented event. Visual world camera doctrine: ${style.promptGuidance.cameraDoctrine} Visual world lighting and color doctrine: ${style.promptGuidance.lightingColor}`,
    "End beat: settle into a readable result or reaction that follows from the action while preserving the source-frame continuity locks.",
    ...(shot.endStillKey
      ? ["Terminal-frame anchor: land exactly on the supplied terminal conditioning image at the final frame; preserve the same subject, faceless identity treatment, wardrobe, props, environment, lighting, and physical consequence across the whole take."]
      : []),
    `Diegetic soundscape: ${soundscape}. Do not generate narration, dialogue, score, lyrics, or musical cues; final editorial audio is mixed separately.`,
    "Keep the take cinematic and physically plausible. Do not add text, subtitles, logos, or watermarks.",
  ].join("\n");
  return {
    ...shot,
    prompt: `${visual}\n\n${contract}`,
    motion: contract,
  };
}
