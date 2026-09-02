import { createHash } from "node:crypto";

import { idempotencyKeys, task, tasks } from "@trigger.dev/sdk";

import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import {
  ERNIE_THUMBNAIL_REFRESH_BATCH_MANIFEST_KEY,
  ERNIE_THUMBNAIL_REFRESH_BATCH_MANIFEST_SHA256,
  ERNIE_THUMBNAIL_REFRESH_BATCH_MODEL_REVISION,
  ERNIE_THUMBNAIL_REFRESH_BATCH_OWNER_ID,
  assertPinnedErnieThumbnailRefreshBatch,
  ernieThumbnailBatchApplyApprovalSubject,
  ernieThumbnailRefreshCandidateCost,
  type ErnieThumbnailRefreshBatchCandidate,
} from "@/lib/ernieThumbnailRefreshBatch";
import { createErnieNovitaThumbnailCurrentCandidateEvidence } from "@/lib/thumbnailRefreshInventory";
import { thumbnailErnieBatchImportApprovalSubject } from "@/lib/thumbnailRefreshCandidate";
import { thumbnailRefreshRuntimeApi } from "@/lib/thumbnailRefreshRuntime";
import {
  issueStudioActionApproval,
  studioActionApprovalFingerprint,
  verifyStudioActionApproval,
  type StudioActionApprovalReceipt,
} from "@/lib/studioActionApproval";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { getObjectBytes, putObject } from "@/lib/storage";
import {
  assertYoutubeThumbnailReplacementDispatch,
  youtubeThumbnailReplacementApprovalSubject,
  youtubeThumbnailReplacementTriggerRequest,
} from "@/lib/youtubeThumbnailReplacement";
import { youtubeThumbnailReplacementRuntimeApi } from "@/lib/youtubeThumbnailReplacementRuntime";

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Payload = Readonly<{
  ownerId: string;
  batchFingerprint: string;
  approval: StudioActionApprovalReceipt;
  approvalFingerprint: string;
}>;

type CandidateShell = Readonly<{
  candidateRunId: Id<"runs">;
  channelId: Id<"channels">;
  sourceRunId: Id<"runs">;
  replayFingerprint: string;
  candidateStatus: string;
  dispatchState: string;
}>;

type ReplacementShell = Readonly<{
  replacementId: Id<"youtubeThumbnailReplacements">;
  channelId: Id<"channels">;
  sourceRunId: Id<"runs">;
  candidateRunId: Id<"runs">;
  youtubeVideoId: string;
  planFingerprint: string;
  dispatchKey: string;
  status: "awaiting_approval" | "pending" | "queued" | "applied" | "blocked";
}>;

function client(): StudioConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("ERNIE thumbnail batch: Convex URL is not configured");
  return new StudioConvexHttpClient(url);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertNativePng(bytes: Uint8Array, candidate: ErnieThumbnailRefreshBatchCandidate): void {
  if (
    bytes.byteLength < PNG_SIGNATURE.length ||
    !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte) ||
    sha256(bytes) !== candidate.artifactSha256
  ) throw new Error(`${candidate.sourceRunId}: staged ERNIE PNG changed from its reviewed hash`);
}

function assertBatchAuthority(payload: Payload): void {
  if (
    payload.ownerId !== ERNIE_THUMBNAIL_REFRESH_BATCH_OWNER_ID ||
    payload.batchFingerprint !== ERNIE_THUMBNAIL_REFRESH_BATCH_MANIFEST_SHA256 ||
    studioActionApprovalFingerprint(payload.approval) !== payload.approvalFingerprint ||
    !verifyStudioActionApproval(payload.approval, {
      action: "thumbnail-ernie-batch-apply",
      ownerId: payload.ownerId,
      subject: ernieThumbnailBatchApplyApprovalSubject({
        ownerId: payload.ownerId,
        batchFingerprint: payload.batchFingerprint,
      }),
    })
  ) throw new Error("ERNIE thumbnail batch owner approval is invalid or expired");
}

async function verifiedSourceBytes() {
  const raw = await getObjectBytes(ERNIE_THUMBNAIL_REFRESH_BATCH_MANIFEST_KEY, undefined, { timeoutMs: 30_000 });
  if (sha256(raw) !== ERNIE_THUMBNAIL_REFRESH_BATCH_MANIFEST_SHA256) {
    throw new Error("ERNIE thumbnail batch manifest bytes changed from the reviewed set");
  }
  const manifest = assertPinnedErnieThumbnailRefreshBatch(JSON.parse(new TextDecoder().decode(raw)) as unknown);
  const staged = await Promise.all(manifest.candidates.map(async (candidate) => {
    const bytes = await getObjectBytes(candidate.ernieSceneKey, undefined, { timeoutMs: 30_000 });
    assertNativePng(bytes, candidate);
    return [candidate.sourceRunId, bytes] as const;
  }));
  return { manifest, bytesBySourceRunId: new Map(staged) };
}

