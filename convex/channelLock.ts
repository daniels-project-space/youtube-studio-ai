/**
 * CHANNEL LOCK — the single choke point for every write that lands on a
 * `channels` row.
 *
 * A channel is marked "done" MANUALLY (channels.lockChannel). From that moment
 * the row is frozen: no config/content edit may modify it. Rather than erroring
 * — which would strand the operator's edit — a guarded write is FORKED onto a
 * new channel row ("v2") that carries the attempted change, links back to the
 * locked parent via `parentChannelId`, and becomes the editable head. The locked
 * v1 is left byte-for-byte untouched.
 *
 * Repeated edits reuse the existing unlocked fork head instead of spawning a new
 * row each time; a fresh row only appears when the whole chain is locked. That
 * bound matters — several callers (bulk maintenance, background sync) would
 * otherwise fork on every pass forever.
 */
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Discriminated result mirroring the codebase's existing "the write did not do
 * what you asked" convention (see channels.updatePipelineIfCurrent's `state`).
 * `channelId` is always the row the caller ASKED to write.
 */
export type ChannelWriteOutcome =
  | { forked: false; channelId: Id<"channels"> }
  | { forked: true; channelId: Id<"channels">; newChannelId: Id<"channels"> };

/** Defensive bound on a corrupted/cyclic parentChannelId chain. */
const MAX_FORK_CHAIN_DEPTH = 32;
/** Defensive bound on slug disambiguation attempts. */
const MAX_FORK_SLUG_ATTEMPTS = 200;

/**
 * Fields a fork must NEVER inherit.
 *
 * - `_id` / `_creationTime`: Convex system fields.
 * - lock state: the fork is the new EDITABLE head, so it starts unlocked.
 * - `youtubeCreated`: `assertYoutubeChannelIdUniqueBinding`
 *   (convex/youtubeCreationClaims.ts) throws when two channel rows project the
 *   same ytChannelId. A fork has not been created on YouTube yet.
 * - `groupId` / `groupRole`: a multi-language group must keep exactly one
 *   "base" (src/trigger/blocks/bundleBlocks.ts filters on it). A fork is a new
 *   standalone channel until the operator regroups it.
 */
const NON_INHERITED_FORK_FIELDS: readonly string[] = [
  "_id",
  "_creationTime",
  "locked",
  "lockedAt",
  "lockedBy",
  "parentChannelId",
  "versionNumber",
  "youtubeCreated",
  "groupId",
  "groupRole",
];

export function isChannelLocked(
  channel: { locked?: boolean } | null | undefined,
): boolean {
  return channel?.locked === true;
}

/**
 * Refuse a write that cannot be meaningfully forked (a delete, or a mid-flight
 * service state-machine write). Forking those would either lose the operator's
 * intent or spawn an unbounded number of rows, so blocking is the safe default.
 */
export function assertChannelWritable(
  channel: { _id: Id<"channels">; locked?: boolean },
  operation: string,
): void {
  if (isChannelLocked(channel)) {
    throw new Error(
      `channel ${channel._id} is locked (marked done); ${operation} is refused. ` +
        `Unlock it explicitly via channels.unlockChannel to proceed.`,
    );
  }
}

/** "my-channel-v2" → "my-channel"; "My Show v3" → "My Show". */
function stripVersionSuffix(value: string, style: "slug" | "name"): string {
  return value.replace(style === "slug" ? /-v\d+$/ : /\s+v\d+$/i, "");
}

/**
 * Allocate a slug that is free for this owner, reusing the same
 * `by_owner_slug` uniqueness lookup channels.createChannel upserts on.
 */
async function uniqueForkSlug(
  ctx: MutationCtx,
  ownerId: string,
  attemptedSlug: string,
  versionNumber: number,
): Promise<string> {
  const base = stripVersionSuffix(attemptedSlug, "slug") || attemptedSlug;
  for (let attempt = 0; attempt < MAX_FORK_SLUG_ATTEMPTS; attempt++) {
    const candidate =
      attempt === 0 ? `${base}-v${versionNumber}` : `${base}-v${versionNumber}-${attempt + 1}`;
    const clash = await ctx.db
      .query("channels")
      .withIndex("by_owner_slug", (q) => q.eq("ownerId", ownerId).eq("slug", candidate))
      .first();
    if (!clash) return candidate;
  }
  throw new Error(`unable to allocate a unique fork slug from '${attemptedSlug}'`);
}

