import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mock } from "node:test";
import { GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getFunctionName } from "convex/server";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  createFinalMasterReleaseCertificate,
  createVisualReviewReleaseReceipt,
  finalMasterReleaseCertificateFingerprint,
  finalMasterReleaseCertificateKey,
  verifyFinalMasterReleaseEvidenceForLocalUpload,
  verifyFinalMasterReleaseEvidenceObjects,
  visualReviewReleaseReceiptKey,
} from "@/lib/finalMasterReleaseCertificate";
import {
  createPackageToOpeningPlan,
  createPackageToOpeningReceipt,
} from "@/engine/packageToOpening";
import { pruneRunObjectsWithVerifiedFinalMasterEvidence } from "@/lib/runArtifactPrune";
import { ObjectDeletionError, getR2Client } from "@/lib/storage";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { sweepDueRunArtifactRetentions } from "@/trigger/runArtifactRetentionSweeper";
import { encryptSecret } from "@/lib/secretEnvelope";
import { youtubeConnectorAad } from "@/lib/youtubeConnector";
import { authorizeDeletion } from "../../../convex/runArtifactRetentions";

const keyPrefix = "owner/alice/channel/casefile/";
const runId = "run-byte-evidence";
const parentReviewFingerprint = "review-byte-evidence";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function buildFixture(kind: "parent" | "short" = "parent") {
  const isShort = kind === "short";
  const reviewFingerprint = isShort
    ? `${parentReviewFingerprint}-short`
    : parentReviewFingerprint;
  const masterName = isShort ? "short.mp4" : "final.mp4";
  const masterBytes = Buffer.from(`${kind}-released-master-bytes`);
  const masterSha256 = sha256(masterBytes);
  const evidenceManifestKey = `${keyPrefix}runs/${runId}/visual-review/${reviewFingerprint}/manifest.json`;
  const frameBytes = [
    Buffer.from(`${kind}-review-frame-one`),
    Buffer.from(`${kind}-review-frame-two`),
  ];
  const frameArtifacts = frameBytes.map((bytes, index) => ({
    id: `${kind}-frame-${index + 1}`,
    tSec: index === 0 ? 3 : 36,
    r2Key: `${keyPrefix}runs/${runId}/visual-review/${reviewFingerprint}/frames/f00${index + 1}.jpg`,
    contentSha256: sha256(bytes),
    byteLength: bytes.byteLength,
  }));
  const receipt = createVisualReviewReleaseReceipt({
    reviewFingerprint,
    reviewReceiptVersion: "visual-review-receipt/v1",
    reviewReceiptFingerprint: "b".repeat(64),
    verdict: "pass",
    summary: "Evidence-backed visual review passed.",
    defects: [],
    focusWindows: [],
    referenceCriteria: [],
    referenceCriteriaComplete: true,
    evidence: {
      source: { durationSec: 60, sha256: masterSha256 },
      manifestKey: evidenceManifestKey,
      frameKeys: frameArtifacts.map((frame) => frame.r2Key),
      frameArtifacts,
    },
  });
  const receiptKey = visualReviewReleaseReceiptKey(
    keyPrefix,
    runId,
    receipt.releaseReceiptFingerprint,
  );
  const thumbnailBytes = Buffer.from(`${kind}-package-thumbnail-bytes`);
  const thumbnailKey = `${keyPrefix}runs/${runId}/${kind}-thumbnail.webp`;
  const packagePlan = createPackageToOpeningPlan({
    title: `${kind} released title`,
    thumbnailDescription: `${kind} thumbnail uses a single clear, high-contrast subject and no baked text for a readable package image.`,
    topic: `${kind} released topic`,
    route: { version: "test-route/v1", family: "narrated_stock" },
    script: { hook: `${kind} opening hook`, hookLoop: `${kind} declared promise` },
  });
  const packageToOpening = createPackageToOpeningReceipt({
    plan: packagePlan,
    finalMaster: { sha256: masterSha256, durationSec: 60 },
    thumbnail: {
      r2Key: thumbnailKey,
      sha256: sha256(thumbnailBytes),
      byteLength: thumbnailBytes.byteLength,
    },
    visualReview: {
      reviewFingerprint,
      reviewReceiptVersion: receipt.reviewReceiptVersion,
      reviewReceiptFingerprint: receipt.reviewReceiptFingerprint,
      releaseReceiptFingerprint: receipt.releaseReceiptFingerprint,
      evidenceFrameArtifacts: frameArtifacts,
    },
  });
  const certificate = createFinalMasterReleaseCertificate({
    version: FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
    finalMaster: {
      r2Key: `${keyPrefix}runs/${runId}/${masterName}`,
      sha256: masterSha256,
      byteLength: masterBytes.byteLength,
      durationSec: 60,
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
    packageToOpening,
  });
  const certificateKey = finalMasterReleaseCertificateKey(
    keyPrefix,
    runId,
    certificate.certificateFingerprint,
  );
  const objects = new Map<string, Buffer>([
    [certificateKey, Buffer.from(JSON.stringify(certificate))],
    [certificate.finalMaster.r2Key, masterBytes],
    [thumbnailKey, thumbnailBytes],
    [receiptKey, Buffer.from(JSON.stringify(receipt))],
    [evidenceManifestKey, Buffer.from(JSON.stringify({
      source: { durationSec: 60, sha256: masterSha256 },
      manifestKey: evidenceManifestKey,
      frames: frameArtifacts,
    }))],
    [frameArtifacts[0].r2Key, frameBytes[0]],
    [frameArtifacts[1].r2Key, frameBytes[1]],
    [
      `${keyPrefix}runs/${runId}/intermediates/${kind}-scene-01.mp4`,
      Buffer.from("replaceable intermediate"),
    ],
  ]);
  return {
    certificate,
    certificateKey,
    frameArtifacts,
    frameBytes,
    masterBytes,
    thumbnailKey,
    thumbnailBytes,
    objects,
  };
}

function getObjectBytes(objects: Map<string, Buffer>) {
  return async (key: string): Promise<Uint8Array> => {
    const bytes = objects.get(key);
    if (!bytes) throw new Error("object not found");
    return bytes;
  };
}

function getObjectIntegrity(objects: Map<string, Buffer>) {
  return async (key: string) => {
    const bytes = objects.get(key);
    if (!bytes) throw new Error("object not found");
    return { sha256: sha256(bytes), byteLength: bytes.byteLength };
  };
}

function headObjectMetadata(objects: Map<string, Buffer>) {
  return async (key: string) => {
    const bytes = objects.get(key);
    return bytes ? { contentLength: bytes.byteLength } : null;
  };
}

async function localUploadVerifierAvoidsR2MasterRestream(): Promise<void> {
  const valid = buildFixture();
  const directory = await mkdtemp(join(tmpdir(), "ysa-local-release-evidence-"));
  const filePath = join(directory, "final.mp4");
  try {
    await writeFile(filePath, valid.masterBytes);
    // The upload verifier is allowed to use the exact local source instead of
    // re-streaming the master, but every compact proof object stays durable.
    const reads: string[] = [];
    const heads: string[] = [];
    await assert.doesNotReject(
      () => verifyFinalMasterReleaseEvidenceForLocalUpload({
        certificate: valid.certificate,
        filePath,
        getObjectBytes: async (key) => {
          reads.push(key);
          return getObjectBytes(valid.objects)(key);
        },
        headObjectMetadata: async (key) => {
          heads.push(key);
          return headObjectMetadata(valid.objects)(key);
        },
      }),
      "the exact local upload source may satisfy the sealed master receipt without a duplicate R2 stream",
    );
    assert.equal(
      reads.includes(valid.certificate.finalMaster.r2Key),
      false,
      "local upload verification must not fetch the full master from R2 again",
    );
    assert.deepEqual(
      heads,
      [valid.certificate.finalMaster.r2Key],
      "local upload verification retains a lightweight durable-object availability fence",
    );
    assert.equal(
      reads.length,
      valid.frameArtifacts.length + 3,
      "the local fast path must still re-read the durable review receipt, manifest, every reviewed frame, and package thumbnail",
    );

    const legacyInput = {
      version: valid.certificate.version,
      finalMaster: {
        r2Key: valid.certificate.finalMaster.r2Key,
        sha256: valid.certificate.finalMaster.sha256,
        durationSec: valid.certificate.finalMaster.durationSec,
      },
      visualReview: valid.certificate.visualReview,
    };
    const legacyCertificate = {
      ...legacyInput,
      certificateFingerprint: finalMasterReleaseCertificateFingerprint(legacyInput),
    };
    await assert.rejects(
      () => verifyFinalMasterReleaseEvidenceForLocalUpload({
        certificate: legacyCertificate,
        filePath,
        getObjectBytes: getObjectBytes(valid.objects),
        headObjectMetadata: headObjectMetadata(valid.objects),
      }),
      /lacks a byte-bound final-master receipt/,
      "legacy certificates without a byte-bound master remain ineligible for the local upload fast path",
    );

    // A retry recomputes local bytes rather than trusting a stale digest from
    // the first attempt, so a same-length replacement cannot be uploaded.
    await writeFile(filePath, Buffer.alloc(valid.masterBytes.byteLength, 0x5a));
    await assert.rejects(
      () => verifyFinalMasterReleaseEvidenceForLocalUpload({
        certificate: valid.certificate,
        filePath,
        getObjectBytes: getObjectBytes(valid.objects),
        headObjectMetadata: headObjectMetadata(valid.objects),
      }),
      /local final-master upload source bytes do not match receipt/,
      "a same-length local replacement must fail on a later upload retry",
    );

    const missingFrame = buildFixture();
    await writeFile(filePath, missingFrame.masterBytes);
    missingFrame.objects.delete(missingFrame.frameArtifacts[0].r2Key);
    await assert.rejects(
      () => verifyFinalMasterReleaseEvidenceForLocalUpload({
        certificate: missingFrame.certificate,
        filePath,
        getObjectBytes: getObjectBytes(missingFrame.objects),
        headObjectMetadata: headObjectMetadata(missingFrame.objects),
      }),
      /evidence frame is unavailable/,
      "the local master fast path must still fail closed when any retained review frame disappeared",
    );

    const missingMaster = buildFixture();
    await writeFile(filePath, missingMaster.masterBytes);
    missingMaster.objects.delete(missingMaster.certificate.finalMaster.r2Key);
    await assert.rejects(
      () => verifyFinalMasterReleaseEvidenceForLocalUpload({
        certificate: missingMaster.certificate,
        filePath,
        getObjectBytes: getObjectBytes(missingMaster.objects),
        headObjectMetadata: headObjectMetadata(missingMaster.objects),
      }),
      /final-master release object is unavailable/,
      "the upload fast path must preserve the durable R2 availability fence",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function pruneFixture(
  fixture: ReturnType<typeof buildFixture>,
  additionalFixtures: Array<ReturnType<typeof buildFixture>> = [],
  overrides: {
    list?: (keys: string[]) => string[];
    delete?: (keys: string[], objects: Map<string, Buffer>) => Promise<number>;
  } = {},
) {
  const objects = new Map(fixture.objects);
  for (const additional of additionalFixtures) {
    for (const [key, bytes] of additional.objects) objects.set(key, bytes);
  }
  const deleteCalls: string[][] = [];
  const result = await pruneRunObjectsWithVerifiedFinalMasterEvidence({
    keyPrefix,
    runId,
    certificateKey: fixture.certificateKey,
    certificate: fixture.certificate,
    ...(additionalFixtures.length > 0
      ? {
          additionalCertificates: additionalFixtures.map((additional) => ({
            certificateKey: additional.certificateKey,
            certificate: additional.certificate,
          })),
        }
      : {}),
    keepNames: ["final.mp4", "thumbnail.jpg"],
    getObjectBytes: getObjectBytes(objects),
    getObjectIntegrity: getObjectIntegrity(objects),
    listObjects: async (prefix) => {
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix));
      return overrides.list ? overrides.list(keys) : keys;
    },
    deleteObjects: async (keys) => {
      deleteCalls.push([...keys]);
      if (overrides.delete) return overrides.delete(keys, objects);
      for (const key of keys) objects.delete(key);
      return keys.length;
    },
  });
  return { result, deleteCalls, objects };
}

/** Runs the actual sweeper → certificate checks → storage SDK wrapper boundary. */
async function retentionWorkerDeletionOutcomes() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const env = {
    R2_ACCOUNT_ID: "fixture", R2_ENDPOINT: "https://storage-fixture.invalid", R2_ACCESS_KEY_ID: "fixture",
    R2_SECRET_ACCESS_KEY: "fixture", R2_BUCKET: "fixture", STUDIO_OWNER_ID: "alice",
    STUDIO_CONVEX_JWT_PRIVATE_KEY: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    NEXT_PUBLIC_CONVEX_URL: "https://retention-fixture.convex.cloud",
    VAULT_URL: "https://vault-fixture.invalid", VAULT_ACCESS_TOKEN: "fixture",
    INTERNAL_QUERY_SECRET: "fixture", YOUTUBE_CLIENT_ID: "fixture", YOUTUBE_CLIENT_SECRET: "fixture",
    YOUTUBE_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    for (const mode of ["partial", "complete", "asset-row-failure", "locked-during-verification",
      "expired-during-verification", "private-at-deletion", "connector-changed", "run-changed", "provider-unavailable",
      "empty-retry", "empty-retry-locked"] as const) {
      const empty = mode.startsWith("empty-retry");
      const completed = mode === "complete" || mode === "empty-retry";
      const denied = !["partial", "complete", "asset-row-failure", "empty-retry"].includes(mode);
      const f = buildFixture();
      f.objects.set(`${keyPrefix}runs/${runId}/intermediates/parent-scene-02.mp4`, Buffer.from("second intermediate"));
      if (empty) for (const key of f.objects.keys()) {
        if (key.includes("/intermediates/")) f.objects.delete(key);
      }
      const operations: string[] = [];
      const events: string[] = [];
      const publishedAt = new Date(Date.now() - 15 * 86_400_000).toISOString();
      const retention: Record<string, unknown> = {
        _id: "retention-fixture", ownerId: "alice", channelId: "channel-fixture", runId,
        keyPrefix, certificateKey: f.certificateKey, additionalCertificateKeys: [], keepNames: ["final.mp4"],
        status: "processing", leaseExpiresAt: Date.now() + 90 * 60_000,
        releaseVideoId: "abcdefghijk", releaseYouTubeChannelId: "UC-fixture", releaseObservationAt: Date.now(),
      };
      const channel = { _id: "channel-fixture", ownerId: "alice", slug: "casefile", locked: false };
      const run = { _id: runId, ownerId: "alice", channelId: "channel-fixture", youtubeVideoId: "abcdefghijk",
        releaseEvidenceStatus: "release_evidence_recorded", releaseEvidenceCertificateKey: f.certificateKey };
      const connector = { _id: "connector-fixture", ownerId: "alice", channelId: "channel-fixture",
        tokenVersion: 4, ytChannelId: "UC-fixture", status: "active",
        refreshTokenCiphertext: encryptSecret("fixture-refresh-token", {
          envName: "YOUTUBE_TOKEN_ENCRYPTION_KEY", aad: youtubeConnectorAad("alice", "channel-fixture"),
        }) };
      const records = new Map<string, Record<string, unknown>>([
        ["retention-fixture", retention], [channel._id, channel], [runId, run], [connector._id, connector],
      ]);
      const authorityCtx = {
        auth: { getUserIdentity: async () => ({ role: "service", owner_id: "alice", subject: "service:youtube-studio-ai" }) },
        db: { get: async (id: string) => records.get(id) ?? null,
          normalizeId: (_table: string, id: string) => records.has(id) ? id : null,
          patch: async (id: string, patch: Record<string, unknown>) => { Object.assign(records.get(id)!, patch); } },
      };
      const fetchMock = mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
        if (url === "https://vault-fixture.invalid/api/query") return Response.json({ status: "success", value: [] });
        if (url === "https://oauth2.googleapis.com/token") {
          assert.equal(new URLSearchParams(String(init?.body)).get("refresh_token"), "fixture-refresh-token");
          return Response.json({ access_token: "fixture-access", expires_in: 3600 });
        }
        assert.ok(url.startsWith("https://www.googleapis.com/youtube/v3/videos?"), "unexpected network request");
        assert.equal(new URL(url).searchParams.get("id"), "abcdefghijk");
        assert.ok(events.includes("listed"), "fresh provider observation follows byte verification and listing");
        events.push("observed");
        if (mode === "provider-unavailable") return new Response(null, { status: 503 });
        if (mode === "connector-changed") connector.tokenVersion = 5;
        if (mode === "run-changed") run.youtubeVideoId = "other-video";
        return Response.json({ items: [{ id: "abcdefghijk", snippet: { channelId: "UC-fixture", publishedAt },
          status: { privacyStatus: mode === "private-at-deletion" ? "private" : "public", uploadStatus: "processed" } }] });
      });
      const storage = mock.method(getR2Client(), "send", async (command: unknown) => {
        if (command instanceof GetObjectCommand) {
          const bytes = f.objects.get(command.input.Key!);
          assert.ok(bytes, "only exact existing evidence may be read");
          return { Body: { transformToByteArray: async () => bytes,
            [Symbol.asyncIterator]: async function* () { yield bytes; } } };
        }
        if (command instanceof ListObjectsV2Command) {
          assert.equal(command.input.Prefix, `${keyPrefix}runs/${runId}/`);
          events.push("listed");
          if (mode === "locked-during-verification" || mode === "empty-retry-locked") channel.locked = true;
          if (mode === "expired-during-verification") retention.leaseExpiresAt = Date.now() - 1;
          return { Contents: [...f.objects.keys()].map((Key) => ({ Key })), IsTruncated: false };
        }
        assert.ok(command instanceof DeleteObjectsCommand);
        assert.equal(empty, false, "a retry with only retained evidence must not send an empty deletion request");
        assert.equal(events.at(-1), "authorized", "storage must follow the real authority handler");
        events.push("deleted");
        assert.equal(command.input.Delete?.Quiet, false);
        const rows = command.input.Delete!.Objects!;
        assert.equal(rows.length, 2);
        assert.ok(rows.every((row) => row.Key?.includes("/intermediates/")));
        const deleted = mode === "partial" ? rows.slice(0, 1) : rows;
        for (const row of deleted) f.objects.delete(row.Key!);
        return { $metadata: { httpStatusCode: 200 }, Deleted: deleted,
          Errors: mode === "partial" ? [{ ...rows[1], Code: "AccessDenied" }] : [] };
      });
      const query = mock.method(StudioConvexHttpClient.prototype, "query", async (reference: never) => {
        const name = getFunctionName(reference);
        if (name === "runArtifactRetentions:listReleaseChecks") return [];
        assert.equal(name, "youtubeAuth:getForChannel");
        return connector;
      });
      const mutation = mock.method(StudioConvexHttpClient.prototype, "mutation", async (reference: never, args: Record<string, unknown>) => {
        const name = getFunctionName(reference);
        operations.push(name);
        if (name === "runArtifactRetentions:claimDue") {
          retention.leaseToken = args.leaseToken;
          return retention;
        }
        if (name === "runArtifactRetentions:authorizeDeletion") {
          const grant = await (authorizeDeletion as unknown as {
            _handler: (ctx: unknown, args: unknown) => Promise<{ expiresAt: number }>;
          })._handler(authorityCtx, args);
          events.push("authorized");
          return grant;
        }
        if (name === "assets:pruneRun") {
          if (mode === "asset-row-failure") throw new Error("controlled asset-row write failure");
          return null;
        }
        if (name === "runArtifactRetentions:complete") {
          assert.equal(args.removedObjects, empty ? 0 : 2);
          assert.equal(args.retainedObjectCount, 7);
          return { status: "completed" };
        }
        assert.equal(name, "runArtifactRetentions:fail");
        return { status: "pending" };
      });
      try {
        const result = await sweepDueRunArtifactRetentions({ limit: 1 });
        assert.deepEqual(result, { claimed: 1, completed: completed ? 1 : 0,
          blocked: 0, removedObjects: denied || empty ? 0 : mode === "partial" ? 1 : 2 });
        assert.deepEqual(operations, ["runArtifactRetentions:claimDue",
          ...(mode === "provider-unavailable" ? [] : ["runArtifactRetentions:authorizeDeletion"]),
          ...(mode === "partial" || denied ? [] : ["assets:pruneRun"]),
          completed ? "runArtifactRetentions:complete" : "runArtifactRetentions:fail"]);
        assert.equal(f.objects.size, empty ? 7 : denied ? 9 : mode === "partial" ? 8 : 7);
        assert.ok(f.objects.has(f.certificate.finalMaster.r2Key));
        assert.ok(f.objects.has(f.certificateKey));
      } finally { storage.mock.restore(); query.mock.restore(); mutation.mock.restore(); fetchMock.mock.restore(); }
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

async function main() {
  await localUploadVerifierAvoidsR2MasterRestream();

  const valid = buildFixture();
  await assert.doesNotReject(
    () => verifyFinalMasterReleaseEvidenceObjects({
      certificate: valid.certificate,
      getObjectBytes: getObjectBytes(valid.objects),
      getObjectIntegrity: getObjectIntegrity(valid.objects),
    }),
    "the exact persisted review-frame bytes must satisfy the sealed evidence receipt",
  );

  const missing = buildFixture();
  missing.objects.delete(missing.frameArtifacts[0].r2Key);
  await assert.rejects(
    () => verifyFinalMasterReleaseEvidenceObjects({
      certificate: missing.certificate,
      getObjectBytes: getObjectBytes(missing.objects),
      getObjectIntegrity: getObjectIntegrity(missing.objects),
    }),
    /evidence frame is unavailable/,
    "a missing retained frame must stop release evidence verification",
  );

  const overwrittenSameLength = buildFixture();
  overwrittenSameLength.objects.set(
    overwrittenSameLength.frameArtifacts[0].r2Key,
    Buffer.alloc(overwrittenSameLength.frameBytes[0].byteLength, 0x5a),
  );
  await assert.rejects(
    () => verifyFinalMasterReleaseEvidenceObjects({
      certificate: overwrittenSameLength.certificate,
      getObjectBytes: getObjectBytes(overwrittenSameLength.objects),
      getObjectIntegrity: getObjectIntegrity(overwrittenSameLength.objects),
    }),
    /frame bytes do not match receipt/,
    "an overwritten same-length frame must not masquerade as reviewed evidence",
  );

  const differentLength = buildFixture();
  differentLength.objects.set(
    differentLength.frameArtifacts[1].r2Key,
    Buffer.concat([differentLength.frameBytes[1], Buffer.from(" changed")]),
  );
  await assert.rejects(
    () => verifyFinalMasterReleaseEvidenceObjects({
      certificate: differentLength.certificate,
      getObjectBytes: getObjectBytes(differentLength.objects),
      getObjectIntegrity: getObjectIntegrity(differentLength.objects),
    }),
    /frame bytes do not match receipt/,
    "a different-byte-length frame must not satisfy the original review receipt",
  );

  const missingMaster = buildFixture();
  missingMaster.objects.delete(missingMaster.certificate.finalMaster.r2Key);
  await assert.rejects(
    () => verifyFinalMasterReleaseEvidenceObjects({
      certificate: missingMaster.certificate,
      getObjectBytes: getObjectBytes(missingMaster.objects),
      getObjectIntegrity: getObjectIntegrity(missingMaster.objects),
    }),
    /final-master release object is unavailable/,
    "a missing stored final master must stop release evidence verification",
  );

  const missingThumbnail = buildFixture();
  missingThumbnail.objects.delete(missingThumbnail.thumbnailKey);
  await assert.rejects(
    () => verifyFinalMasterReleaseEvidenceObjects({
      certificate: missingThumbnail.certificate,
      getObjectBytes: getObjectBytes(missingThumbnail.objects),
      getObjectIntegrity: getObjectIntegrity(missingThumbnail.objects),
    }),
    /package-to-opening thumbnail is unavailable/,
    "a missing package thumbnail must stop a later release retry",
  );

  const overwrittenThumbnail = buildFixture();
  overwrittenThumbnail.objects.set(
    overwrittenThumbnail.thumbnailKey,
    Buffer.alloc(overwrittenThumbnail.thumbnailBytes.byteLength, 0x5a),
  );
  await assert.rejects(
    () => verifyFinalMasterReleaseEvidenceObjects({
      certificate: overwrittenThumbnail.certificate,
      getObjectBytes: getObjectBytes(overwrittenThumbnail.objects),
      getObjectIntegrity: getObjectIntegrity(overwrittenThumbnail.objects),
    }),
    /package-to-opening thumbnail bytes do not match the sealed receipt/,
    "a same-length thumbnail replacement must not masquerade as the selected package art",
  );

  const replacedMaster = buildFixture();
  replacedMaster.objects.set(
    replacedMaster.certificate.finalMaster.r2Key,
    Buffer.alloc(replacedMaster.masterBytes.byteLength, 0x5a),
  );
  await assert.rejects(
    () => verifyFinalMasterReleaseEvidenceObjects({
      certificate: replacedMaster.certificate,
      getObjectBytes: getObjectBytes(replacedMaster.objects),
      getObjectIntegrity: getObjectIntegrity(replacedMaster.objects),
    }),
    /final-master release object bytes do not match receipt/,
    "a same-length replacement must not masquerade as the reviewed final master",
  );

  const mismatchedMaster = buildFixture();
  mismatchedMaster.objects.set(
    mismatchedMaster.certificate.finalMaster.r2Key,
    Buffer.concat([mismatchedMaster.masterBytes, Buffer.from(" changed")]),
  );
  await assert.rejects(
    () => verifyFinalMasterReleaseEvidenceObjects({
      certificate: mismatchedMaster.certificate,
      getObjectBytes: getObjectBytes(mismatchedMaster.objects),
      getObjectIntegrity: getObjectIntegrity(mismatchedMaster.objects),
    }),
    /final-master release object bytes do not match receipt/,
    "a byte-length mismatch must not satisfy the final-master receipt",
  );

  const validCleanup = await pruneFixture(buildFixture());
  assert.equal(validCleanup.result.cleaned, true, "cleanup may proceed only after all evidence bytes revalidate");
  assert.deepEqual(
    validCleanup.deleteCalls,
    [[`${keyPrefix}runs/${runId}/intermediates/parent-scene-01.mp4`]],
    "cleanup must retain the certificate, receipt, manifest, frames, and final master",
  );
  assert.equal(validCleanup.objects.size, 7);
  assert.equal(validCleanup.result.retainedObjectCount, 7);
  for (const key of validCleanup.result.retainedReleaseEvidence) assert.ok(validCleanup.objects.has(key));

  for (const badKey of ["owner/bob/channel/other/runs/other/final.mp4", `${keyPrefix}runs/${runId}-other/a`, `${keyPrefix}runs/${runId}/`]) {
    const badListing = await pruneFixture(buildFixture(), [], { list: (keys) => [...keys, badKey] });
    assert.equal(badListing.result.cleaned, false);
    assert.equal(badListing.result.removedObjects, 0);
    assert.equal(badListing.deleteCalls.length, 0, "listing must be scoped before any destructive request");
  }
  const duplicateListing = await pruneFixture(buildFixture(), [], { list: (keys) => [...keys, keys[0]] });
  assert.equal(duplicateListing.result.cleaned, false);
  assert.equal(duplicateListing.deleteCalls.length, 0);

  for (const deleted of [0, -1, 2, NaN, 0.5]) {
    const shortDelete = await pruneFixture(buildFixture(), [], { delete: async () => deleted });
    assert.equal(shortDelete.result.cleaned, false, "only an exact acknowledgement count may complete cleanup");
    assert.equal(shortDelete.result.removedObjects, 0);
    assert.equal(shortDelete.result.retainedObjectCount, 7);
  }

  const partialFixture = buildFixture();
  partialFixture.objects.set(`${keyPrefix}runs/${runId}/intermediates/parent-scene-02.mp4`, Buffer.from("another intermediate"));
  const partial = await pruneFixture(partialFixture, [], {
    delete: async (keys, objects) => {
      objects.delete(keys[0]);
      throw new ObjectDeletionError("Object deletion is incomplete", 1, keys.length);
    },
  });
  assert.equal(partial.result.cleaned, false);
  assert.equal(partial.result.removedObjects, 1);
  assert.equal(partial.result.retainedObjectCount, 7);
  for (const key of partial.result.retainedReleaseEvidence) assert.ok(partial.objects.has(key));
  const retry = await pruneFixture({ ...partialFixture, objects: partial.objects });
  assert.equal(retry.result.cleaned, true);
  assert.equal(retry.result.removedObjects, 1, "a retry must target only the intermediate still present");
  assert.equal(retry.objects.size, 7);

  const parentForDerivativeCleanup = buildFixture();
  const shortForDerivativeCleanup = buildFixture("short");
  const derivativeCleanup = await pruneFixture(
    parentForDerivativeCleanup,
    [shortForDerivativeCleanup],
  );
  assert.equal(
    derivativeCleanup.result.cleaned,
    true,
    "cleanup may proceed when parent and independently certified derivative evidence both revalidate",
  );
  assert.deepEqual(
    derivativeCleanup.deleteCalls,
    [[
      `${keyPrefix}runs/${runId}/intermediates/parent-scene-01.mp4`,
      `${keyPrefix}runs/${runId}/intermediates/short-scene-01.mp4`,
    ]],
    "cleanup must retain the derivative master and every one of its evidence objects",
  );
  assert(
    derivativeCleanup.result.retainedReleaseEvidence.includes(shortForDerivativeCleanup.certificate.finalMaster.r2Key),
    "the certified derivative master itself must survive cleanup",
  );

  const parentWithBrokenDerivative = buildFixture();
  const brokenDerivative = buildFixture("short");
  brokenDerivative.objects.delete(brokenDerivative.frameArtifacts[0].r2Key);
  const brokenDerivativeCleanup = await pruneFixture(
    parentWithBrokenDerivative,
    [brokenDerivative],
  );
  assert.equal(
    brokenDerivativeCleanup.result.cleaned,
    false,
    "a missing derivative evidence frame must stop cleanup before any object is deleted",
  );
  assert.equal(brokenDerivativeCleanup.result.removedObjects, 0);
  assert.deepEqual(
    brokenDerivativeCleanup.deleteCalls,
    [],
    "cleanup must preserve the whole run namespace when derivative proof is incomplete",
  );

  const missingCleanupFixture = buildFixture();
  missingCleanupFixture.objects.delete(missingCleanupFixture.frameArtifacts[0].r2Key);
  const missingCleanup = await pruneFixture(missingCleanupFixture);
  assert.equal(missingCleanup.result.cleaned, false, "cleanup must fail closed when a frame disappeared");
  assert.equal(missingCleanup.result.removedObjects, 0);
  assert.deepEqual(missingCleanup.deleteCalls, [], "cleanup must delete nothing when evidence is missing");

  const overwrittenCleanupFixture = buildFixture();
  overwrittenCleanupFixture.objects.set(
    overwrittenCleanupFixture.frameArtifacts[0].r2Key,
    Buffer.alloc(overwrittenCleanupFixture.frameBytes[0].byteLength, 0x33),
  );
  const overwrittenCleanup = await pruneFixture(overwrittenCleanupFixture);
  assert.equal(overwrittenCleanup.result.cleaned, false, "cleanup must fail closed when a frame was overwritten");
  assert.equal(overwrittenCleanup.result.removedObjects, 0);
  assert.deepEqual(overwrittenCleanup.deleteCalls, [], "cleanup must preserve every object on a byte-validation gap");

  const replacedMasterCleanupFixture = buildFixture();
  replacedMasterCleanupFixture.objects.set(
    replacedMasterCleanupFixture.certificate.finalMaster.r2Key,
    Buffer.alloc(replacedMasterCleanupFixture.masterBytes.byteLength, 0x44),
  );
  const replacedMasterCleanup = await pruneFixture(replacedMasterCleanupFixture);
  assert.equal(
    replacedMasterCleanup.result.cleaned,
    false,
    "cleanup must fail closed when the stored final master was replaced",
  );
  assert.equal(replacedMasterCleanup.result.removedObjects, 0);
  assert.deepEqual(
    replacedMasterCleanup.deleteCalls,
    [],
    "cleanup must not delete anything when final-master bytes diverge",
  );
  await retentionWorkerDeletionOutcomes();
}

main().then(() => console.log("final-master release evidence integrity tests passed"));
