import assert from "node:assert/strict";
import { canonicalJson } from "@/lib/canonicalJson";
import {
  finalizedPlanWeekRenderReceiptFixture,
  planWeekProviderResultFixture,
} from "@/lib/__tests__/planWeekRenderReceiptFixture";
import {
  PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA,
  isFinalizedPlanWeekRenderReceipt,
  makePlanWeekProviderRenderReceipt,
  planWeekArtifactHeadMatches,
  validatePlanWeekProviderRenderReceipt,
  verifyFinalizedPlanWeekRenderReceipt,
  verifyPlanWeekProviderReceiptCryptography,
  type PlanWeekRenderScope,
} from "@/lib/planWeekRenderReceipt";

async function main(): Promise<void> {
  const scope: PlanWeekRenderScope = {
    ownerId: "owner-1",
    channelId: "channel-1",
    batchId: "batch-1",
    itemId: "item-1",
    attempt: 1,
    requestKey: "request-1",
    checkpointKey: "thumbnail:item-1:1",
    destinationKey: "owners/owner-1/channels/channel-1/plan/item-1/thumbnail.jpg",
  };
  const receipt = makePlanWeekProviderRenderReceipt(
    scope,
    planWeekProviderResultFixture(),
    1_900_000_000_000,
  );
  assert.equal(validatePlanWeekProviderRenderReceipt(receipt, scope), true);
  assert.equal(await verifyPlanWeekProviderReceiptCryptography(receipt), true);

  const wrongIdle = structuredClone(receipt);
  wrongIdle.runtimeAttestation.idleShutdownSeconds += 1;
  assert.equal(validatePlanWeekProviderRenderReceipt(wrongIdle, scope), false);

  const forgedBillingHash = structuredClone(receipt);
  forgedBillingHash.billingReceipt.gpuSku = "forged-sku";
  assert.equal(validatePlanWeekProviderRenderReceipt(forgedBillingHash, scope), true);
  assert.equal(await verifyPlanWeekProviderReceiptCryptography(forgedBillingHash), false);

  const forgedRequestHash = structuredClone(receipt);
  const request = JSON.parse(forgedRequestHash.requestCanonicalJson) as Record<string, unknown>;
  request["prefix"] = "forged/prefix";
  forgedRequestHash.requestCanonicalJson = canonicalJson(request);
  assert.equal(validatePlanWeekProviderRenderReceipt(forgedRequestHash, scope), false);
  assert.equal(await verifyPlanWeekProviderReceiptCryptography(forgedRequestHash), false);

  const { artifactReceipt: artifact } = finalizedPlanWeekRenderReceiptFixture(scope);
  assert.equal(isFinalizedPlanWeekRenderReceipt({ providerReceipt: receipt, artifactReceipt: artifact }), true);
  assert.equal(isFinalizedPlanWeekRenderReceipt({ providerReceipt: receipt }), false);
  const finalizedRow = {
    ...scope,
    providerRequestSha256: receipt.requestSha256,
    providerReceipt: receipt,
    artifactReceipt: artifact,
    createdAt: receipt.createdAt,
    finalizedAt: artifact.createdAt,
  };
  assert.equal(await verifyFinalizedPlanWeekRenderReceipt(finalizedRow, scope), true);
  for (const [field, value] of [
    ["ownerId", "owner-foreign"],
    ["channelId", "channel-foreign"],
    ["batchId", "batch-foreign"],
    ["itemId", "item-foreign"],
    ["attempt", 2],
    ["requestKey", "request-foreign"],
    ["checkpointKey", "thumbnail:item-foreign:1"],
    ["destinationKey", "owner/foreign/channel/foreign/plan/foreign.jpg"],
    ["providerRequestSha256", "f".repeat(64)],
    ["createdAt", receipt.createdAt + 1],
    ["finalizedAt", artifact.createdAt + 1],
  ] as const) {
    assert.equal(
      await verifyFinalizedPlanWeekRenderReceipt({ ...finalizedRow, [field]: value }, scope),
      false,
      `top-level ${field} substitution must be rejected`,
    );
  }
  const foreignScope = {
    ...scope,
    itemId: "item-foreign",
    checkpointKey: "thumbnail:item-foreign:1",
    destinationKey: "owner/owner-1/channel/channel-1/plan/item-foreign.jpg",
  };
  const foreignNested = finalizedPlanWeekRenderReceiptFixture(foreignScope);
  assert.equal(await verifyFinalizedPlanWeekRenderReceipt({
    ...finalizedRow,
    providerReceipt: foreignNested.providerReceipt,
    artifactReceipt: foreignNested.artifactReceipt,
  }, scope), false, "a foreign nested receipt cannot be transplanted under the target row");
  const forgedFinalized = structuredClone(finalizedRow);
  const forgedCanonicalRequest = JSON.parse(
    forgedFinalized.providerReceipt.requestCanonicalJson,
  ) as Record<string, unknown>;
  const jobs = forgedCanonicalRequest["jobs"] as Array<Record<string, unknown>>;
  jobs[0] = { ...jobs[0], prompt: "forged but structurally valid prompt" };
  forgedFinalized.providerReceipt.requestCanonicalJson = canonicalJson(forgedCanonicalRequest);
  forgedFinalized.providerReceipt.requestSha256 = "e".repeat(64);
  forgedFinalized.providerRequestSha256 = "e".repeat(64);
  forgedFinalized.artifactReceipt.providerRequestSha256 = "e".repeat(64);
  assert.equal(isFinalizedPlanWeekRenderReceipt(forgedFinalized), true);
  assert.equal(await verifyFinalizedPlanWeekRenderReceipt(forgedFinalized, scope), false,
    "shape-valid canonical request tampering must fail cryptographic verification");
  const exactHead = {
    contentLength: artifact.byteLength,
    contentType: "image/jpeg",
    etag: artifact.etag,
    metadata: {
      [PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA.checkpointKey]: scope.checkpointKey,
      [PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA.providerRequestSha256]: receipt.requestSha256,
      [PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA.billingReceiptSha256]: receipt.billingReceiptSha256,
      [PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA.artifactSha256]: artifact.sha256,
      [PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA.artifactCreatedAt]: String(artifact.createdAt),
    },
  };
  assert.equal(planWeekArtifactHeadMatches({
    head: exactHead,
    checkpointKey: scope.checkpointKey,
    provider: receipt,
    artifact,
  }), true);
  assert.equal(planWeekArtifactHeadMatches({
    head: null,
    checkpointKey: scope.checkpointKey,
    provider: receipt,
    artifact,
  }), false, "a deleted artifact must not satisfy readiness");
  assert.equal(planWeekArtifactHeadMatches({
    head: { ...exactHead, metadata: { ...exactHead.metadata,
      [PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA.artifactSha256]: "e".repeat(64) } },
    checkpointKey: scope.checkpointKey,
    provider: receipt,
    artifact,
  }), false, "a replaced artifact must not satisfy readiness");

  console.log("PLAN-WEEK RENDER RECEIPT PASS: exact profile, canonical hashes, and final artifact binding");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
