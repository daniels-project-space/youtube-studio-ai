import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import {
  assertReleaseCertificateVisualReviewBindings, assertVisualReviewReleaseReceipt,
  createFinalMasterReleaseCertificate, createVisualReviewReleaseReceipt,
  FINAL_MASTER_RELEASE_CERTIFICATE_VERSION, visualReviewManifestFingerprint,
  visualReviewReleaseReceiptKey, verifyFinalMasterReleaseEvidenceObjects,
} from "../finalMasterReleaseCertificate";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const prefix = "owners/manifest-fixture/", runId = "manifest-fixture";
const master = Buffer.from("synthetic master identity, not visual approval");
const frameBytes = Buffer.from("synthetic frame identity, not visual approval");
const source = { sha256: hash(master), durationSec: 90 };
const root = `${prefix}runs/${runId}/visual-review/review-fixture`;
const frame = { id: "broad-0", tSec: 3, r2Key: `${root}/frames/broad-0.jpg`,
  contentSha256: hash(frameBytes), byteLength: frameBytes.length };
const manifest = { version: "video-review/v5", source, manifestKey: `${root}/manifest.json`,
  frames: [{ ...frame, selectionReasons: ["uniform"] }],
  coverage: { maxGapSec: 45, maxAllowedGapSec: 90, focusedWindows: [], requiredFocusFrameCount: 0, missingFocusFrameCount: 0 } };
const review = { reviewFingerprint: "review-fixture", reviewReceiptVersion: "visual-review-receipt/v1",
  reviewReceiptFingerprint: "b".repeat(64), verdict: "pass", summary: "Synthetic transport fixture, not perceptual approval.",
  defects: [], focusWindows: [], referenceCriteria: [], referenceCriteriaComplete: true, evidence: manifest };

// Execute each production writer's actual constructor expression with guarded
// inputs, then exercise the real durable release reader. No provider is called.
function receiptFromCaller(file: string) {
  const sourceFile = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const calls: ts.CallExpression[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(sourceFile) === "createVisualReviewReleaseReceipt") calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile); assert.equal(calls.length, 1);
  const code = ts.transpileModule(`const result = ${calls[0].getText(sourceFile)}; result;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(code, {
    createVisualReviewReleaseReceipt, visualReviewManifestFingerprint,
    visualReview: review, review, durationSec: source.durationSec,
    finalMasterSha256AfterVisualReview: source.sha256, afterReviewSha256: source.sha256,
    visualReviewEvidenceManifestKey: manifest.manifestKey,
    sortedVisualReviewEvidenceFrameKeys: [frame.r2Key], sortedVisualReviewEvidenceFrameArtifacts: [frame],
    visualEvidence: { evidenceManifestKey: manifest.manifestKey, evidenceFrameKeys: [frame.r2Key], evidenceFrameArtifacts: [frame] },
  }) as ReturnType<typeof createVisualReviewReleaseReceipt>;
}

for (const caller of ["src/trigger/blocks/narratedBlocks.ts", "src/trigger/blocks/lofiBlocks.ts"]) {
  test(`${caller} seals the complete manifest through durable release verification`, async () => {
    const receipt = receiptFromCaller(caller);
    assert.equal(receipt.evidence.manifestFingerprint, visualReviewManifestFingerprint(manifest));
    const receiptKey = visualReviewReleaseReceiptKey(prefix, runId, receipt.releaseReceiptFingerprint);
    const certificate = createFinalMasterReleaseCertificate({ version: FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
      finalMaster: { r2Key: `${prefix}runs/${runId}/final.mp4`, sha256: source.sha256, byteLength: master.length, durationSec: source.durationSec },
      visualReview: { evidenceManifestKey: manifest.manifestKey, evidenceFrameKeys: [frame.r2Key], evidenceFrameArtifacts: [frame], receiptKey,
        reviewFingerprint: receipt.reviewFingerprint, reviewReceiptVersion: receipt.reviewReceiptVersion,
        reviewReceiptFingerprint: receipt.reviewReceiptFingerprint, releaseReceiptFingerprint: receipt.releaseReceiptFingerprint } });
    let durable: unknown = manifest;
    let reads: string[] = [];
    const verify = () => verifyFinalMasterReleaseEvidenceObjects({ certificate,
      getObjectIntegrity: async key => { assert.equal(key, certificate.finalMaster.r2Key); return { sha256: source.sha256, byteLength: master.length }; },
      getObjectBytes: async key => {
        reads.push(key);
        if (key === receiptKey) return Buffer.from(JSON.stringify(receipt));
        if (key === manifest.manifestKey) return Buffer.from(JSON.stringify(durable, null, 2));
        assert.equal(key, frame.r2Key); return frameBytes;
      },
    });
    await verify(); assert.equal(reads.length, 3, "binding must not add another storage request");
    const mutations = [
      { ...manifest, coverage: { ...manifest.coverage, maxGapSec: 900 } },
      { ...manifest, coverage: { ...manifest.coverage, missingFocusFrameCount: 1 } },
      { ...manifest, coverage: { ...manifest.coverage, focusedWindows: [{ startSec: 1, endSec: 8, reason: "altered" }] } },
      { ...manifest, source: { ...source, durationSec: 91 } },
      { ...manifest, version: "changed" },
      { ...manifest, frames: [{ ...manifest.frames[0], selectionReasons: ["changed"] }] },
      { ...manifest, futureLoopEvidence: { claimed: "unreviewed addition" } },
    ];
    for (const altered of mutations) {
      durable = altered; reads = [];
      await assert.rejects(verify(), /manifest fingerprint mismatch/);
      assert.equal(reads.length, 2, "altered manifest must stop before frame downloads");
    }
    durable = { coverage: manifest.coverage, frames: manifest.frames, manifestKey: manifest.manifestKey, source, version: manifest.version };
    await verify(); // Formatting and object-key order are not semantic changes.
    const { manifestFingerprint: _removed, ...unboundEvidence } = receipt.evidence;
    void _removed;
    assert.throws(() => assertVisualReviewReleaseReceipt({ ...receipt, evidence: unboundEvidence }), /fingerprint/);
    const { version: _version, releaseReceiptFingerprint: _fingerprint, ...input } = receipt;
    void _version; void _fingerprint;
    const downgraded = createVisualReviewReleaseReceipt({ ...input, evidence: unboundEvidence });
    assert.throws(() => assertReleaseCertificateVisualReviewBindings({ certificate, receipt: downgraded, evidenceManifest: manifest }), /does not match/);
  });
}

test("manifest fingerprint rejects invalid roots and remains stable across JSON serialization", () => {
  for (const value of [undefined, null, "manifest", []]) assert.throws(() => visualReviewManifestFingerprint(value));
  assert.equal(visualReviewManifestFingerprint(manifest), visualReviewManifestFingerprint(JSON.parse(JSON.stringify(manifest))));
});