/**
 * Walk down the fork chain to the first descendant that is not locked.
 * Returns null when every row in the chain is locked — the caller then creates
 * a new fork.
 */
async function unlockedForkHead(
  ctx: MutationCtx,
  channel: Doc<"channels">,
): Promise<Doc<"channels"> | null> {
  let current = channel;
  const seen = new Set<string>([String(current._id)]);
  for (let depth = 0; depth < MAX_FORK_CHAIN_DEPTH; depth++) {
    if (!isChannelLocked(current)) return current;
    const children = (
      await ctx.db
        .query("channels")
        .withIndex("by_parent", (q) => q.eq("parentChannelId", current._id))
        .collect()
    ).filter((child) => child.ownerId === current.ownerId && !seen.has(String(child._id)));
    if (children.length === 0) return null;
    // Deterministic descent so concurrent writers converge on the same head.
    children.sort(
      (a, b) =>
        (a.versionNumber ?? 0) - (b.versionNumber ?? 0) || a._creationTime - b._creationTime,
    );
    current = children[0]!;
    seen.add(String(current._id));
  }
  throw new Error(`channel fork chain from ${channel._id} exceeds the supported depth`);
}

/** Copy the locked parent, apply the attempted change on top, insert as v(n+1). */
async function insertChannelFork(
  ctx: MutationCtx,
  parent: Doc<"channels">,
  patch: Record<string, unknown>,
): Promise<Id<"channels">> {
  const versionNumber = (parent.versionNumber ?? 1) + 1;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parent)) {
    if (NON_INHERITED_FORK_FIELDS.includes(key)) continue;
    next[key] = value;
  }
  for (const [key, value] of Object.entries(patch)) {
    if (NON_INHERITED_FORK_FIELDS.includes(key)) continue;
    next[key] = value;
  }

  // Ownership never transfers on a fork, whatever the attempted patch said.
  next.ownerId = parent.ownerId;
  next.parentChannelId = parent._id;
  next.versionNumber = versionNumber;
  next.locked = false;

  const attemptedName = typeof next.name === "string" && next.name ? next.name : parent.name;
  next.name = `${stripVersionSuffix(attemptedName, "name")} v${versionNumber}`;
  const attemptedSlug = typeof next.slug === "string" && next.slug ? next.slug : parent.slug;
  next.slug = await uniqueForkSlug(ctx, parent.ownerId, attemptedSlug, versionNumber);

  // A patch uses `undefined` to mean "clear this field"; an insert just omits it.
  for (const key of Object.keys(next)) {
    if (next[key] === undefined) delete next[key];
  }

  return await ctx.db.insert(
    "channels",
    next as unknown as Parameters<MutationCtx["db"]["insert"]>[1] & Doc<"channels">,
  );
}

/**
 * Apply `patch` to `channelId`, honouring the channel lock.
 *
 * Unlocked → a plain patch, `{ forked: false }`.
 * Locked   → the target row is NOT touched; the patch lands on its editable
 *            fork head (created on first attempt) and the caller gets
 *            `{ forked: true, newChannelId }`.
 */
export async function patchChannelRespectingLock(
  ctx: MutationCtx,
  channelId: Id<"channels">,
  patch: Record<string, unknown>,
): Promise<ChannelWriteOutcome> {
  const channel = await ctx.db.get(channelId);
  if (!channel) throw new Error(`channel not found: ${channelId}`);

  if (!isChannelLocked(channel)) {
    await ctx.db.patch(channelId, patch);
    return { forked: false, channelId };
  }

  const head = await unlockedForkHead(ctx, channel);
  if (head) {
    await ctx.db.patch(head._id, patch);
    return { forked: true, channelId, newChannelId: head._id };
  }
  const newChannelId = await insertChannelFork(ctx, channel, patch);
  return { forked: true, channelId, newChannelId };
}
