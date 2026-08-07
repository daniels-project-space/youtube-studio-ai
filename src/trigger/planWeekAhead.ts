/**
 * `plan-week-ahead` — pre-build the upcoming-videos queue for a channel: pick N
 * fresh topics, then for each generate an SEO title, a short description, and a
 * thumbnail (the SAME universal renderer as a real render: one text-free flash
 * scene + deterministic local typography), and store them in the `contentPlan`
 * table for the channel page's "Week ahead" section.
 */
import { task } from "@trigger.dev/sdk";
import { AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { channelPrefix, getObjectBytes, headObjectMetadata, putObject } from "@/lib/storage";
import { hasGeminiKey } from "@/lib/gemini";
import { optimizeTopics } from "@/lib/topicOptimizer";
import { loadLedger } from "@/lib/performance";
import { detectFollowups } from "@/lib/followups";
import { generateBananaImage, hasBanana } from "@/lib/banana";
import { renderThumbnail } from "@/lib/thumbnailRenderer";
import type { ThumbnailPlaybook } from "@/lib/thumbnailLab";
import type { ThumbnailTextZone } from "@/lib/thumbnailLayout";
import {
  resolveThumbnailStyle,
  styleFromDNA,
  shortTitleFallback,
} from "@/lib/thumbnailFormula";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createModelUsageScope } from "@/lib/modelUsage";
import { createImageUsageScope } from "@/lib/imageUsage";
import {
  PLAN_WEEK_CONTRACT_VERSION,
  buildPlanWeekTopicCheckpoint,
  buildPlanWeekUsageCheckpoint,
  dedupePlanCandidates,
  deterministicPlanDescription,
  parsePlanWeekUsageMetadata,
  parsePlanWeekTopicCheckpoint,
  planWeekReservation,
  planWeekUsageMetadata,
  type PlanWeekUsageCheckpoint,
  type PlanWeekTopicCheckpoint,
} from "@/lib/planWeekBatch";

export interface PlanWeekArgs {
  ownerId: string;
  channelId: string;
  count?: number;
  /** Stable caller key; Trigger run identity is the fallback for automatic retries. */
  requestKey?: string;
}

class AmbiguousTopicCheckpointError extends Error {}
class AmbiguousThumbnailCheckpointError extends Error {}
class InvalidPlanCheckpointError extends Error {}