async function importCandidate(args: {
  convex: StudioConvexHttpClient;
  ownerId: string;
  item: ErnieThumbnailRefreshBatchCandidate;
  bytes: Uint8Array;
}): Promise<{ candidateRunId: string; state: "imported" | "already_imported" }> {
  const { convex, ownerId, item, bytes } = args;
  const shell = await convex.mutation(thumbnailRefreshRuntimeApi.createCandidateShell, {
    ownerId,
    sourceRunId: item.sourceRunId as Id<"runs">,
    now: Date.now(),
  } as never) as unknown as CandidateShell;
  if (
    String(shell.sourceRunId) !== item.sourceRunId ||
    String(shell.channelId) !== item.channelId ||
    !/^[a-f0-9]{64}$/.test(shell.replayFingerprint)
  ) throw new Error(`${item.sourceRunId}: Studio source changed from the reviewed ERNIE batch`);
  const candidateRunId = String(shell.candidateRunId);
  if (shell.candidateStatus === "ok" && shell.dispatchState === "consumed") {
    return { candidateRunId, state: "already_imported" };
  }
  if (shell.candidateStatus !== "queued" || shell.dispatchState !== "awaiting_approval") {
    throw new Error(`${item.sourceRunId}: candidate is not available for native ERNIE import`);
  }
  const r2Key = `owner/${ownerId}/channel/${item.channelSlug}/runs/${candidateRunId}/thumbnail.png`;
  try {
    await putObject(r2Key, bytes, {
      contentType: "image/png",
      metadata: {
        producer: "ernie-novita-thumbnail-scene-v1",
        source_run_id: item.sourceRunId,
        ernie_scene_sha256: item.artifactSha256,
      },
      ifNoneMatch: "*",
    });
  } catch (error) {
    const existing = await getObjectBytes(r2Key, undefined, { timeoutMs: 30_000 });
    if (sha256(existing) !== item.artifactSha256) throw error;
  }
  const stored = await getObjectBytes(r2Key, undefined, { timeoutMs: 30_000 });
  assertNativePng(stored, item);
  const evidence = createErnieNovitaThumbnailCurrentCandidateEvidence({
    ownerId,
    channelId: item.channelId,
    runId: candidateRunId,
    r2Key,
    artifactSha256: item.artifactSha256,
    providerRequestSha256: item.providerRequestSha256,
    providerResponseSha256: item.providerResponseSha256,
    modelRevision: ERNIE_THUMBNAIL_REFRESH_BATCH_MODEL_REVISION,
  });
  const approval = issueStudioActionApproval({
    action: "thumbnail-ernie-batch-import",
    ownerId,
    subject: thumbnailErnieBatchImportApprovalSubject({
      ownerId,
      channelId: item.channelId,
      sourceRunId: item.sourceRunId,
      candidateRunId,
      replayFingerprint: shell.replayFingerprint,
      r2Key,
      artifactSha256: item.artifactSha256,
      providerRequestSha256: item.providerRequestSha256,
      providerResponseSha256: item.providerResponseSha256,
    }),
    actor: `authenticated-operator:${ownerId}`,
    evidence: `Owner-confirmed reviewed ERNIE batch ${ERNIE_THUMBNAIL_REFRESH_BATCH_MANIFEST_SHA256}: source ${item.sourceRunId}, native PNG SHA-256 ${item.artifactSha256}.`,
    maxCostUsd: 0.4,
  });
  await convex.mutation(thumbnailRefreshRuntimeApi.importErnieBatchCandidate, {
    ownerId,
    sourceRunId: item.sourceRunId as Id<"runs">,
    candidateRunId: shell.candidateRunId,
    r2Key,
    evidence,
    qa: item.qa,
    batchReceiptKey: item.batchReceiptKey,
    batchResultKey: item.batchResultKey,
    costTotal: ernieThumbnailRefreshCandidateCost(item),
    approval,
    approvalFingerprint: studioActionApprovalFingerprint(approval),
    now: Date.now(),
  } as never);
  return { candidateRunId, state: "imported" };
}

