import assert from "node:assert/strict";
import test from "node:test";

import {
  LTX25_BENCHMARK_REVIEW_BRIEF_CONTRACT,
  createLtx25BenchmarkReviewBrief,
} from "../lib/ltx25BenchmarkReviewBrief.mjs";

const reportKey = `novita/benchmarks/ltx-2.5-720p-native-x2-smoke/${"a".repeat(24)}/report.json`;
const report = {
  ok: true,
  status: "complete",
  reportSha256: "b".repeat(64),
  outputs: [{
    id: "native-720p-x2-smoke",
    key: "novita/benchmarks/ltx-2.5-720p-native-x2-smoke/a/video/output.mp4",
    controllerProof: { sha256: "c".repeat(64) },
  }],
};

test("creates a pending, exact-output review brief with the complete quality rubric", () => {
  const brief = createLtx25BenchmarkReviewBrief({ reportKey, report });
  assert.equal(brief.contract, LTX25_BENCHMARK_REVIEW_BRIEF_CONTRACT);
  assert.equal(brief.status, "pending_human_visual_review");
  assert.equal(brief.output.videoSha256, report.outputs[0].controllerProof.sha256);
  assert.equal(brief.requiredEvidenceKey, reportKey.replace("/report.json", "/review/evidence.json"));
  assert.deepEqual(brief.requiredCriteria.map((criterion) => criterion.id), [
    "story-and-subject-continuity",
    "camera-motion-and-temporal-integrity",
    "artifact-freedom",
    "final-image-and-audio-fidelity",
  ]);
  assert.doesNotMatch(JSON.stringify(brief), /"verdict"\s*:|"pass"|data:image|base64/i, "a review brief may not resemble an approved quality receipt");
});

test("rejects incomplete, ambiguous, or altered output evidence", () => {
  assert.throws(
    () => createLtx25BenchmarkReviewBrief({ reportKey, report: { ...report, status: "incomplete" } }),
    /complete benchmark/i,
  );
  assert.throws(
    () => createLtx25BenchmarkReviewBrief({ reportKey, report: { ...report, outputs: [] } }),
    /exactly one sealed output/i,
  );
  assert.throws(
    () => createLtx25BenchmarkReviewBrief({
      reportKey,
      report: { ...report, outputs: [{ ...report.outputs[0], controllerProof: { sha256: "not-a-hash" } }] },
    }),
    /output SHA-256/i,
  );
});