export const planWeekAheadTask = task({
  id: "plan-week-ahead",
  maxDuration: 1800,
  retry: { maxAttempts: 3, minTimeoutInMs: 5_000, maxTimeoutInMs: 60_000, factor: 2 },
  run: async (payload: PlanWeekArgs, { ctx }) => {
    const log = (m: string, x?: Record<string, unknown>) => console.log(`[plan-week-ahead] ${m}`, x ?? "");
    await bootstrapSecrets(log);
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) abortTask("NEXT_PUBLIC_CONVEX_URL is not configured");
    const convex = new ConvexHttpClient(url);

    const channelId = payload.channelId as Id<"channels">;
    const count = Math.max(1, Math.min(12, payload.count ?? 5));
    const channel = await convex.query(api.channels.getChannel, { channelId });
    if (!channel) abortTask(`channel not found: ${payload.channelId}`);
    const ownerId = channel.ownerId;
    if (payload.ownerId !== ownerId) abortTask("plan-week-ahead: owner/channel mismatch");
    const niche = channel.identity?.niche ?? "";
    const persona = channel.identity?.persona ?? "";
    const channelName = channel.name;
    const requestKey = payload.requestKey?.trim() || ctx.run.id;
    const claimant = `${ctx.run.id}:${ctx.attempt.number}`;
    const reservation = planWeekReservation(count);
    const admitted = await (async () => {
      try {
        return await convex.mutation(api.contentPlan.reservePlanBatch, {
          ownerId,
          channelId,
          requestKey,
          triggerRunId: ctx.run.id,
          contractVersion: PLAN_WEEK_CONTRACT_VERSION,
          requestedCount: count,
          reservedCostUsd: reservation.totalUsd,
        });
      } catch (error) {
        if (/budget admission|ownership mismatch|idempotency|invalid plan|requestedCount/i.test(errorMessage(error))) {
          abortTask(error);
        }
        throw error;
      }
    })();
    const batchId = admitted.batchId as Id<"planBatches">;
    if (admitted.status === "ready") {
      return { ok: true, planned: admitted.itemIds?.length ?? count, reused: true, costUsd: admitted.actualCostUsd };
    }
    log(`admitted batch ${requestKey}: reserve $${reservation.totalUsd.toFixed(4)}`, {
      modelUsd: reservation.modelUsd,
      imageUsd: reservation.imageUsd,
      reused: admitted.reused,
    });

    // STYLE DNA FIRST — same source of truth as the render pipeline's
    // thumbnail_gen. The template-letter fallback put Greek marble busts on a
    // finance channel's entire week-ahead plan.
    const style =
      styleFromDNA((channel as { styleDNA?: Parameters<typeof styleFromDNA>[0] }).styleDNA) ??
      resolveThumbnailStyle((channel as { template?: string }).template);
    log(`thumbnail style source: ${style.label === "Style DNA" ? "Style DNA" : `template preset (${style.label})`}`);

    let existing = await convex.query(api.contentPlan.listPlan, { ownerId, channelId });
    const keyPrefix = channelPrefix(ownerId, channel.slug);

    let itemIds = admitted.itemIds as Id<"contentPlan">[] | undefined;
    if (admitted.topicState !== "complete") {
      if (!hasGeminiKey() || !hasBanana()) {
        const modelScope = createModelUsageScope();
        const imageScope = createImageUsageScope();
        const checkpoint = buildPlanWeekUsageCheckpoint(modelScope.snapshot(), imageScope.snapshot());
        const usageCheckpointKey = "topics:preflight";
        await convex.mutation(api.contentPlan.recordPlanBatchUsage, {
          ownerId, channelId, batchId, checkpointKey: usageCheckpointKey,
          fingerprint: checkpoint.fingerprint, modelUsage: checkpoint.modelUsage,
          imageUsage: checkpoint.imageUsage, costUsd: checkpoint.costUsd,
          accountingComplete: checkpoint.accountingComplete,
        });
        const error = !hasGeminiKey()
          ? "plan-week-ahead: Gemini topic provider is not configured"
          : "plan-week-ahead: thumbnail image provider is not configured";
        await convex.mutation(api.contentPlan.failPlanTopics, {
          ownerId, channelId, batchId, attempt: admitted.topicAttempt,
          usageCheckpointKey, error, retryable: true,
        });
        abortTask(error);
      }

      // Provider output is persisted before Convex topic rows. Recover the
      // current fenced attempt before opening a new provider claim.
      if (!itemIds && admitted.topicAttempt > 0) {
        const recovered = await loadTopicCheckpoint(
          planTopicCheckpointKey(ownerId, channel.slug, batchId, admitted.topicAttempt),
          batchId,
          admitted.topicAttempt,
        );
        if (recovered) {
          itemIds = await persistTopicCheckpoint({ convex, ownerId, channelId, batchId, checkpoint: recovered });
          log(`recovered ${itemIds.length} topics from durable R2 checkpoint`);
        }
      }

      const topicClaim = itemIds
        ? { state: "complete" as const, itemIds }
        : await convex.mutation(api.contentPlan.claimPlanTopics, {
            ownerId, channelId, batchId, claimant,
          });
      if (topicClaim.state === "busy" || topicClaim.state === "blocked" ||
          topicClaim.state === "recovery_only") {
        const recovered = await loadTopicCheckpoint(
          planTopicCheckpointKey(ownerId, channel.slug, batchId, topicClaim.attempt),
          batchId,
          topicClaim.attempt,
        );
        if (!recovered) {
          const error = topicClaim.error ?? "plan topic phase is unavailable";
          if (topicClaim.state === "blocked" || topicClaim.state === "recovery_only") abortTask(error);
          throw new Error(error);
        }
        itemIds = await persistTopicCheckpoint({ convex, ownerId, channelId, batchId, checkpoint: recovered });
        log(`recovered ${itemIds.length} topics from durable R2 checkpoint`);
      }
      if (!itemIds && topicClaim.state === "complete") {
        itemIds = topicClaim.itemIds as Id<"contentPlan">[];
      } else if (!itemIds && topicClaim.state === "claimed") {
        const usageCheckpointKey = `topics:${topicClaim.attempt}`;
        const modelScope = createModelUsageScope();
        const imageScope = createImageUsageScope();
        try {
          const items = await modelScope.run(() => imageScope.run(async () => {
            const followups = detectFollowups(await loadLedger(keyPrefix));
            const quota = followups.length ? Math.min(followups.length, Math.max(1, Math.round(count / 3))) : 0;
            const followupBets = followups.slice(0, quota).map((followup) => ({
              topic: deterministicFollowupTopic(followup.fromTopic || followup.fromTitle, followup.kind),
              title: deterministicFollowupTopic(followup.fromTitle || followup.fromTopic, followup.kind),
              thumbnailMoment:
                `A concrete next-chapter scene about ${followup.fromTopic || followup.fromTitle}, ` +
                `with one changed consequence clearly visible.`,
            }));
            const uniqueFollowups = dedupePlanCandidates(followupBets, existing.map((row) => row.topic));
            const freshCount = Math.max(0, count - uniqueFollowups.length);
            const optimized = freshCount
              ? await optimizeTopics({
                  convex, ownerId, channelId, keyPrefix,
                  // Four bench candidates replace paid embedding fan-out; the
                  // deterministic gate below removes exact and near duplicates.
                  count: freshCount + 4,
                  identity: {
                    niche,
                    persona,
                    topicPool: channel.identity?.topicPool,
                    bannedWords: channel.identity?.bannedWords,
                    requiredCallbacks: channel.identity?.requiredCallbacks,
                  },
                  channelName,
                  alsoAvoid: [...existing.map((row) => row.topic), ...uniqueFollowups.map((bet) => bet.topic)],
                  providerSemanticDedupe: false,
                  beforeProviderSpend: async () => {
                    await convex.mutation(api.contentPlan.markPlanTopicsProviderStarted, {
                      ownerId, channelId, batchId, attempt: topicClaim.attempt, claimant,
                    });
                  },
                  log,
                })
              : [];
            const candidates = dedupePlanCandidates(
              [...uniqueFollowups, ...optimized],
              existing.map((row) => row.topic),
            ).slice(0, count);
            if (!candidates.length) throw new Error("plan-week-ahead: no unique topics passed the plan gate");
            return candidates.map((candidate) => {
              const topic = candidate.topic.trim();
              const title = String(candidate.title || topic).trim().slice(0, 100);
              return {
                topic,
                title,
                description: deterministicPlanDescription(topic, niche),
                sceneSeed: candidate.thumbnailMoment?.trim() ||
                  `A physical cause-and-effect scene that communicates ${topic} through people, objects, and action.`,
              };
            });
          }));
          const checkpoint = buildPlanWeekUsageCheckpoint(modelScope.snapshot(), imageScope.snapshot());
          const topicCheckpoint = buildPlanWeekTopicCheckpoint({
            batchId,
            attempt: topicClaim.attempt,
            usageCheckpointKey,
            items,
            usage: checkpoint,
          });
          await writeTopicCheckpoint(
            planTopicCheckpointKey(ownerId, channel.slug, batchId, topicClaim.attempt),
            topicCheckpoint,
          );
          itemIds = await persistTopicCheckpoint({
            convex, ownerId, channelId, batchId, checkpoint: topicCheckpoint,
          });
          log(`topic checkpoint saved: ${itemIds.length} unique items, $${checkpoint.costUsd.toFixed(6)}`);
        } catch (error) {
          const checkpoint = buildPlanWeekUsageCheckpoint(modelScope.snapshot(), imageScope.snapshot());
          await convex.mutation(api.contentPlan.recordPlanBatchUsage, {
            ownerId, channelId, batchId, checkpointKey: usageCheckpointKey,
            fingerprint: checkpoint.fingerprint, modelUsage: checkpoint.modelUsage,
            imageUsage: checkpoint.imageUsage, costUsd: checkpoint.costUsd,
            accountingComplete: checkpoint.accountingComplete,
          });
          const failed = await convex.mutation(api.contentPlan.failPlanTopics, {
            ownerId, channelId, batchId, attempt: topicClaim.attempt, usageCheckpointKey,
            error: errorMessage(error),
            retryable: checkpoint.costUsd === 0 && checkpoint.accountingComplete && retryableFailure(error),
          });
          if (failed.state === "complete") {
            itemIds = failed.itemIds as Id<"contentPlan">[];
            log(`topic save response recovered: ${itemIds.length} committed items`);
          } else if (error instanceof AmbiguousTopicCheckpointError) {
            // The next Trigger attempt performs R2 recovery before it is
            // allowed to open another provider claim.
            throw error;
          } else if (checkpoint.costUsd === 0 && checkpoint.accountingComplete && retryableFailure(error)) {
            throw error;
          } else {
            abortTask(error);
          }
        }
      }
    }

    existing = await convex.query(api.contentPlan.listPlan, { ownerId, channelId });
    const batchItems = existing.filter((row) => row.batchId === batchId) as Array<typeof existing[number] & {
      _id: Id<"contentPlan">;
      title?: string;
      description?: string;
      sceneSeed?: string;
    }>;
    if (!itemIds?.length || !batchItems.length) abortTask("plan-week-ahead: admitted batch has no persisted items");
    const dir = join(tmpdir(), `plan_${channelId}_${batchId}`);
    mkdirSync(dir, { recursive: true });

    const failures: string[] = [];
    for (let index = 0; index < batchItems.length; index++) {
      const item = batchItems[index];
      const thumbnailKey = planThumbnailKey(ownerId, channel.slug, item._id);
      const claim = await convex.mutation(api.contentPlan.claimPlanItem, {
        ownerId, channelId, batchId, itemId: item._id, claimant,
      });
      if (claim.state === "complete") continue;
      const usageCheckpointKey = `thumbnail:${item._id}:${claim.attempt}`;

      try {
        const recovered = await recoverThumbnailCheckpoint(thumbnailKey);
        if (recovered) {
          await persistThumbnailCheckpoint({
            convex, ownerId, channelId, batchId, itemId: item._id,
            usageCheckpointKey: recovered.usageCheckpointKey,
            checkpoint: recovered.checkpoint,
          });
          await convex.mutation(api.contentPlan.completePlanItem, {
            ownerId, channelId, batchId, itemId: item._id, attempt: claim.attempt,
            thumbnailKey, usageCheckpointKey: recovered.usageCheckpointKey,
          });
          log(`recovered ${index + 1}/${batchItems.length} from R2 checkpoint`);
          continue;
        }
      } catch (error) {
        if (!(error instanceof InvalidPlanCheckpointError)) throw error;
        await convex.mutation(api.contentPlan.failPlanItem, {
          ownerId, channelId, batchId, itemId: item._id, attempt: claim.attempt,
          usageCheckpointKey, error: errorMessage(error), retryable: false,
        });
        failures.push(`${item.topic}: ${errorMessage(error)}`);
        break;
      }

      if (claim.state === "blocked") {
        failures.push(`${item.topic}: ${claim.error ?? "thumbnail attempt is not retryable"}`);
        break;
      }

      if (claim.state === "recovery_only") {
        failures.push(`${item.topic}: ${claim.error ?? "thumbnail provider spend already started; checkpoint recovery is required"}`);
        break;
      }

      if (claim.state === "busy") {
        failures.push(`${item.topic}: an earlier paid claim is still active`);
        continue;
      }

      const modelScope = createModelUsageScope();
      const imageScope = createImageUsageScope();
      try {
        await modelScope.run(() => imageScope.run(() => genThumb({
          id: item._id,
          topic: item.topic,
          title: item.title?.trim() || item.topic,
          style,
          channelName,
          niche,
          ownerId,
          slug: channel.slug,
          dir,
          log,
          sceneSeed: item.sceneSeed,
          playbook: (channel as { thumbnailPlaybook?: ThumbnailPlaybook }).thumbnailPlaybook,
          usageCheckpointKey,
          usageMetadata: () => planWeekUsageMetadata(
            buildPlanWeekUsageCheckpoint(modelScope.snapshot(), imageScope.snapshot()),
          ),
          beforeProviderSpend: async () => {
            await convex.mutation(api.contentPlan.markPlanItemProviderStarted, {
              ownerId, channelId, batchId, itemId: item._id, attempt: claim.attempt, claimant,
            });
          },
        })));
        const checkpoint = buildPlanWeekUsageCheckpoint(modelScope.snapshot(), imageScope.snapshot());
        await persistThumbnailCheckpoint({
          convex, ownerId, channelId, batchId, itemId: item._id,
          usageCheckpointKey, checkpoint,
        });
        await convex.mutation(api.contentPlan.completePlanItem, {
          ownerId, channelId, batchId, itemId: item._id, attempt: claim.attempt,
          thumbnailKey, usageCheckpointKey,
        });
        log(`planned ${index + 1}/${batchItems.length}: "${(item.title || item.topic).slice(0, 50)}"`);
      } catch (error) {
        const checkpoint = buildPlanWeekUsageCheckpoint(modelScope.snapshot(), imageScope.snapshot());
        if (error instanceof AmbiguousThumbnailCheckpointError) {
          try {
            const recovered = await recoverThumbnailCheckpoint(thumbnailKey);
            if (recovered) {
              await persistThumbnailCheckpoint({
                convex, ownerId, channelId, batchId, itemId: item._id,
                usageCheckpointKey: recovered.usageCheckpointKey,
                checkpoint: recovered.checkpoint,
              });
              await convex.mutation(api.contentPlan.completePlanItem, {
                ownerId, channelId, batchId, itemId: item._id, attempt: claim.attempt,
                thumbnailKey, usageCheckpointKey: recovered.usageCheckpointKey,
              });
              log(`recovered ${index + 1}/${batchItems.length} after ambiguous R2 upload`);
              continue;
            }
          } catch {
            // Persist the exact spend below, then let Trigger make one
            // recovery-only attempt. It may not re-enter the provider.
          }
        }
        const retryable = checkpoint.costUsd === 0 && checkpoint.accountingComplete && retryableFailure(error);
        try {
          await persistThumbnailCheckpoint({
            convex, ownerId, channelId, batchId, itemId: item._id,
            usageCheckpointKey, checkpoint,
          });
          await convex.mutation(api.contentPlan.failPlanItem, {
            ownerId, channelId, batchId, itemId: item._id, attempt: claim.attempt,
            usageCheckpointKey, error: errorMessage(error),
            retryable,
          });
        } catch (checkpointError) {
          failures.push(`${item.topic}: accounting checkpoint failed (${errorMessage(checkpointError)})`);
          break;
        }
        failures.push(`${item.topic}: ${errorMessage(error)}`);
        if (error instanceof AmbiguousThumbnailCheckpointError) throw error;
        // One terminal item means this batch cannot become ready. Do not buy
        // more thumbnails just to discover that again at finalization.
        if (!retryable) break;
      }
    }

    const final = await convex.mutation(api.contentPlan.finalizePlanBatch, { ownerId, channelId, batchId });
    if (final.status !== "ready") {
      const error = `plan-week-ahead ${final.status}: ${
        "error" in final ? final.error : failures.join("; ") || "items still active"
      }`;
      if (final.status === "failed" && !final.retryable) abortTask(error);
      throw new Error(error);
    }
    return { ok: true, planned: final.planned, reused: admitted.reused, costUsd: final.actualCostUsd };
  },
});

