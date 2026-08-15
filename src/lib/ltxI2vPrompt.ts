import type { Shot } from "@/lib/novitaRenderFarm";

/**
 * LTX receives a source still, not a storyboard. This compact prompt structure
 * is applied at the final shared video boundary so every LTX caller asks for
 * one legible, continuous take that the timeline can cut together later.
 *
 * It follows the transferable first-frame I2V pattern: source-frame anchors,
 * action onset, continuous development, then a readable result or reaction.
 */
export const LTX_I2V_PROMPT_CONTRACT_VERSION = "ltx-i2v-directing/v2" as const;

const MARKER = `[${LTX_I2V_PROMPT_CONTRACT_VERSION}]`;
const REQUIRED_CONTRACT_CLAUSES = [
  MARKER,
  "Source-frame anchor:",
  "Action onset:",
  "Continuous development:",
  "End beat:",
  "Diegetic soundscape:",
  "Do not generate narration, dialogue, score, lyrics, or musical cues;",
  "Keep the take cinematic and physically plausible.",
] as const;

function clean(value: string | undefined, fallback: string): string {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

/**
 * A version marker alone is never evidence that an I2V take received the
 * continuity contract. Keep this deliberately text-level: the shared render
 * boundary needs an inexpensive, provider-free proof before any LTX spend.
 */
export function hasCompleteLtxI2vPromptContract(shot: Pick<Shot, "prompt" | "motion">): boolean {
  return REQUIRED_CONTRACT_CLAUSES.every((clause) => shot.motion.includes(clause)) &&
    shot.prompt.includes(MARKER);
}

/**
 * Add the model-agnostic part of good I2V direction without discarding the
 * director's subject, camera, wardrobe, evidence, or negative constraints.
 * It is idempotent because controlled recovery paths re-submit a Shot.
 */
export function applyLtxI2vPromptContract(shot: Shot): Shot {
  if (shot.motion.includes(MARKER)) {
    if (!hasCompleteLtxI2vPromptContract(shot)) {
      throw new Error(
        "LTX I2V prompt contract marker is present but its required continuity and audio clauses are incomplete",
      );
    }
    return shot;
  }
  const visual = clean(shot.prompt, "the supplied source frame");
  const action = clean(shot.motion, "subtle natural motion appropriate to the shot");
  const camera = clean(shot.cameraMove, "the planned camera position");
  const scale = clean(shot.shotScale, "the planned composition");
  const lens = clean(shot.lens, "the planned lens");
  const soundscape = clean(
    shot.diegeticSoundscape,
    "restrained location tone and physical sound motivated only by the visible action",
  );
  const contract = [
    MARKER,
    `Source-frame anchor: begin exactly from the supplied image; preserve the visible subject, faceless identity treatment, wardrobe, palette, props, environment, lighting, ${scale} framing, and ${lens}.`,
    `Action onset: ${action}`,
    `Continuous development: perform one coherent physical action in the same place and time while the camera executes ${camera}; no jump cut, subject replacement, wardrobe/prop swap, time skip, or invented event.`,
    "End beat: settle into a readable result or reaction that follows from the action while preserving the source-frame continuity locks.",
    `Diegetic soundscape: ${soundscape}. Do not generate narration, dialogue, score, lyrics, or musical cues; final editorial audio is mixed separately.`,
    "Keep the take cinematic and physically plausible. Do not add text, subtitles, logos, or watermarks.",
  ].join("\n");
  return {
    ...shot,
    prompt: `${visual}\n\n${contract}`,
    motion: contract,
  };
}
