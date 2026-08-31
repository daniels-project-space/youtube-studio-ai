/**
 * A pending review brief is deliberately not benchmark approval evidence.
 * It gives the reviewer the exact finished output identity and complete
 * quality rubric without carrying pixels, prompts, signed URLs, or a pass.
 */
export const LTX25_BENCHMARK_REVIEW_BRIEF_CONTRACT = "ltx-benchmark-review-brief/v1";

const SHA256 = /^[a-f0-9]{64}$/u;
const OUTPUT_ID = /^[a-z0-9][a-z0-9._:-]{2,159}$/u;
const R2_KEY = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9][A-Za-z0-9._/@+=:-]{1,511}$/u;
const BENCHMARK_REPORT_KEY = /^novita\/benchmarks\/ltx-2\.5-720p-native-x2-smoke\/[a-f0-9]{24}\/report\.json$/u;

const REQUIRED_CRITERIA = Object.freeze([
  Object.freeze({ id: "story-and-subject-continuity", scope: "frame" }),
  Object.freeze({ id: "camera-motion-and-temporal-integrity", scope: "global" }),
  Object.freeze({ id: "artifact-freedom", scope: "global" }),
  Object.freeze({ id: "final-image-and-audio-fidelity", scope: "global" }),
]);

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function text(value, label, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

/**
 * Creates a review task from the report immediately before that report is
 * sealed. A future reviewer must still write independently extracted review
 * frames plus the supported `ltx-benchmark-review/v2` evidence sidecar.
 */
export function createLtx25BenchmarkReviewBrief({ reportKey, report }) {
  text(reportKey, "benchmark report key", BENCHMARK_REPORT_KEY);
  const sealed = record(report, "complete LTX benchmark report");
  if (sealed.status !== "complete" || sealed.ok !== true) {
    throw new Error("review brief may be created only for a complete benchmark report");
  }
  const reportSha256 = text(sealed.reportSha256, "benchmark report SHA-256", SHA256);
  if (!Array.isArray(sealed.outputs) || sealed.outputs.length !== 1) {
    throw new Error("native-720p x2 benchmark review brief requires exactly one sealed output");
  }
  const output = record(sealed.outputs[0], "benchmark output");
  const controllerProof = record(output.controllerProof, "benchmark output controller proof");
  const outputId = text(output.id, "benchmark output id", OUTPUT_ID);
  const outputKey = text(output.key, "benchmark output key", R2_KEY);
  const outputVideoSha256 = text(controllerProof.sha256, "benchmark output SHA-256", SHA256);
  const benchmarkRoot = reportKey.slice(0, -"/report.json".length);

  return Object.freeze({
    contract: LTX25_BENCHMARK_REVIEW_BRIEF_CONTRACT,
    status: "pending_human_visual_review",
    reportKey,
    reportSha256,
    output: Object.freeze({ id: outputId, key: outputKey, videoSha256: outputVideoSha256 }),
    requiredEvidenceKey: `${benchmarkRoot}/review/evidence.json`,
    requiredCriteria: REQUIRED_CRITERIA,
    instructions: "Do not mark this brief as passed. Create retained review frames and a separately immutable ltx-benchmark-review/v2 evidence sidecar for this exact output.",
  });
}
