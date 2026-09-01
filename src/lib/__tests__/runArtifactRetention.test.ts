import assert from "node:assert/strict";
import test from "node:test";

import {
  RUN_ARTIFACT_RETENTION_MS,
  dueRunArtifactRetentionLease,
  expectedChannelKeyPrefix,
  scheduleRunArtifactRetention,
  validateRunArtifactKeepNames,
  validateRunArtifactRetentionObjectKeys,
} from "@/lib/runArtifactRetention";

test("private drafts remain retained until a real release is recorded", () => {
  assert.deepEqual(scheduleRunArtifactRetention({
    releaseMode: "private_draft",
    uploadedAt: 1_000,
  }), {
    version: "run-artifact-retention/v1",
    releaseMode: "private_draft",
    status: "awaiting_release",
  });
});

test("public and scheduled releases keep artifacts through release plus fourteen days", () => {
  const publicSchedule = scheduleRunArtifactRetention({ releaseMode: "public", uploadedAt: 2_000 });
  assert.equal(publicSchedule.releaseAt, 2_000);
  assert.equal(publicSchedule.retainUntil, 2_000 + RUN_ARTIFACT_RETENTION_MS);

  const scheduled = scheduleRunArtifactRetention({
    releaseMode: "scheduled",
    uploadedAt: 2_000,
    scheduledPublishAt: 9_000,
  });
  assert.equal(scheduled.releaseAt, 9_000);
  assert.equal(scheduled.retainUntil, 9_000 + RUN_ARTIFACT_RETENTION_MS);
  assert.throws(
    () => scheduleRunArtifactRetention({
      releaseMode: "scheduled",
      uploadedAt: 2_000,
      scheduledPublishAt: 1_999,
    }),
    /cannot precede/,
  );
});

test("cleanup namespaces and retained filenames cannot escape their exact run", () => {
  const keyPrefix = expectedChannelKeyPrefix({ ownerId: "owner_daniel", channelSlug: "rainy-neon" });
  assert.equal(keyPrefix, "owner/owner_daniel/channel/rainy-neon/");
  assert.deepEqual(validateRunArtifactKeepNames(["thumbnail.jpg", "final.mp4", "thumbnail.jpg"]), [
    "final.mp4",
    "thumbnail.jpg",
  ]);
  assert.throws(() => validateRunArtifactKeepNames(["../outside"]), /run-local/);
  assert.deepEqual(validateRunArtifactRetentionObjectKeys({
    keyPrefix,
    runId: "run-1",
    certificateKey: `${keyPrefix}runs/run-1/evidence/certificate.json`,
    additionalCertificateKeys: [`${keyPrefix}runs/run-1/evidence/short.json`],
  }).additionalCertificateKeys, [`${keyPrefix}runs/run-1/evidence/short.json`]);
  assert.throws(() => validateRunArtifactRetentionObjectKeys({
    keyPrefix,
    runId: "run-1",
    certificateKey: `${keyPrefix}runs/run-2/evidence/certificate.json`,
  }), /outside/);
  assert.throws(() => validateRunArtifactRetentionObjectKeys({
    keyPrefix,
    runId: "run-1",
    certificateKey: `${keyPrefix}runs/run-1/evidence/certificate.json`,
    additionalCertificateKeys: [`${keyPrefix}runs/run-1/evidence/certificate.json`],
  }), /derivative certificate/);
});

test("retention and lease timestamps reject unsafe integer overflow", () => {
  assert.throws(() => scheduleRunArtifactRetention({
    releaseMode: "public",
    uploadedAt: Number.MAX_SAFE_INTEGER,
  }), /deadline/);
  assert.throws(() => dueRunArtifactRetentionLease({
    now: Number.MAX_SAFE_INTEGER,
    token: "b".repeat(64),
  }), /lease expiry/);
});

test("cleanup leases are bounded and unguessable", () => {
  assert.deepEqual(dueRunArtifactRetentionLease({ now: 50, token: "a".repeat(64) }), {
    leaseToken: "a".repeat(64),
    leaseExpiresAt: 5_400_050,
  });
  assert.throws(() => dueRunArtifactRetentionLease({ now: 50, token: "weak" }), /invalid/);
});
