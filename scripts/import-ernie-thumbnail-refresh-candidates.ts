/**
 * Admit QA-passed ERNIE thumbnail refresh artifacts as private Studio
 * candidates. It deliberately cannot queue a YouTube change: the normal
 * per-video replacement plan and its separate approval remain required.
 *
 * Set ERNIE_THUMBNAIL_IMPORT_EXECUTE=1 only after inspecting the batch review.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { config } from "dotenv";

import type { Id } from "../convex/_generated/dataModel";
import { createErnieNovitaThumbnailCurrentCandidateEvidence } from "@/lib/thumbnailRefreshInventory";
import { thumbnailErnieBatchImportApprovalSubject } from "@/lib/thumbnailRefreshCandidate";
import { thumbnailRefreshRuntimeApi } from "@/lib/thumbnailRefreshRuntime";
import {
  issueStudioActionApproval,
  studioActionApprovalFingerprint,
} from "@/lib/studioActionApproval";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { getObjectBytes, putObjectFromFile } from "@/lib/storage";

config({ path: process.env.ERNIE_THUMBNAIL_STUDIO_ENV_FILE?.trim() || ".env.local" });

const OWNER_ID = process.env.ERNIE_THUMBNAIL_OWNER_ID?.trim() || "owner_daniel";
const PLAN_DIR = process.env.ERNIE_THUMBNAIL_PLAN_DIR?.trim() || "/tmp/ysa-ernie-thumbnail-refresh-v1";
const REVIEW_FILE = process.env.ERNIE_THUMBNAIL_REVIEW_FILE?.trim() || join(PLAN_DIR, "review", "batch-review.json");
const EXECUTE = process.env.ERNIE_THUMBNAIL_IMPORT_EXECUTE === "1";
const SHA256 = /^[a-f0-9]{64}$/;
const ERNIE_MODEL_REVISION = "01bcb3f1acdb1454ee579d2796ecc4c156873eea";
const ERNIE_SPOT_HOURLY_USD = 0.335;

type ThumbnailGateVerdict = Readonly<{
  textOk: boolean;
  faceClear: boolean;
  punch: number;
  styleMatch: number;
  storyMatch: number;
  uiClean: boolean;
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

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function passed(qa: ThumbnailGateVerdict): boolean {
  return qa.textOk && qa.faceClear && qa.punch >= 7 && qa.styleMatch >= 7 && qa.storyMatch >= 7 && qa.uiClean;
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
      !SHA256.test(item.ernieSceneSha256) || typeof item.finalPath !== "string" || !item.finalPath ||
      !item.qa || !passed(item.qa)
    ) throw new Error("batch review includes a non-admissible candidate");
    seen.add(item.sourceRunId);
  }
}

function client(): StudioConvexHttpClient {
  const address = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!address) throw new Error("NEXT_PUBLIC_CONVEX_URL is required");
  return new StudioConvexHttpClient(address);
}

function estimatedPerCandidateCost(review: BatchReview): number {
  // Novita exposes the exact elapsed worker lifetime but no per-output invoice.
  // Store the reproducible proportional spot estimate rather than fabricate a
  // provider charge. The import mutation independently caps it at $0.40.
  const estimate = (review.controller.elapsedSeconds / 3_600 * ERNIE_SPOT_HOURLY_USD) / review.reviewed.length;
  return Math.min(0.4, Math.max(0, Number(estimate.toFixed(6))));
}

async function main(): Promise<void> {
  const review = JSON.parse(await readFile(REVIEW_FILE, "utf8")) as unknown;
  assertReview(review);
  const summaryPath = join(PLAN_DIR, "review", "batch-import.json");
  const dryRun = review.reviewed.map((item) => ({
    sourceRunId: item.sourceRunId,
    channelSlug: item.channelSlug,
    finalSha256: item.finalSha256,
    qa: item.qa,
  }));
  if (!EXECUTE) {
    await writeFile(summaryPath, `${JSON.stringify({ version: 1, mode: "dry_run", candidates: dryRun }, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ event: "dry-run", candidates: dryRun.length, summaryPath }));
    return;
  }

  const convex = client();
  const imported: Array<Record<string, unknown>> = [];
  const costTotal = estimatedPerCandidateCost(review);
  for (const item of review.reviewed) {
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
      await putObjectFromFile(r2Key, item.finalPath, {
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
      providerResponseSha256: review.controller.providerResponseSha256,
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
      providerResponseSha256: review.controller.providerResponseSha256,
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
      batchReceiptKey: review.controller.receiptKey,
      batchResultKey: review.controller.rootOutputKey,
      costTotal,
      approval,
      approvalFingerprint: studioActionApprovalFingerprint(approval),
      now: Date.now(),
    } as never) as unknown;
    imported.push({ sourceRunId: item.sourceRunId, candidateRunId, state: "imported", result });
    await writeFile(summaryPath, `${JSON.stringify({
      version: 1,
      mode: "executed",
      controller: review.controller,
      estimatedPerCandidateCostUsd: costTotal,
      imported,
    }, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify({ event: "imported", candidates: imported.length, summaryPath }));
}

main().catch((error: unknown) => {
  console.error(`import-ernie-thumbnail-refresh-candidates: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
