/**
 * Voice bank — profiled voice cards for the operator's ElevenLabs account
 * (voicecraft's casting source). Each row = one voice, with the structured
 * profile a Gemini audio analysis produced from its REAL preview audio, so
 * casting matches on what voices actually SOUND like, not on their labels.
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const profileValidator = v.object({
  gender: v.string(), // male | female | neutral
  ageFeel: v.string(), // young | middle_aged | old
  register: v.string(), // deep | low | mid | high
  pace: v.string(), // slow | measured | brisk | fast
  energy: v.string(), // calm | controlled | warm | bright | intense
  texture: v.string(), // <=6 words, e.g. "dry gravel, close-mic intimacy"
  character: v.string(), // <=30 words judge-facing description
  bestFor: v.array(v.string()), // ranked archetype keys
  confidence: v.number(), // 1-10
});

export const upsertProfile = mutation({
  args: {
    ownerId: v.string(),
    voiceId: v.string(),
    name: v.string(),
    provider: v.string(), // "elevenlabs"
    category: v.string(), // premade | professional | cloned | generated
    labels: v.optional(v.any()),
    previewUrl: v.optional(v.string()),
    profile: profileValidator,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("voiceProfiles")
      .withIndex("by_owner_voice", (q) => q.eq("ownerId", args.ownerId).eq("voiceId", args.voiceId))
      .first();
    const row = { ...args, profiledAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, row);
      return existing._id;
    }
    return await ctx.db.insert("voiceProfiles", row);
  },
});

export const listProfiles = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("voiceProfiles")
      .withIndex("by_owner_voice", (q) => q.eq("ownerId", args.ownerId))
      .collect();
  },
});

/** Attach the rendered 10s audition clip (R2 key) to a voice card. */
export const setAudition = mutation({
  args: { ownerId: v.string(), voiceId: v.string(), auditionKey: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("voiceProfiles")
      .withIndex("by_owner_voice", (q) => q.eq("ownerId", args.ownerId).eq("voiceId", args.voiceId))
      .first();
    if (!row) throw new Error(`voiceBank.setAudition: no profile for ${args.voiceId}`);
    await ctx.db.patch(row._id, { auditionKey: args.auditionKey });
  },
});

/** Evict a voice from the bank (recruit validation failure / operator removal). */
export const deleteProfile = mutation({
  args: { ownerId: v.string(), voiceId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("voiceProfiles")
      .withIndex("by_owner_voice", (q) => q.eq("ownerId", args.ownerId).eq("voiceId", args.voiceId))
      .first();
    if (row) await ctx.db.delete(row._id);
    return Boolean(row);
  },
});
