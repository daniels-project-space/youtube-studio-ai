import assert from "node:assert/strict";

import { assertScriptNarrationConsistent, assembleScriptNarration } from "@/engine/scriptNarration";
import type { StageContext } from "@/engine/types";
import { narrationTts } from "@/trigger/blocks/narratedBlocks";

const script = {
  hook: "The first clue was hiding in plain sight.",
  sections: [
    { heading: "The clue", narration: "A single mark changed the investigation." },
    { heading: "The answer", narration: "The mark revealed who had entered." },
  ],
  narrationText: "The first clue was hiding in plain sight.\n\nA single mark changed the investigation.\n\nThe mark revealed who had entered.",
};

assert.equal(assembleScriptNarration(script.hook, script.sections), script.narrationText);
assert.doesNotThrow(() => assertScriptNarrationConsistent(script, "test"));
assert.throws(
  () => assertScriptNarrationConsistent({ ...script, narrationText: "Different words." }, "test"),
  /narrationText does not match/,
);

const context = (value: unknown, flatText: string): StageContext => ({
  ownerId: "owner-script-narration-test",
  runId: "run-script-narration-test",
  channelId: "channel-script-narration-test",
  keyPrefix: "owner/test/channel/script-narration/",
  params: {},
  store: { script: value, narrationText: flatText },
  budgetUsd: 0,
  log: () => {},
});

async function main(): Promise<void> {
  await assert.rejects(
    narrationTts.run(context({ ...script, narrationText: "Different words." }, "Different words.")),
    /narrationText does not match/,
    "the paid TTS boundary rejects inconsistent structured scripts before checking approval or setting up a provider",
  );
  await assert.rejects(
    narrationTts.run(context(script, "A separately modified narration.")),
    /flat narrationText differs from the bound script/,
    "the paid TTS boundary rejects drift between the admitted script and its flat stage input",
  );
  await assert.rejects(
    narrationTts.run(context(script, script.narrationText)),
    /script quality is not approved/,
    "a consistent script continues to the existing independent quality gate",
  );

  console.log("script narration contract tests passed");
}

void main();
