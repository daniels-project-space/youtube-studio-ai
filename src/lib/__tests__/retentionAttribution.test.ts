import assert from "node:assert/strict";

import {
  createPackageToOpeningPlan,
  createPackageToOpeningReceipt,
} from "@/engine/packageToOpening";
import {
  describePackageOpeningRetentionAttribution,
  packageOpeningRetentionAttribution,
} from "@/lib/retentionAttribution";

const plan = createPackageToOpeningPlan({
  title: "Why the river changed course",
  thumbnailDescription: "One bright route marker over a clear river delta.",
  topic: "How a river changed course",
  route: { version: "narrated-stock/foundation/v1", family: "narrated_stock" },
  script: { hook: "At dawn, the river moved.", hookLoop: "The map said one thing." },
});
const receipt = createPackageToOpeningReceipt({
  plan,
  finalMaster: { sha256: "a".repeat(64), durationSec: 60 },
  thumbnail: {
    r2Key: "owner/a/channel/b/runs/run-1/thumbnail.webp",
    sha256: "b".repeat(64),
    byteLength: 123,
  },
  visualReview: {
    reviewFingerprint: "review-v1",
    reviewReceiptVersion: "visual-review-release-receipt/v1",
    reviewReceiptFingerprint: "c".repeat(64),
    releaseReceiptFingerprint: "d".repeat(64),
    evidenceFrameArtifacts: [{
      id: "opening-frame",
      tSec: 3,
      r2Key: "owner/a/channel/b/runs/run-1/visual-review/opening.jpg",
      contentSha256: "e".repeat(64),
      byteLength: 456,
    }],
  },
});

const verified = packageOpeningRetentionAttribution({ plan, receipt });
assert.deepEqual(verified, {
  state: "verified_final_master",
  openingAnchorSource: "script_cold_open",
  planFingerprint: plan.planFingerprint,
  receiptFingerprint: receipt.receiptFingerprint,
});
assert.match(describePackageOpeningRetentionAttribution(verified), /verified final-master opening anchor/);

assert.deepEqual(packageOpeningRetentionAttribution({ plan, receipt: undefined }), {
  state: "planned_not_final_master_verified",
  openingAnchorSource: "script_cold_open",
  planFingerprint: plan.planFingerprint,
});
assert.deepEqual(packageOpeningRetentionAttribution({ plan: undefined, receipt }), { state: "not_recorded" });
assert.deepEqual(
  packageOpeningRetentionAttribution({ plan, receipt: { ...receipt, planFingerprint: "f".repeat(64) } }),
  { state: "mismatched_receipt" },
  "a receipt from another opening plan must never attribute viewer retention",
);

console.log("retention attribution tests passed");
