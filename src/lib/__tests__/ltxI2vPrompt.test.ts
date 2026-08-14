import assert from "node:assert/strict";
import { applyLtxI2vPromptContract, LTX_I2V_PROMPT_CONTRACT_VERSION } from "@/lib/ltxI2vPrompt";

const source = {
  id: "cinematic-shot-a",
  prompt: "A faceless mannequin in a rust wool coat studies a railway timetable in a dim station.",
  motion: "Slow dolly-in as the mannequin folds the timetable and looks toward the departure board.",
  seconds: 5,
  cameraMove: "dolly_push" as const,
  shotScale: "medium" as const,
  lens: "50mm",
  stillKey: "stills/a.png",
};

const directed = applyLtxI2vPromptContract(source);
assert.match(directed.motion, new RegExp(LTX_I2V_PROMPT_CONTRACT_VERSION));
assert.match(directed.motion, /Source-frame anchor/);
assert.match(directed.motion, /Action onset/);
assert.match(directed.motion, /Continuous development/);
assert.match(directed.motion, /End beat/);
assert.match(directed.prompt, /rust wool coat/);
assert.match(directed.motion, /no jump cut, subject replacement, wardrobe\/prop swap/);
assert.deepEqual(applyLtxI2vPromptContract(directed), directed, "recovery retries must not duplicate the shared prompt contract");
