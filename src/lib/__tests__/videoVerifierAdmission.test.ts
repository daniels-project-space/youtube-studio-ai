import assert from "node:assert/strict";

import { normalizeVisionVerdict } from "@/lib/videoVerifier";

assert.deepEqual(
  normalizeVisionVerdict({ score: 8.7, issues: ["  slight blur  "] }),
  { score: 8.7, issues: ["  slight blur  "] },
  "a complete numeric vision verdict must preserve its score and issue evidence",
);

const missingScore = normalizeVisionVerdict({ pass: true, issues: [] });
assert.equal(missingScore.score, 0, "a pass boolean cannot substitute for the required numeric score");
assert.match(missingScore.issues[0] ?? "", /no usable numeric 0–10 score/);

const outOfRange = normalizeVisionVerdict({ score: 12, issues: [] });
assert.equal(outOfRange.score, 0, "out-of-range scores must not be clamped into a release-quality score");
assert.match(outOfRange.issues[0] ?? "", /outside the declared 0–10 range/);

const malformedIssues = normalizeVisionVerdict({ score: 9, issues: "looks good" });
assert.equal(malformedIssues.score, 0, "a valid score cannot be admitted without the declared issue shape");
assert.ok(malformedIssues.issues.some((issue) => /no issues array/.test(issue)));

const nonObject = normalizeVisionVerdict(null);
assert.equal(nonObject.score, 0);
assert.ok(nonObject.issues.length > 0);

console.log("VIDEO VERIFIER ADMISSION PASS — malformed vision scores cannot become approvals");
