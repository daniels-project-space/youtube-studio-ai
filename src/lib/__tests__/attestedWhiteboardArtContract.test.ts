import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  ATTESTED_WHITEBOARD_ART_CONTRACT_VERSION,
  assertAttestedWhiteboardArtReceipt,
  attestedWhiteboardArtReceiptFromNovita,
} from "@/lib/attestedWhiteboardArtContract";
import type { AttestedNovitaImageBytes } from "@/lib/novitaMedia";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function rendered(): AttestedNovitaImageBytes {
  return {
    bytes: PNG_1X1,
    url: "https://r2.example.test/art.png",
    key: "owners/o/channels/c/runs/r/whiteboard/art.png",
    jobId: "image-job-1234",
    model: "Tongyi-MAI/Z-Image-Turbo@pinned",
    profileId: "production",
    width: 1,
    height: 1,
    costUsd: 0.0125,
    billingReceipt: {
      provider: "novita",
      currency: "USD",
      receiptId: "billing-1234",
      gpuSku: "RTX 4090",
      gpuCount: 1,
      gpuSeconds: 10,
      gpuRateUsdPerSecond: 0.00125,
      startupUsd: 0,
      storageUsd: 0,
      costUsd: 0.0125,
    },
    runtimeAttestation: {
      provider: "novita",
      capacityMode: "spot",
      weightStorage: "local-persistent-disk",
      cacheMount: "/workspace/model-cache",
      checkpointing: true,
      idleShutdownSeconds: 90,
      gpuCount: 1,
      model: "Tongyi-MAI/Z-Image-Turbo",
      revision: "pinned",
      checkpoint: "model.safetensors",
    },
    profileSha256: HASH_A,
    manifestSha256: HASH_B,
    requestSha256: HASH_A,
    requestCanonicalJson: "{}",
    billingReceiptSha256: HASH_B,
  };
}

const receipt = attestedWhiteboardArtReceiptFromNovita(rendered());
assert.equal(receipt.contractVersion, ATTESTED_WHITEBOARD_ART_CONTRACT_VERSION);
assert.equal(receipt.provider, "novita");
assert.equal(receipt.route, "local-z-image-turbo");
assert.equal(receipt.width, 1);
assert.equal(receipt.height, 1);
assert.equal(receipt.responseSha256, createHash("sha256").update(PNG_1X1).digest("hex"));
assert.equal(assertAttestedWhiteboardArtReceipt(receipt, receipt.responseSha256), receipt);

assert.throws(
  () => assertAttestedWhiteboardArtReceipt({ ...receipt, provider: "fal" }, receipt.responseSha256),
  /outside its admitted Novita contract/i,
);
assert.throws(
  () => assertAttestedWhiteboardArtReceipt({ ...receipt, route: "ernie-image-novita-4090" }, receipt.responseSha256),
  /outside its admitted Novita contract/i,
  "a future ERNIE route must not be relabelled as today's Z-Image receipt",
);
assert.throws(
  () => assertAttestedWhiteboardArtReceipt(receipt, HASH_A),
  /bytes do not match/i,
);
assert.throws(
  () => attestedWhiteboardArtReceiptFromNovita({ ...rendered(), width: 2 }),
  /geometry/i,
);

console.log("ATTESTED WHITEBOARD ART CONTRACT PASS");
