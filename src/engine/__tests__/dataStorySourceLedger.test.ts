import assert from "node:assert/strict";

import {
  assertDataStorySourceLedger,
  dataStorySourceLedgerFingerprint,
  evaluateDataStorySourceLedger,
  type DataStorySourceLedger,
} from "@/engine/dataStorySourceLedger";

const now = Date.now();
const source = {
  id: "bls",
  name: "U.S. Bureau of Labor Statistics",
  url: "https://www.bls.gov/",
  snapshotSha256: "a".repeat(64),
};
const base = {
  version: "data-story-source-ledger/v1" as const,
  topic: "Labour-market changes",
  sources: [source],
  claims: [
    { id: "unemployment", sourceId: "bls", numericAnchor: "4.1%", context: "the approved unemployment figure" },
    { id: "jobs", sourceId: "bls", numericAnchor: "151,000", context: "the approved payroll figure" },
    { id: "hours", sourceId: "bls", numericAnchor: "34.3", context: "the approved weekly-hours figure" },
  ],
};
const ledger: DataStorySourceLedger = {
  ...base,
  review: {
    decision: "approved",
    reviewerId: "editor-1",
    reviewId: "review-1",
    reviewedAt: new Date(now).toISOString(),
    reviewedLedgerFingerprint: dataStorySourceLedgerFingerprint(base),
  },
};
const narration = [
  "According to U.S. Bureau of Labor Statistics, the figure was 4.1%.",
  "According to U.S. Bureau of Labor Statistics, payrolls changed by 151,000.",
  "According to U.S. Bureau of Labor Statistics, weekly hours held at 34.3.",
].join(" ");

assert.deepEqual(assertDataStorySourceLedger(ledger, narration), ledger);

const inventedSource = evaluateDataStorySourceLedger(
  ledger,
  narration.replace("U.S. Bureau of Labor Statistics, payrolls", "Made Up Institute, payrolls"),
  now,
);
assert.equal(inventedSource.safe, false);
assert.ok(inventedSource.issues.some((issue) => issue.code === "unknown_spoken_source"));

const inventedNumber = evaluateDataStorySourceLedger(ledger, narration.replace("4.1%", "9.9%"), now);
assert.equal(inventedNumber.safe, false);
assert.ok(inventedNumber.issues.some((issue) => issue.code === "unapproved_spoken_number"));

const changedLedger = {
  ...ledger,
  claims: [...ledger.claims, { id: "extra", sourceId: "bls", numericAnchor: "2.0%", context: "not reviewed" }],
};
const staleReview = evaluateDataStorySourceLedger(changedLedger, narration, now);
assert.equal(staleReview.safe, false);
assert.ok(staleReview.issues.some((issue) => issue.code === "review_fingerprint_mismatch"));

console.log("Data-story source ledger tests passed");
