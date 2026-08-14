import type { Shot } from "@/lib/novitaRenderFarm";

/**
 * LTX receives a source still, not a storyboard. This compact prompt structure
 * is applied at the final shared video boundary so every LTX caller asks for
 * one legible, continuous take that the timeline can cut together later.
 *
 * It follows the transferable first-frame I2V pattern: source-frame anchors,
 * action onset, continuous development, then a readable result or reaction.
 */
export const LTX_I2V_PROMPT_CONTRACT_VERSION = "ltx-i2v-directing/v1" as const;

const MARKER = `[${LTX_I2V_PROMPT_CONTRACT_VERSION}]`;

function clean(value: string | undefined, fallback: string): string {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

/**
 * Add the model-agnostic part of good I2V direction without discarding the
 * director's subject, camera, wardrobe, evidence, or negative constraints.
 * It is idempotent because controlled recovery paths re-submit a Shot.
 */
export function applyLtxI2vPromptContract(shot: Shot): Shot {
  if (shot.motion.includes(MARKER)) return shot;
  const visual = clean(shot.prompt, "the supplied source frame");
  const action = clean(shot.motion, "subtle natural motion appropriate to the shot");
  const camera = clean(shot.cameraMove, "the planned camera position");
  const scale = clean(shot.shotScale, "the planned composition");
  const lens = clean(shot.lens, "the planned lens");
  const contract = [
    MARKER,
    `Source-frame anchor: begin exactly from the supplied image; preserve the visible subject, faceless identity treatment, wardrobe, palette, props, environment, lighting, ${scale} framing, and ${lens}.`,
    `Action onset: ${action}`,
    `Continuous development: perform one coherent physical action in the same place and time while the camera executes ${camera}; no jump cut, subject replacement, wardrobe/prop swap, time skip, or invented event.`,
    "End beat: settle into a readable result or reaction that follows from the action while preserving the source-frame continuity locks.",
    "Keep the take cinematic and physically plausible. Do not add text, subtitles, logos, watermarks, dialogue, or lyrics.",
  ].join("\n");
  return {
    ...shot,
    prompt: `${visual}\n\n${contract}`,
    motion: contract,
  };
}
