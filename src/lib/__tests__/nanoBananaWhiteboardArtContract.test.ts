import assert from "node:assert/strict";

import {
  NANO_BANANA_2_WHITEBOARD_SUPPORT_ART_PROFILE,
  NANO_BANANA_PRO_WHITEBOARD_ART_PROFILE,
  assertNanoBanana2WhiteboardSupportArtReceipt,
  assertNanoBananaWhiteboardArtReceipt,
  assertNanoBananaProWhiteboardArtReceipt,
  nanoBanana2WhiteboardSupportArtCostUsd,
  nanoBananaProWhiteboardArtCostUsd,
  whiteboardTieredArtCostUsd,
} from "@/lib/nanoBananaWhiteboardArtContract";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function receipt() {
  return {
    provider: "fal" as const,
    model: "fal-ai/nano-banana-pro" as const,
    apiVersion: "fal.run/v1" as const,
    route: "fal-nano-banana-pro-whiteboard-art" as const,
    width: 2048,
    height: 1152,
    promptUtf8Bytes: 1_200,
    outputCostUsd: NANO_BANANA_PRO_WHITEBOARD_ART_PROFILE.outputImageUsd,
    costUsd: nanoBananaProWhiteboardArtCostUsd(),
    sourceContentType: "image/png",
    providerRequestCanonicalJson: "{\"model\":\"fal-ai/nano-banana-pro\"}",
    providerRequestSha256: HASH_A,
    providerResponseMetadataCanonicalJson: "{\"status\":200}",
    providerResponseMetadataSha256: HASH_B,
    responseSha256: HASH_A,
    createdAt: 1_700_000_000_000,
  };
}

function validReceiptIsByteAndCostBound(): void {
  const accepted = assertNanoBananaProWhiteboardArtReceipt(receipt(), HASH_A);
  assert.equal(accepted.model, NANO_BANANA_PRO_WHITEBOARD_ART_PROFILE.model);
  assert.equal(accepted.route, NANO_BANANA_PRO_WHITEBOARD_ART_PROFILE.route);
  assert.ok(accepted.costUsd <= NANO_BANANA_PRO_WHITEBOARD_ART_PROFILE.admissionCeilingUsd);
}

function substitutionsAndCostForgeryFailClosed(): void {
  assert.throws(
    () => assertNanoBananaProWhiteboardArtReceipt({ ...receipt(), model: "gemini-3-pro-image" }, HASH_A),
    /sealed Nano Banana Pro profile/i,
  );
  assert.throws(
    () => assertNanoBananaProWhiteboardArtReceipt({ ...receipt(), costUsd: 0.01 }, HASH_A),
    /unsealed Nano Banana Pro cost/i,
  );
  assert.throws(
    () => assertNanoBananaProWhiteboardArtReceipt(receipt(), HASH_B),
    /bytes do not match/i,
  );
  assert.throws(
    () => assertNanoBananaProWhiteboardArtReceipt({ ...receipt(), provider: "gemini" }, HASH_A),
    /sealed Nano Banana Pro profile/i,
  );
}

function supportReceipt() {
  return {
    provider: "fal" as const,
    model: "fal-ai/nano-banana-2" as const,
    apiVersion: "fal.run/v1" as const,
    route: "fal-nano-banana-2-whiteboard-support-art" as const,
    width: 1376,
    height: 768,
    promptUtf8Bytes: 900,
    outputCostUsd: NANO_BANANA_2_WHITEBOARD_SUPPORT_ART_PROFILE.outputImageUsd,
    costUsd: nanoBanana2WhiteboardSupportArtCostUsd(),
    sourceContentType: "image/png",
    providerRequestCanonicalJson: "{\"model\":\"fal-ai/nano-banana-2\"}",
    providerRequestSha256: HASH_A,
    providerResponseMetadataCanonicalJson: "{\"status\":200}",
    providerResponseMetadataSha256: HASH_B,
    responseSha256: HASH_A,
    createdAt: 1_700_000_000_000,
  };
}

function benchmarkQualifiedSupportTierIsBounded(): void {
  const accepted = assertNanoBanana2WhiteboardSupportArtReceipt(supportReceipt(), HASH_A);
  assert.equal(accepted.model, NANO_BANANA_2_WHITEBOARD_SUPPORT_ART_PROFILE.model);
  assert.equal(assertNanoBananaWhiteboardArtReceipt(supportReceipt(), HASH_A).route, accepted.route);
  assert.equal(whiteboardTieredArtCostUsd(1, 3), 0.39);
  assert.throws(
    () => assertNanoBanana2WhiteboardSupportArtReceipt({ ...supportReceipt(), costUsd: 0.04 }, HASH_A),
    /unsealed Nano Banana 2 cost/i,
  );
  assert.throws(
    () => assertNanoBananaWhiteboardArtReceipt({ ...supportReceipt(), route: "fal-unreviewed-cheap-model" }, HASH_A),
    /unadmitted provider route/i,
  );
}

validReceiptIsByteAndCostBound();
substitutionsAndCostForgeryFailClosed();
benchmarkQualifiedSupportTierIsBounded();
console.log("NANO BANANA PRO WHITEBOARD ART CONTRACT PASS");
