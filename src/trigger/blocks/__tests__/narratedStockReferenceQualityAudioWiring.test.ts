import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { referenceQualityContractFor } from "@/engine/creative/referenceQuality";
import { isReferenceQualityEvidenceBridgeV2Family } from "@/lib/referenceQualityFinalMasterBinding";

const narrated = readFileSync(
  resolve(process.cwd(), "src/trigger/blocks/narratedBlocks.ts"),
  "utf8",
);

assert.equal(
  isReferenceQualityEvidenceBridgeV2Family(referenceQualityContractFor("narrated_stock").family),
  true,
  "narrated stock is admitted only because its frozen contract names measured documentary narration",
);
assert.equal(
  isReferenceQualityEvidenceBridgeV2Family(referenceQualityContractFor("quizyear").family),
  false,
  "quizyear cannot borrow narration semantics for its supportive-audio requirement",
);
assert.equal(
  isReferenceQualityEvidenceBridgeV2Family(referenceQualityContractFor("sleep").family),
  false,
  "sleep cannot borrow narration semantics for a potentially wordless ambient master",
);
assert.match(
  narrated,
  /isReferenceQualityEvidenceBridgeV2Family\(releaseReferenceQualityContract!\.family\)[\s\S]{0,180}finalMasterNarrationSemantic !== undefined[\s\S]{0,180}hasPassingScoredAudioAxis[\s\S]{0,240}createReferenceQualityEvidenceBridgeV2/,
  "shared final QA may create the bridge only after its family-specific admission, final-master narration semantic receipt, and scored audio-axis receipt",
);
assert.match(
  narrated,
  /createReferenceQualityEvidenceBridgeV2\([\s\S]{0,1600}finalMasterNarration: finalMasterNarrationSemantic[\s\S]{0,600}audioAxis: qualityEvidence\.axes\.audio/,
  "the emitted bridge must bind the exact final-master narration semantic and audio-axis siblings rather than a generic QA pass",
);

console.log("narrated-stock reference-quality audio wiring tests passed");
