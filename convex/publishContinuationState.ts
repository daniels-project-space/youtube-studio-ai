import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export function assertPublishArtifactId(value: string): void {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error("publish continuation immutable artifact id is invalid");
  }
}

/**
 * Transactional pre-dispatch fence used by publishIntents.createOrGet. Keeping
 * this inside the same Convex mutation removes the scheduler race and one extra
 * client round-trip/billable mutation.
 */
export async function bindExactPublishIntent(
  ctx: MutationCtx,
  args: {
    ownerId: string;
    channelId: Id<"channels">;
    runId: Id<"runs">;
    intentId: Id<"publishIntents">;
    artifactId: string;
  },
): Promise<void> {
  assertPublishArtifactId(args.artifactId);
  const [run, intent] = await Promise.all([
    ctx.db.get(args.runId),
    ctx.db.get(args.intentId),
  ]);
  if (!run || !intent) throw new Error("publish intent binding record is missing");
  if (
    run.ownerId !== args.ownerId ||
    run.channelId !== args.channelId ||
    intent.ownerId !== args.ownerId ||
    intent.channelId !== args.channelId ||
    intent.runId !== args.runId ||
    intent.videoArtifactId !== args.artifactId
  ) {
    throw new Error("publish intent binding run/owner/channel/artifact mismatch");
  }
  if (!["running", "failed"].includes(run.status)) {
    throw new Error(`publish intent binding refuses run status: ${run.status}`);
  }
  const hasIntent = run.blockedPublishIntentId !== undefined;
  const hasArtifact = run.blockedPublishArtifactId !== undefined;
  if (hasIntent !== hasArtifact) {
    throw new Error("publish intent binding pair is incomplete");
  }
  if (
    (hasIntent && run.blockedPublishIntentId !== args.intentId) ||
    (hasArtifact && run.blockedPublishArtifactId !== args.artifactId)
  ) {
    throw new Error("run is already fenced by a different publish intent");
  }
  if (
    run.publishContinuationState === "completed" &&
    (run.publishContinuationIntentId !== args.intentId ||
      run.publishContinuationArtifactId !== args.artifactId)
  ) {
    throw new Error("completed publish continuation identity cannot be rebound");
  }
  await ctx.db.patch(args.runId, {
    blockedPublishIntentId: args.intentId,
    blockedPublishArtifactId: args.artifactId,
  });
}

export async function requireExactBoundPublishIntent(
  ctx: MutationCtx,
  run: Doc<"runs">,
  args: {
    intentId: Id<"publishIntents">;
    artifactId: string;
    youtubeVideoId?: string;
    requireUploaded?: boolean;
  },
): Promise<Doc<"publishIntents">> {
  assertPublishArtifactId(args.artifactId);
  if (
    run.blockedPublishIntentId !== args.intentId ||
    run.blockedPublishArtifactId !== args.artifactId
  ) {
    throw new Error("publish continuation does not match the run's exact blocking intent");
  }
  const intent = await ctx.db.get(args.intentId);
  if (
    !intent ||
    intent.runId !== run._id ||
    intent.ownerId !== run.ownerId ||
    intent.channelId !== run.channelId ||
    intent.videoArtifactId !== args.artifactId
  ) {
    throw new Error("publish continuation intent/run/artifact identity mismatch");
  }
  if (args.requireUploaded && intent.status !== "uploaded") {
    throw new Error(`publish continuation intent is ${intent.status}, not uploaded`);
  }
  if (
    args.youtubeVideoId !== undefined &&
    intent.youtubeVideoId !== args.youtubeVideoId
  ) {
    throw new Error("publish continuation YouTube video identity mismatch");
  }
  return intent;
}

/**
 * Returns the completion audit patch after proving the exact blocked intent,
 * immutable artifact and uploaded YouTube video all belong to this run. No
 * blocking fence is cleared unless every identity check passes.
 */
export async function completedPublishContinuationPatch(
  ctx: MutationCtx,
  run: Doc<"runs">,
  completedAt: number,
): Promise<Record<string, unknown>> {
  const hasBlockedIntent = run.blockedPublishIntentId !== undefined;
  const hasBlockedArtifact = run.blockedPublishArtifactId !== undefined;
  if (hasBlockedIntent !== hasBlockedArtifact) {
    throw new Error("publish continuation blocking intent/artifact pair is incomplete");
  }
  if (!hasBlockedIntent || !hasBlockedArtifact) {
    if (
      run.publishContinuationState === "pending" ||
      run.publishContinuationState === "queued"
    ) {
      throw new Error("publish continuation outbox lost its blocking intent fence");
    }
    return {};
  }

  const intentId = run.blockedPublishIntentId as Id<"publishIntents">;
  const artifactId = run.blockedPublishArtifactId as string;
  const intent = await requireExactBoundPublishIntent(ctx, run, {
    intentId,
    artifactId,
    youtubeVideoId: run.youtubeVideoId,
    requireUploaded: true,
  });
  if (!intent.youtubeVideoId || run.youtubeVideoId !== intent.youtubeVideoId) {
    throw new Error("publish continuation run is missing the exact uploaded YouTube video");
  }
  if (
    run.publishContinuationIntentId !== undefined &&
    run.publishContinuationIntentId !== intentId
  ) {
    throw new Error("publish continuation audit intent identity mismatch");
  }
  if (
    run.publishContinuationArtifactId !== undefined &&
    run.publishContinuationArtifactId !== artifactId
  ) {
    throw new Error("publish continuation audit artifact identity mismatch");
  }
  if (
    run.publishContinuationVideoId !== undefined &&
    run.publishContinuationVideoId !== intent.youtubeVideoId
  ) {
    throw new Error("publish continuation audit video identity mismatch");
  }

  return {
    blockedPublishIntentId: undefined,
    blockedPublishArtifactId: undefined,
    publishContinuationState: "completed",
    publishContinuationIntentId: intentId,
    publishContinuationArtifactId: artifactId,
    publishContinuationVideoId: intent.youtubeVideoId,
    publishContinuationUpdatedAt: completedAt,
    publishContinuationCompletedAt: completedAt,
    publishContinuationLastError: undefined,
  };
}
