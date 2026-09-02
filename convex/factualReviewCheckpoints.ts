import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import {
  FACTUAL_REVIEW_CHECKPOINT_VERSION,
  FACTUAL_REVIEW_REQUIRED_ARTIFACTS,
  assertFactualReviewArtifactBindings,
  factualReviewApprovalFingerprint,
  factualReviewCheckpointFingerprint,
  factualReviewSourceAuthorityFromInvocation,
  type FactualReviewArtifactBinding,
  type FactualReviewSourceAuthority,
} from "../src/engine/factualReviewCheckpoint";
import { canonicalJson } from "../src/lib/canonicalJson";
import { assertPlanWeekPreparationPointer } from "../src/lib/planWeekPreparation";
import { assertRunExecutionWriteFence, RUN_QUEUE_LEASE_MS } from "../src/lib/runLease";
import { sha256Hex } from "../src/lib/sha256";

const MAX_FACTUAL_REVIEW_RESUME_ENQUEUE_ATTEMPTS = 2;
// The continuation shares its channel-level Trigger queue with long-form
// generation. Use the same bounded three-hour queue lease, rather than a
// short dispatcher timeout that would duplicate a healthy serialized wait.
const FACTUAL_REVIEW_RESUME_QUEUE_LEASE_MS = RUN_QUEUE_LEASE_MS;

type ReviewCtx = MutationCtx | QueryCtx;
type UnknownRecord = Record<string, unknown>;
type ReviewRun = Doc<"runs">;
type ReviewCheckpoint = {
  _id: Id<"factualReviewCheckpoints">;
  ownerId: string;
  channelId: Id<"channels">;
  runId: Id<"runs">;
  version: typeof FACTUAL_REVIEW_CHECKPOINT_VERSION;
  invocationSha256: string;
  sourceAuthority: FactualReviewSourceAuthority;
  artifacts: FactualReviewArtifactBinding[];
  checkpointFingerprint: string;
  decision: "awaiting" | "approved" | "rejected" | "blocked";
  createdAt: number;
  reviewerId?: string;
  approvedAt?: number;
  rejectedAt?: number;
  blockedAt?: number;
  blockedReason?: string;
  approvalFingerprint?: string;
};

function asRecord(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as UnknownRecord;
}

