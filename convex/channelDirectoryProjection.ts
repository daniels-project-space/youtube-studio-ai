import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type NavigationChannel = Pick<Doc<"channels">, "_id" | "name" | "slug"> & {
  identity: Pick<Doc<"channels">["identity"], "imageKey" | "niche" | "palette">;
};

export function channelDirectoryEntry(channel: NavigationChannel) {
  return {
    _id: channel._id,
    name: channel.name,
    slug: channel.slug,
    identity: {
      imageKey: channel.identity.imageKey,
      niche: channel.identity.niche,
      palette: channel.identity.palette,
    },
  };
}

export function channelDirectoryState(ctx: QueryCtx | MutationCtx, ownerId: string) {
  return ctx.db.query("channelDirectoryStates")
    .withIndex("by_owner", q => q.eq("ownerId", ownerId)).unique();
}

export async function writeChannelDirectory(ctx: MutationCtx, channel: Doc<"channels">, generation?: number): Promise<void> {
  const currentGeneration = generation ?? (await channelDirectoryState(ctx, channel.ownerId))?.generation ?? 1;
  const existing = await ctx.db.query("channelDirectory")
    .withIndex("by_channel", q => q.eq("channelId", channel._id)).unique();
  if (existing && existing.ownerId !== channel.ownerId) throw new Error("Channel directory owner mismatch");
  const { _id, ...entry } = channelDirectoryEntry(channel);
  const next = {
    ownerId: channel.ownerId, channelId: _id, channelCreatedAt: channel._creationTime,
    generation: currentGeneration, ...entry,
  };
  if (!existing) {
    await ctx.db.insert("channelDirectory", next);
  } else if (existing.generation !== next.generation || existing.channelCreatedAt !== next.channelCreatedAt ||
    JSON.stringify(channelDirectoryEntry({ ...existing, _id: existing.channelId })) !== JSON.stringify(entryWithId(next))) {
    await ctx.db.patch(existing._id, next);
  }
}

function entryWithId(row: Omit<NavigationChannel, "_id"> & { channelId: Id<"channels"> }) {
  return { _id: row.channelId, name: row.name, slug: row.slug, identity: row.identity };
}

export async function updateChannelDirectoryForPatch(
  ctx: MutationCtx, channel: Doc<"channels">, patch: Record<string, unknown>,
): Promise<void> {
  if (!["name", "slug", "identity", "ownerId"].some(key => Object.hasOwn(patch, key))) return;
  if (Object.hasOwn(patch, "ownerId") && patch.ownerId !== channel.ownerId) {
    throw new Error("Channel ownership cannot change through a channel patch");
  }
  const next = { ...channel, ...patch } as Doc<"channels">;
  if (JSON.stringify(channelDirectoryEntry(channel)) === JSON.stringify(channelDirectoryEntry(next))) return;
  await writeChannelDirectory(ctx, next);
}

export async function deleteChannelDirectory(ctx: MutationCtx, channel: Pick<Doc<"channels">, "_id" | "ownerId">) {
  const row = await ctx.db.query("channelDirectory")
    .withIndex("by_channel", q => q.eq("channelId", channel._id)).unique();
  if (!row) return;
  if (row.ownerId !== channel.ownerId) throw new Error("Channel directory owner mismatch");
  await ctx.db.delete(row._id);
}

export async function readChannelDirectory(ctx: QueryCtx, ownerId: string) {
  const state = await channelDirectoryState(ctx, ownerId);
  if (!state?.ready) {
    const channels = await ctx.db.query("channels")
      .withIndex("by_owner", q => q.eq("ownerId", ownerId)).collect();
    return channels.map(channelDirectoryEntry);
  }
  const rows = await ctx.db.query("channelDirectory")
    .withIndex("by_owner_generation", q => q.eq("ownerId", ownerId).eq("generation", state.generation)).collect();
  rows.sort((a, b) => a.channelCreatedAt - b.channelCreatedAt ||
    (a.channelId < b.channelId ? -1 : a.channelId > b.channelId ? 1 : 0));
  return rows.map(entryWithId);
}
