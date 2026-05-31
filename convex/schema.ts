import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * YouTube Studio AI — Convex data model (MASTER-PLAN §C).
 *
 * Single source of truth for all pipeline state. EVERY row carries `ownerId`
 * (tenancy-retrofit from day 1 — single-operator now, per-channel SaaS later).
 * R2 keys are per-channel prefixed; nothing here holds media bytes.
 */
export default defineSchema({
  // A channel = Identity + an ordered Pipeline of Blocks + Config.
  channels: defineTable({
    ownerId: v.string(),
    slug: v.string(),
    name: v.string(),
    identity: v.object({
      persona: v.string(),
      voiceId: v.optional(v.string()),
      bannedWords: v.array(v.string()),
      requiredCallbacks: v.array(v.string()),
      styleGrammar: v.string(),
      palette: v.array(v.string()),
      thumbnailTemplate: v.string(),
      topicPool: v.array(v.string()),
      cadence: v.string(),
    }),
    template: v.string(), // archetype A|B|C|D|E
    pipeline: v.array(
      v.object({
        block: v.string(),
        params: v.optional(v.any()),
      }),
    ),
    modelRouting: v.optional(v.any()),
    qaRubric: v.optional(v.any()),
    budget: v.number(), // per-run USD ceiling
    status: v.string(), // draft|active|paused|archived
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_slug", ["ownerId", "slug"]),

  // One execution of a channel's pipeline.
  runs: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    status: v.string(), // queued|running|ok|failed|canceled
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    costTotal: v.number(),
    error: v.optional(v.string()),
    videoAssetId: v.optional(v.id("assets")),
    youtubeVideoId: v.optional(v.string()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_channel", ["channelId"]),

  // Per-block progress for a run — drives the live UI.
  runStages: defineTable({
    ownerId: v.string(),
    runId: v.id("runs"),
    block: v.string(),
    status: v.string(), // queued|running|ok|failed|skipped
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    cost: v.number(),
    inputs: v.optional(v.any()),
    outputs: v.optional(v.any()),
    error: v.optional(v.string()),
  })
    .index("by_run", ["runId"])
    .index("by_run_block", ["runId", "block"])
    .index("by_owner", ["ownerId"]),

  // Media artifacts; bytes live in R2, addressed by r2Key.
  assets: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.optional(v.id("runs")),
    kind: v.string(), // keyframe|clip|upscaled|music|video|thumbnail
    r2Key: v.string(),
    meta: v.optional(v.any()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_channel", ["channelId"])
    .index("by_run", ["runId"]),

  // Topic dedup memory.
  topicMemory: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    key: v.string(),
    usedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_channel", ["channelId"])
    .index("by_channel_key", ["channelId", "key"]),

  // Per-run, per-provider spend.
  costLedger: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    provider: v.string(),
    units: v.number(),
    usd: v.number(),
    at: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_channel", ["channelId"])
    .index("by_run", ["runId"]),

  // Per-channel cron schedule.
  schedules: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    cron: v.string(),
    enabled: v.boolean(),
    lastRun: v.optional(v.number()),
    nextRun: v.optional(v.number()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_channel", ["channelId"]),

  // YouTube OAuth (one Google acct, many channels).
  oauthTokens: defineTable({
    ownerId: v.string(),
    provider: v.string(), // youtube
    refreshToken: v.string(), // encrypted at rest in P3
    scopes: v.array(v.string()),
    channels: v.array(v.string()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_provider", ["ownerId", "provider"]),

  // Generic key/value settings.
  settings: defineTable({
    ownerId: v.string(),
    key: v.string(),
    value: v.any(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_key", ["ownerId", "key"]),
});