function validText(value: unknown, label: string, max = 1_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function validFingerprint(value: unknown, label: string): string {
  const fingerprint = validText(value, label, 80);
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error(`${label} must be sha256`);
  return fingerprint;
}

function clearExecutionLeasePatch() {
  return {
    leaseExpiresAt: undefined,
    leaseOwner: undefined,
    leaseRecoveryPending: undefined,
    remoteChildWaitLeaseOwner: undefined,
    remoteChildWaitExecutionLeaseToken: undefined,
    remoteChildWaitBlockId: undefined,
    remoteChildWaitDispatchKey: undefined,
    remoteChildWaitUntil: undefined,
    remoteChildWaitDeadline: undefined,
  };
}

function terminalRunPatch(now: number, error: string) {
  return {
    status: "factual_review_blocked" as const,
    factualReviewState: "blocked" as const,
    factualReviewResumeState: "blocked" as const,
    factualReviewResumeUpdatedAt: now,
    factualReviewResumeQueueDeadlineAt: undefined,
    factualReviewResumeLastError: error,
    error,
    finishedAt: now,
    heartbeatAt: now,
    ...clearExecutionLeasePatch(),
  };
}

function factualReviewResumeQueueDeadline(run: ReviewRun): number | undefined {
  const explicit = run.factualReviewResumeQueueDeadlineAt;
  if (explicit !== undefined) {
    return Number.isSafeInteger(explicit) && explicit >= 0 ? explicit : undefined;
  }
  // Existing queued continuation receipts predate the explicit deadline. Their
  // durable queued timestamp is enough to give them the same bounded recovery
  // behavior after this migration, rather than leaving them invisible forever.
  const queuedAt = run.factualReviewResumeQueuedAt;
  if (!Number.isSafeInteger(queuedAt) || (queuedAt as number) < 0) return undefined;
  const deadline = (queuedAt as number) + FACTUAL_REVIEW_RESUME_QUEUE_LEASE_MS;
  return Number.isSafeInteger(deadline) ? deadline : undefined;
}

function checkpointFromDoc(value: unknown): ReviewCheckpoint {
  return value as ReviewCheckpoint;
}

async function ownedRun(
  ctx: ReviewCtx,
  args: { ownerId: string; channelId: Id<"channels">; runId: Id<"runs"> },
) {
  const [channel, run] = await Promise.all([ctx.db.get(args.channelId), ctx.db.get(args.runId)]);
  if (!channel || channel.ownerId !== args.ownerId) {
    throw new Error("factual review channel ownership mismatch");
  }
  if (!run || run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
    throw new Error("factual review run ownership/channel mismatch");
  }
  return run;
}

async function checkpointForRun(ctx: ReviewCtx, runId: Id<"runs">): Promise<ReviewCheckpoint | null> {
  const rows = await ctx.db
    .query("factualReviewCheckpoints")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .take(2);
  if (rows.length > 1) throw new Error("factual review run has more than one immutable checkpoint");
  return rows[0] ? checkpointFromDoc(rows[0]) : null;
}

async function ownedCheckpoint(
  ctx: ReviewCtx,
  ownerId: string,
  checkpointId: Id<"factualReviewCheckpoints">,
): Promise<ReviewCheckpoint> {
  const checkpoint = await ctx.db.get(checkpointId);
  if (!checkpoint || checkpoint.ownerId !== ownerId) {
    throw new Error("factual review checkpoint not found");
  }
  return checkpointFromDoc(checkpoint);
}

function outputForStage(stage: unknown, block: string): UnknownRecord {
  const row = asRecord(stage, `factual review ${block} stage`);
  if (row["status"] !== "ok") throw new Error(`factual review ${block} stage is not retained as ok`);
  return asRecord(row["outputs"], `factual review ${block} outputs`);
}

/**
 * Resolves the exact current stage output to its content-addressed artifact.
 * If an upstream self-heal left historical artifacts behind, only a hash that
 * matches the current durable stage output is eligible for the checkpoint.
 */
async function retainedArtifactsForRun(
  ctx: ReviewCtx,
  runId: Id<"runs">,
): Promise<{ artifacts: readonly FactualReviewArtifactBinding[]; stages: Map<string, UnknownRecord> }> {
  const [stageRows, artifactRows] = await Promise.all([
    ctx.db.query("runStages").withIndex("by_run", (q) => q.eq("runId", runId)).collect(),
    ctx.db.query("runArtifacts").withIndex("by_run", (q) => q.eq("runId", runId)).collect(),
  ]);
  const stageRowsByBlock = new Map<string, unknown>();
  for (const row of stageRows) {
    const stage = asRecord(row, "factual review stage");
    stageRowsByBlock.set(validText(stage["block"], "factual review stage block", 160), stage);
  }
  const stages = new Map<string, UnknownRecord>();
  for (const block of new Set(FACTUAL_REVIEW_REQUIRED_ARTIFACTS.map((requirement) => requirement.producerModule))) {
    const stage = stageRowsByBlock.get(block);
    if (!stage) throw new Error(`factual review retained ${block} stage is missing`);
    stages.set(block, outputForStage(stage, block));
  }

  const bound: FactualReviewArtifactBinding[] = [];
  for (const requirement of FACTUAL_REVIEW_REQUIRED_ARTIFACTS) {
    const outputs = stages.get(requirement.producerModule);
    if (!outputs || !(requirement.key in outputs)) {
      throw new Error(`factual review retained stage output is missing: ${requirement.key}`);
    }
    const payloadHash = sha256Hex(canonicalJson(outputs[requirement.key]));
    const candidates = artifactRows
      .filter((artifact) =>
        artifact.key === requirement.key &&
        artifact.producerModule === requirement.producerModule &&
        artifact.payloadHash === payloadHash,
      )
      .sort((left, right) =>
        (right.createdAt - left.createdAt) || String(left.artifactId).localeCompare(String(right.artifactId)),
      );
    const artifact = candidates[0];
    if (!artifact) {
      throw new Error(`factual review immutable artifact is missing or corrupt: ${requirement.key}`);
    }
    bound.push({
      key: requirement.key,
      artifactId: validText(artifact.artifactId, `factual review ${requirement.key} artifact id`, 500),
      payloadHash: validFingerprint(artifact.payloadHash, `factual review ${requirement.key} payload hash`),
      producerModule: validText(artifact.producerModule, `factual review ${requirement.key} producer`, 160),
      producerVersion: validText(artifact.producerVersion, `factual review ${requirement.key} producer version`, 160),
      schemaVersion: validText(artifact.schemaVersion, `factual review ${requirement.key} schema version`, 160),
    });
  }
  return { artifacts: assertFactualReviewArtifactBindings(bound), stages };
}

async function assertStoredSourceAuthority(
  ctx: ReviewCtx,
  ownerId: string,
  sourceAuthority: FactualReviewSourceAuthority,
): Promise<void> {
  const packId = ctx.db.normalizeId("reviewedEvidencePacks", sourceAuthority.reviewedPackId);
  if (!packId) throw new Error("factual review source pack id is invalid");
  const pack = await ctx.db.get(packId);
  const storedReceipt = pack ? asRecord(pack.pack, "stored reviewed evidence pack") : undefined;
  const storedSourceAuthority = storedReceipt
    ? asRecord(storedReceipt["sourceAuthority"], "stored reviewed evidence source authority")
    : undefined;
  const storedRawLedger = storedSourceAuthority?.["dataStorySourceLedger"];
  if (
    !pack ||
    storedSourceAuthority?.["kind"] !== "data_story_source_ledger" ||
    storedRawLedger === undefined ||
    sha256Hex(canonicalJson(storedRawLedger)) !== sourceAuthority.rawLedgerFingerprint ||
    pack.ownerId !== ownerId ||
    pack.authorityKind !== "data_story_source_ledger" ||
    pack.contentFingerprint !== sourceAuthority.reviewedPackContentFingerprint ||
    pack.authorityContentFingerprint !== sourceAuthority.authorityContentFingerprint ||
    pack.routeSeedFingerprint !== sourceAuthority.routeSeedFingerprint ||
    pack.topicFingerprint !== sourceAuthority.topicFingerprint ||
    pack.showProfileFingerprint !== sourceAuthority.showProfileFingerprint ||
    canonicalJson([...pack.selectedCapabilityKeys].sort()) !==
      canonicalJson([...sourceAuthority.selectedCapabilityKeys].sort())
  ) {
    throw new Error("factual review immutable raw-ledger authority no longer matches its frozen pack");
  }
}

/**
 * The common read-only integrity fence used at creation, owner approval,
 * doctor dispatch, and execution re-entry. It deliberately compares current
 * retained stage values with the persisted content-addressed artifacts rather
 * than trusting a client-supplied artifact list.
 */
async function assertCheckpointIntegrity(
  ctx: ReviewCtx,
  run: ReviewRun,
  checkpoint: ReviewCheckpoint,
): Promise<{ narrationOutputs: UnknownRecord }> {
  if (!run.pipelineInvocationSnapshot || !run.pipelineInvocationSha256) {
    throw new Error("factual review run is missing its frozen invocation");
  }
  if (run.pipelineInvocationSha256 !== checkpoint.invocationSha256) {
    throw new Error("factual review checkpoint invocation fingerprint changed");
  }
  const sourceAuthority = factualReviewSourceAuthorityFromInvocation(run.pipelineInvocationSnapshot);
  if (canonicalJson(sourceAuthority) !== canonicalJson(checkpoint.sourceAuthority)) {
    throw new Error("factual review checkpoint source authority changed");
  }
  await assertStoredSourceAuthority(ctx, run.ownerId, sourceAuthority);
  const expectedFingerprint = factualReviewCheckpointFingerprint({
    ownerId: run.ownerId,
    channelId: String(run.channelId),
    runId: String(run._id),
    invocationSha256: checkpoint.invocationSha256,
    sourceAuthority,
    artifacts: checkpoint.artifacts,
  });
  if (expectedFingerprint !== checkpoint.checkpointFingerprint) {
    throw new Error("factual review checkpoint fingerprint is corrupt");
  }
  const retained = await retainedArtifactsForRun(ctx, run._id);
  if (canonicalJson(retained.artifacts) !== canonicalJson(assertFactualReviewArtifactBindings(checkpoint.artifacts))) {
    throw new Error("factual review retained artifacts no longer match the approved checkpoint");
  }
  const narrationOutputs = retained.stages.get("narration_tts");
  if (!narrationOutputs || typeof narrationOutputs["narrationKey"] !== "string" || !narrationOutputs["narrationKey"].trim()) {
    throw new Error("factual review retained narration key is missing");
  }
  return { narrationOutputs };
}

async function blockCheckpoint(
  ctx: MutationCtx,
  run: ReviewRun,
  checkpoint: ReviewCheckpoint | null,
  now: number,
  reason: string,
): Promise<void> {
  const error = validText(
    reason.replace(/[\u0000-\u001f]+/g, " ").trim(),
    "factual review block reason",
    1_000,
  );
  if (checkpoint && checkpoint.decision !== "blocked" && checkpoint.decision !== "rejected") {
    await ctx.db.patch(checkpoint._id, {
      decision: "blocked",
      blockedAt: now,
      blockedReason: error,
    });
  }
  await ctx.db.patch(run._id, terminalRunPatch(now, error));
}

export const createAwaiting = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    leaseOwner: v.string(),
    executionLeaseToken: v.number(),
    invocationSha256: v.string(),
    costTotal: v.number(),
    now: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "factual review checkpoint creation");
    const now = args.now ?? Date.now();
    if (!Number.isFinite(now) || !Number.isFinite(args.costTotal) || args.costTotal < 0) {
      throw new Error("factual review checkpoint timing/cost is invalid");
    }
    const run = await ownedRun(ctx, args);
    assertRunExecutionWriteFence(run, {
      leaseOwner: args.leaseOwner,
      executionLeaseToken: args.executionLeaseToken,
    }, now);
    if (run.pipelineInvocationSha256 !== validFingerprint(args.invocationSha256, "factual review invocation fingerprint")) {
      return await (async () => {
        const error = "factual review checkpoint invocation does not match the frozen run";
        await blockCheckpoint(ctx, run, await checkpointForRun(ctx, args.runId), now, error);
        return { kind: "blocked" as const, error };
      })();
    }
    let sourceAuthority: FactualReviewSourceAuthority;
    let artifacts: readonly FactualReviewArtifactBinding[];
    try {
      sourceAuthority = factualReviewSourceAuthorityFromInvocation(run.pipelineInvocationSnapshot);
      await assertStoredSourceAuthority(ctx, args.ownerId, sourceAuthority);
      ({ artifacts } = await retainedArtifactsForRun(ctx, args.runId));
    } catch (error) {
      const message = `factual review checkpoint cannot retain exact reviewed work: ${
        error instanceof Error ? error.message : String(error)
      }`;
      await blockCheckpoint(ctx, run, await checkpointForRun(ctx, args.runId), now, message);
      return { kind: "blocked" as const, error: message };
    }
    const checkpointFingerprint = factualReviewCheckpointFingerprint({
      ownerId: args.ownerId,
      channelId: String(args.channelId),
      runId: String(args.runId),
      invocationSha256: args.invocationSha256,
      sourceAuthority,
      artifacts,
    });
    const existing = await checkpointForRun(ctx, args.runId);
    if (existing) {
      if (
        existing.checkpointFingerprint !== checkpointFingerprint ||
        existing.decision !== "awaiting"
      ) {
        const error = "factual review checkpoint replay does not match its immutable awaiting receipt";
        await blockCheckpoint(ctx, run, existing, now, error);
        return { kind: "blocked" as const, error };
      }
      await ctx.db.patch(run._id, {
        status: "awaiting_factual_review",
        factualReviewCheckpointId: existing._id,
        factualReviewCheckpointFingerprint: existing.checkpointFingerprint,
        factualReviewState: "awaiting",
        costTotal: args.costTotal,
        error: undefined,
        heartbeatAt: now,
        ...clearExecutionLeasePatch(),
      });
      return {
        kind: "awaiting" as const,
        checkpointId: existing._id,
        checkpointFingerprint: existing.checkpointFingerprint,
        reused: true,
      };
    }
    const checkpointId = await ctx.db.insert("factualReviewCheckpoints", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      runId: args.runId,
      version: FACTUAL_REVIEW_CHECKPOINT_VERSION,
      invocationSha256: args.invocationSha256,
      sourceAuthority: {
        ...sourceAuthority,
        reviewedPackId: sourceAuthority.reviewedPackId as Id<"reviewedEvidencePacks">,
        selectedCapabilityKeys: [...sourceAuthority.selectedCapabilityKeys],
      },
      artifacts: [...artifacts],
      checkpointFingerprint,
      decision: "awaiting",
      createdAt: now,
    });
    await ctx.db.patch(run._id, {
      status: "awaiting_factual_review",
      factualReviewCheckpointId: checkpointId,
      factualReviewCheckpointFingerprint: checkpointFingerprint,
      factualReviewState: "awaiting",
      costTotal: args.costTotal,
      error: undefined,
      heartbeatAt: now,
      ...clearExecutionLeasePatch(),
    });
    return { kind: "awaiting" as const, checkpointId, checkpointFingerprint, reused: false };
  },
});