function deterministicFollowupTopic(subject: string, kind: "sequel" | "deep_dive" | "variation"): string {
  const clean = subject.trim().replace(/\s+/g, " ").replace(/[.:;!?-]+$/, "");
  if (kind === "sequel") return `${clean}: the next chapter`;
  if (kind === "deep_dive") return `${clean}: the deeper mechanism`;
  return `${clean}: a new consequence`;
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
}

function abortTask(error: unknown): never {
  throw new AbortTaskRunError(errorMessage(error));
}

function retryableFailure(error: unknown): boolean {
  const message = errorMessage(error);
  if (/successful response|no image part|unreadable successful|accounting|budget/i.test(message)) return false;
  return /timeout|network|429|500|502|503|504|temporar|overload|rate limit|not configured|missing/i.test(message);
}

function planThumbnailKey(ownerId: string, slug: string, itemId: string): string {
  return `${channelPrefix(ownerId, slug)}plan/${itemId}.jpg`;
}

function planTopicCheckpointKey(ownerId: string, slug: string, batchId: string, attempt: number): string {
  return `${channelPrefix(ownerId, slug)}plan-batches/${batchId}/topics/${attempt}.json`;
}

async function loadTopicCheckpoint(
  key: string,
  batchId: string,
  attempt: number,
): Promise<PlanWeekTopicCheckpoint | null> {
  let bytes: Uint8Array;
  try {
    bytes = await getObjectBytes(key);
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number }; name?: string }).$metadata?.httpStatusCode;
    const name = (error as { name?: string }).name;
    if (status === 404 || name === "NoSuchKey" || name === "NotFound") return null;
    throw error;
  }
  try {
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
    const checkpoint = parsePlanWeekTopicCheckpoint(parsed);
    return checkpoint?.batchId === batchId && checkpoint.attempt === attempt ? checkpoint : null;
  } catch {
    return null;
  }
}

