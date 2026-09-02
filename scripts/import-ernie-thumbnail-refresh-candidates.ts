/**
 * Admit QA-passed ERNIE thumbnail refresh artifacts as private Studio
 * candidates. It deliberately cannot queue a YouTube change: the normal
 * per-video replacement plan and its separate approval remain required.
 *
 * Set ERNIE_THUMBNAIL_IMPORT_EXECUTE=1 only after inspecting the batch review.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { config } from "dotenv";

import type { Id } from "../convex/_generated/dataModel";
import { thumbnailGoldenGatePassed } from "@/engine/qualityPolicy";
import { createErnieNovitaThumbnailCurrentCandidateEvidence } from "@/lib/thumbnailRefreshInventory";
import { thumbnailErnieBatchImportApprovalSubject } from "@/lib/thumbnailRefreshCandidate";
import { thumbnailRefreshRuntimeApi } from "@/lib/thumbnailRefreshRuntime";
import {
  issueStudioActionApproval,
  studioActionApprovalFingerprint,
} from "@/lib/studioActionApproval";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { getObjectBytes, putObject } from "@/lib/storage";

config({ path: process.env.ERNIE_THUMBNAIL_STUDIO_ENV_FILE?.trim() || ".env.local" });

const OWNER_ID = process.env.ERNIE_THUMBNAIL_OWNER_ID?.trim() || "owner_daniel";
const PLAN_DIR = process.env.ERNIE_THUMBNAIL_PLAN_DIR?.trim() || "/tmp/ysa-ernie-thumbnail-refresh-v1";
const REVIEW_FILE = process.env.ERNIE_THUMBNAIL_REVIEW_FILE?.trim() || join(PLAN_DIR, "review", "batch-review.json");
const REVIEW_FILES = (process.env.ERNIE_THUMBNAIL_REVIEW_FILES ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const REQUIRE_COMPLETE_SET = process.env.ERNIE_THUMBNAIL_REQUIRE_COMPLETE_SET === "1";
const EXECUTE = process.env.ERNIE_THUMBNAIL_IMPORT_EXECUTE === "1";
const SHA256 = /^[a-f0-9]{64}$/;
const ERNIE_MODEL_REVISION = "01bcb3f1acdb1454ee579d2796ecc4c156873eea";
const ERNIE_SPOT_HOURLY_USD = 0.335;
const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type ThumbnailGateVerdict = Readonly<{
  textOk: boolean;
  faceClear: boolean;
  punch: number;
  styleMatch: number;
  storyMatch: number;
  uiClean: boolean;
  visualTreatmentCompliant?: boolean;
  reason: string;
}>;

type ReviewedArtifact = Readonly<{
  sourceRunId: string;
  channelId: string;
  channelSlug: string;
  title: string;
  expectedWords: string[];
  pattern: string;
  scenePromptSha256: string;
  ernieSceneKey: string;
  ernieSceneSha256: string;
  finalPath: string;
  finalSha256: string;
  qa: ThumbnailGateVerdict;
}>;

type BatchReview = Readonly<{
  version: 1;
  controller: {
    jobId: string;
    rootOutputKey: string;
    receiptKey: string;
    providerResponseSha256: string;
    elapsedSeconds: number;
  };
  reviewed: ReviewedArtifact[];
}>;

type CandidateShell = Readonly<{
  candidateRunId: Id<"runs">;
  channelId: Id<"channels">;
  sourceRunId: Id<"runs">;
  replayFingerprint: string;
  candidateStatus: string;
  dispatchState: string;
}>;

type ReviewedCandidate = Readonly<{
  artifact: ReviewedArtifact;
  controller: BatchReview["controller"];
  sourceReviewCount: number;
  reviewFile: string;
}>;

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function passed(qa: ThumbnailGateVerdict): boolean {
  return thumbnailGoldenGatePassed(qa);
}

function assertQa(value: unknown): asserts value is ThumbnailGateVerdict {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("candidate QA is invalid");
  const qa = value as Partial<ThumbnailGateVerdict>;
  if (
    typeof qa.textOk !== "boolean" || typeof qa.faceClear !== "boolean" || typeof qa.uiClean !== "boolean" ||
    typeof qa.visualTreatmentCompliant !== "boolean" ||
    !Number.isFinite(qa.punch) || !Number.isFinite(qa.styleMatch) || !Number.isFinite(qa.storyMatch) ||
    typeof qa.reason !== "string" || !qa.reason.trim()
  ) throw new Error("candidate QA lacks its complete gate verdict");
}

function assertReview(value: unknown): asserts value is BatchReview {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("batch review is invalid");
  const review = value as Partial<BatchReview>;
  const controller = review.controller;
  if (
    review.version !== 1 || !controller || !Array.isArray(review.reviewed) || !review.reviewed.length ||
    typeof controller.jobId !== "string" || !controller.jobId ||
    typeof controller.rootOutputKey !== "string" || !controller.rootOutputKey.startsWith("projects/novita-thumbnail-batch/jobs/") ||
    typeof controller.receiptKey !== "string" || !controller.receiptKey.startsWith("projects/novita-thumbnail-batch/jobs/") ||
    !SHA256.test(String(controller.providerResponseSha256)) ||
    !Number.isFinite(controller.elapsedSeconds) || controller.elapsedSeconds < 0
  ) throw new Error("batch review lacks an immutable ERNIE controller identity");
  const seen = new Set<string>();
  for (const item of review.reviewed) {
    if (
      !item || typeof item.sourceRunId !== "string" || !item.sourceRunId || seen.has(item.sourceRunId) ||
      typeof item.channelId !== "string" || !item.channelId || typeof item.channelSlug !== "string" || !item.channelSlug ||
      !SHA256.test(item.scenePromptSha256) || !SHA256.test(item.finalSha256) ||
      !SHA256.test(item.ernieSceneSha256) || item.finalSha256 !== item.ernieSceneSha256 ||
      typeof item.finalPath !== "string" || !item.finalPath || !item.qa
    ) throw new Error("batch review includes an invalid candidate");
    assertQa(item.qa);
    seen.add(item.sourceRunId);
  }
}

/**
 * The native-typography route has no compositor: the exact signed ERNIE PNG
 * reviewed by QA is the exact object that may be admitted to Studio. Read the
 * modest thumbnail asset once and retain those bytes for upload, so a changed
 * local file cannot be labeled with an older review hash after QA completed.
 */