export const getForRun = query({
  args: { ownerId: v.string(), runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerId !== args.ownerId) throw new Error("factual review run not found");
    return await checkpointForRun(ctx, args.runId);
  },
});

/** Server-only review projection. POST never accepts any of these artifacts. */
export const getReviewForRun = query({
  args: { ownerId: v.string(), runId: v.id("runs") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerId !== args.ownerId) throw new Error("factual review run not found");
    const checkpoint = await checkpointForRun(ctx, args.runId);
    if (!checkpoint) return null;
    let review: UnknownRecord | undefined;
    let integrityError: string | undefined;
    try {
      const retained = await assertCheckpointIntegrity(ctx, run, checkpoint);
      const stages = await ctx.db.query("runStages").withIndex("by_run", (q) => q.eq("runId", args.runId)).collect();
      const rawByBlock = new Map(stages.map((stage) => [stage.block, stage]));
      const outputByBlock = (block: string) => {
        const stage = rawByBlock.get(block);
        return stage ? outputForStage(stage, block) : undefined;
      };
      const scriptGen = outputByBlock("script_gen");
      const storySpine = outputByBlock("story_spine");
      const episodeGraph = outputByBlock("episode_graph");
      review = {
        narrationKey: retained.narrationOutputs["narrationKey"],
        narrationDurationSec: retained.narrationOutputs["narrationDurationSec"],
        narrationTranscriptText: retained.narrationOutputs["narrationTranscriptText"],
        script: scriptGen?.["script"],
        narrationText: scriptGen?.["narrationText"],
        storySpine: {
          timedScript: storySpine?.["timedScript"],
          narrativeBeats: storySpine?.["narrativeBeats"],
          continuityLedger: storySpine?.["continuityLedger"],
          shotList: storySpine?.["shotList"],
          dpVisualSpecs: storySpine?.["dpVisualSpecs"],
          editorEdl: storySpine?.["editorEdl"],
          storyCoverage: storySpine?.["storyCoverage"],
          episodeSpec: storySpine?.["episodeSpec"],
        },
        episodeGraph: episodeGraph?.["episodeGraph"],
        sceneManifest: episodeGraph?.["sceneManifest"],
      };
    } catch (error) {
      integrityError = error instanceof Error ? error.message : String(error);
    }
    return { checkpoint, ...(review ? { review } : {}), ...(integrityError ? { integrityError } : {}) };
  },
});

