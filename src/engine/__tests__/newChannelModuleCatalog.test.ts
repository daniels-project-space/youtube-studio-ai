import assert from "node:assert/strict";

import { MODULE_CATALOG, NEW_CHANNEL_MODULE_CATALOG } from "@/engine/moduleCatalog";

const narration = NEW_CHANNEL_MODULE_CATALOG.find((module) => module.block === "narration_tts");
assert.ok(narration, "new-channel catalog must retain the narration controls");

const provider = narration.params.find((field) => field.key === "ttsProvider");
assert.deepEqual(
  provider?.options?.map((option) => option.value),
  ["elevenlabs"],
  "new-channel setup must expose only the active narration provider",
);
assert.equal(
  narration.params.some((field) => field.key === "qwenSpeaker"),
  false,
  "new-channel setup must not expose retired speaker controls",
);

const legacyNarration = MODULE_CATALOG.find((module) => module.block === "narration_tts");
assert.ok(
  legacyNarration?.params.some((field) => field.key === "qwenSpeaker"),
  "the legacy catalog must retain historic settings for existing channel receipts",
);

console.log("New-channel narration catalog policy tests passed");
