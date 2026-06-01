import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const identityValidator = v.object({
  persona: v.string(),
  voiceId: v.optional(v.string()),
  voiceRef: v.optional(v.string()),
  toneRefs: v.optional(v.array(v.string())),
  bannedWords: v.array(v.string()),
  requiredCallbacks: v.array(v.string()),
  styleGrammar: v.string(),
  palette: v.array(v.string()),
  thumbnailTemplate: v.string(),
  topicPool: v.array(v.string()),
  cadence: v.string(),
  niche: v.optional(v.string()),
  thumbnailIdentity: v.optional(
    v.object({
      colorPalette: v.array(v.string()),
      visualStyle: v.string(),
      textPosition: v.string(),
      avoid: v.array(v.string()),
    }),
  ),
});

const thumbnailerValidator = v.union(
  v.literal("claude_flux"),
  v.literal("ideogram"),
  v.literal("title_card"),
);

const pipelineValidator = v.array(
  v.object({
    block: v.string(),
    params: v.optional(v.any()),
  }),
);

export const createChannel = mutation({
  args: {
    ownerId: v.string(),
    slug: v.string(),
    name: v.string(),
    identity: identityValidator,
    thumbnailer: v.optional(thumbnailerValidator),
    template: v.string(),
    pipeline: pipelineValidator,
    modelRouting: v.optional(v.any()),
    qaRubric: v.optional(v.any()),
    budget: v.number(),
    status: v.optional(v.string()),
  },
  returns: v.id("channels"),
  handler: async (ctx, args) => {
    // Idempotent upsert keyed on (ownerId, slug): a re-seed of the same
    // channel patches the existing doc instead of inserting a duplicate
    // (the prior bare-insert was the source of duplicate channels).
    const existing = await ctx.db
      .query("channels")
      .withIndex("by_owner_slug", (q) =>
        q.eq("ownerId", args.ownerId).eq("slug", args.slug),
      )
      .unique();

    const doc = {
      ownerId: args.ownerId,
      slug: args.slug,
      name: args.name,
      identity: args.identity,
      thumbnailer: args.thumbnailer,
      template: args.template,
      pipeline: args.pipeline,
      modelRouting: args.modelRouting,
      qaRubric: args.qaRubric,
      budget: args.budget,
      status: args.status ?? "draft",
    };

    if (existing) {
      await ctx.db.patch(existing._id, doc);
      return existing._id;
    }

    return await ctx.db.insert("channels", doc);
  },
});

/**
 * Resolve a channel by (ownerId, slug) via the by_owner_slug index.
 * Powers the /channels/[slug] detail route.
 */
export const getChannelBySlug = query({
  args: { ownerId: v.string(), slug: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("channels")
      .withIndex("by_owner_slug", (q) =>
        q.eq("ownerId", args.ownerId).eq("slug", args.slug),
      )
      .unique();
  },
});

export const listChannels = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("channels")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
  },
});

export const getChannel = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.channelId);
  },
});

/**
 * Hard-delete a channel doc. Used by the dedupe-channels maintenance script
 * after its runs have been repointed onto the kept channel.
 */
export const deleteChannel = mutation({
  args: { channelId: v.id("channels") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.delete(args.channelId);
    return null;
  },
});

export const updateChannel = mutation({
  args: {
    channelId: v.id("channels"),
    name: v.optional(v.string()),
    identity: v.optional(identityValidator),
    thumbnailer: v.optional(thumbnailerValidator),
    template: v.optional(v.string()),
    pipeline: v.optional(pipelineValidator),
    modelRouting: v.optional(v.any()),
    qaRubric: v.optional(v.any()),
    budget: v.optional(v.number()),
    status: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { channelId, ...rest } = args;
    const existing = await ctx.db.get(channelId);
    if (!existing) throw new Error(`channel not found: ${channelId}`);
    const patch: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(rest)) {
      if (val !== undefined) patch[k] = val;
    }
    await ctx.db.patch(channelId, patch);
    return null;
  },
});