export const approve = mutation({
  args: { ownerId: v.string(), checkpointId: v.id("factualReviewCheckpoints"), reviewerId: v.string(), now: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "factual review approval");
    const now = args.now ?? Date.now();
    const reviewerId = validText(args.reviewerId, "factual review reviewer", 160);
    const checkpoint = await ownedCheckpoint(ctx, args.ownerId, args.checkpointId);
    const run = await ownedRun(ctx, { ownerId: args.ownerId, channelId: checkpoint.channelId, runId: checkpoint.runId });
    if (checkpoint.decision === "approved") {
      return { kind: "approved" as const, checkpoint, reused: true };
    }
    if (checkpoint.decision !== "awaiting" || run.status !== "awaiting_factual_review") {
      throw new Error("factual review checkpoint is no longer awaiting owner approval");
    }
    try {
      await assertCheckpointIntegrity(ctx, run, checkpoint);
    } catch (error) {
      const message = `factual review approval blocked because retained work changed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      await blockCheckpoint(ctx, run, checkpoint, now, message);
      return { kind: "blocked" as const, error: message };
    }
    const approvalFingerprint = factualReviewApprovalFingerprint({
      checkpointFingerprint: checkpoint.checkpointFingerprint,
      reviewerId,
      approvedAt: now,
    });
    await ctx.db.patch(checkpoint._id, {
      decision: "approved",
      reviewerId,
      approvedAt: now,
      approvalFingerprint,
    });
    await ctx.db.patch(run._id, {
      factualReviewState: "approved",
      factualReviewResumeState: "pending",
      factualReviewApprovalFingerprint: approvalFingerprint,
      factualReviewResumeAttempts: 0,
      factualReviewResumeUpdatedAt: now,
      factualReviewResumeQueuedAt: undefined,
      factualReviewResumeQueueDeadlineAt: undefined,
      factualReviewResumeTriggerRunId: undefined,
      factualReviewResumeLastError: undefined,
      error: undefined,
      heartbeatAt: now,
      ...clearExecutionLeasePatch(),
    });
    return {
      kind: "approved" as const,
      checkpoint: { ...checkpoint, decision: "approved" as const, reviewerId, approvedAt: now, approvalFingerprint },
      reused: false,
    };
  },
});

export const reject = mutation({
  args: { ownerId: v.string(), checkpointId: v.id("factualReviewCheckpoints"), reviewerId: v.string(), now: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "factual review rejection");
    const now = args.now ?? Date.now();
    const reviewerId = validText(args.reviewerId, "factual review reviewer", 160);
    const checkpoint = await ownedCheckpoint(ctx, args.ownerId, args.checkpointId);
    const run = await ownedRun(ctx, { ownerId: args.ownerId, channelId: checkpoint.channelId, runId: checkpoint.runId });
    if (checkpoint.decision === "rejected") {
      return { kind: "rejected" as const, checkpoint, reused: true };
    }
    if (checkpoint.decision !== "awaiting" || run.status !== "awaiting_factual_review") {
      throw new Error("factual review checkpoint is no longer awaiting owner rejection");
    }
    const reason = "factual review rejected by the owner; create a fresh immutable revision before visual work";
    await ctx.db.patch(checkpoint._id, { decision: "rejected", reviewerId, rejectedAt: now, blockedReason: reason });
    await ctx.db.patch(run._id, {
      ...terminalRunPatch(now, reason),
      factualReviewState: "rejected",
      factualReviewResumeState: "blocked",
    });
    return { kind: "rejected" as const, reused: false };
  },
});

export const listPendingResumes = query({
  args: { ownerId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "factual review continuation recovery");
    const limit = Math.max(1, Math.min(50, Math.floor(args.limit ?? 25)));
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_owner_factual_review_resume", (q) =>
        q.eq("ownerId", args.ownerId).eq("factualReviewResumeState", "pending"),
      )
      .take(limit * 2);
    const pending = [] as Array<{
      runId: Id<"runs">;
      channelId: Id<"channels">;
      invocationSha256: string;
      checkpointId: Id<"factualReviewCheckpoints">;
      checkpointFingerprint: string;
      approvalFingerprint: string;
      attempt: number;
      scheduledPlan?: {
        planItemId: string;
        topic: string;
        title: string;
        thumbnailKey: string;
        scheduledAt?: number;
        preparation?: { version: string; manifestKey: string; manifestSha256: string };
      };
    }>;
    for (const run of runs) {
      if (run.status !== "awaiting_factual_review" || run.factualReviewState !== "approved") continue;
      if (
        !run.pipelineInvocationSha256 ||
        !run.factualReviewCheckpointId ||
        !run.factualReviewCheckpointFingerprint ||
        !run.factualReviewApprovalFingerprint
      ) {
        continue;
      }
      const attempt = run.factualReviewResumeAttempts ?? 0;
      if (attempt >= MAX_FACTUAL_REVIEW_RESUME_ENQUEUE_ATTEMPTS) continue;
      let preparation: { version: string; manifestKey: string; manifestSha256: string } | undefined;
      const hasPreparation = [
        run.plannedPreparationVersion,
        run.plannedPreparationManifestKey,
        run.plannedPreparationManifestSha256,
      ].some((value) => value !== undefined);
      if (hasPreparation) {
        try {
          preparation = assertPlanWeekPreparationPointer({
            version: run.plannedPreparationVersion,
            manifestKey: run.plannedPreparationManifestKey,
            manifestSha256: run.plannedPreparationManifestSha256,
          });
        } catch {
          // A partial or altered immutable receipt cannot be continued. Keep
          // it observable for repair rather than issuing a run without its
          // frozen weekly inputs.
          continue;
        }
      }
      const scheduledPlan = run.planItemId && run.plannedTopic && run.plannedTitle && run.plannedThumbnailKey
        ? {
            planItemId: String(run.planItemId),
            topic: run.plannedTopic,
            title: run.plannedTitle,
            thumbnailKey: run.plannedThumbnailKey,
            ...(run.plannedPublishAt === undefined ? {} : { scheduledAt: run.plannedPublishAt }),
            ...(preparation ? { preparation } : {}),
          }
        : undefined;
      pending.push({
        runId: run._id,
        channelId: run.channelId,
        invocationSha256: run.pipelineInvocationSha256,
        checkpointId: run.factualReviewCheckpointId,
        checkpointFingerprint: run.factualReviewCheckpointFingerprint,
        approvalFingerprint: run.factualReviewApprovalFingerprint,
        attempt,
        ...(scheduledPlan ? { scheduledPlan } : {}),
      });
      if (pending.length >= limit) break;
    }
    return pending;
  },
});

/**
 * A Trigger acceptance can be lost before its queued task starts. Reap that
 * *delivery* without touching the approved factual work: the next minute
 * dispatcher receives the exact same checkpoint/invocation envelope, with a
 * new bounded delivery idempotency key. A continuation may do this only a
 * finite number of times before becoming an explicit owner-repair state.
 */
export const reapExpiredQueuedResumes = mutation({
  args: {
    ownerId: v.string(),
    now: v.number(),
    limit: v.optional(v.number()),
  },
  returns: v.object({ checked: v.number(), requeued: v.number(), blocked: v.number() }),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "factual review queued continuation recovery");
    if (!Number.isSafeInteger(args.now) || args.now < 0) {
      throw new Error("factual review queued continuation recovery time is invalid");
    }
    const limit = Math.max(1, Math.min(50, Math.floor(args.limit ?? 25)));
    // New rows are fair by deadline. A second, bounded legacy slice handles
    // pre-deadline receipts through their already durable queued timestamp.
    const [due, legacy] = await Promise.all([
      ctx.db
        .query("runs")
        .withIndex("by_owner_factual_review_resume_queue_deadline", (q) =>
          q
            .eq("ownerId", args.ownerId)
            .eq("factualReviewResumeState", "queued")
            .gt("factualReviewResumeQueueDeadlineAt", undefined)
            .lte("factualReviewResumeQueueDeadlineAt", args.now),
        )
        .take(limit),
      ctx.db
        .query("runs")
        .withIndex("by_owner_factual_review_resume_queue_deadline", (q) =>
          q
            .eq("ownerId", args.ownerId)
            .eq("factualReviewResumeState", "queued")
            .eq("factualReviewResumeQueueDeadlineAt", undefined),
        )
        .take(limit),
    ]);
    let checked = 0;
    let requeued = 0;
    let blocked = 0;
    const seen = new Set<string>();
    for (const run of [...due, ...legacy]) {
      if (seen.has(String(run._id))) continue;
      seen.add(String(run._id));
      checked++;
      if (run.status !== "awaiting_factual_review" || run.factualReviewState !== "approved") {
        await blockCheckpoint(
          ctx,
          run,
          await checkpointForRun(ctx, run._id),
          args.now,
          "factual review queued continuation has an invalid approval state; manual reconciliation is required",
        );
        blocked++;
        continue;
      }
      const deadline = factualReviewResumeQueueDeadline(run);
      if (deadline === undefined) {
        await blockCheckpoint(
          ctx,
          run,
          await checkpointForRun(ctx, run._id),
          args.now,
          "factual review queued continuation is missing its bounded dispatch deadline; manual reconciliation is required",
        );
        blocked++;
        continue;
      }
      if (deadline > args.now) continue;
      const checkpoint = await checkpointForRun(ctx, run._id);
      const attempts = run.factualReviewResumeAttempts;
      if (!Number.isSafeInteger(attempts) || (attempts as number) < 1) {
        await blockCheckpoint(
          ctx,
          run,
          checkpoint,
          args.now,
          "factual review queued continuation has an invalid bounded delivery count; manual reconciliation is required",
        );
        blocked++;
        continue;
      }
      if ((attempts as number) >= MAX_FACTUAL_REVIEW_RESUME_ENQUEUE_ATTEMPTS) {
        await blockCheckpoint(
          ctx,
          run,
          checkpoint,
          args.now,
          `factual review queued continuation did not start after ${attempts} bounded delivery attempt(s); manual reconciliation is required`,
        );
        blocked++;
        continue;
      }
      if (
        !checkpoint ||
        !run.factualReviewCheckpointId ||
        !run.factualReviewCheckpointFingerprint ||
        !run.factualReviewApprovalFingerprint ||
        !run.pipelineInvocationSha256
      ) {
        await blockCheckpoint(
          ctx,
          run,
          checkpoint,
          args.now,
          "factual review queued continuation is missing its immutable approval receipt; manual reconciliation is required",
        );
        blocked++;
        continue;
      }
      try {
        await assertApprovedFactualReviewResume(ctx, {
          ownerId: args.ownerId,
          channelId: run.channelId,
          runId: run._id,
          checkpointId: run.factualReviewCheckpointId,
          checkpointFingerprint: run.factualReviewCheckpointFingerprint,
          approvalFingerprint: run.factualReviewApprovalFingerprint,
          invocationSha256: run.pipelineInvocationSha256,
        });
      } catch (error) {
        await blockCheckpoint(
          ctx,
          run,
          checkpoint,
          args.now,
          `factual review queued continuation cannot reissue its immutable receipt: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        blocked++;
        continue;
      }
      await ctx.db.patch(run._id, {
        factualReviewResumeState: "pending",
        factualReviewResumeUpdatedAt: args.now,
        factualReviewResumeQueuedAt: undefined,
        factualReviewResumeQueueDeadlineAt: undefined,
        factualReviewResumeTriggerRunId: undefined,
        factualReviewResumeLastError:
          "factual review accepted Trigger delivery expired before execution claim; reissuing the exact immutable receipt",
        heartbeatAt: args.now,
      });
      requeued++;
    }
    return { checked, requeued, blocked };
  },
});

