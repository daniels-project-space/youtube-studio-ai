import assert from "node:assert/strict";
import {
  applyLtxI2vPromptContract,
  hasCompleteLtxI2vPromptContract,
  LTX_I2V_PROMPT_CONTRACT_VERSION,
} from "@/lib/ltxI2vPrompt";
import { DEFAULT_LTX_STYLE_ID, LTX_STYLES } from "@/engine/ltxStylePresets";

const source = {
  id: "cinematic-shot-a",
  prompt: "A faceless mannequin in a rust wool coat studies a railway timetable in a dim station.",
  motion: "Slow dolly-in as the mannequin folds the timetable and looks toward the departure board.",
  seconds: 5,
  cameraMove: "dolly_push" as const,
  shotScale: "medium" as const,
  lens: "50mm",
  diegeticSoundscape: "distant train brakes, a paper timetable softly folding, and the station's low electrical hum",
  stillKey: "stills/a.png",
};

const directed = applyLtxI2vPromptContract(source);
assert.match(directed.motion, new RegExp(LTX_I2V_PROMPT_CONTRACT_VERSION));
assert.match(directed.motion, /Source-frame anchor/);
assert.match(directed.motion, /Action onset/);
assert.match(directed.motion, /Continuous development/);
assert.match(directed.motion, /End beat/);
assert.match(directed.motion, /Diegetic soundscape: distant train brakes/);
assert.match(directed.motion, /Do not generate narration, dialogue, score, lyrics, or musical cues/);
assert.match(directed.prompt, /rust wool coat/);
assert.match(directed.motion, /no jump cut, subject replacement, wardrobe\/prop swap/);
assert.equal(hasCompleteLtxI2vPromptContract(directed), true);
assert.deepEqual(applyLtxI2vPromptContract(directed), directed, "recovery retries must not duplicate the shared prompt contract");

const terminalDirected = applyLtxI2vPromptContract({
  ...source,
  id: "cinematic-shot-terminal",
  endStillKey: "stills/a-terminal.png",
});
assert.match(terminalDirected.motion, /Terminal-frame anchor: land exactly on the supplied terminal conditioning image/);
assert.equal(hasCompleteLtxI2vPromptContract(terminalDirected), true);
assert.deepEqual(
  applyLtxI2vPromptContract(terminalDirected),
  terminalDirected,
  "a terminal-frame contract must remain intact on a recovery retry",
);
assert.throws(
  () => applyLtxI2vPromptContract({ ...directed, endStillKey: "stills/a-terminal.png" }),
  /marker is present but its required continuity and audio clauses are incomplete/,
  "an older marked prompt must not silently skip a newly supplied final-frame condition",
);

assert.throws(
  () => applyLtxI2vPromptContract({
    ...source,
    id: "cinematic-shot-partial-contract",
    motion: `[${LTX_I2V_PROMPT_CONTRACT_VERSION}] preserve the source frame`,
  }),
  /marker is present but its required continuity and audio clauses are incomplete/,
  "a partial marker must not bypass the shared final LTX directing contract",
);

// Wave 1: the hardcoded generic fallback soundscape text was replaced by the
// (default, since no styleId is passed) style's own soundscapeDefault prose
// — see /tmp/ltx_task2_prompt_contract.md for why this literal assertion had
// to change rather than the generic string surviving unmodified.
const defaultSoundscape = applyLtxI2vPromptContract({ ...source, id: "cinematic-shot-b", diegeticSoundscape: undefined });
assert.match(defaultSoundscape.motion, /restrained interior tone: distant traffic or rain on glass/);
assert.ok(
  defaultSoundscape.motion.includes(LTX_STYLES[DEFAULT_LTX_STYLE_ID].promptGuidance.soundscapeDefault),
  "omitting styleId with no shot soundscape must fall back to the default style's soundscape prose",
);

// --- Wave 1: style-adaptive prompt contract -------------------------------

const STYLE_IDS_TO_CHECK = [undefined, "documentary_mannequin", "anime", "photorealistic"] as const;
for (const styleId of STYLE_IDS_TO_CHECK) {
  const styled = applyLtxI2vPromptContract(
    { ...source, id: `cinematic-shot-style-${styleId ?? "default"}` },
    styleId,
  );
  assert.equal(
    hasCompleteLtxI2vPromptContract(styled),
    true,
    `style ${styleId ?? "(default)"} must still produce a complete LTX I2V contract`,
  );
  const resolvedStyle = LTX_STYLES[styleId ?? DEFAULT_LTX_STYLE_ID];
  assert.ok(
    styled.motion.includes(resolvedStyle.promptGuidance.appearance),
    `style ${styleId ?? "(default)"} appearance prose must appear in the motion contract`,
  );
  assert.ok(
    styled.motion.includes(resolvedStyle.promptGuidance.cameraDoctrine),
    `style ${styleId ?? "(default)"} camera doctrine prose must appear in the motion contract`,
  );
}

// An explicit shot-level diegetic soundscape always wins over any style default.
for (const styleId of ["documentary_mannequin", "anime", "photorealistic", "watercolor", "music_video_cinematic"] as const) {
  const styled = applyLtxI2vPromptContract({ ...source, id: `cinematic-shot-soundscape-${styleId}` }, styleId);
  assert.match(
    styled.motion,
    /Diegetic soundscape: distant train brakes, a paper timetable softly folding, and the station's low electrical hum/,
    `style ${styleId} must not override an explicit shot diegeticSoundscape`,
  );
}

// A non-default style with no shot soundscape uses THAT style's soundscape
// prose, not the default style's.
const animeSoundscape = applyLtxI2vPromptContract(
  { ...source, id: "cinematic-shot-anime-soundscape", diegeticSoundscape: undefined },
  "anime",
);
assert.ok(
  animeSoundscape.motion.includes(LTX_STYLES.anime.promptGuidance.soundscapeDefault),
  "an explicit non-default styleId must use that style's soundscape prose when the shot has none",
);
assert.ok(
  !animeSoundscape.motion.includes(LTX_STYLES[DEFAULT_LTX_STYLE_ID].promptGuidance.soundscapeDefault),
  "a non-default style's fallback soundscape must not be the default style's soundscape prose",
);
