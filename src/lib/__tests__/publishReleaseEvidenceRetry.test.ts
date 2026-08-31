import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Id } from "../../../convex/_generated/dataModel";
import {
  FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  createFinalMasterReleaseCertificate,
  createVisualReviewReleaseReceipt,
  finalMasterReleaseCertificateKey,
  visualReviewReleaseReceiptKey,
} from "@/lib/finalMasterReleaseCertificate";
import {
  PublishReleaseEvidenceError,
  resolvePublishIntentReleaseEvidenceBinding,
  verifyPublishIntentReleaseEvidence,
} from "@/lib/publishReleaseEvidence";

const keyPrefix = "owner/alice/channel/narrated/";
const runId = "run-publish-release-evidence" as Id<"runs">;
const channelId = "channel-publish-release-evidence" as Id<"channels">;
const ownerId = "owner-alice";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function buildFixture() {
  const masterBytes = Buffer.from("sealed publish retry master");
  const masterSha256 = sha256(masterBytes);
  const reviewFingerprint = "publish-retry-review";
  const evidenceManifestKey = `${keyPrefix}runs/${runId}/visual-review/${reviewFingerprint}/manifest.json`;
  const frameBytes = [Buffer.from("review-frame-one"), Buffer.from("review-frame-two")];
  const frameArtifacts = frameBytes.map((bytes, index) => ({
    r2Key: `${keyPrefix}runs/${runId}/visual-review/${reviewFingerprint}/frames/f00${index + 1}.jpg`,
    contentSha256: sha256(bytes),
    byteLength: bytes.byteLength,
  }));
  const receipt = createVisualReviewReleaseReceipt({
    reviewFingerprint,
    reviewReceiptVersion: "visual-review-receipt/v1",
    reviewReceiptFingerprint: "b".repeat(64),
    verdict: "pass",
    summary: "The retained review passed.",
    defects: [],
    focusWindows: [],
    referenceCriteria: [],
    referenceCriteriaComplete: true,
    evidence: {
      source: { durationSec: 31, sha256: masterSha256 },
      manifestKey: evidenceManifestKey,
      frameKeys: frameArtifacts.map((frame) => frame.r2Key),
      frameArtifacts,
    },
  });
  const receiptKey = visualReviewReleaseReceiptKey(
    keyPrefix,
    String(runId),
    receipt.releaseReceiptFingerprint,
  );
  const certificate = createFinalMasterReleaseCertificate({
    version: FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
    finalMaster: {
      r2Key: `${keyPrefix}runs/${runId}/final.mp4`,
      sha256: masterSha256,
      byteLength: masterBytes.byteLength,
      durationSec: 31,
    },
    visualReview: {
      evidenceManifestKey,
      evidenceFrameKeys: frameArtifacts.map((frame) => frame.r2Key),
      evidenceFrameArtifacts: frameArtifacts,
      receiptKey,
      reviewFingerprint,
      reviewReceiptVersion: receipt.reviewReceiptVersion,
      reviewReceiptFingerprint: receipt.reviewReceiptFingerprint,
      releaseReceiptFingerprint: receipt.releaseReceiptFingerprint,
    },
  });
  const certificateKey = finalMasterReleaseCertificateKey(
    keyPrefix,
    String(runId),
    certificate.certificateFingerprint,
  );
  const objects = new Map<string, Buffer>([
    [certificateKey, Buffer.from(JSON.stringify(certificate))],
    [certificate.finalMaster.r2Key, masterBytes],
    [receiptKey, Buffer.from(JSON.stringify(receipt))],
    [evidenceManifestKey, Buffer.from(JSON.stringify({
      source: { durationSec: 31, sha256: masterSha256 },
      manifestKey: evidenceManifestKey,
      frames: frameArtifacts,
    }))],
    [frameArtifacts[0].r2Key, frameBytes[0]],
    [frameArtifacts[1].r2Key, frameBytes[1]],
  ]);
  return { certificate, certificateKey, frameArtifacts, masterBytes, objects };
}

function intent(
  fixture: ReturnType<typeof buildFixture>,
  mode: "bound" | "legacy" = "bound",
) {
  return {
    ownerId,
    channelId,
    runId,
    videoArtifactId: `sha256:${fixture.certificate.finalMaster.sha256}`,
    videoArtifactKey: fixture.certificate.finalMaster.r2Key,
    videoSha256: fixture.certificate.finalMaster.sha256,
    ...(mode === "bound"
      ? {
          releaseEvidenceCertificateKey: fixture.certificateKey,
          releaseEvidenceCertificateFingerprint: fixture.certificate.certificateFingerprint,
        }
      : {}),
  };
}

function recordedRun(fixture: ReturnType<typeof buildFixture>) {
  return {
    ownerId,
    channelId,
    releaseEvidenceStatus: "release_evidence_recorded",
    releaseEvidenceCertificateKey: fixture.certificateKey,
    releaseEvidenceCertificateFingerprint: fixture.certificate.certificateFingerprint,
  };
}

function getObjectBytes(objects: Map<string, Buffer>) {
  return async (key: string): Promise<Uint8Array> => {
    const bytes = objects.get(key);
    if (!bytes) throw new Error(`missing object: ${key}`);
    return bytes;
  };
}

function getObjectIntegrity(objects: Map<string, Buffer>) {
  return async (key: string) => {
    const bytes = objects.get(key);
    if (!bytes) throw new Error(`missing object: ${key}`);
    return { sha256: sha256(bytes), byteLength: bytes.byteLength };
  };
}

function headObjectMetadata(objects: Map<string, Buffer>) {
  return async (key: string) => {
    const bytes = objects.get(key);
    return bytes ? { contentLength: bytes.byteLength } : null;
  };
}

