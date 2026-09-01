import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { artifactContract } from "@/engine/artifactSchemas";
import { registerAllBlocks } from "@/engine/blocks";
import { getManifest } from "@/engine/registry";
import {
  buildShortCaptionOnScreenTextCues,
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
for (const key of ["styleDNA", "showBible"]) {
  assert(key in short.optionalConsumes, `Short final review must retain frozen channel identity input ${key}`);
}
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

assert.deepEqual(
  buildShortCaptionOnScreenTextCues([
    { startSec: 0, endSec: 1.2, text: "A clear opening hook" },
    { startSec: 1.2, endSec: 2.4, text: "keeps the viewer watching" },
  ], 45),
  [
    { id: "short-caption-001", sampleSec: 0.6, expectedText: "A clear opening hook", minTokenCoverage: 0.8 },
    { id: "short-caption-002", sampleSec: 1.8, expectedText: "keeps the viewer watching", minTokenCoverage: 0.8 },
  ],
  "every burned caption must yield a midpoint OCR probe tied to its final timing",
);
assert.throws(
  () => buildShortCaptionOnScreenTextCues([
    { startSec: 0, endSec: 1.2, text: "Go" },
  ], 45),
  /at least two readable tokens/,
  "a Short with an unprovable one-token caption must fail before its automatic upload path",
);
assert.throws(
  () => buildShortCaptionOnScreenTextCues([
    { startSec: 44.5, endSec: 46, text: "This caption exceeds the master" },
  ], 45),
  /invalid final-master timing/,
  "caption OCR evidence must not silently clamp an invalid final-master window",
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
        id: "f001",
        tSec: 0.1,
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
const shortReviewHelper = lofi.slice(
  lofi.indexOf("async function persistShortReleaseEvidence"),
  lofi.indexOf("export const shortsSpinoff"),
);
assert.match(
  shortReviewHelper,
  /channelVisualReviewProfile\(\{[\s\S]*?requireSpecificLaneProfile:\s*true/,
  "the post-transform Short release gate must reject an unregistered lane profile instead of falling back to generic visual QA",
);
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
  /loadDurableShortReleaseCertificate\(ctx\)[\s\S]*?verifyFinalMasterNarrationAuditIfPresent\([\s\S]*?pruneRunObjectsWithVerifiedFinalMasterEvidence\([\s\S]*?getObjectIntegrity/,
  "cleanup must revalidate the derivative narration audit and stream/hash durable Short bytes before deletion",
);
assert.match(
  lofi,
  /async function verifyShortReleaseEvidenceForUpload[\s\S]*?verifyFinalMasterReleaseEvidenceForLocalUpload\([\s\S]*?filePath: args\.filePath[\s\S]*?verifyFinalMasterNarrationAuditIfPresent\(/,
  "connector admission must hash the exact local Short source, bind transcript proof, and preserve durable review-frame verification",
);
assert.match(
  lofi,
  /const captionTextCues = buildShortCaptionOnScreenTextCues\(args\.captionCues, structural\.durationSec\)[\s\S]*?await proveOnScreenText\([\s\S]*?if \(!onScreenText\.passed[\s\S]*?onScreenText,[\s\S]*?shortsOpeningEvidence,[\s\S]*?\}\);/,
  "the post-transform Short must seal passing timed OCR caption evidence into its release certificate",
);
assert.match(
  lofi,
  /async function verifyShortReleaseEvidenceForUpload[\s\S]*?!certificate\.onScreenText[\s\S]*?lacks passing burned-caption OCR evidence[\s\S]*?await verifyFinalMasterReleaseEvidenceForLocalUpload/,
  "a durable Short certificate without passing burned-caption OCR evidence must stop before connector admission",
);
assert.match(
  lofi,
  /planShortsOpeningCaptionEvidence\([\s\S]*?overlays: \[\{[\s\S]*?createShortsOpeningEvidence\([\s\S]*?shortsOpeningEvidence,[\s\S]*?createFinalMasterReleaseCertificate/,
  "only the Short post-transform review must bind its timed opening caption into a durable opening-evidence receipt",
);
assert.match(
  lofi,
  /async function verifyShortReleaseEvidenceForUpload[\s\S]*?!certificate\.shortsOpeningEvidence[\s\S]*?lacks opening timing evidence[\s\S]*?verifyFinalMasterReleaseEvidenceForLocalUpload/,
  "a Short certificate lacking the lane-scoped opening receipt must stop before connector admission",
);

assert.match(
  shortSource,
  /verifyFinalMasterReleaseEvidenceForUpload\(ctx, src, videoKey\)[\s\S]*?selectNarrativeShortSource\([\s\S]*?narrativeSelection\.kind === "not_safe"[\s\S]*?makeVerticalClip\(src, raw, \{ startSec: sourceStartSec, durSec \}\)/,
  "a serialized derivative must select one release-bound Episode-Graph window after parent verification and before transform spend",
);
assert.match(
  shortSource,
  /persistShortReleaseEvidence\(\{[\s\S]*?narrativeSelection\.kind === "selected"[\s\S]*?narrativeShortOrigin: narrativeSelection\.origin/,
  "the selected narrative beat must be sealed into the post-transform Short certificate",
);
assert.match(
  shortSource,
  /const publishShort = narrativeSelection\.kind === "selected"\s*\? false[\s\S]*?privacyStatus: publishShort \? "public" : "private"/,
  "a serialized narrative derivative is private-only even when a public Short parameter is supplied",
);
assert.match(
  shortSource,
  /narrativeSelection\.kind !== "selected" && ctx\.params\["crosspostShort"\] === true && hasAyrshareKey\(\)/,
  "a sealed narrative derivative must not enter the optional cross-post path",
);
assert.match(
  shortSource,
  /Non-serialized channels retain the existing opening-window behavior[\s\S]*?sourceStartSec = Math\.max\(0, timings\[0\]\.start\)/,
  "ordinary channels must retain their established opening-window Short selection",
);

console.log("Short post-transform release-evidence wiring tests passed");
