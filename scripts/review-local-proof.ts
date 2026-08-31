/**
 * Independent final-review driver for local, explicitly non-publishable proof
 * renders. It never creates a channel, touches Convex/R2, or uploads media.
 *
 * Usage:
 *   npm exec tsx -- scripts/review-local-proof.ts \
 *     --video output/whiteboard/<run>/out.mp4 \
 *     --lane whiteboard_explainer --renderer whiteboard_scribe \
 *     --title "A truthful title" --run-id local-proof-id
 *
 * OPENROUTER_API_KEY is intentionally the only eligible reviewer credential.
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import {
  channelVisualReviewProfile,
  reviewRender,
} from "../src/lib/visualReview";
import { localProofBroadFrameBudget } from "../src/lib/localProofReviewBudget";
import { localProofReviewAudit } from "../src/lib/localProofReviewReport";
import type { ContentLaneKey } from "../src/engine/contentLane";

const execFileAsync = promisify(execFile);
const MIN_PROOF_BROAD_QUALITY_SCORE = 7;

type Args = Readonly<{
  video: string;
  lane: ContentLaneKey;
  renderer: string;
  title: string;
  runId: string;
}>;

function readArgs(argv: readonly string[]): Args {
  const values = new Map<string, string>();
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value?.trim()) {
      throw new Error("Expected --video --lane --renderer --title --run-id arguments");
    }
    values.set(key.slice(2), value.trim());
  }
  const required = ["video", "lane", "renderer", "title", "run-id"] as const;
  for (const key of required) {
    if (!values.get(key)) throw new Error(`Missing --${key}`);
  }
  const runId = values.get("run-id")!;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(runId)) {
    throw new Error("--run-id must be a safe local run identifier");
  }
  return {
    video: resolve(values.get("video")!),
    lane: values.get("lane")! as ContentLaneKey,
    renderer: values.get("renderer")!,
    title: values.get("title")!,
    runId,
  };
}

async function durationSec(video: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    video,
  ]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration < 3) {
    throw new Error(`Unable to read a usable duration from ${video}`);
  }
  return duration;
}

async function main(): Promise<void> {
  const args = readArgs(process.argv);
  const bytes = await readFile(args.video);
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  const duration = await durationSec(args.video);
  // Long-form proof renders must meet the same evidence-gap rule as final QA.
  // A fixed 16-frame sample silently became insufficient above roughly two
  // minutes. The resulting frame count scales with the permitted gap and is
  // then split by reviewRender at the provider's real image cap; it must never
  // be silently reduced to a cheaper representative sample.
  const proofBroadFrameBudget = localProofBroadFrameBudget(duration);
  const profile = channelVisualReviewProfile({
    contentLaneKey: args.lane,
    primaryRenderer: args.renderer,
    requireSpecificLaneProfile: true,
  });
  const result = await reviewRender(args.video, duration, {
    title: args.title,
    expectTitleCard: false,
    expectOutroCard: false,
    ...profile,
  }, {
    runId: args.runId,
    required: true,
    persistEvidence: false,
    maxFrames: proofBroadFrameBudget,
    maxFocusFrames: 0,
    collectBroadQualityScore: true,
    requireBroadQualityScore: true,
    sourceSha256,
    log: (line) => console.error(`[local-proof-review] ${line}`),
  });
  const reportPath = resolve(dirname(args.video), "final-local-proof-review.json");
  const audit = localProofReviewAudit({
    artifactPath: args.video,
    durationSec: duration,
    review: result,
  });
  await writeFile(reportPath, JSON.stringify({
    contract: "local-proof-final-review/v1",
    status: "reviewed_not_publishable",
    videoPath: args.video,
    sourceSha256,
    durationSec: duration,
    lane: args.lane,
    renderer: args.renderer,
    requiredBroadQualityScore: MIN_PROOF_BROAD_QUALITY_SCORE,
    audit,
    review: result,
  }, null, 2), "utf8");
  if (result.verdict !== "pass") {
    throw new Error(`Local proof final review is ${result.verdict}; retained ${reportPath}`);
  }
  // A proof render exists to expose craft defects before a production route
  // inherits it. Minor findings are still findings: do not normalize a known
  // issue merely because the production verdict reserves hard failure for
  // major/critical defects.
  if (result.defects.length > 0) {
    throw new Error(`Local proof final review found ${result.defects.length} defect(s); retained ${reportPath}`);
  }
  if ((result.broadQualityScore?.score ?? 0) < MIN_PROOF_BROAD_QUALITY_SCORE) {
    throw new Error(
      `Local proof broad quality ${result.broadQualityScore?.score ?? "missing"} is below ${MIN_PROOF_BROAD_QUALITY_SCORE}; retained ${reportPath}`,
    );
  }
  console.log(JSON.stringify({
    status: "passed_not_publishable",
    reportPath,
    durationSec: duration,
    framesReviewed: result.evidence.frames.length,
    broadQualityScore: result.broadQualityScore?.score,
    maxGapSec: result.evidence.coverage.maxGapSec,
    reviewFingerprint: result.reviewFingerprint,
  }, null, 2));
}

void main();
