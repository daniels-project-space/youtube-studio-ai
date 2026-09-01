import assert from "node:assert/strict";

import {
  selectDeterministicQwenVoice,
  selectVoiceFromProviderMetadata,
} from "@/lib/deterministicVoiceCast";

const result = selectVoiceFromProviderMetadata({
  niche: "evidence-led history documentary",
  voices: [
    {
      voiceId: "bright-social",
      name: "Bright Social",
      category: "generated",
      labels: { gender: "female", age: "young", use_case: "social_media" },
    },
    {
      voiceId: "documentary-pro",
      name: "Documentary Pro",
      category: "professional",
      labels: { gender: "male", age: "adult", use_case: "narrative_story", accent: "American" },
      description: "measured documentary narrator",
    },
  ],
});

assert.equal(result.voiceId, "documentary-pro");
assert(result.selectionScore >= 7);
assert.match(result.why, /real cold-open audio remains mandatory/);
assert.throws(
  () => selectVoiceFromProviderMetadata({
    niche: "history documentary",
    voices: [{ voiceId: "wrong", name: "Wrong", category: "generated", labels: { gender: "female", age: "young", accent: "Australian" } }],
  }),
  /no provider-declared voice meets/,
  "metadata selection must fail closed rather than declare a mismatched voice quality-approved",
);

const qwen = selectDeterministicQwenVoice({
  niche: "evidence-led American history documentary",
  speaker: "Aiden",
  language: "English",
});
assert.equal(qwen.provider, "qwen3");
assert.equal(qwen.voiceId, "Aiden");
assert(qwen.selectionScore >= 7);
assert.match(qwen.why, /native_language:english/);
assert.throws(
  () => selectDeterministicQwenVoice({ niche: "history", speaker: "George", language: "English" }),
  /unsupported Qwen CustomVoice speaker/,
);

console.log("deterministic voice-cast tests passed");