export const markResumeQueued = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    checkpointId: v.id("factualReviewCheckpoints"),
    checkpointFingerprint: v.string(),
    approvalFingerprint: v.string(),
    triggerRunId: v.string(),
    queuedAt: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "factual review continuation enqueue receipt");
    if (!Number.isSafeInteger(args.queuedAt) || args.queuedAt < 0) {
      throw new Error("factual review continuation queue timestamp is invalid");
    }
    const queueDeadlineAt = args.queuedAt + FACTUAL_REVIEW_RESUME_QUEUE_LEASE_MS;
    if (!Number.isSafeInteger(queueDeadlineAt)) {
      throw new Error("factual review continuation queue deadline is invalid");
    }
    const triggerRunId = validText(args.triggerRunId, "factual review Trigger run id", 300);
    const run = await ownedRun(ctx, args);
    const checkpoint = await ownedCheckpoint(ctx, args.ownerId, args.checkpointId);
    if (
      checkpoint.runId !== args.runId ||
      checkpoint.checkpointFingerprint !== validFingerprint(args.checkpointFingerprint, "factual review checkpoint fingerprint") ||
      checkpoint.approvalFingerprint !== validFingerprint(args.approvalFingerprint, "factual review approval fingerprint") ||
      run.factualReviewCheckpointId !== args.checkpointId ||
      run.factualReviewCheckpointFingerprint !== checkpoint.checkpointFingerprint ||
      run.factualReviewApprovalFingerprint !== checkpoint.approvalFingerprint
    ) {
      throw new Error("factual review continuation enqueue identity mismatch");
    }
    if (run.factualReviewResumeState === "consumed" || run.factualReviewState === "resumed") {
      return { state: "consumed" as const, reused: true };
    }
    if (run.factualReviewResumeState === "queued") {
      return { state: "queued" as const, reused: true };
    }
    if (run.status !== "awaiting_factual_review" || run.factualReviewResumeState !== "pending") {
      throw new Error("factual review continuation is not pending");
    }
    const attempts = (run.factualReviewResumeAttempts ?? 0) + 1;
    if (attempts > MAX_FACTUAL_REVIEW_RESUME_ENQUEUE_ATTEMPTS) {
      await blockCheckpoint(
        ctx,
        run,
        checkpoint,
        args.queuedAt,
        `factual review continuation exceeded ${MAX_FACTUAL_REVIEW_RESUME_ENQUEUE_ATTEMPTS} bounded delivery attempts before queue acknowledgement`,
      );
      return { state: "blocked" as const, attempts };
    }
    await ctx.db.patch(run._id, {
      factualReviewResumeState: "queued",
      factualReviewResumeAttempts: attempts,
      factualReviewResumeUpdatedAt: args.queuedAt,
      factualReviewResumeQueuedAt: args.queuedAt,
      factualReviewResumeQueueDeadlineAt: queueDeadlineAt,
      factualReviewResumeTriggerRunId: triggerRunId,
      factualReviewResumeLastError: undefined,
    });
    return { state: "queued" as const, reused: false };
  },
});

