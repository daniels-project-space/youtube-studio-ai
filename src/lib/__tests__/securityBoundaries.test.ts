import assert from "node:assert/strict";
import {
  decryptSecret,
  encryptSecret,
  isSecretEnvelope,
} from "@/lib/secretEnvelope";
import {
  createYouTubeOAuthState,
  verifyYouTubeOAuthState,
} from "@/lib/youtubeOAuthState";
import {
  createOperationsOAuthState,
  verifyOperationsOAuthState,
} from "@/lib/operationsOAuthState";
import { isKnownOperationsOwnerChannel } from "@/lib/operationsOwnerIdentity";
import {
  authorizeStudioRoute,
  createOperatorSessionToken,
  getStudioActor,
  requireStudioActor,
  STUDIO_SESSION_COOKIE,
} from "@/lib/operatorSession";
import {
  validateBridgeCompletion,
  type NovitaBridgeStatus,
} from "@/lib/novitaRenderFarm";

process.env.TEST_SECURITY_KEY = Buffer.alloc(32, 7).toString("base64url");
process.env.YOUTUBE_OAUTH_STATE_SECRET = Buffer.alloc(32, 9).toString(
  "base64url",
);
process.env.STUDIO_SESSION_SECRET = Buffer.alloc(32, 11).toString("base64url");
process.env.STUDIO_INTERNAL_API_TOKEN = "service-test-token";
process.env.STUDIO_OWNER_ID = "owner-test";