async function queueReplacement(args: {
  convex: StudioConvexHttpClient;
  ownerId: string;
  item: ErnieThumbnailRefreshBatchCandidate;
  candidateRunId: string;
}): Promise<"queued" | "already_queued" | "already_applied"> {
  const { convex, ownerId, item, candidateRunId } = args;
  const shell = await convex.mutation(youtubeThumbnailReplacementRuntimeApi.createPlanShell, {
    ownerId,
    sourceRunId: item.sourceRunId as Id<"runs">,
    candidateRunId: candidateRunId as Id<"runs">,
    youtubeVideoId: item.youtubeVideoId,
    now: Date.now(),
  } as never) as unknown as ReplacementShell;
  if (
    String(shell.sourceRunId) !== item.sourceRunId ||
    String(shell.candidateRunId) !== candidateRunId ||
    shell.youtubeVideoId !== item.youtubeVideoId
  ) throw new Error(`${item.sourceRunId}: YouTube replacement plan changed from the reviewed binding`);
  if (shell.status === "applied") return "already_applied";
  if (shell.status === "queued") return "already_queued";
  if (shell.status === "blocked") throw new Error(`${item.sourceRunId}: YouTube replacement is blocked`);
  if (shell.status === "awaiting_approval") {
    const approval = issueStudioActionApproval({
      action: "youtube-thumbnail-replacement",
      ownerId,
      subject: youtubeThumbnailReplacementApprovalSubject({
        replacementId: String(shell.replacementId),
        planFingerprint: shell.planFingerprint,
        dispatchKey: shell.dispatchKey,
      }),
      actor: `authenticated-operator:${ownerId}`,
      evidence: `Owner-confirmed reviewed ERNIE batch ${ERNIE_THUMBNAIL_REFRESH_BATCH_MANIFEST_SHA256}: exact YouTube video ${item.youtubeVideoId}.`,
    });
    await convex.mutation(youtubeThumbnailReplacementRuntimeApi.claimApproval, {
      ownerId,
      replacementId: shell.replacementId,
      planFingerprint: shell.planFingerprint,
      approval,
      approvalFingerprint: studioActionApprovalFingerprint(approval),
      now: Date.now(),
    } as never);
  }
  const raw = await convex.query(youtubeThumbnailReplacementRuntimeApi.getDispatch, {
    ownerId,
    replacementId: shell.replacementId,
  } as never);
  const dispatch = assertYoutubeThumbnailReplacementDispatch(raw);
  if (dispatch.candidateArtifactSha256 !== item.artifactSha256) {
    throw new Error(`${item.sourceRunId}: replacement candidate bytes differ from the reviewed ERNIE image`);
  }
  const triggerRequest = youtubeThumbnailReplacementTriggerRequest(dispatch);
  const attempt = dispatch.dispatchAttempt + 1;
  try {
    const idempotencyKey = await idempotencyKeys.create(triggerRequest.idempotencySeed, { scope: "global" });
    const handle = await tasks.trigger(triggerRequest.taskId, triggerRequest.payload, {
      concurrencyKey: triggerRequest.concurrencyKey,
      idempotencyKey,
    });
    await convex.mutation(youtubeThumbnailReplacementRuntimeApi.markQueued, {
      ownerId,
      replacementId: shell.replacementId,
      triggerRunId: handle.id,
      attempt,
      now: Date.now(),
    } as never);
  } catch (error) {
    await convex.mutation(youtubeThumbnailReplacementRuntimeApi.recordFailure, {
      ownerId,
      replacementId: shell.replacementId,
      attempt,
      error: error instanceof Error ? error.message : String(error),
      now: Date.now(),
    } as never);
    throw error;
  }
  return "queued";
}

export async function executeErnieThumbnailBatchApply(payload: Payload) {
  await bootstrapSecrets(() => {}, {
    required: ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "STUDIO_CONVEX_JWT_PRIVATE_KEY"],
  });
  assertBatchAuthority(payload);
  const { manifest, bytesBySourceRunId } = await verifiedSourceBytes();
  const convex = client();
  const results: Array<{ sourceRunId: string; state: string; error?: string }> = [];
  for (const item of manifest.candidates) {
    try {
      const bytes = bytesBySourceRunId.get(item.sourceRunId);
      if (!bytes) throw new Error("verified ERNIE source bytes are unavailable");
      const candidate = await importCandidate({ convex, ownerId: payload.ownerId, item, bytes });
      const replacement = await queueReplacement({
        convex,
        ownerId: payload.ownerId,
        item,
        candidateRunId: candidate.candidateRunId,
      });
      results.push({ sourceRunId: item.sourceRunId, state: `${candidate.state}:${replacement}` });
    } catch (error) {
      results.push({
        sourceRunId: item.sourceRunId,
        state: "blocked",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    ok: results.every((result) => result.state !== "blocked"),
    batchFingerprint: ERNIE_THUMBNAIL_REFRESH_BATCH_MANIFEST_SHA256,
    total: results.length,
    queued: results.filter((result) => result.state.endsWith(":queued")).length,
    alreadyApplied: results.filter((result) => result.state.endsWith(":already_applied")).length,
    blocked: results.filter((result) => result.state === "blocked"),
  };
}

export const ernieThumbnailBatchApplyTask = task({
  id: "ernie-thumbnail-batch-apply",
  machine: "small-1x",
  maxDuration: 300,
  retry: { maxAttempts: 1 },
  queue: { concurrencyLimit: 1 },
  run: async (payload: Payload) => executeErnieThumbnailBatchApply(payload),
});