async function readVerifiedNativeErniePng(item: ReviewedArtifact): Promise<Uint8Array> {
  const bytes = new Uint8Array(await readFile(item.finalPath));
  if (bytes.byteLength < PNG_SIGNATURE.length || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new Error(`${item.sourceRunId}: reviewed ERNIE artifact is not a PNG`);
  }
  if (sha256(bytes) !== item.finalSha256) {
    throw new Error(`${item.sourceRunId}: reviewed ERNIE artifact bytes no longer match the QA hash`);
  }
  return bytes;
}

function client(): StudioConvexHttpClient {
  const address = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!address) throw new Error("NEXT_PUBLIC_CONVEX_URL is required");
  return new StudioConvexHttpClient(address);
}

function estimatedPerCandidateCost(candidate: ReviewedCandidate): number {
  // Novita exposes the exact elapsed worker lifetime but no per-output invoice.
  // Store the reproducible proportional spot estimate rather than fabricate a
  // provider charge. The import mutation independently caps it at $0.40.
  const estimate = (candidate.controller.elapsedSeconds / 3_600 * ERNIE_SPOT_HOURLY_USD) / candidate.sourceReviewCount;
  return Math.min(0.4, Math.max(0, Number(estimate.toFixed(6))));
}

function reviewFiles(): string[] {
  return REVIEW_FILES.length ? REVIEW_FILES : [REVIEW_FILE];
}