async function writeTopicCheckpoint(key: string, checkpoint: PlanWeekTopicCheckpoint): Promise<void> {
  try {
    await putObject(key, JSON.stringify(checkpoint), {
      contentType: "application/json",
      ifNoneMatch: "*",
      metadata: {
        "plan-week-contract": PLAN_WEEK_CONTRACT_VERSION,
        "plan-week-fingerprint": checkpoint.artifactFingerprint,
      },
    });
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    let existing: PlanWeekTopicCheckpoint | null = null;
    try {
      existing = await loadTopicCheckpoint(key, checkpoint.batchId, checkpoint.attempt);
    } catch {
      // Preserve the original ambiguous write error below.
    }
    if (existing?.artifactFingerprint === checkpoint.artifactFingerprint) return;
    if (status !== 409 && status !== 412) {
      throw new AmbiguousTopicCheckpointError(
        `plan topic checkpoint upload outcome is ambiguous: ${errorMessage(error)}`,
      );
    }
    if (!existing || existing.artifactFingerprint !== checkpoint.artifactFingerprint) {
      throw new Error("plan topic checkpoint already exists with different content");
    }
  }
}

async function persistTopicCheckpoint(args: {
  convex: ConvexHttpClient;
  ownerId: string;
  channelId: Id<"channels">;
  batchId: Id<"planBatches">;
  checkpoint: PlanWeekTopicCheckpoint;
}): Promise<Id<"contentPlan">[]> {
  const saved = await args.convex.mutation(api.contentPlan.savePlanTopics, {
    ownerId: args.ownerId,
    channelId: args.channelId,
    batchId: args.batchId,
    attempt: args.checkpoint.attempt,
    usageCheckpointKey: args.checkpoint.usageCheckpointKey,
    fingerprint: args.checkpoint.usage.fingerprint,
    modelUsage: args.checkpoint.usage.modelUsage,
    imageUsage: args.checkpoint.usage.imageUsage,
    costUsd: args.checkpoint.usage.costUsd,
    accountingComplete: args.checkpoint.usage.accountingComplete,
    items: args.checkpoint.items,
  });
  if (saved.state === "blocked") throw new Error(saved.error);
  return saved.itemIds as Id<"contentPlan">[];
}

