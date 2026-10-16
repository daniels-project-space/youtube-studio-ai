import assert from "node:assert/strict";
import { assessMusicAuditionApprovalReadiness } from "@/engine/musicAuditionReview";

const sections = ["intro", "build", "peak", "outro"].map((id) => ({ id }));
const sectionReviews = Object.fromEntries(sections.map(({ id }) => [id, { score: "0.82", evidence: `${id} develops musically` }]));
const base = {
  sections,
  sectionReviews,
  emotionalDepthScore: "0.84",
  arrangementDepthScore: "0.86",
  hollowOrGeneric: false,
  notes: "Auditioned the full native WAV and all transitions.",
  thresholds: { minimumSectionScore: 0.75, minimumEmotionalDepthScore: 0.8, minimumArrangementDepthScore: 0.8 },
  technicalQualityPass: true,
};

assert.deepEqual(assessMusicAuditionApprovalReadiness({
  ...base, sectionReviews: {}, emotionalDepthScore: "", arrangementDepthScore: "", notes: "",
}), { reviewComplete: false, humanReviewPasses: false, approvalReady: false });
assert.deepEqual(assessMusicAuditionApprovalReadiness(base), {
  reviewComplete: true, humanReviewPasses: true, approvalReady: true,
});
for (const failed of [
  { sectionReviews: { ...sectionReviews, peak: { score: "0.74", evidence: "No lift" } } },
  { emotionalDepthScore: "0.79" },
  { arrangementDepthScore: "0.79" },
  { hollowOrGeneric: true },
  { technicalQualityPass: false },
]) {
  assert.equal(assessMusicAuditionApprovalReadiness({ ...base, ...failed }).approvalReady, false,
    `approval must remain blocked for ${Object.keys(failed).join(", ")}`);
}
assert.equal(assessMusicAuditionApprovalReadiness({ ...base, technicalQualityPass: undefined }).approvalReady, false,
  "a missing technical result must fail closed");

console.log("Music audition approval readiness: completeness, human thresholds, and technical fail-closed checks passed");