async function withLocalMaster<T>(
  fixture: ReturnType<typeof buildFixture>,
  action: (filePath: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "ysa-publish-release-evidence-"));
  const filePath = join(directory, "final.mp4");
  try {
    await writeFile(filePath, fixture.masterBytes);
    return await action(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function verify(args: {
  fixture: ReturnType<typeof buildFixture>;
  filePath: string;
  mode?: "bound" | "legacy";
  run?: ReturnType<typeof recordedRun>;
}) {
  return await verifyPublishIntentReleaseEvidence({
    intent: intent(args.fixture, args.mode),
    getRun: async () => args.run ?? recordedRun(args.fixture),
    getObjectBytes: getObjectBytes(args.fixture.objects),
    getObjectIntegrity: getObjectIntegrity(args.fixture.objects),
    headObjectMetadata: headObjectMetadata(args.fixture.objects),
    localFilePath: args.filePath,
  });
}

async function initialAndRetryStayBound(): Promise<void> {
  const fixture = buildFixture();
  await withLocalMaster(fixture, async (filePath) => {
    const initial = await verify({ fixture, filePath });
    const retry = await verify({ fixture, filePath });
    assert.equal(initial.binding.source, "intent");
    assert.equal(retry.binding.certificateFingerprint, fixture.certificate.certificateFingerprint);
  });
}

async function missingOrTamperedEvidenceNeverReachesUpload(): Promise<void> {
  for (const corruption of ["missing", "tampered"] as const) {
    const fixture = buildFixture();
    if (corruption === "missing") {
      fixture.objects.delete(fixture.frameArtifacts[0].r2Key);
    } else {
      fixture.objects.set(
        fixture.frameArtifacts[1].r2Key,
        Buffer.alloc(fixture.frameArtifacts[1].byteLength, 0x5a),
      );
    }
    await withLocalMaster(fixture, async (filePath) => {
      let providerUploads = 0;
      await assert.rejects(
        async () => {
          await verify({ fixture, filePath });
          providerUploads++;
        },
        PublishReleaseEvidenceError,
        `${corruption} review evidence must fail before a provider upload`,
      );
      assert.equal(providerUploads, 0, `${corruption} evidence must make zero upload calls`);
    });
  }
}

async function legacyRowsNeedExactRunEvidence(): Promise<void> {
  const fixture = buildFixture();
  await withLocalMaster(fixture, async (filePath) => {
    const result = await verify({ fixture, filePath, mode: "legacy" });
    assert.equal(result.binding.source, "legacy_run");
    await assert.rejects(
      () => verify({
        fixture,
        filePath,
        mode: "legacy",
        run: {
          ...recordedRun(fixture),
          releaseEvidenceStatus: "evidence_incomplete",
        },
      }),
      PublishReleaseEvidenceError,
      "a legacy row may not infer release evidence from a non-recorded run",
    );
  });
}

async function mismatchedBindingsFailClosed(): Promise<void> {
  const fixture = buildFixture();
  assert.throws(
    () => resolvePublishIntentReleaseEvidenceBinding({
      releaseEvidenceCertificateKey: fixture.certificateKey,
    }),
    PublishReleaseEvidenceError,
    "initial intent creation requires the complete immutable evidence pair",
  );
  await withLocalMaster(fixture, async (filePath) => {
    await assert.rejects(
      () => verify({
        fixture,
        filePath,
        run: {
          ...recordedRun(fixture),
          releaseEvidenceCertificateFingerprint: "f".repeat(64),
        },
      }),
      PublishReleaseEvidenceError,
      "an intent/run certificate mismatch must never become a retry upload",
    );
  });
}

async function creationAndDispatcherWiringStayFailClosed(): Promise<void> {
  const [lofi, intents, dispatcher] = await Promise.all([
    readFile("src/trigger/blocks/lofiBlocks.ts", "utf8"),
    readFile("convex/publishIntents.ts", "utf8"),
    readFile("src/lib/publishDispatcher.ts", "utf8"),
  ]);
  assert.match(
    lofi,
    /api\.publishIntents\.createOrGet[\s\S]*releaseEvidenceCertificateKey:[\s\S]*releaseEvidenceCertificateFingerprint:/,
    "initial intent creation must persist the exact final-master certificate pointer",
  );
  assert.match(
    intents,
    /releaseEvidenceCertificateKey: v\.string\(\),[\s\S]*releaseEvidenceCertificateFingerprint: v\.string\(\)/,
    "new intent creation must require a complete certificate pointer",
  );
  assert.match(
    intents,
    /existing\.releaseEvidenceCertificateKey !==\s*args\.releaseEvidenceCertificateKey[\s\S]*existing\.releaseEvidenceCertificateFingerprint !==\s*args\.releaseEvidenceCertificateFingerprint/,
    "reusing an intent with different evidence must be rejected as immutable conflict",
  );
  const verifyAt = dispatcher.indexOf("const releaseEvidence = await verifyPublishIntentReleaseEvidence");
  const connectorAt = dispatcher.indexOf("requireYouTubeConnector(convex");
  assert.ok(
    verifyAt >= 0 && connectorAt > verifyAt,
    "every dispatcher attempt must verify release evidence before connector/provider work",
  );
  assert.match(
    dispatcher,
    /error instanceof PublishReleaseEvidenceError[\s\S]*blockReleaseEvidence[\s\S]*status: blocked\?\.status \?\? "dead_letter"/,
    "invalid evidence must terminal-block instead of entering retry_wait",
  );
}

async function main() {
  await initialAndRetryStayBound();
  await missingOrTamperedEvidenceNeverReachesUpload();
  await legacyRowsNeedExactRunEvidence();
  await mismatchedBindingsFailClosed();
  await creationAndDispatcherWiringStayFailClosed();
  console.log("Publish release-evidence retry tests passed");
}

void main();
