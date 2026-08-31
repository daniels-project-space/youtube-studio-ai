import assert from "node:assert/strict";
import { prepareDirectLtxI2vShot } from "@/lib/novitaMedia";
import { hasCompleteLtxI2vPromptContract } from "@/lib/ltxI2vPrompt";

const prepared = prepareDirectLtxI2vShot({
  id: "direct-i2v-quality-contract",
  prompt: "A quiet lamp-lit reading room with a handwritten notebook on the desk.",
  diegeticSoundscape: "soft rain against the glass and one page turning",
  durationSec: 5,
  negativePrompt: "subtitles, logos, watermarks, extra people",
  motionPrompt: "the visible hand turns one notebook page while rain shifts on the window",
  cameraInstruction: "slow dolly push past the desk lamp toward the notebook, with the window staying in deep background parallax",
  shotScale: "medium",
  lens: "50mm natural",
  seed: 42,
  profileId: "production",
  stillKey: "owners/o/channels/c/stills/opening.png",
  endStillKey: "owners/o/channels/c/stills/settled.png",
  styleId: "photorealistic",
});

assert.equal(
  hasCompleteLtxI2vPromptContract(prepared),
  true,
  "a standalone LTX take must carry the same complete continuity contract as a planned sequence",
);
assert.equal(prepared.negative, undefined, "distilled LTX exclusions must be sealed into the positive contract");
assert.match(prepared.prompt, /Avoid all of the following: subtitles, logos, watermarks, extra people/);
assert.match(prepared.motion, /Source-frame anchor/);
assert.match(prepared.motion, /Action onset/);
assert.match(prepared.motion, /the visible hand turns one notebook page/);
assert.match(prepared.motion, /slow dolly push past the desk lamp/);
assert.doesNotMatch(prepared.motion, /camera executes static/);
assert.match(prepared.motion, /Terminal-frame anchor/);
assert.match(prepared.motion, /soft rain against the glass and one page turning/);
assert.match(prepared.motion, /no jump cut, subject replacement, wardrobe\/prop swap/);

console.log("Direct LTX I2V quality-contract tests passed");
