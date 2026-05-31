import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const identityValidator = v.object({
  persona: v.string(),
  voiceId: v.optional(v.string()),
  bannedWords: v.array(v.string()),
  requiredCallbacks: v.array(v.string()),
  styleGrammar: v.string(),
  palette: v.array(v.string()),
  thumbnailTemplate: v.string(),
  topicPool: v.array(v.string()),
  cadence: v.string(),
});

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
    template: v.string(),
    pipeline: pipelineValidator,
    modelRouting: v.optional(v.any()),
    qaRubric: v.optional(v.any()),
    budget: v.number(),
    status: v.optional(v.string()),
  },
  returns: v.id("channels"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("channels", {
      ownerId: args.ownerId,
      slug: args.slug,
      name: args.name,
      identity: args.identity,
      template: args.template,
      pipeline: args.pipeline,
      modelRouting: args.modelRouting,
      qaRubric: args.qaRubric,
      budget: args.budget,
      status: args.status ?? "draft",
    });
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

export const updateChannel = mutation({
  args: {
    channelId: v.id("channels"),
    name: v.optional(v.string()),
    identity: v.optional(identityValidator),
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
