import assert from "node:assert/strict";

import { PRICE } from "@/engine/pricing";
import {
  motionComicNovitaImageStageEnvelope,
} from "@/trigger/blocks/motionComicBlocks";
import {
  whiteboardNanoBananaProArtStageEnvelope,
} from "@/trigger/blocks/whiteboardScribeBlocks";

function whiteboardEnvelopeIsAllOrNothing(): void {
  const full = whiteboardNanoBananaProArtStageEnvelope(16, 31);
  assert.equal(full.imageJobs, 80);
  assert.equal(full.imageMaxCostUsd, 80 * 0.15);
  assert.throws(
    () => whiteboardNanoBananaProArtStageEnvelope(16, undefined),
    /compiler-signed stage budget/,
    "a direct/legacy invocation without a signed stage envelope must fail before art",
  );
  assert.throws(
    () => whiteboardNanoBananaProArtStageEnvelope(16, full.imageMaxCostUsd - 0.0001),
    /requires a \$12\.0000 Nano Banana Pro envelope/,
    "the full art sequence must be admitted before the first panel is purchased",
  );
}

function motionComicEnvelopeIsAllOrNothing(): void {
  const full = motionComicNovitaImageStageEnvelope(12, 10);
  assert.equal(full.imageJobs, 24);
  assert.equal(full.imageMaxCostUsd, 24 * PRICE.novitaImageMaxUsd);
  assert.throws(
    () => motionComicNovitaImageStageEnvelope(12, undefined),
    /compiler-signed stage budget/,
  );
  assert.throws(
    () => motionComicNovitaImageStageEnvelope(12, full.imageMaxCostUsd - 0.0001),
    /requires a \$8\.4000 Novita envelope/,
    "a comic must never buy a partial panel sequence",
  );
}

whiteboardEnvelopeIsAllOrNothing();
motionComicEnvelopeIsAllOrNothing();

console.log("Novita image stage contracts passed");