async function main() {
  const aad = "youtube-connector:owner-a:channel-a";
  const plaintext = "refresh-token-that-must-not-be-stored";
  const envelope = encryptSecret(plaintext, {
    envName: "TEST_SECURITY_KEY",
    aad,
  });
  assert.equal(isSecretEnvelope(envelope), true);
  assert.equal(envelope.includes(plaintext), false);
  assert.equal(
    decryptSecret(envelope, { envName: "TEST_SECURITY_KEY", aad }),
    plaintext,
  );
  assert.throws(() =>
    decryptSecret(envelope, {
      envName: "TEST_SECURITY_KEY",
      aad: "youtube-connector:owner-b:channel-a",
    }),
  );

  const now = 1_800_000_000_000;
  const oauth = createYouTubeOAuthState({
    channelId: "channel-a",
    ownerId: "owner-a",
    now,
    ttlMs: 60_000,
  });
  assert.deepEqual(
    verifyYouTubeOAuthState({
      state: oauth.state,
      nonce: oauth.nonce,
      now: now + 30_000,
    }),
    oauth.payload,
  );
  const [statePayload, stateSignature] = oauth.state.split(".");
  const tamperedSignature = `${stateSignature.startsWith("A") ? "B" : "A"}${stateSignature.slice(1)}`;
  assert.throws(
    () =>
      verifyYouTubeOAuthState({
        state: `${statePayload}.${tamperedSignature}`,
        nonce: oauth.nonce,
        now: now + 30_000,
      }),
    /signature/,
  );
  assert.throws(
    () =>
      verifyYouTubeOAuthState({
        state: oauth.state,
        nonce: "wrong-browser",
        now: now + 30_000,
      }),
    /browser/,
  );
  assert.throws(
    () =>
      verifyYouTubeOAuthState({
        state: oauth.state,
        nonce: oauth.nonce,
        now: now + 60_001,
      }),
    /expired/,
  );

  const operationsOAuth = createOperationsOAuthState({ now, ttlMs: 60_000 });
  assert.deepEqual(
    verifyOperationsOAuthState({
      state: operationsOAuth.state,
      nonce: operationsOAuth.nonce,
      now: now + 30_000,
    }),
    operationsOAuth.payload,
  );
  assert.throws(
    () => verifyOperationsOAuthState({
      state: operationsOAuth.state,
      nonce: "wrong-browser",
      now: now + 30_000,
    }),
    /browser/,
  );
  assert.equal(isKnownOperationsOwnerChannel({
    selectedChannelId: "UC-owner",
    connectors: [{ ytChannelId: "UC-owner", status: "active" }],
    createdDestinations: [],
    publishedVideoChannelIds: [],
  }), true);
  assert.equal(isKnownOperationsOwnerChannel({
    selectedChannelId: "UC-revoked",
    connectors: [{ ytChannelId: "UC-revoked", status: "revoked" }],
    createdDestinations: [],
    publishedVideoChannelIds: [],
  }), false);
  assert.equal(isKnownOperationsOwnerChannel({
    selectedChannelId: "UC-published-owner",
    connectors: [],
    createdDestinations: [],
    publishedVideoChannelIds: ["UC-published-owner"],
  }), true);

  const session = await createOperatorSessionToken();
  const sessionRequest = new Request("https://studio.test/api/secure", {
    headers: { cookie: `${STUDIO_SESSION_COOKIE}=${session}` },
  });
  assert.deepEqual(await getStudioActor(sessionRequest), {
    ownerId: "owner-test",
    role: "owner",
    authKind: "session",
  });
  await assert.rejects(
    () =>
      requireStudioActor(
        new Request("https://studio.test/api/secure", {
          method: "POST",
          headers: { cookie: `${STUDIO_SESSION_COOKIE}=${session}` },
        }),
      ),
    /cross-origin/,
  );
  assert.deepEqual(
    await requireStudioActor(
      new Request("https://studio.test/api/secure", {
        method: "POST",
        headers: {
          authorization: "Bearer service-test-token",
        },
      }),
    ),
    { ownerId: "owner-test", role: "owner", authKind: "service" },
  );
  const anonymousFailure = await authorizeStudioRoute(
    new Request("https://studio.test/api/secure"),
  );
  assert.equal(anonymousFailure?.status, 401);
  const csrfFailure = await authorizeStudioRoute(
    new Request("https://studio.test/api/secure", {
      method: "POST",
      headers: { cookie: `${STUDIO_SESSION_COOKIE}=${session}` },
    }),
  );
  assert.equal(csrfFailure?.status, 403);
  assert.equal(
    await authorizeStudioRoute(
      new Request("https://studio.test/api/secure", {
        method: "POST",
        headers: {
          cookie: `${STUDIO_SESSION_COOKIE}=${session}`,
          origin: "https://studio.test",
        },
      }),
    ),
    null,
  );

  const renderStatus: NovitaBridgeStatus = {
    ok: true,
    jobId: "image-0123456789abcdef0123456789abcdef",
    phase: "image",
    status: "done",
    outputs: [
      "imagecraft/owner/owner-test/channel/test/runs/run-1/novita/image-0123456789abcdef0123456789abcdef/stills/shot-a.png",
    ],
    n_outputs: 1,
    n_jobs: 1,
    outputPrefix:
      "imagecraft/owner/owner-test/channel/test/runs/run-1/novita/image-0123456789abcdef0123456789abcdef/stills",
    expectedKeys: [
      "imagecraft/owner/owner-test/channel/test/runs/run-1/novita/image-0123456789abcdef0123456789abcdef/stills/shot-a.png",
    ],
    missingKeys: [],
    failedIds: [],
    profile: {
      contractVersion: "1.0.0",
      id: "production",
      phase: "image",
      model: "Tongyi-MAI/Z-Image-Turbo",
      revision: "f332072aa78be7aecdf3ee76d5c247082da564a6",
      checkpoint: "Z-Image-Turbo",
      width: 1920,
      height: 1088,
      steps: 9,
      guidanceScale: 0,
      precision: "bf16",
      candidates: 1,
      infrastructure: {
        provider: "novita",
        capacityMode: "spot",
        weightStorage: "local-persistent-disk",
        cacheMount: "/workspace/model-cache",
        checkpointing: true,
        idleShutdownSeconds: 300,
        elasticGpuCeiling: 8,
      },
      allowFallback: false,
    },
    profileSha256: "a".repeat(64),
    manifestSha256: "b".repeat(64),
    requestSha256: "c".repeat(64),
    runtimeAttestation: {
      provider: "novita",
      capacityMode: "spot",
      weightStorage: "local-persistent-disk",
      cacheMount: "/workspace/model-cache",
      checkpointing: true,
      idleShutdownSeconds: 300,
      gpuCount: 1,
      model: "Tongyi-MAI/Z-Image-Turbo",
      revision: "f332072aa78be7aecdf3ee76d5c247082da564a6",
      checkpoint: "Z-Image-Turbo",
    },
    billingReceipt: {
      provider: "novita",
      currency: "USD",
      receiptId: "receipt-security-fixture",
      gpuSku: "RTX-4090",
      gpuCount: 1,
      gpuSeconds: 10,
      gpuRateUsdPerSecond: 0.001,
      startupUsd: 0,
      storageUsd: 0,
      costUsd: 0.01,
    },
    billingReceiptSha256: "d".repeat(64),
    stillKeys: [
      "imagecraft/owner/owner-test/channel/test/runs/run-1/novita/image-0123456789abcdef0123456789abcdef/stills/shot-a.png",
    ],
  };
  assert.deepEqual(
    validateBridgeCompletion({
      phase: "image",
      prefix: "owner/owner-test/channel/test/runs/run-1/novita",
      jobId: renderStatus.jobId,
      expectedJobIds: ["shot-a"],
      status: renderStatus,
    }),
    renderStatus.outputs,
  );
  assert.throws(
    () =>
      validateBridgeCompletion({
        phase: "image",
        prefix: "owner/owner-test/channel/test/runs/run-1/novita",
        jobId: renderStatus.jobId,
        expectedJobIds: ["shot-a"],
        status: { ...renderStatus, outputPrefix: "imagecraft/shared/stills" },
      }),
    /namespace/,
  );
  assert.throws(
    () =>
      validateBridgeCompletion({
        phase: "image",
        prefix: "owner/owner-test/channel/test/runs/run-1/novita",
        jobId: renderStatus.jobId,
        expectedJobIds: ["shot-a"],
        status: { ...renderStatus, failedIds: ["shot-a"] },
      }),
    /failed or missing/,
  );

  console.log("security boundary tests passed");
}

void main();