async function recoverThumbnailCheckpoint(key: string): Promise<{
  checkpoint: PlanWeekUsageCheckpoint;
  usageCheckpointKey: string;
} | null> {
  const head = await headObjectMetadata(key);
  if (!head) return null;
  if ((head.contentLength ?? 0) <= 0) {
    throw new InvalidPlanCheckpointError("existing plan thumbnail checkpoint is empty");
  }
  const checkpoint = parsePlanWeekUsageMetadata(head.metadata);
  const usageCheckpointKey = head.metadata["plan-week-checkpoint-key"]?.trim();
  if (!checkpoint || !usageCheckpointKey) {
    throw new InvalidPlanCheckpointError("existing plan thumbnail is missing its exact usage checkpoint");
  }
  return { checkpoint, usageCheckpointKey };
}

async function persistThumbnailCheckpoint(args: {
  convex: ConvexHttpClient;
  ownerId: string;
  channelId: Id<"channels">;
  batchId: Id<"planBatches">;
  itemId: Id<"contentPlan">;
  usageCheckpointKey: string;
  checkpoint: PlanWeekUsageCheckpoint;
}): Promise<void> {
  const result = await args.convex.mutation(api.contentPlan.recordPlanBatchUsage, {
    ownerId: args.ownerId,
    channelId: args.channelId,
    batchId: args.batchId,
    itemId: args.itemId,
    checkpointKey: args.usageCheckpointKey,
    fingerprint: args.checkpoint.fingerprint,
    modelUsage: args.checkpoint.modelUsage,
    imageUsage: args.checkpoint.imageUsage,
    costUsd: args.checkpoint.costUsd,
    accountingComplete: args.checkpoint.accountingComplete,
  });
  if ("budgetExceeded" in result && result.budgetExceeded) {
    throw new Error("plan thumbnail usage exceeded the admitted batch reservation");
  }
  if (!args.checkpoint.accountingComplete) {
    throw new Error("plan thumbnail contains unpriced model/image usage");
  }
}

