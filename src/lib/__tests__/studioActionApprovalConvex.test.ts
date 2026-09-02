import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  issueStudioActionApproval,
  studioActionApprovalFingerprint,
} from "../studioActionApproval";
import {
  studioActionApprovalFingerprintForConvex,
  verifyStudioActionApprovalForConvex,
} from "../studioActionApprovalConvex";

async function main(): Promise<void> {
  const priorSecret = process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY;
  process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = "test-only-studio-action-secret";
  try {
  const now = 1_800_000_000_000;
  const receipt = issueStudioActionApproval({
    action: "thumbnail-ernie-batch-import",
    ownerId: "owner_daniel",
    subject: "thumbnail-ernie-batch-import:test",
    actor: "authenticated-operator:owner_daniel",
    evidence: "test explicit thumbnail import approval",
    maxCostUsd: 5,
    now,
    ttlMs: 60_000,
  });
  const expected = {
    action: "thumbnail-ernie-batch-import" as const,
    ownerId: "owner_daniel",
    subject: "thumbnail-ernie-batch-import:test",
    maximumCostUsd: 5,
  };
  assert.equal(
    await studioActionApprovalFingerprintForConvex(receipt),
    studioActionApprovalFingerprint(receipt),
    "Convex must fingerprint the exact Node-issued receipt bytes",
  );
  assert.equal(await verifyStudioActionApprovalForConvex(receipt, { ...expected, now: now + 30_000 }), true);
  assert.equal(await verifyStudioActionApprovalForConvex({ ...receipt, subject: "changed" }, { ...expected, now }), false);
  assert.equal(await verifyStudioActionApprovalForConvex({ ...receipt, maxCostUsd: 6 }, { ...expected, now }), false);
  assert.equal(await verifyStudioActionApprovalForConvex(receipt, { ...expected, now: now + 61_000 }), false);
  assert.equal(await verifyStudioActionApprovalForConvex(receipt, {
    ...expected,
    now: now + 61_000,
    persistedReceiptFingerprint: studioActionApprovalFingerprint(receipt),
  }), true, "only the exact previously frozen receipt may resume after expiry");
  } finally {
    if (priorSecret === undefined) delete process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY;
    else process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = priorSecret;
  }

  const [convexMutationSource, convexVerifierSource] = await Promise.all([
    readFile(new URL("../../../convex/thumbnailRefresh.ts", import.meta.url), "utf8"),
    readFile(new URL("../studioActionApprovalConvex.ts", import.meta.url), "utf8"),
  ]);
  assert.match(convexMutationSource, /studioActionApprovalConvex/,
    "the Convex mutation must use the Web-Crypto verifier, never the Node issuer module");
  assert.doesNotMatch(convexMutationSource, /from ["']\.\.\/src\/lib\/studioActionApproval["']/,
    "the Convex mutation must not pull node:crypto into its default runtime bundle");
  assert.doesNotMatch(convexVerifierSource, /node:crypto|\bBuffer\b/,
    "the Convex verifier must remain Web-standard only");

  console.log("studio action approval Convex Web Crypto tests passed");
}

void main();
