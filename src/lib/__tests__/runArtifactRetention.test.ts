import assert from "node:assert/strict";
import test from "node:test";

import {
  RUN_ARTIFACT_RETENTION_MS,
  dueRunArtifactRetentionLease,
  evaluateRunArtifactRelease,
  expectedChannelKeyPrefix,
  hasFreshRunArtifactRelease,
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

test("public upload intent and scheduled dates never begin deletion before observed release", () => {
  const publicSchedule = scheduleRunArtifactRetention({ releaseMode: "public", uploadedAt: 2_000 });
  assert.equal(publicSchedule.status, "awaiting_release");
  assert.equal(publicSchedule.releaseAt, undefined);
  assert.equal(publicSchedule.retainUntil, undefined);

  const scheduled = scheduleRunArtifactRetention({
    releaseMode: "scheduled",
    uploadedAt: 2_000,
    scheduledPublishAt: 9_000,
  });
  assert.equal(scheduled.status, "awaiting_release");
  assert.equal(scheduled.releaseAt, undefined);
  assert.equal(scheduled.retainUntil, undefined);
  assert.throws(
    () => scheduleRunArtifactRetention({
      releaseMode: "scheduled",
      uploadedAt: 2_000,
      scheduledPublishAt: 1_999,
    }),
    /cannot precede/,
  );
});

test("only exact public processed observations start the clock at real publication", () => {
  const releaseAt = Date.parse("2026-09-01T12:00:00Z");
  const args = {
    expectedVideoId: "abcdefghijk", expectedChannelId: "UC-channel",
    observedAt: releaseAt + 60_000,
    observation: {
      videoId: "abcdefghijk", channelId: "UC-channel", privacyStatus: "public",
      uploadStatus: "processed", publishedAt: new Date(releaseAt).toISOString(),
    },
  };
  assert.deepEqual(evaluateRunArtifactRelease(args), {
    released: true, releaseAt, retainUntil: releaseAt + RUN_ARTIFACT_RETENTION_MS,
  });
  for (const privacyStatus of ["private", "unlisted", undefined]) {
    assert.equal(evaluateRunArtifactRelease({
      ...args, observation: { ...args.observation, privacyStatus },
    }).released, false, `${privacyStatus} cannot reuse publishedAt as a release`);
  }
  for (const uploadStatus of ["uploaded", "failed", "rejected", "deleted", undefined]) {
    assert.equal(evaluateRunArtifactRelease({
      ...args, observation: { ...args.observation, uploadStatus },
    }).released, false);
  }
  for (const patch of [
    { channelId: "UC-other" }, { videoId: "other-video" },
    { publishedAt: undefined }, { publishedAt: "bad date" },
    { publishedAt: new Date(args.observedAt + 1).toISOString() },
  ]) {
    assert.equal(evaluateRunArtifactRelease({
      ...args, observation: { ...args.observation, ...patch },
    }).released, false);
  }
  assert.equal(evaluateRunArtifactRelease({ ...args, observation: null }).released, false);
});

test("a due cleanup requires a fresh observation and an exact fourteen-day clock", () => {
  const now = 1_800_000_000_000;
  const evidence = {
    now, releaseAt: now - RUN_ARTIFACT_RETENTION_MS,
    retainUntil: now, releaseConfirmedAt: now - 100,
    releaseObservationAt: now - 100,
  };
  assert.equal(hasFreshRunArtifactRelease(evidence), true);
  for (const patch of [
    { releaseConfirmedAt: undefined }, { releaseObservationAt: undefined },
    { releaseObservationAt: now - 300_001 }, { releaseObservationAt: now + 1 },
    { retainUntil: now - 1 }, { retainUntil: now + 1 },
    { releaseAt: undefined },
  ]) assert.equal(hasFreshRunArtifactRelease({ ...evidence, ...patch }), false);
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
    releaseMode: "public", uploadedAt: Number.MAX_SAFE_INTEGER + 1,
  }), /upload time/);
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