export const recordResumeEnqueueFailure = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    checkpointId: v.id("factualReviewCheckpoints"),
    checkpointFingerprint: v.string(),
    approvalFingerprint: v.string(),
    error: v.string(),
    failedAt: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "factual review continuation enqueue failure");
    const run = await ownedRun(ctx, args);
    const checkpoint = await ownedCheckpoint(ctx, args.ownerId, args.checkpointId);
    const error = validText(args.error, "factual review continuation error", 1_000);
    if (
      checkpoint.runId !== args.runId ||
      checkpoint.checkpointFingerprint !== validFingerprint(args.checkpointFingerprint, "factual review checkpoint fingerprint") ||
      checkpoint.approvalFingerprint !== validFingerprint(args.approvalFingerprint, "factual review approval fingerprint") ||
      run.factualReviewCheckpointId !== args.checkpointId ||
      run.factualReviewCheckpointFingerprint !== checkpoint.checkpointFingerprint ||
      run.factualReviewApprovalFingerprint !== checkpoint.approvalFingerprint
    ) {
      throw new Error("factual review continuation failure identity mismatch");
    }
    if (run.factualReviewResumeState === "consumed" || run.factualReviewState === "resumed") {
      return { state: "consumed" as const, reused: true };
    }
    // A concurrent dispatcher may have received an ambiguous Trigger failure
    // after another worker already recorded the accepted delivery. Never turn
    // that durable queue acknowledgement back into pending work.
    if (run.factualReviewResumeState === "queued") {
      return { state: "queued" as const, reused: true };
    }
    const attempts = (run.factualReviewResumeAttempts ?? 0) + 1;
    if (attempts >= MAX_FACTUAL_REVIEW_RESUME_ENQUEUE_ATTEMPTS) {
      await blockCheckpoint(
        ctx,
        run,
        checkpoint,
        args.failedAt,
        `factual review continuation could not be enqueued after ${attempts} bounded attempts: ${error}`,
      );
      return { state: "blocked" as const, attempts };
    }
    await ctx.db.patch(run._id, {
      factualReviewResumeState: "pending",
      factualReviewResumeAttempts: attempts,
      factualReviewResumeUpdatedAt: args.failedAt,
      factualReviewResumeQueuedAt: undefined,
      factualReviewResumeQueueDeadlineAt: undefined,
      factualReviewResumeTriggerRunId: undefined,
      factualReviewResumeLastError: error,
    });
    return { state: "pending" as const, attempts };
  },
});