/**
 * One plan-preview thumbnail from Topicraft's already-judged scene (or a
 * deterministic topic-grounded fallback). There is no per-thumbnail LLM
 * concept/meta call: one claimed Flash image plus local exact typography.
 */
async function genThumb(o: {
  id: string;
  topic: string;
  title: string;
  style: ReturnType<typeof resolveThumbnailStyle>;
  channelName: string;
  niche: string;
  ownerId: string;
  slug: string;
  dir: string;
  log: (m: string) => void;
  /** Topicraft's judged thumbnail moment — the scene the bet was gated on. */
  sceneSeed?: string;
  playbook?: ThumbnailPlaybook;
  usageCheckpointKey: string;
  usageMetadata: () => Record<string, string>;
  beforeProviderSpend: () => Promise<void>;
}): Promise<string> {
  if (!hasBanana()) throw new Error("plan thumbnail image provider is not configured");
  const scene = o.sceneSeed?.trim() ||
    `A dramatic physical scene that communicates this subject through people, objects, and action: ${o.topic}.` +
    (o.niche ? ` Visual context: ${o.niche}.` : "");
  const lines: { text: string; payoff?: boolean }[] = [{ text: shortTitleFallback(o.title), payoff: true }];
  const outJpg = join(o.dir, `t_${o.id}.jpg`);
  const vl = o.playbook?.visualLanguage;
  const patterns = o.playbook?.patterns ?? [];
  const patternIndex = patterns.length
    ? [...o.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % patterns.length
    : 0;
  const requestedZone = String(patterns[patternIndex]?.textRecipe?.position ?? "left");
  const zones = new Set<ThumbnailTextZone>([
    "left", "right", "upperLeft", "upperRight", "center", "upperCenter",
  ]);
  const textZone = zones.has(requestedZone as ThumbnailTextZone)
    ? requestedZone as ThumbnailTextZone
    : "left";
  let providerSpendStarted = false;
  await renderThumbnail({
    spec: {
      scene: {
        description: scene,
        imageStyle: vl?.imageStyle ?? o.style.art,
        palette: [vl?.baseColor, vl?.accentColor, o.style.palette]
          .filter((value): value is string => Boolean(value)),
        accentColor: vl?.accentColor ?? o.style.title.accent ?? undefined,
        composition: vl?.composition,
        textZone,
        visualAvoid: o.playbook?.avoid,
      },
      typography: {
        lines: lines.map((line) => ({
          text: line.text,
          payoff: line.payoff,
          accent: line.payoff,
        })),
        subtitle: o.channelName,
        font: vl?.font ?? o.style.title.font,
        uppercase: vl?.uppercase ?? o.style.title.uppercase,
        treatment: vl?.treatment ?? "clean",
        textObject: vl?.textObject,
        baseColor: vl?.baseColor,
        accentColor: vl?.accentColor ?? o.style.title.accent ?? undefined,
        badgeStyle: vl?.badgeStyle,
      },
    },
    outJpg,
    tmpDir: o.dir,
    generateScene: async (request) => {
      if (!providerSpendStarted) {
        await o.beforeProviderSpend();
        providerSpendStarted = true;
      }
      return generateBananaImage({ ...request, maxProviderAttempts: 1 });
    },
  });
  const key = planThumbnailKey(o.ownerId, o.slug, o.id);
  try {
    await putObject(key, readFileSync(outJpg), {
      contentType: "image/jpeg",
      metadata: {
        ...o.usageMetadata(),
        "plan-week-checkpoint-key": o.usageCheckpointKey,
      },
      ifNoneMatch: "*",
    });
  } catch (error) {
    throw new AmbiguousThumbnailCheckpointError(
      `plan thumbnail upload outcome is ambiguous: ${errorMessage(error)}`,
    );
  }
  return key;
}