async function reviewedCandidates(files: readonly string[]): Promise<ReviewedCandidate[]> {
  const selected = new Map<string, ReviewedCandidate>();
  for (const reviewFile of files) {
    const review = JSON.parse(await readFile(reviewFile, "utf8")) as unknown;
    assertReview(review);
    for (const artifact of review.reviewed) {
      if (!passed(artifact.qa)) continue;
      // Review files are ordered from the original batch to later repairs. A
      // succeeding repair deliberately supersedes the prior passing candidate
      // for the same source run; failed repairs never displace good pixels.
      selected.set(artifact.sourceRunId, {
        artifact,
        controller: review.controller,
        sourceReviewCount: review.reviewed.length,
        reviewFile,
      });
    }
  }
  if (!selected.size) throw new Error("no passing ERNIE thumbnail candidates were found");
  return [...selected.values()].sort((left, right) => left.artifact.sourceRunId.localeCompare(right.artifact.sourceRunId));
}

async function assertCompleteCandidateSet(candidates: readonly ReviewedCandidate[]): Promise<void> {
  if (!REQUIRE_COMPLETE_SET) return;
  const manifest = JSON.parse(await readFile(join(PLAN_DIR, "manifest.json"), "utf8")) as {
    planned?: Array<{ sourceRunId?: unknown }>;
  };
  if (!Array.isArray(manifest.planned) || !manifest.planned.length) {
    throw new Error("complete-set import requires a manifest with planned non-LoFi candidates");
  }
  const expected = new Set(manifest.planned.map((item) => item.sourceRunId).filter((value): value is string => typeof value === "string"));
  if (expected.size !== manifest.planned.length) throw new Error("planned manifest has duplicate or invalid source run ids");
  const actual = new Set(candidates.map((candidate) => candidate.artifact.sourceRunId));
  const missing = [...expected].filter((id) => !actual.has(id));
  const unexpected = [...actual].filter((id) => !expected.has(id));
  if (missing.length || unexpected.length) {
    throw new Error(`complete-set ERNIE import mismatch: missing=${missing.join(",") || "none"}; unexpected=${unexpected.join(",") || "none"}`);
  }
}

