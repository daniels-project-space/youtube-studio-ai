import assert from "node:assert/strict";
import { MODULE_CONTRACTS } from "../moduleContracts";
import {
  NARRATION_TTS_MODULE_COST_CEILING_USD,
  narrationChapterCardsRequested,
  narrationTtsCostCeilingUsd,
  maxQwenNarrationDurationSeconds,
  qwenNarrationBudgetAdmission,
} from "../narrationTtsCost";

assert.equal(MODULE_CONTRACTS.narration_tts.maxCostUsd, NARRATION_TTS_MODULE_COST_CEILING_USD);
assert.equal(
  narrationTtsCostCeilingUsd({ durationSeconds: 60, provider: "qwen3" }).toFixed(3),
  "2.206",
);
assert.equal(
  narrationTtsCostCeilingUsd({ durationSeconds: 600, provider: "qwen3" }).toFixed(3),
  "13.006",
);
assert.equal(
  narrationTtsCostCeilingUsd({ durationSeconds: 600, provider: "qwen3", chapterCards: true }).toFixed(3),
  "15.391",
);
assert.equal(
  MODULE_CONTRACTS.narration_tts.maxCostUsdFor?.(
    { ttsProvider: "qwen3", maxSeconds: 600 },
    undefined,
  )?.toFixed(3),
  narrationTtsCostCeilingUsd({ durationSeconds: 600, provider: "qwen3" }).toFixed(3),
  "the runtime contract and admission estimate must use the same cost function",
);

assert.equal(qwenNarrationBudgetAdmission({
  durationSeconds: 180,
  perVideoBudgetUsd: 5,
}).allowed, true);
assert.equal(qwenNarrationBudgetAdmission({
  durationSeconds: 300,
  perVideoBudgetUsd: 5,
}).reason, "per-video-budget");
assert.equal(qwenNarrationBudgetAdmission({
  durationSeconds: 600,
  perVideoBudgetUsd: 100,
}).reason, "module-ceiling");
assert.equal(qwenNarrationBudgetAdmission({
  durationSeconds: 60,
  chapterCards: true,
  perVideoBudgetUsd: 3,
}).reason, "per-video-budget");

assert.equal(narrationChapterCardsRequested({
  moduleConfig: { narration_tts: { chapterCards: true } },
}), true);
assert.equal(narrationChapterCardsRequested({
  paramOverrides: { narration_tts: { chapterCards: true } },
}), true);
assert.equal(narrationChapterCardsRequested({
  moduleConfig: { narration_tts: { chapterCards: false } },
}), false);

for (const chapterCards of [false, true]) {
  const maximum = maxQwenNarrationDurationSeconds({
    minimumSeconds: 60,
    maximumSeconds: 3_600,
    stepSeconds: 60,
    chapterCards,
    perVideoBudgetUsd: 5,
  });
  assert.notEqual(maximum, null, "the current $5 budget admits at least one narrated_stock duration");
  assert.equal(qwenNarrationBudgetAdmission({
    durationSeconds: maximum!,
    chapterCards,
    perVideoBudgetUsd: 5,
  }).allowed, true);
  assert.equal(qwenNarrationBudgetAdmission({
    durationSeconds: maximum! + 60,
    chapterCards,
    perVideoBudgetUsd: 5,
  }).allowed, false, "the returned family step is the maximum admitted duration");
}
assert.equal(maxQwenNarrationDurationSeconds({
  minimumSeconds: 60,
  maximumSeconds: 3_600,
  stepSeconds: 60,
  perVideoBudgetUsd: 2,
}), null, "a $2 budget cannot admit even the minimum Qwen reserve");

console.log("Qwen narration duration and budget admission tests passed");
