import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../lofiBlocks.ts", import.meta.url), "utf8");

assert.match(
  source,
  /measureNativeMusicQuality\(\{[\s\S]*?audio: candidate\.audio[\s\S]*?durationSec: candidate\.receipt\.durationSec[\s\S]*?\}\)[\s\S]*?hasKnownMiniMaxMusic3OpeningDegradation\(technicalQuality\)/,
  "MiniMax Music3 must measure the exact native candidate before accepting it for mastering",
);
assert.match(
  source,
  /for \(let attempt = 0; attempt < 2; attempt \+= 1\)[\s\S]*?remainingBudgetUsd = configuredBudgetUsd - billedAttestedCostUsd[\s\S]*?maxCostUsd: Math\.min\(10, remainingBudgetUsd\)/,
  "known Music3 degradation may have only one budget-aware deterministic reseed retry",
);
assert.match(
  source,
  /minimax_music3_rejected_native_wav[\s\S]*?known-music3-opening-degradation/,
  "a rejected paid Music3 candidate must retain inspectable evidence rather than disappear",
);
assert.match(
  source,
  /musicQualityReviewStatus: usedProvider === "minimax_music3"[\s\S]*?"awaiting-human-audition"/,
  "technical recovery must not forge or bypass the independent human musical audition",
);

console.log("Lo-Fi MiniMax Music3 technical recovery wiring tests passed");
