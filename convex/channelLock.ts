/**
 * CHANNEL LOCK — the single guard for every operator-authored channel write.
 *
 * A channel marked done is immutable. Unlike the retired fork-on-write design,
 * a locked row now rejects every guarded change until its interactive owner
 * explicitly unlocks it. This is intentionally a hard stop: an agent must not
 * get a silent v2 merely because it attempted a later optimisation.
 */
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  CHANNEL_LOCK_AUDIT_BLOCK_ID,
  channelMutationAuditActor,
  recordChannelLockAudit,
} from "./channelLockAudit";

/** Discriminated outcome so callers can stop without mistaking rejection for success. */
export type ChannelWriteOutcome =
  | { state: "updated"; channelId: Id<"channels"> }
  | { state: "channel_locked"; channelId: Id<"channels"> };

export function isChannelLocked(
  channel: { locked?: boolean } | null | undefined,
): boolean {
  return channel?.locked === true;
}

/**
 * Use for state-machine/delete paths where the caller cannot return a durable
 * discriminated outcome. Operator-authored updates should use the patch helper
 * below so their rejected attempt is auditable.
 */
export function assertChannelWritable(
  channel: { _id: Id<"channels">; locked?: boolean },
  operation: string,
): void {
  if (isChannelLocked(channel)) {
    throw new Error(
      `channel ${channel._id} is locked (marked done); ${operation} is refused. ` +
        "Unlock it explicitly via channels.unlockChannel to proceed.",
    );
  }
}

/**
 * Apply an operator-authored patch only while the channel remains editable.
 * A rejection is returned, rather than thrown, so the lock audit commits in
 * the same transaction and workers can stop cleanly.
 */
export async function patchChannelRespectingLock(
  ctx: MutationCtx,
  channelId: Id<"channels">,
  patch: Record<string, unknown>,
  operation: string,
): Promise<ChannelWriteOutcome> {
  const channel = await ctx.db.get(channelId);
  if (!channel) throw new Error(`channel not found: ${channelId}`);

  if (isChannelLocked(channel)) {
    await recordChannelLockAudit(ctx, {
      ownerId: channel.ownerId,
      channelId: channel._id,
      blockId: CHANNEL_LOCK_AUDIT_BLOCK_ID,
      event: "mutation_rejected",
      operation,
      actor: await channelMutationAuditActor(ctx),
      reason: `channel is locked; unlock it explicitly before ${operation}`,
    });
    return { state: "channel_locked", channelId };
  }

  await ctx.db.patch(channelId, patch);
  return { state: "updated", channelId };
}

/**
 * Fields that record an external fact rather than an operator-authored channel
 * change. A field belongs here only when the event already happened outside
 * the app and refusing it would strand an irreversible provider receipt.
 */
const EXTERNAL_FACT_FIELDS: readonly string[] = ["youtubeCreated"];

/**
 * Record an allowlisted external fact even when a channel is locked. This is
 * deliberately narrower than patchChannelRespectingLock; config, identity,
 * pipeline, schedule, and creative changes never bypass the lock.
 */
export async function patchChannelExternalFact(
  ctx: MutationCtx,
  channelId: Id<"channels">,
  patch: Record<string, unknown>,
): Promise<void> {
  const disallowed = Object.keys(patch).filter(
    (key) => !EXTERNAL_FACT_FIELDS.includes(key),
  );
  if (disallowed.length > 0) {
    throw new Error(
      `patchChannelExternalFact: field(s) ${disallowed.join(", ")} are not on the ` +
        "EXTERNAL_FACT_FIELDS allowlist (convex/channelLock.ts).",
    );
  }
  const channel = await ctx.db.get(channelId);
  if (!channel) throw new Error(`channel not found: ${channelId}`);
  await ctx.db.patch(channelId, patch);
}