async function main(): Promise<void> {
  const files = reviewFiles();
  const candidates = await reviewedCandidates(files);
  await assertCompleteCandidateSet(candidates);
  // Validate source bytes even for a dry run. This turns the operator-facing
  // review command into an immutable-artifact preflight, rather than merely a
  // count of JSON records that happened to pass at an earlier time.
  for (const { artifact } of candidates) await readVerifiedNativeErniePng(artifact);
  const summaryPath = join(PLAN_DIR, "review", "batch-import.json");
  await mkdir(join(PLAN_DIR, "review"), { recursive: true });
  const dryRun = candidates.map(({ artifact, controller, reviewFile }) => ({
    sourceRunId: artifact.sourceRunId,
    channelSlug: artifact.channelSlug,
    finalSha256: artifact.finalSha256,
    qa: artifact.qa,
    receiptKey: controller.receiptKey,
    reviewFile,
  }));
  if (!EXECUTE) {
    await writeFile(summaryPath, `${JSON.stringify({ version: 2, mode: "dry_run", reviewFiles: files, candidates: dryRun }, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ event: "dry-run", candidates: dryRun.length, summaryPath }));
    return;
  }

  const convex = client();
  const imported: Array<Record<string, unknown>> = [];
  for (const candidate of candidates) {
    const { artifact: item, controller } = candidate;
    const finalBytes = await readVerifiedNativeErniePng(item);
    const costTotal = estimatedPerCandidateCost(candidate);
    const shell = await convex.mutation(thumbnailRefreshRuntimeApi.createCandidateShell, {
      ownerId: OWNER_ID,
      sourceRunId: item.sourceRunId as Id<"runs">,
      now: Date.now(),
    } as never) as unknown as CandidateShell;
    if (
      String(shell.sourceRunId) !== item.sourceRunId || String(shell.channelId) !== item.channelId ||
      !SHA256.test(shell.replayFingerprint)
    ) throw new Error(`${item.sourceRunId}: candidate shell changed from the reviewed source`);
    const candidateRunId = String(shell.candidateRunId);
    if (shell.candidateStatus === "ok" && shell.dispatchState === "consumed") {
      imported.push({ sourceRunId: item.sourceRunId, candidateRunId, state: "already_imported" });
      continue;
    }
    if (shell.candidateStatus !== "queued" || shell.dispatchState !== "awaiting_approval") {
      throw new Error(`${item.sourceRunId}: candidate shell is not available for ERNIE import`);
    }
    // This is ERNIE's original PNG, including its native typography. The
    // route may not transcode it to JPEG or add deterministic text locally.
    const r2Key = `owner/${OWNER_ID}/channel/${item.channelSlug}/runs/${candidateRunId}/thumbnail.png`;
    try {
      await putObject(r2Key, finalBytes, {
        contentType: "image/png",
        metadata: {
          producer: "ernie-novita-thumbnail-scene-v1",
          source_run_id: item.sourceRunId,
          ernie_scene_sha256: item.ernieSceneSha256,
        },
        ifNoneMatch: "*",
      });
    } catch (error) {
      // Resume only when a prior interrupted import left exactly the reviewed
      // bytes at the candidate-bound key; never overwrite unknown data.
      const existing = await getObjectBytes(r2Key);
      if (sha256(existing) !== item.finalSha256) throw error;
    }
    const evidence = createErnieNovitaThumbnailCurrentCandidateEvidence({
      ownerId: OWNER_ID,
      channelId: item.channelId,
      runId: candidateRunId,
      r2Key,
      artifactSha256: item.finalSha256,
      providerRequestSha256: item.scenePromptSha256,
      providerResponseSha256: controller.providerResponseSha256,
      modelRevision: ERNIE_MODEL_REVISION,
    });
    const subject = thumbnailErnieBatchImportApprovalSubject({
      ownerId: OWNER_ID,
      channelId: item.channelId,
      sourceRunId: item.sourceRunId,
      candidateRunId,
      replayFingerprint: shell.replayFingerprint,
      r2Key,
      artifactSha256: item.finalSha256,
      providerRequestSha256: item.scenePromptSha256,
      providerResponseSha256: controller.providerResponseSha256,
    });
    const approval = issueStudioActionApproval({
      action: "thumbnail-ernie-batch-import",
      ownerId: OWNER_ID,
      subject,
      actor: `authenticated-operator:${OWNER_ID}`,
      evidence: `Owner-authorized ERNIE-Novita thumbnail refresh: source ${item.sourceRunId}, final SHA-256 ${item.finalSha256}, QA gate passed.`,
      maxCostUsd: 0.4,
    });
    const result = await convex.mutation(thumbnailRefreshRuntimeApi.importErnieBatchCandidate, {
      ownerId: OWNER_ID,
      sourceRunId: item.sourceRunId as Id<"runs">,
      candidateRunId: shell.candidateRunId,
      r2Key,
      evidence,
      qa: item.qa,
      batchReceiptKey: controller.receiptKey,
      batchResultKey: controller.rootOutputKey,
      costTotal,
      approval,
      approvalFingerprint: studioActionApprovalFingerprint(approval),
      now: Date.now(),
    } as never) as unknown;
    imported.push({ sourceRunId: item.sourceRunId, candidateRunId, state: "imported", result });
    await writeFile(summaryPath, `${JSON.stringify({
      version: 2,
      mode: "executed",
      reviewFiles: files,
      imported,
    }, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify({ event: "imported", candidates: imported.length, summaryPath }));
}

main().catch((error: unknown) => {
  console.error(`import-ernie-thumbnail-refresh-candidates: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
