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
      // Persona reference material for tone-matched generation (competitor-
      // intelligence port). All optional → back-compat with existing channels.
      voiceRef: v.optional(v.string()),
      toneRefs: v.optional(v.array(v.string())),
      bannedWords: v.array(v.string()),
      requiredCallbacks: v.array(v.string()),
      styleGrammar: v.string(),
      palette: v.array(v.string()),
      thumbnailTemplate: v.string(),
      topicPool: v.array(v.string()),
      cadence: v.string(),
      // The niche this channel competes in (drives competitor research).
      niche: v.optional(v.string()),
      // Generated channel art (R2 keys): square avatar + 16:9 banner.
      imageKey: v.optional(v.string()),
      bannerKey: v.optional(v.string()),
      // Thumbnail identity for the claude_flux thumbnailer (all optional).
      thumbnailIdentity: v.optional(
        v.object({
          colorPalette: v.array(v.string()),
          visualStyle: v.string(),
          textPosition: v.string(),
          avoid: v.array(v.string()),
        }),
      ),
      // Show Bible — the film-crew creative brief (written once by the Showrunner).
      // All optional → existing channels keep working with no Bible.
      creativeBrief: v.optional(
        v.object({
          positioning: v.string(),
          vibe: v.string(),
          iconicMotif: v.string(),
          worksInSpace: v.array(v.string()),
          avoidInSpace: v.array(v.string()),
          activeCrew: v.array(v.string()),
          directorDoctrine: v.optional(v.string()),
          dpDoctrine: v.optional(v.string()),
          editorDoctrine: v.optional(v.string()),
          composerDoctrine: v.optional(v.string()),
          criticDoctrine: v.optional(v.string()),
          refreshedAt: v.number(),
        }),
      ),
    }),
    // Which thumbnail strategy this channel uses (default "banana" — the
    // engine). claude_flux/ideogram are retired, kept only for existing rows.
    thumbnailer: v.optional(
      v.union(
        v.literal("banana"),
        v.literal("title_card"),
        v.literal("claude_flux"),
        v.literal("ideogram"),
      ),
    ),
    template: v.string(), // archetype A|B|C|D|E
    pipeline: v.array(
      v.object({
        block: v.string(),
        params: v.optional(v.any()),
      }),
    ),
    modelRouting: v.optional(v.any()),
    qaRubric: v.optional(v.any()),
    // Frozen, machine-readable Style DNA (visual/audio/narrative spec) the
    // Inception research distills once and every block must conform to. Flexible
    // (v.any) — the TS `StyleDNA` interface is the real contract. Carries a
    // confidence + groundingGaps so the Pipeline Doctor knows what to heal.
    styleDNA: v.optional(v.any()),
    // The LLM Pipeline Architect's decision report (applied/rejected ops,
    // missing capabilities, grounding actions) — the audit trail for WHY this
    // channel's pipeline looks the way it does. v.any: TS owns the contract.
    architectReport: v.optional(v.any()),
    // Thumbnail Lab output: per-channel playbook (rules + executable patterns)
    // distilled from VERIFIED high-view competitor thumbnails + the latest
    // tournament verdict. thumbnail_gen executes its patterns at render time.
    thumbnailPlaybook: v.optional(v.any()),
    // Script Lab output: hook rules + rotated opening devices distilled from
    // WATCHING the niche's top-view videos. script_gen executes it per video.
    scriptPlaybook: v.optional(v.any()),
    budget: v.number(), // per-run USD ceiling
    status: v.string(), // draft|active|paused|archived
    // Operator organization: name of the channelFolders folder this channel is
    // filed in (drag & drop on the Channels page). Unset/"" = unfiled.
    folder: v.optional(v.string()),
    // Upload schedule the operator edits in the Scheduler UI (drives calendar
    // projection + autonomous scheduler). days = weekdays 0(Sun)-6(Sat).
    schedule: v.optional(
      v.object({
        frequency: v.string(), // daily|weekly|biweekly|monthly
        days: v.optional(v.array(v.number())),
      }),
    ),
    // Multi-language group link. groupId = the base channel's _id; the base + its
    // language siblings share it. All optional → standalone channels are ungrouped.
    groupId: v.optional(v.string()),
    language: v.optional(v.string()), // "en" | "de" | "es" …
    groupRole: v.optional(v.string()), // "base" | "sibling"
    // Browserbase agent records the YouTube channel it created here so the UI can
    // show it + prompt the operator to Connect (link the per-channel OAuth token).
    youtubeCreated: v.optional(
      v.object({
        ytChannelId: v.optional(v.string()),
        handle: v.optional(v.string()),
        url: v.optional(v.string()),
        createdAt: v.number(),
        // "creating" while the agent runs, "created" when done, "failed" on error.
        status: v.optional(v.string()),
        // True if the avatar was set during the create flow (onboarding photo step).
        avatarSet: v.optional(v.boolean()),
      }),
    ),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_slug", ["ownerId", "slug"])
    .index("by_group", ["groupId"]),

  // Operator-created folders on the Channels page (channels reference them by
  // name via channels.folder; a folder can exist empty).
  channelFolders: defineTable({
    ownerId: v.string(),
    name: v.string(),
  }).index("by_owner", ["ownerId"]),

  // Tombstones of deleted channels: a COMPACT structural print (identity,
  // pipeline, DNA, playbook shapes — no run data, no media) so a deleted
  // channel's design is never lost while its data residue is fully removed.
  channelArchives: defineTable({
    ownerId: v.string(),
    slug: v.string(),
    name: v.string(),
    archivedAt: v.number(),
    /** JSON string, capped small (~≤60KB). */
    snapshot: v.string(),
  }).index("by_owner", ["ownerId"]),

  // MODULE FORGE: architect-authored modules as declarative specs (the TS
  // `ForgedModuleSpec` schema is the contract; the interpreter is the trust
  // boundary). status: active|disabled. Forged for one channel but reusable
  // fleet-wide once proven.
  forgedModules: defineTable({
    ownerId: v.string(),
    blockId: v.string(), // forged_<slug>, unique per owner
    spec: v.any(),
    status: v.string(),
    forChannelId: v.optional(v.string()),
    capability: v.optional(v.string()), // the missingCapability it answers
  }).index("by_owner", ["ownerId"]).index("by_owner_block", ["ownerId", "blockId"]),

  // -------------------- Competitor-intelligence engine --------------------
  // Aggregated niche signals mined from YouTube Data API v3 + Gemini Vision.
  nicheIntelligence: defineTable({
    ownerId: v.string(),
    niche: v.string(),
    topTitlePatterns: v.array(v.any()), // [{pattern, count}]
    powerWords: v.array(v.any()), // [{word, count}]
    optimalTitleLen: v.number(),
    topTags: v.array(v.any()), // [{tag, count}]
    avgViewsTop50: v.number(),
    medianViewsTop50: v.number(),
    thumbnailStyleGuide: v.object({
      dominantColors: v.array(v.string()),
      hasTextOverlayPct: v.number(),
      notes: v.string(),
    }),
    refreshedAt: v.number(),
  }).index("by_owner_niche", ["ownerId", "niche"]),

  // Per-niche competitor channels + their best-performing videos.
  competitors: defineTable({
    ownerId: v.string(),
    niche: v.string(),
    channelName: v.string(),
    totalViews: v.number(),
    videoCount: v.number(),
    topVideos: v.array(
      v.object({
        youtubeVideoId: v.string(),
        title: v.string(),
        views: v.number(),
        likes: v.number(),
        comments: v.number(),
        tags: v.array(v.string()),
        thumbnailUrl: v.string(),
        durationSec: v.number(),
        publishedAt: v.string(),
      }),
    ),
    refreshedAt: v.number(),
  }).index("by_owner_niche", ["ownerId", "niche"]),

  // Derived SEO strategy databank (Gemini-synthesised from the above).
  seoDatabank: defineTable({
    ownerId: v.string(),
    niche: v.string(),
    channelId: v.optional(v.id("channels")),
    titleTemplates: v.array(v.string()),
    tagClusters: v.array(v.any()),
    thumbnailRules: v.array(v.string()),
    hookPatterns: v.array(v.string()),
    competitorGaps: v.array(v.string()),
    refreshedAt: v.number(),
  }).index("by_owner_niche", ["ownerId", "niche"]),

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

  // Per-run streamed console lines (ctx.log) — drives the live LogConsole.
  runLogs: defineTable({
    ownerId: v.string(),
    runId: v.id("runs"),
    block: v.optional(v.string()),
    level: v.string(), // info|warn|error
    message: v.string(),
    at: v.number(), // ms epoch — primary chronological sort
    seq: v.optional(v.number()), // tie-breaker within the same flush batch
  })
    .index("by_run", ["runId"])
    .index("by_run_seq", ["runId", "at", "seq"]),

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

  // -------------------- Analytics (stats-refresh sink) --------------------
  // Per-video performance snapshots, captured by the stats-refresh task from
  // the YouTube Data API v3 (videos.list?part=statistics). Each row is one
  // point-in-time reading; the history is the (youtubeVideoId, snapshotAt) axis.
  videoAnalytics: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    youtubeVideoId: v.string(),
    views: v.number(),
    likes: v.number(),
    comments: v.number(),
    watchTimeHours: v.optional(v.number()),
    estimatedRevenueUsd: v.optional(v.number()),
    ctr: v.optional(v.number()),
    rpm: v.optional(v.number()),
    snapshotAt: v.number(),
  })
    .index("by_channel", ["channelId"])
    .index("by_video", ["youtubeVideoId", "snapshotAt"]),

  // Per-channel daily rollup, captured by the stats-refresh task from
  // channels.list?part=statistics. Idempotent on (channelId, date) — the task
  // upserts one row per channel per UTC day and computes subscriberDelta vs the
  // previous day. This is what v1 never populated (channelAnalytics gap).
  channelAnalytics: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    date: v.string(), // YYYY-MM-DD (UTC)
    totalViews: v.number(),
    totalWatchHours: v.optional(v.number()),
    subscriberCount: v.number(),
    subscriberDelta: v.number(),
    videoCount: v.number(),
    estimatedRevenueUsd: v.optional(v.number()),
  }).index("by_channel_date", ["channelId", "date"]),

  // Week-ahead content plan (upcoming videos per channel). `order` ascending =
  // soonest; `scheduledAt` pins a calendar date (drag-to-reschedule / date field).
  contentPlan: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    order: v.number(),
    topic: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    thumbnailKey: v.optional(v.string()),
    status: v.string(), // "generating" | "ready" | "used"
    createdAt: v.number(),
    scheduledAt: v.optional(v.number()), // pinned publish date (ms epoch)
  })
    .index("by_channel_order", ["channelId", "order"])
    .index("by_owner", ["ownerId"]),

  // Per-channel YouTube OAuth tokens — so each channel uploads to its OWN
  // YouTube channel. Onboarding a channel = one consent → one row here. Read
  // server-side by upload_draft; never surfaced to the client.
  youtubeAuth: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    refreshToken: v.string(),
    ytChannelId: v.optional(v.string()),
    ytTitle: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_channel", ["channelId"]),
});
