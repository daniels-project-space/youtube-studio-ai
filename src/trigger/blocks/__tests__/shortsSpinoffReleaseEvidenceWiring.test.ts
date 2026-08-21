import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { artifactContract } from "@/engine/artifactSchemas";
import { registerAllBlocks } from "@/engine/blocks";
import { getManifest } from "@/engine/registry";
import {
  assertShortReleaseStructuralEvidence,
  assertShortReleaseVisualEvidence,
} from "@/trigger/blocks/lofiBlocks";

registerAllBlocks();

const short = getManifest("shorts_spinoff");
const cleanup = getManifest("cleanup");
assert(short && cleanup, "Short release and cleanup blocks must be registered");

for (const key of [
  "videoKey",
  "videoLocalPath",
  "sentenceTimings",
  "watchUrl",
  "qaPassed",
  "qualityEvidence",
  "finalMasterReleaseCertificateKey",
]) {
  assert(key in short.consumes, `shorts_spinoff must require certified parent input ${key}`);
}
for (const key of [
  "shortKey",
  "shortVideoId",
  "shortReleaseCertificateReference",
  "shortReleaseCertificateKey",
]) {
  assert(key in short.optionalProduces, `shorts_spinoff must durably expose ${key} only after a successful upload`);
}
assert.equal(short.costAndLatency.paid, true, "the mandatory post-transform review must reserve a real cost envelope");
assert(short.costAndLatency.maxCostUsdFor, "the Short release review must have a bounded declared cost");
assert.equal(short.qualityContract.required, true, "Short release evidence must be a fail-closed quality contract");
assert.equal(short.qualityContract.failClosed, true);
assert(
  short.securityAndSideEffects.effects.includes("publish_media"),
  "the publishing side effect remains visible to policy/approval controls",
);

for (const key of ["shortKey", "shortReleaseCertificateKey"]) {
  assert(key in cleanup.optionalConsumes, `cleanup must retain an uploaded derivative's ${key}`);
}
for (const key of [
  "shortKey",
  "shortVideoId",
  "shortReleaseCertificateReference",
  "shortReleaseCertificateKey",
]) {
  assert.equal(
    artifactContract(key).persist,
    key === "shortVideoId" ? "inline" : "reference",
    `${key} must be persistable instead of an opaque transient result`,
  );
}

assert.doesNotThrow(() => assertShortReleaseStructuralEvidence({
  hasVideo: true,
  hasAudio: true,
  width: 1080,
  height: 1920,
  durationSec: 45,
  expectedDurationSec: 45,
  integratedLufs: -16,
}));
assert.throws(
  () => assertShortReleaseStructuralEvidence({
    hasVideo: true,
    hasAudio: false,
    width: 1080,
    height: 1920,
    durationSec: 45,
    expectedDurationSec: 45,
    integratedLufs: -16,
  }),
  /structurally invalid/,
  "a derivative without audio must stop before connector lookup",
);

const masterSha256 = "a".repeat(64);
const validReview = {
  ran: true,
  verdict: "pass",
  referenceCriteriaComplete: true,
  evidence: {
    source: { durationSec: 45, sha256: masterSha256 },
    manifestKey: "owner/alice/runs/run-short/visual-review/manifest.json",
    frames: [
      {
        r2Key: "owner/alice/runs/run-short/visual-review/frames/f001.jpg",
        contentSha256: "b".repeat(64),
        byteLength: 123,
      },
    ],
  },
  reviewFingerprint: "short-review-fingerprint",
  reviewReceiptVersion: "visual-review-receipt/v1",
  reviewReceiptFingerprint: "c".repeat(64),
  summary: "Post-transform review passed.",
  defects: [],
  focusWindows: [],
  referenceCriteria: [],
} as unknown as Parameters<typeof assertShortReleaseVisualEvidence>[0]["review"];

assert.doesNotThrow(() => assertShortReleaseVisualEvidence({
  review: validReview,
  expectedMasterSha256: masterSha256,
  actualMasterSha256: masterSha256,
}));
assert.throws(
  () => assertShortReleaseVisualEvidence({
    review: { ...validReview, verdict: "needs_human" },
    expectedMasterSha256: masterSha256,
    actualMasterSha256: masterSha256,
  }),
  /did not pass/,
  "a non-passing post-transform visual review must stop release",
);
assert.throws(
  () => assertShortReleaseVisualEvidence({
    review: {
      ...validReview,
      evidence: { ...validReview.evidence, frames: [] },
    },
    expectedMasterSha256: masterSha256,
    actualMasterSha256: masterSha256,
  }),
  /retained no evidence frames/,
  "a pass label without durable frame-byte evidence must stop release",
);

const lofi = readFileSync(join(process.cwd(), "src/trigger/blocks/lofiBlocks.ts"), "utf8");
const shortSource = lofi.slice(lofi.indexOf("export const shortsSpinoff"));
const evidenceGate = shortSource.indexOf("await persistShortReleaseEvidence(");
const durableReloadGate = shortSource.indexOf("await verifyShortReleaseEvidenceForUpload(");
const connectorLookup = shortSource.indexOf("requireYouTubeConnector(client");
const upload = shortSource.indexOf("await uploadDurableVideo(");
assert(
  evidenceGate >= 0 &&
    durableReloadGate > evidenceGate &&
    connectorLookup > durableReloadGate &&
    upload > connectorLookup,
  "a Short release-evidence failure must stop before connector lookup and upload dispatch",
);
assert.match(
  shortSource,
  /assertParentMasterReadyForShort\(ctx\)[\s\S]*?verifyFinalMasterReleaseEvidenceForUpload\(ctx, src, videoKey\)[\s\S]*?persistShortReleaseEvidence\([\s\S]*?verifyShortReleaseEvidenceForUpload\([\s\S]*?requireYouTubeConnector\(client[\s\S]*?uploadDurableVideo\(/,
  "the actual upload path must verify both the parent and post-transform proof before dispatch",
);
assert.match(
  lofi,
  /loadDurableShortReleaseCertificate\(ctx\)[\s\S]*?additionalCertificates:[\s\S]*?keepKinds: \["video", "thumbnail", "derived_short"\]/,
  "cleanup must retain a completed Short's independent release evidence and Library asset",
);
assert.match(
  lofi,
  /loadDurableShortReleaseCertificate\(ctx\)[\s\S]*?verifyFinalMasterNarrationAuditIfPresent\([\s\S]*?bytesSha256\(await getObjectBytes\(shortRelease\.durableCertificate\.finalMaster\.r2Key\)\)[\s\S]*?pruneRunObjectsWithVerifiedFinalMasterEvidence/,
  "cleanup must revalidate the derivative narration audit and durable Short bytes before deletion",
);
assert.match(
  lofi,
  /async function verifyShortReleaseEvidenceForUpload[\s\S]*?verifyFinalMasterNarrationAuditIfPresent\([\s\S]*?bytesSha256\(await getObjectBytes\(args\.shortKey\)\)[\s\S]*?fileSha256\(args\.filePath\)/,
  "connector admission must bind transcript proof, R2 object bytes, and local upload bytes to the Short certificate",
);

console.log("Short post-transform release-evidence wiring tests passed");