export const blockResume = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    checkpointId: v.id("factualReviewCheckpoints"),
    checkpointFingerprint: v.string(),
    approvalFingerprint: v.optional(v.string()),
    leaseOwner: v.string(),
    executionLeaseToken: v.number(),
    reason: v.string(),
    now: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "factual review resume block");
    const now = args.now ?? Date.now();
    const run = await ownedRun(ctx, args);
    assertRunExecutionWriteFence(run, {
      leaseOwner: args.leaseOwner,
      executionLeaseToken: args.executionLeaseToken,
    }, now);
    const checkpoint = await ownedCheckpoint(ctx, args.ownerId, args.checkpointId);
    if (
      checkpoint.runId !== args.runId ||
      checkpoint.checkpointFingerprint !== validFingerprint(args.checkpointFingerprint, "factual review checkpoint fingerprint") ||
      run.factualReviewCheckpointId !== args.checkpointId ||
      run.factualReviewCheckpointFingerprint !== checkpoint.checkpointFingerprint ||
      (args.approvalFingerprint !== undefined && checkpoint.approvalFingerprint !== args.approvalFingerprint)
    ) {
      throw new Error("factual review resume block identity mismatch");
    }
    await blockCheckpoint(ctx, run, checkpoint, now, args.reason);
    return null;
  },
});

/**
 * Shared by `runs.claimExecutionLease`: a rejected resume must become a
 * durable manual terminal state in the same Convex transaction, not an
 * exception that rolls back and invites a scheduler retry.
 */
export async function terminalizeFactualReviewResumeForLease(
  ctx: MutationCtx,
  args: {
    ownerId: string;
    channelId: Id<"channels">;
    runId: Id<"runs">;
    reason: string;
    now: number;
  },
): Promise<void> {
  const run = await ownedRun(ctx, args);
  // A corrupt foreign/missing checkpoint id is itself terminal evidence. Do
  // not throw here: Convex would roll the terminal patch back and let a stale
  // Trigger delivery keep retrying this otherwise manual-only receipt.
  let checkpoint: ReviewCheckpoint | null = null;
  try {
    checkpoint = run.factualReviewCheckpointId
      ? await ownedCheckpoint(ctx, args.ownerId, run.factualReviewCheckpointId)
      : await checkpointForRun(ctx, args.runId);
  } catch {
    checkpoint = await checkpointForRun(ctx, args.runId).catch(() => null);
  }
  await blockCheckpoint(ctx, run, checkpoint, args.now, args.reason);
}

/**
 * A continuation can die after its execution lease claim has consumed the
 * approval receipt but before the worker reaches its first post-review block.
 * Return that exact immutable receipt to the factual-review outbox rather than
 * letting the generic scheduler replay a payload with no approval envelope.
 *
 * The dispatcher will mint the next bounded delivery from the existing
 * checkpoint/approval fingerprints. Do not increment attempts here:
 * `markResumeQueued` accounts only for a Trigger delivery that was actually
 * accepted, preserving the distinction between a dead worker and an enqueue
 * attempt that never reached Trigger.
 */
