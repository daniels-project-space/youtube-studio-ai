import assert from "node:assert/strict";
import {
  issueStudioActionApproval,
  studioActionApprovalFingerprint,
  verifyStudioActionApproval,
} from "../studioActionApproval";

const priorSecret = process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY;
process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = "test-only-studio-action-secret";
try {
  const now = 1_800_000_000_000;
  const receipt = issueStudioActionApproval({
    action: "channel-inception-execute",
    ownerId: "owner_daniel",
    subject: "channel-design:test",
    actor: "authenticated-operator:owner_daniel",
    evidence: "test explicit setup approval",
    maxCostUsd: 5,
    now,
    ttlMs: 60_000,
  });
  const expected = {
    action: "channel-inception-execute" as const,
    ownerId: "owner_daniel",
    subject: "channel-design:test",
    maximumCostUsd: 5,
  };
  assert.equal(verifyStudioActionApproval(receipt, { ...expected, now: now + 30_000 }), true);
  assert.equal(verifyStudioActionApproval(receipt, { ...expected, subject: "changed", now }), false);
  assert.equal(verifyStudioActionApproval({ ...receipt, maxCostUsd: 6 }, { ...expected, now }), false);
  assert.equal(verifyStudioActionApproval(receipt, { ...expected, now: now + 61_000 }), false);
  assert.equal(verifyStudioActionApproval(receipt, {
    ...expected,
    now: now + 61_000,
    persistedReceiptFingerprint: studioActionApprovalFingerprint(receipt),
  }), true, "only the exact previously frozen receipt may resume after expiry");
} finally {
  if (priorSecret === undefined) delete process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY;
  else process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = priorSecret;
}

console.log("studio action approval tests passed");
