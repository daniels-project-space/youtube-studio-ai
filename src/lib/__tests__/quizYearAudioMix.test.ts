import assert from "node:assert/strict";

import {
  QUIZ_YEAR_AUDIO_MIX_EVIDENCE_VERSION,
  assertQuizYearAudibleMix,
} from "@/lib/quizYearAudioMix";

const audible = assertQuizYearAudibleMix({
  integratedLufs: -24.6,
  windowMeanDb: -27.2,
});
assert.equal(audible.version, QUIZ_YEAR_AUDIO_MIX_EVIDENCE_VERSION);
assert.equal(audible.integratedLufs, -24.6);

assert.throws(
  () => assertQuizYearAudibleMix({ integratedLufs: -70, windowMeanDb: -91 }),
  /audible-mix floor/,
  "an AAC silence track must not pass merely because it has an audio stream",
);
assert.throws(
  () => assertQuizYearAudibleMix({ integratedLufs: null, windowMeanDb: null }),
  /could not be measured/,
  "a missing or unreadable audio stream must fail before a final master is retained",
);

console.log("QuizYear audible final-mix tests passed");
