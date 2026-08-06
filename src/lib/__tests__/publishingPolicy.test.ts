import assert from "node:assert/strict";
import {
  buildPublishIdempotencyKey,
  evaluatePublishClaim,
  isGenerationDue,
  localDateKey,
  retryAt,
  stableJson,
  YOUTUBE_UPLOAD_SCOPES,
  type ChannelSchedulePolicy,
  type PublishClaimInput,
} from "@/lib/publishingPolicy";
import { channelPublishConfiguration } from "@/lib/channelPublishPolicy";

const NOW = Date.parse("2026-07-19T13:30:00.000Z");

function claimInput(): PublishClaimInput {
  return {
    now: NOW,
    intent: {
      ownerId: "owner-a",
      channelId: "channel-a",
      connectorId: "connector-a",
      connectorVersion: 7,
      status: "approved",
      nextAttemptAt: NOW,
    },
    connector: {
      connectorId: "connector-a",
      ownerId: "owner-a",
      channelId: "channel-a",
      tokenVersion: 7,
      status: "active",
      grantedScopes: [YOUTUBE_UPLOAD_SCOPES[0]],
    },
    activeDispatches: 0,
    uploadsToday: 0,
    schedule: { maxConcurrent: 1, dailyQuota: 3 },
  };
}

function rejectedReason(input: PublishClaimInput): string {
  const decision = evaluatePublishClaim(input);
  assert.equal(decision.ok, false);
  return decision.ok ? "" : decision.reason;
}

function claimBoundaries(): void {
  assert.deepEqual(evaluatePublishClaim(claimInput()), { ok: true });

  const tenantMismatch = claimInput();
  tenantMismatch.connector.ownerId = "owner-b";
  assert.deepEqual(evaluatePublishClaim(tenantMismatch), {
    ok: false,
    reason: "tenant_mismatch",
    terminal: true,
  });

  const connectorMismatch = claimInput();
  connectorMismatch.intent.connectorId = "connector-b";
  assert.equal(rejectedReason(connectorMismatch), "connector_mismatch");

  const rotated = claimInput();
  rotated.connector.tokenVersion = 8;
  assert.equal(rejectedReason(rotated), "connector_version_changed");

  const revoked = claimInput();
  revoked.connector.status = "revoked";
  assert.equal(rejectedReason(revoked), "connector_inactive");

  const missingScope = claimInput();
  missingScope.connector.grantedScopes = [];
  assert.equal(rejectedReason(missingScope), "upload_scope_missing");

  const leased = claimInput();
  leased.intent.status = "dispatching";
  leased.intent.leaseExpiresAt = NOW + 60_000;
  assert.deepEqual(evaluatePublishClaim(leased), {
    ok: false,
    reason: "lease_active",
    terminal: false,
  });

  const expiredLease = claimInput();
  expiredLease.intent.status = "dispatching";
  expiredLease.intent.leaseExpiresAt = NOW - 1;
  assert.deepEqual(evaluatePublishClaim(expiredLease), { ok: true });

  const future = claimInput();
  future.intent.nextAttemptAt = NOW + 1;
  assert.equal(rejectedReason(future), "not_due");

  const busy = claimInput();
  busy.activeDispatches = 1;
  assert.equal(rejectedReason(busy), "channel_concurrency");

  const quota = claimInput();
  quota.uploadsToday = 3;
  assert.equal(rejectedReason(quota), "daily_quota");
}

function timezoneScheduling(): void {
  const schedule: ChannelSchedulePolicy = {
    enabled: true,
    timezone: "America/New_York",
    localTime: "09:00",
    days: [0],
    frequency: "weekly",
  };
  assert.equal(isGenerationDue({ now: NOW, lastStartedAt: 0, schedule }), true);
  assert.equal(
    isGenerationDue({ now: Date.parse("2026-07-19T12:59:00.000Z"), lastStartedAt: 0, schedule }),
    false,
  );
  assert.equal(
    isGenerationDue({ now: NOW, lastStartedAt: Date.parse("2026-07-19T10:00:00.000Z"), schedule }),
    false,
  );
  assert.equal(
    localDateKey(Date.parse("2026-07-19T00:30:00.000Z"), "America/Los_Angeles"),
    "2026-07-18",
  );
  assert.equal(
    localDateKey(Date.parse("2026-07-19T00:30:00.000Z"), "Asia/Tokyo"),
    "2026-07-19",
  );
  assert.throws(
    () => isGenerationDue({ now: NOW, lastStartedAt: 0, schedule: { localTime: "25:00" } }),
    /invalid channel schedule/,
  );
}

function durableIdentityAndRetry(): void {
  const key = buildPublishIdempotencyKey({
    connectorId: "connector-a",
    videoArtifactId: "sha256:abc",
    intentVersion: 2,
  });
  assert.equal(key, "connector-a:sha256:abc:v2");
  assert.equal(
    key,
    buildPublishIdempotencyKey({
      connectorId: "connector-a",
      videoArtifactId: "sha256:abc",
      intentVersion: 2,
    }),
  );
  assert.throws(
    () => buildPublishIdempotencyKey({ connectorId: "", videoArtifactId: "sha256:abc", intentVersion: 2 }),
    /invalid publish idempotency/,
  );
  assert.throws(
    () => buildPublishIdempotencyKey({ connectorId: "connector-a", videoArtifactId: "sha256:abc", intentVersion: 0 }),
    /invalid publish idempotency/,
  );
  assert.equal(retryAt(NOW, 1, 10), NOW + 10 * 60_000);
  assert.equal(retryAt(NOW, 4, 10), NOW + 80 * 60_000);
  assert.equal(retryAt(NOW, 99, 720), NOW + 24 * 60 * 60_000);
  assert.equal(stableJson({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');
}

function immutableChannelPublishConfiguration(): void {
  const publicCrosspost = [
    {
      block: "upload_draft",
      params: { publishMode: "public", categoryId: "22", approvedForPublish: true },
    },
    { block: "crosspost", params: { platforms: ["instagram", "tiktok"] } },
  ];
  const configured = channelPublishConfiguration(publicCrosspost);
  assert.deepEqual(configured.actions, ["crosspost", "youtube_public"]);
  assert.match(configured.fingerprint, /^[a-f0-9]{64}$/);

  const reorderedKeys = channelPublishConfiguration([
    {
      block: "upload_draft",
      params: { approvedForPublish: true, categoryId: "22", publishMode: "public" },
    },
    { block: "crosspost", params: { platforms: ["instagram", "tiktok"] } },
  ]);
  assert.equal(reorderedKeys.fingerprint, configured.fingerprint);

  const forgedMode = channelPublishConfiguration([
    {
      block: "upload_draft",
      params: { publishMode: "scheduled", categoryId: "22", approvedForPublish: true },
    },
    { block: "crosspost", params: { platforms: ["instagram", "tiktok"] } },
  ]);
  assert.deepEqual(forgedMode.actions, ["crosspost", "youtube_scheduled"]);
  assert.notEqual(forgedMode.fingerprint, configured.fingerprint);

  const forgedPlatforms = channelPublishConfiguration([
    publicCrosspost[0],
    { block: "crosspost", params: { platforms: ["youtube"] } },
  ]);
  assert.notEqual(forgedPlatforms.fingerprint, configured.fingerprint);
}

claimBoundaries();
timezoneScheduling();
durableIdentityAndRetry();
immutableChannelPublishConfiguration();
console.log("publishing policy tests passed");
