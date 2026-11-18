import { v } from "convex/values";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import { channelPipelineWriteFence } from "../src/lib/channelPipelineWriteFence";
import { firstLockedModulePipelineChange, moduleConfigFingerprint } from "../src/lib/channelModuleLock";
import { canonicalJson } from "../src/lib/canonicalJson";
import { sha256Hex } from "../src/lib/sha256";
import { durationCandidateProposal } from "../src/lib/durationCandidateProposal";
import { durationCandidateFamily } from "../src/lib/durationCandidateFamily";

const entry = v.object({ block: v.string(), version: v.optional(v.string()), params: v.optional(v.any()) });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function frozenInception(value: unknown) {
  if (!record(value) || typeof value.schemaVersion !== "string" || typeof value.planKey !== "string" || typeof value.requestFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.requestFingerprint) || !record(value.requestSnapshot)) return null;
  const source = { schemaVersion: value.schemaVersion, planKey: value.planKey, requestFingerprint: value.requestFingerprint, requestSnapshot: value.requestSnapshot };
  return JSON.stringify(source).length <= 100_000 ? source : null;
}

export const list = query({
  args: { ownerId: v.string(), channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity?.owner_id !== args.ownerId || !((identity.role === "owner" && identity.subject === args.ownerId) || identity.role === "service")) throw new Error("Owner verification required");
    return ctx.db.query("durationDraftCandidates").withIndex("by_owner_channel_created", q => q.eq("ownerId", args.ownerId).eq("channelId", args.channelId)).order("desc").take(100);
  },
});

export const get = query({
  args: { ownerId: v.string(), channelId: v.id("channels"), candidateId: v.id("durationDraftCandidates") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity?.owner_id !== args.ownerId || !((identity.role === "owner" && identity.subject === args.ownerId) || identity.role === "service")) throw new Error("Owner verification required");
    const row = await ctx.db.get(args.candidateId);
    return row?.ownerId === args.ownerId && row.channelId === args.channelId ? row : null;
  },
});

export const create = mutation({
  args: { ownerId: v.string(), channelId: v.id("channels"), baselineFingerprint: v.string(), requestedSeconds: v.number(), pipeline: v.array(entry) },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "duration draft creation");
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.ownerId !== args.ownerId) throw new Error("Channel not found");
    if (channel.locked === true) throw new Error("Channel is locked");
    if (channelPipelineWriteFence(channel) !== args.baselineFingerprint) throw new Error("Channel changed since preview; recalculate before saving");
    const family = durationCandidateFamily(channel);
    if (family !== "music_loop" && family !== "narrated_stock") throw new Error("This format is not supported for duration candidates");
    if (args.pipeline.length > 100 || JSON.stringify(args.pipeline).length > 100_000 || JSON.stringify(channel.moduleConfig ?? {}).length > 100_000) throw new Error("Invalid duration candidate");
    const proposal = durationCandidateProposal(channel, args.requestedSeconds);
    if (canonicalJson(proposal.pipeline) !== canonicalJson(args.pipeline)) throw new Error("Candidate does not match the duration transformation");
    const lock = firstLockedModulePipelineChange({ moduleLocks: channel.moduleLocks, currentPipeline: channel.pipeline, nextPipeline: args.pipeline });
    if (lock) throw new Error(`Module '${lock}' is locked`);
    const baselineModuleConfig = channel.moduleConfig ?? {};
    const moduleConfig = proposal.moduleConfig;
    for (const block of Object.keys(channel.moduleLocks ?? {})) {
      if (moduleConfigFingerprint(baselineModuleConfig, block) !== moduleConfigFingerprint(moduleConfig, block)) throw new Error(`Module '${block}' is locked`);
    }
    if (canonicalJson(channel.pipeline) === canonicalJson(args.pipeline) && canonicalJson(baselineModuleConfig) === canonicalJson(moduleConfig)) throw new Error("The requested duration produces no pipeline or module settings change");
    const sourceInception = frozenInception(channel.inception);
    const content = { version: "duration-draft-candidate/v3" as const, ownerId: args.ownerId, channelId: String(args.channelId), baselineFingerprint: args.baselineFingerprint, family, requestedSeconds: args.requestedSeconds, baselineModuleConfig, moduleConfig, pipeline: args.pipeline, sourceInception };
    const fingerprint = sha256Hex(canonicalJson(content));
    const existing = await ctx.db.query("durationDraftCandidates").withIndex("by_owner_channel_fingerprint", q => q.eq("ownerId", args.ownerId).eq("channelId", args.channelId).eq("fingerprint", fingerprint)).unique();
    if (existing) return { id: existing._id, fingerprint, reused: true };
    const prior = await ctx.db.query("durationDraftCandidates").withIndex("by_owner_channel_created", q => q.eq("ownerId", args.ownerId).eq("channelId", args.channelId)).take(100);
    if (prior.length >= 100) throw new Error("Channel duration candidate limit reached");
    const id = await ctx.db.insert("durationDraftCandidates", { status: "untested", version: content.version, ownerId: args.ownerId, channelId: args.channelId, fingerprint, baselineFingerprint: args.baselineFingerprint, family, requestedSeconds: args.requestedSeconds, baselinePipeline: channel.pipeline, baselineModuleConfig, pipeline: args.pipeline, moduleConfig, sourceInception, createdAt: Date.now() });
    return { id, fingerprint, reused: false };
  },
});
