import assert from "node:assert/strict";
import {
  applyLtxI2vPromptContract,
  hasCompleteLtxI2vPromptContract,
  LTX_I2V_PROMPT_CONTRACT_VERSION,
} from "@/lib/ltxI2vPrompt";

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

const defaultSoundscape = applyLtxI2vPromptContract({ ...source, id: "cinematic-shot-b", diegeticSoundscape: undefined });
assert.match(defaultSoundscape.motion, /restrained location tone and physical sound motivated only by the visible action/);