export async function requeueExpiredFactualReviewResumeForLease(
  ctx: MutationCtx,
  args: {
    ownerId: string;
    channelId: Id<"channels">;
    runId: Id<"runs">;
    now: number;
    reason: string;
  },
): Promise<"not_factual" | "requeued" | "blocked"> {
  const run = await ownedRun(ctx, args);
  const looksLikeConsumedFactualContinuation =
    run.factualReviewState === "resumed" ||
    run.factualReviewResumeState === "consumed";
  if (!looksLikeConsumedFactualContinuation) return "not_factual";

  const terminalize = async (detail: string): Promise<"blocked"> => {
    await terminalizeFactualReviewResumeForLease(ctx, {
      ...args,
      reason: detail,
    });
    return "blocked";
  };
  if (
    run.status !== "running" ||
    run.factualReviewState !== "resumed" ||
    run.factualReviewResumeState !== "consumed"
  ) {
    return await terminalize(
      "factual review continuation recovery found an invalid consumed approval state",
    );
  }
  const attempts = run.factualReviewResumeAttempts ?? 0;
  if (!Number.isSafeInteger(attempts) || attempts < 0) {
    return await terminalize(
      "factual review continuation recovery found an invalid bounded delivery count",
    );
  }
  if (attempts >= MAX_FACTUAL_REVIEW_RESUME_ENQUEUE_ATTEMPTS) {
    return await terminalize(
      `factual review continuation lease expired after ${attempts} bounded delivery attempt(s); manual reconciliation is required`,
    );
  }
  if (
    !run.factualReviewCheckpointId ||
    !run.factualReviewCheckpointFingerprint ||
    !run.factualReviewApprovalFingerprint ||
    !run.pipelineInvocationSha256
  ) {
    return await terminalize(
      "factual review continuation recovery is missing its immutable approval receipt",
    );
  }

  try {
    await assertApprovedFactualReviewResume(ctx, {
      ownerId: args.ownerId,
      channelId: args.channelId,
      runId: args.runId,
      checkpointId: run.factualReviewCheckpointId,
      checkpointFingerprint: run.factualReviewCheckpointFingerprint,
      approvalFingerprint: run.factualReviewApprovalFingerprint,
      invocationSha256: run.pipelineInvocationSha256,
    });
  } catch (error) {
    return await terminalize(
      `factual review continuation recovery rejected its immutable approval receipt: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  await ctx.db.patch(run._id, {
    status: "awaiting_factual_review",
    factualReviewState: "approved",
    factualReviewResumeState: "pending",
    factualReviewResumeUpdatedAt: args.now,
    factualReviewResumeQueuedAt: undefined,
    factualReviewResumeQueueDeadlineAt: undefined,
    factualReviewResumeTriggerRunId: undefined,
    factualReviewResumeLastError: args.reason,
    error: undefined,
    heartbeatAt: args.now,
    ...clearExecutionLeasePatch(),
  });
  return "requeued";
}

/**
 * Called by the execution-lease mutation before it may turn an awaiting run
 * back into `running`. Any mismatch throws so the caller can terminalize the
 * receipt in the same transaction before a Trigger worker reaches a provider.
 */
export async function assertApprovedFactualReviewResume(
  ctx: ReviewCtx,
  args: {
    ownerId: string;
    channelId: Id<"channels">;
    runId: Id<"runs">;
    checkpointId: Id<"factualReviewCheckpoints">;
    checkpointFingerprint: string;
    approvalFingerprint: string;
    invocationSha256: string;
  },
): Promise<{ checkpoint: ReviewCheckpoint; narrationOutputs: UnknownRecord }> {
  const run = await ownedRun(ctx, args);
  const checkpoint = await ownedCheckpoint(ctx, args.ownerId, args.checkpointId);
  if (
    checkpoint.channelId !== args.channelId ||
    checkpoint.runId !== args.runId ||
    checkpoint.decision !== "approved" ||
    checkpoint.checkpointFingerprint !== validFingerprint(args.checkpointFingerprint, "factual review checkpoint fingerprint") ||
    checkpoint.approvalFingerprint !== validFingerprint(args.approvalFingerprint, "factual review approval fingerprint") ||
    checkpoint.invocationSha256 !== validFingerprint(args.invocationSha256, "factual review invocation fingerprint") ||
    run.pipelineInvocationSha256 !== checkpoint.invocationSha256 ||
    run.factualReviewCheckpointId !== checkpoint._id ||
    run.factualReviewCheckpointFingerprint !== checkpoint.checkpointFingerprint ||
    run.factualReviewApprovalFingerprint !== checkpoint.approvalFingerprint ||
    !["pending", "queued", "consumed"].includes(run.factualReviewResumeState ?? "")
  ) {
    throw new Error("factual review resume does not match its immutable approval receipt");
  }
  const retained = await assertCheckpointIntegrity(ctx, run, checkpoint);
  return { checkpoint, narrationOutputs: retained.narrationOutputs };
}

/** Trigger-only read used to probe retained narration before visual work. */
export const getApprovedResumeNarration = query({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    checkpointId: v.id("factualReviewCheckpoints"),
    checkpointFingerprint: v.string(),
    approvalFingerprint: v.string(),
    invocationSha256: v.string(),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "factual review resume retained-artifact check");
    const approved = await assertApprovedFactualReviewResume(ctx, args);
    return { narrationOutputs: approved.narrationOutputs };
  },
});

export function factualReviewResumeMaxAttempts(): number {
  return MAX_FACTUAL_REVIEW_RESUME_ENQUEUE_ATTEMPTS;
}
