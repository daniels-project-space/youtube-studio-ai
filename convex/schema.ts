import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const planWeekNanoBananaProviderReceipt = v.object({
  version: v.literal("plan-week-provider-render/v2"),
  ownerId: v.string(),
  channelId: v.string(),
  batchId: v.string(),
  itemId: v.string(),
  attempt: v.number(),
  requestKey: v.string(),
  checkpointKey: v.string(),
  destinationKey: v.string(),
  provider: v.literal("gemini"),
  route: v.literal("nano-banana-flash"),
  sourceKey: v.string(),
  sourceContentType: v.string(),
  model: v.literal("gemini-2.5-flash-image"),
  apiVersion: v.literal("v1beta"),
  modelVersion: v.string(),
  responseId: v.string(),
  profileId: v.literal("nano-banana-thumbnail/v2"),
  width: v.literal(1344),
  height: v.literal(768),
  promptUtf8Bytes: v.number(),
  promptTokenCount: v.number(),
  promptCostUsd: v.number(),
  outputCostUsd: v.literal(0.039),
  costUsd: v.number(),
  requestSha256: v.string(),
  requestCanonicalJson: v.string(),
  providerResponseMetadataCanonicalJson: v.string(),
  providerResponseMetadataSha256: v.string(),
  responseSha256: v.string(),
  createdAt: v.number(),
});

/** Read-only compatibility for immutable receipts created before the migration. */
const planWeekLegacyNovitaProviderReceipt = v.object({
  version: v.literal("plan-week-provider-render/v1"),
  ownerId: v.string(),
  channelId: v.string(),
  batchId: v.string(),
  itemId: v.string(),
  attempt: v.number(),
  requestKey: v.string(),
  checkpointKey: v.string(),
  destinationKey: v.string(),
  provider: v.literal("novita"),
  providerJobId: v.string(),
  sourceKey: v.string(),
  model: v.string(),
  modelRevision: v.string(),
  profileId: v.string(),
  width: v.number(),
  height: v.number(),
  costUsd: v.number(),
  runtimeAttestation: v.object({
    provider: v.literal("novita"),
    capacityMode: v.literal("spot"),
    weightStorage: v.literal("local-persistent-disk"),
    cacheMount: v.literal("/workspace/model-cache"),
    checkpointing: v.literal(true),
    idleShutdownSeconds: v.number(),
    gpuCount: v.number(),
    model: v.string(),
    revision: v.string(),
    checkpoint: v.string(),
    pipeline: v.optional(v.union(v.literal("distilled"), v.literal("two-stage-hq"))),
    distilledLoraCheckpoint: v.optional(v.string()),
    spatialUpscalerCheckpoint: v.optional(v.string()),
  }),
  profileSha256: v.string(),
  manifestSha256: v.string(),
  requestSha256: v.string(),
  requestCanonicalJson: v.string(),
  billingReceiptSha256: v.string(),
  billingReceipt: v.object({
    provider: v.literal("novita"),
    currency: v.literal("USD"),
    receiptId: v.string(),
    gpuSku: v.string(),
    gpuCount: v.number(),
    gpuSeconds: v.number(),
    gpuRateUsdPerSecond: v.number(),
    startupUsd: v.number(),
    storageUsd: v.number(),
    costUsd: v.number(),
  }),
  createdAt: v.number(),
});

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
    // Single source of family truth (wizard family key), set at creation.
    family: v.optional(v.string()),
    // Immutable visual production lane. This is deliberately separate from the
    // editable pipeline so a whiteboard/comic/show cannot silently change its
    // visual engine on a later configuration or architect update.
    contentLane: v.optional(v.object({
      version: v.literal("content-lane/v1"),
      key: v.string(),
      family: v.optional(v.string()),
      primaryRenderer: v.string(),
    })),
    // Operator hard rail: blocks the architect may never re-add.
    disabledBlocks: v.optional(v.array(v.string())),
    identity: v.object({
      persona: v.string(),
      voiceId: v.optional(v.string()),
  voiceCasting: v.optional(
    v.object({
      voiceId: v.string(),
      name: v.optional(v.string()),
      character: v.optional(v.string()),
      score: v.optional(v.number()),
      why: v.optional(v.string()),
      at: v.optional(v.number()),
          auditionReceipt: v.optional(v.object({
            version: v.literal("voice-casting-audition/v1"),
        ownerId: v.string(),
        channelId: v.string(),
        voiceId: v.string(),
        score: v.number(),
        judgedAt: v.number(),
        auditionedCount: v.number(),
        shortlistFingerprint: v.string(),
            verdictFingerprint: v.string(),
          })),
          coldOpenReceipt: v.optional(v.object({
            version: v.literal("voice-cold-open/v1"),
            ownerId: v.string(),
            channelId: v.string(),
            voiceId: v.string(),
            judgedAt: v.number(),
            seed: v.number(),
            textFingerprint: v.string(),
            physicsFingerprint: v.string(),
            verdictFingerprint: v.string(),
            scores: v.object({
              register: v.number(),
              pace: v.number(),
              performance: v.number(),
              clean: v.number(),
            }),
          })),
          providerSelectionReceipt: v.optional(v.object({
            version: v.literal("voice-provider-selection/v1"),
            ownerId: v.string(),
            channelId: v.string(),
            provider: v.literal("elevenlabs"),
            voiceId: v.string(),
            score: v.number(),
            selectedAt: v.number(),
            shortlistedCount: v.number(),
            shortlistFingerprint: v.string(),
            selectionFingerprint: v.string(),
          })),
          localColdOpenReceipt: v.optional(v.object({
            version: v.literal("voice-local-cold-open/v1"),
            ownerId: v.string(),
            channelId: v.string(),
            provider: v.literal("elevenlabs"),
            voiceId: v.string(),
            measuredAt: v.number(),
            textFingerprint: v.string(),
            physicsFingerprint: v.string(),
            audioFingerprint: v.string(),
            durationSec: v.number(),
            wordsPerSec: v.number(),
            integratedLufs: v.number(),
          })),
    }),
  ),
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
    // engine). renderer_native is a local media-renderer still; claude_flux/
    // ideogram are retired, kept only for existing rows.
    thumbnailer: v.optional(
      v.union(
        v.literal("banana"),
        v.literal("title_card"),
        v.literal("renderer_native"),
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
    // Only an approved recommendation may increment this version.
    learningPolicyVersion: v.optional(v.number()),
    qaRubric: v.optional(v.any()),
    // Per-module operator config: { [blockId]: { preset?, ...knobValues } }. Set
    // from the onboarding "Pipeline style" step + the channel Settings "Pipeline
    // modules" section, validated against the module's CustomizationSurface
    // (engine/customization.validateKnobs) before write. Flows into the pipeline
    // via buildChannelProfile({ moduleOverrides }). v.any per-block → the typed
    // Knob contract (engine/moduleRegistry) is the real validator.
    moduleConfig: v.optional(v.record(v.string(), v.any())),
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
    // Resumable Channel Inception ledger. The TypeScript transition contract in
    // engine/channelInceptionLedger owns its strict shape; keeping the persisted
    // envelope flexible allows contract-version migrations without a live-table
    // rewrite while every mutation still validates stage identities atomically.
    inception: v.optional(v.any()),
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
        timezone: v.optional(v.string()), // IANA name, e.g. Europe/Berlin
        localTime: v.optional(v.string()), // 24h HH:mm
        enabled: v.optional(v.boolean()),
        approvalMode: v.optional(
          v.union(v.literal("manual"), v.literal("private_auto")),
        ),
        dailyQuota: v.optional(v.number()),
        maxConcurrent: v.optional(v.number()),
        retryMaxAttempts: v.optional(v.number()),
        retryBaseMinutes: v.optional(v.number()),
        madeForKids: v.optional(v.boolean()),
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
    // CHANNEL LOCK ("done"). Set MANUALLY and explicitly by the operator via
    // channels.lockChannel — never auto-detected from status/progress. While
    // locked === true no config/content write lands on this row: every guarded
    // mutation forks the change onto a v2 row (see convex/channelLock.ts) so the
    // finished channel is frozen exactly as it shipped. Clearing it is equally
    // manual — channels.unlockChannel, owner identity + typed confirmation only.
    locked: v.optional(v.boolean()),
    lockedAt: v.optional(v.number()),
    lockedBy: v.optional(v.string()),
    // Fork lineage. Set on a v2+ row to the locked ancestor it was forked from;
    // versionNumber is 1 for an original channel and parent+1 for each fork.
    parentChannelId: v.optional(v.id("channels")),
    versionNumber: v.optional(v.number()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_slug", ["ownerId", "slug"])
    .index("by_group", ["groupId"])
    .index("by_youtube_channel_id", ["youtubeCreated.ytChannelId"])
    // Lets the lock guard find a locked channel's editable fork head without a
    // table scan, so repeated edits reuse v2 instead of spawning v3, v4, v5…
    .index("by_parent", ["parentChannelId"]),

  // Durable exactly-once boundary for the irreversible Browserbase YouTube
  // channel-create click. A request can enter provider_started only once; all
  // later executions are reconciliation-only until an exact channel receipt is
  // atomically attached to the app channel.
  youtubeCreationClaims: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    requestKey: v.string(),
    name: v.string(),
    requestedHandle: v.string(),
    receiptFingerprint: v.string(),
    approvalSubject: v.string(),
    approvalActor: v.string(),
    approvalEvidence: v.string(),
    approvalIssuedAt: v.number(),
    approvalExpiresAt: v.number(),
    approvalReceipt: v.any(),
    status: v.union(
      v.literal("claimed"),
      v.literal("provider_started"),
      v.literal("ambiguous"),
      v.literal("recovery"),
      v.literal("pre_provider_failed"),
      v.literal("created"),
    ),
    workerId: v.string(),
    claimExpiresAt: v.number(),
    providerAttemptId: v.optional(v.string()),
    providerStartedAt: v.optional(v.number()),
    providerSessionId: v.optional(v.string()),
    preProviderInventory: v.optional(v.object({
      version: v.literal("youtube-pre-provider-inventory/v1"),
      ownerId: v.string(),
      channelId: v.string(),
      requestKey: v.string(),
      name: v.string(),
      requestedHandle: v.string(),
      receiptFingerprint: v.string(),
      inventoryFingerprint: v.string(),
      candidateCount: v.number(),
      observedYtChannelIds: v.array(v.string()),
      exactIdentityState: v.union(
        v.literal("absent"),
        v.literal("present"),
        v.literal("ambiguous"),
      ),
      observedAt: v.number(),
    })),
    recoveryAttempts: v.number(),
    lastRecoveryAt: v.optional(v.number()),
    ytChannelId: v.optional(v.string()),
    handle: v.optional(v.string()),
    url: v.optional(v.string()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_owner_request", ["ownerId", "requestKey"])
    .index("by_channel_request", ["channelId", "requestKey"])
    .index("by_yt_channel_id", ["ytChannelId"]),

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
      hasTextOverlayPct: v.union(v.number(), v.null()),
      notes: v.string(),
      evidenceSource: v.optional(v.literal("youtube_data_api_v3_metadata")),
      visualEvidenceStatus: v.optional(v.literal("metadata_only")),
      sampledVideoCount: v.optional(v.number()),
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

  // Source-attributed SEO databank derived from collected YouTube metadata.
  seoDatabank: defineTable({
    ownerId: v.string(),
    niche: v.string(),
    channelId: v.optional(v.id("channels")),
    titleTemplates: v.array(v.string()),
    tagClusters: v.array(v.any()),
    thumbnailRules: v.array(v.string()),
    hookPatterns: v.array(v.string()),
    competitorGaps: v.array(v.string()),
    sourceAttribution: v.optional(v.object({
      provider: v.literal("youtube_data_api_v3"),
      sampledVideoIds: v.array(v.string()),
      sourceFields: v.array(v.string()),
      videosAnalysed: v.number(),
      topPerformersAnalysed: v.number(),
      limitations: v.array(v.string()),
    })),
    refreshedAt: v.number(),
  }).index("by_owner_niche", ["ownerId", "niche"]),

  // Per-niche cached breakout-video scans (topicraft's quota-immune outlier
  // signal — live YouTube search quota dies daily, so the hot path reads here).
  outlierBank: defineTable({
    ownerId: v.string(),
    niche: v.string(),
    fetchedAt: v.number(),
    outliers: v.array(
      v.object({
        title: v.string(),
        channelTitle: v.string(),
        views: v.number(),
        subs: v.number(),
        score: v.number(),
        videoId: v.string(),
        publishedAt: v.string(),
        durationSec: v.number(),
      }),
    ),
  }).index("by_owner_niche", ["ownerId", "niche"]),

  // Profiled voice cards for the operator's ElevenLabs account (voicecraft
  // casting source — profiles produced by Gemini audio analysis of previews).
  voiceProfiles: defineTable({
    ownerId: v.string(),
    voiceId: v.string(),
    name: v.string(),
    provider: v.string(),
    category: v.string(),
    labels: v.optional(v.any()),
    previewUrl: v.optional(v.string()),
    profile: v.object({
      gender: v.string(),
      ageFeel: v.string(),
      register: v.string(),
      pace: v.string(),
      energy: v.string(),
      texture: v.string(),
      character: v.string(),
      bestFor: v.array(v.string()),
      confidence: v.number(),
    }),
    /** R2 key of the 10s same-text audition clip (channel settings picker). */
    auditionKey: v.optional(v.string()),
    profiledAt: v.number(),
  }).index("by_owner_voice", ["ownerId", "voiceId"]),

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
    pipelinePolicyId: v.optional(v.string()),
    pipelinePolicyVersion: v.optional(v.string()),
    pipelineFingerprint: v.optional(v.string()),
    pipelineModules: v.optional(v.any()),
    pipelineCapabilities: v.optional(v.array(v.string())),
    reservedMaxCostUsd: v.optional(v.number()),
    pipelineCompiledAt: v.optional(v.number()),
    // Write-once, pre-provider execution contract. Retries and post-upload
    // recovery use this exact pipeline/seed/budget/key namespace instead of
    // silently recompiling mutable channel settings.
    pipelineInvocationSnapshot: v.optional(v.any()),
    pipelineInvocationSha256: v.optional(v.string()),
    pipelineInvocationClaimedAt: v.optional(v.number()),
    // Write-once parent checkpoint for an admitted Channel Inception probe.
    // This is claimed before Trigger dispatch, so a lost response reuses the
    // exact child receipt, frozen overrides, context, run id, and cost cap.
    probeDispatchEnvelope: v.optional(v.any()),
    probeDispatchEnvelopeFingerprint: v.optional(v.string()),
    probeDispatchClaimedAt: v.optional(v.number()),
    probeDispatchKey: v.optional(v.string()),
    // Exact upload intent currently fencing post-upload continuation for this
    // run. The intent id and immutable artifact id are installed before the
    // dispatcher can call YouTube, and are cleared only by an exact successful
    // pipeline completion.
    blockedPublishIntentId: v.optional(v.id("publishIntents")),
    blockedPublishArtifactId: v.optional(v.string()),
    // Durable continuation outbox. A Trigger enqueue can fail after YouTube has
    // accepted the upload; `pending` survives that gap for the nightly Doctor,
    // `queued` records a durable enqueue receipt, and `completed` is retained as
    // audit evidence after the blocking fence is cleared.
    publishContinuationState: v.optional(
      v.union(v.literal("pending"), v.literal("queued"), v.literal("completed")),
    ),
    publishContinuationIntentId: v.optional(v.id("publishIntents")),
    publishContinuationArtifactId: v.optional(v.string()),
    publishContinuationVideoId: v.optional(v.string()),
    publishContinuationAttempts: v.optional(v.number()),
    publishContinuationUpdatedAt: v.optional(v.number()),
    publishContinuationQueuedAt: v.optional(v.number()),
    publishContinuationCompletedAt: v.optional(v.number()),
    publishContinuationTriggerRunId: v.optional(v.string()),
    publishContinuationLastError: v.optional(v.string()),
    // Immutable snapshot of a pinned plan item admitted by the scheduler.
    // Keeping it on the run makes retries observable and prevents a later UI
    // edit from silently changing the topic or native YouTube publish time.
    planItemId: v.optional(v.id("contentPlan")),
    plannedTopic: v.optional(v.string()),
    plannedTitle: v.optional(v.string()),
    plannedThumbnailKey: v.optional(v.string()),
    plannedPublishAt: v.optional(v.number()),
    // Durable worker lifecycle. Queued work gets a short claim lease; Trigger
    // replaces it with a bounded execution lease and heartbeat. Convex cron
    // reaps expired work without depending on a paid/AI maintenance task.
    heartbeatAt: v.optional(v.number()),
    leaseExpiresAt: v.optional(v.number()),
    leaseOwner: v.optional(v.string()),
    executionAttempts: v.optional(v.number()),
    // Set only by the lease reaper when a dead execution has a complete,
    // immutable invocation snapshot. The scheduler may re-dispatch that exact
    // run once; claiming the execution lease clears this marker.
    leaseRecoveryPending: v.optional(v.boolean()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_channel", ["channelId"])
    .index("by_channel_started", ["channelId", "startedAt"])
    .index("by_channel_status", ["channelId", "status"])
    .index("by_channel_probe_dispatch", ["channelId", "probeDispatchKey"])
    .index("by_status_started", ["status", "startedAt"])
    .index("by_owner_publish_continuation", [
      "ownerId",
      "publishContinuationState",
      "publishContinuationUpdatedAt",
    ]),

  // One disposable RTX 4090 worker for one immutable Novita manifest. This is
  // deliberately separate from `runs`: a run can have image/video phases,
  // retries, and parallel waves, while every provider instance must receive an
  // independently verifiable deletion receipt before billing is considered
  // closed.
  novitaWorkerLeases: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    blockId: v.string(),
    phase: v.union(v.literal("image"), v.literal("video")),
    manifestId: v.string(),
    manifestSha256: v.string(),
    workerName: v.string(),
    productId: v.string(),
    gpuSku: v.literal("RTX 4090"),
    gpuCount: v.literal(1),
    clusterId: v.string(),
    storageId: v.string(),
    imageDigest: v.string(),
    maximumCostUsd: v.number(),
    status: v.union(
      v.literal("requested"),
      v.literal("create_claimed"),
      v.literal("create_dispatched"),
      v.literal("provisioning"),
      v.literal("booting"),
      v.literal("rendering"),
      v.literal("draining"),
      v.literal("delete_requested"),
      v.literal("deleted_verified"),
      v.literal("failed"),
      v.literal("deletion_unverified"),
    ),
    instanceId: v.optional(v.string()),
    createAttemptToken: v.optional(v.string()),
    createClaimedAt: v.optional(v.number()),
    // Persisted before the external create POST. If an HTTP response is lost,
    // this makes the resulting provider resource ambiguous until a real
    // provider instance id can be reconciled and deleted.
    createDispatchedAt: v.optional(v.number()),
    // Only one Trigger execution may observe/delete a bound worker. The token
    // is an execution fence, distinct from the physical-create claim above.
    executionAttemptToken: v.optional(v.string()),
    executionClaimedAt: v.optional(v.number()),
    // Conservative billing anchor for resumed lifecycle estimates.
    instanceCreatedAt: v.optional(v.number()),
    requestedAt: v.number(),
    bootDeadlineAt: v.number(),
    absoluteDeadlineAt: v.number(),
    lastHeartbeatAt: v.number(),
    lastWorkAt: v.number(),
    completionKey: v.optional(v.string()),
    deletedVerifiedAt: v.optional(v.number()),
    deletionRequestedAt: v.optional(v.number()),
    billingReceipt: v.optional(v.any()),
    lastError: v.optional(v.string()),
  })
    .index("by_worker_name", ["workerName"])
    .index("by_manifest", ["manifestId"])
    .index("by_instance", ["instanceId"])
    .index("by_status_last_work", ["status", "lastWorkAt"])
    .index("by_run", ["runId"]),

  // A managed provider worker can exceptionally outlive its lease write (for
  // example if Convex is unavailable immediately after Novita accepts create).
  // The reaper writes one immutable audit receipt after verified removal; this
  // makes orphan cleanup observable rather than merely a transient log line.
  novitaOrphanTeardownAudits: defineTable({
    workerName: v.string(),
    instanceId: v.string(),
    deletedVerifiedAt: v.number(),
    receipt: v.any(),
  }).index("by_worker_instance", ["workerName", "instanceId"]),

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

  // Immutable, content-addressed module handoffs. Unlike the legacy ambient
  // run-stage blob, every artifact records its schema/module version and exact
  // upstream artifact ids so a resumed consumer can prove lineage.
  runArtifacts: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    artifactId: v.string(),
    key: v.string(),
    type: v.string(),
    schemaVersion: v.string(),
    producerModule: v.string(),
    producerVersion: v.string(),
    payloadHash: v.string(),
    inputArtifactIds: v.array(v.string()),
    optionalFallbacks: v.array(v.string()),
    persistence: v.union(v.literal("inline"), v.literal("reference"), v.literal("summary")),
    payload: v.optional(v.any()),
    summary: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_artifact_id", ["artifactId"])
    .index("by_run", ["runId"])
    .index("by_run_key", ["runId", "key"])
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
    .index("by_channel_kind", ["channelId", "kind"])
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
    connectorId: v.optional(v.id("youtubeAuth")),
    connectorVersion: v.optional(v.number()),
    ingestionId: v.optional(v.id("analyticsIngestions")),
    source: v.optional(
      v.union(v.literal("youtube_data_api"), v.literal("youtube_analytics_api")),
    ),
    metricDefinitionVersion: v.optional(v.string()),
    windowStart: v.optional(v.string()),
    windowEnd: v.optional(v.string()),
    confidence: v.optional(
      v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    ),
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
    connectorId: v.optional(v.id("youtubeAuth")),
    connectorVersion: v.optional(v.number()),
    ingestionId: v.optional(v.id("analyticsIngestions")),
    source: v.optional(v.literal("youtube_data_api")),
    metricDefinitionVersion: v.optional(v.string()),
    confidence: v.optional(
      v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    ),
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
    batchId: v.optional(v.id("planBatches")),
    itemKey: v.optional(v.string()),
    order: v.number(),
    topic: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    sceneSeed: v.optional(v.string()),
    thumbnailKey: v.optional(v.string()),
    status: v.string(), // "generating" | "ready" | "failed" | "used"
    generationState: v.optional(v.string()), // pending|claimed|complete|failed
    generationAttempt: v.optional(v.number()),
    generationClaimedBy: v.optional(v.string()),
    generationClaimedAt: v.optional(v.number()),
    generationProviderStartedAt: v.optional(v.number()),
    generationProviderStartedBy: v.optional(v.string()),
    generationError: v.optional(v.string()),
    generationRetryable: v.optional(v.boolean()),
    generationCostUsd: v.optional(v.number()),
    usageCheckpointKey: v.optional(v.string()),
    createdAt: v.number(),
    scheduledAt: v.optional(v.number()), // pinned publish date (ms epoch)
    scheduledRunId: v.optional(v.id("runs")),
    scheduledClaimedAt: v.optional(v.number()),
    scheduledUsedAt: v.optional(v.number()),
    scheduledFailure: v.optional(v.string()),
  })
    .index("by_channel_order", ["channelId", "order"])
    .index("by_channel_status_order", ["channelId", "status", "order"])
    .index("by_channel_status_schedule", ["channelId", "status", "scheduledAt"])
    .index("by_owner", ["ownerId"])
    .index("by_owner_status", ["ownerId", "status"])
    .index("by_batch", ["batchId", "order"]),

  /** Durable, idempotent admission/checkpoint record for plan-week-ahead. */
  planBatches: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    channelSlug: v.string(),
    requestKey: v.string(),
    triggerRunId: v.string(),
    contractVersion: v.string(),
    requestedCount: v.number(),
    reservedCostUsd: v.number(),
    actualCostUsd: v.number(),
    status: v.string(), // reserved|running|ready|failed
    topicState: v.string(), // pending|claimed|complete|failed
    topicAttempt: v.number(),
    topicClaimedBy: v.optional(v.string()),
    topicClaimedAt: v.optional(v.number()),
    topicProviderStartedAt: v.optional(v.number()),
    topicProviderStartedBy: v.optional(v.string()),
    topicUsageCheckpointKey: v.optional(v.string()),
    itemIds: v.optional(v.array(v.id("contentPlan"))),
    accountingComplete: v.boolean(),
    budgetExceeded: v.boolean(),
    error: v.optional(v.string()),
    retryable: v.boolean(),
    // One-off failed-batch recovery fence. Once claimed, only retries of this
    // exact Trigger run/version may continue the exact ordered item list.
    recoveryGuardVersion: v.optional(v.string()),
    recoveryTaskRunId: v.optional(v.string()),
    recoveryExpectedItemIds: v.optional(v.array(v.id("contentPlan"))),
    recoveryExpectedActualCostUsd: v.optional(v.number()),
    recoveryExpectedProviderRoute: v.optional(v.string()),
    recoveryExpectedTaskVersion: v.optional(v.string()),
    // Historical Quiet Stoic recovery attempts recorded immutable diagnostics
    // directly on the batch. Keep both fields optional so deploying the schema
    // validates those rows without deleting or rewriting production evidence.
    quietStoicItem3Rescue: v.optional(v.any()),
    quietStoicItem3RescueV2: v.optional(v.any()),
    // The same completed historical recovery recorded its golden-run fence at
    // the top level. These values are provenance, not live control inputs.
    recoveryGoldenStartedAt: v.optional(v.number()),
    recoveryGoldenStartedBy: v.optional(v.string()),
    recoveryGoldenFinishedAt: v.optional(v.number()),
    recoveryGoldenTerminal: v.optional(v.boolean()),
    leaseExpiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_request", ["ownerId", "channelId", "requestKey"])
    .index("by_owner", ["ownerId", "createdAt"])
    .index("by_channel", ["channelId", "createdAt"])
    .index("by_channel_status", ["channelId", "status", "createdAt"]),

  /** Immutable per-phase usage ledger; batch totals are recomputed from rows. */
  planBatchUsage: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    batchId: v.id("planBatches"),
    itemId: v.optional(v.id("contentPlan")),
    checkpointKey: v.string(),
    fingerprint: v.string(),
    modelUsage: v.any(),
    imageUsage: v.any(),
    // Older completed production rows include this immutable pricing/QA
    // evidence. Keep it optional so schema deployment validates both those
    // rows and newer rows that do not need a reconciliation record.
    reconciliationEvidence: v.optional(v.any()),
    costUsd: v.number(),
    accountingComplete: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_batch", ["batchId", "createdAt"])
    .index("by_checkpoint", ["batchId", "checkpointKey"]),

  /** Immutable provider receipt plus the independently finalized thumbnail artifact. */
  planWeekRenderReceipts: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    batchId: v.id("planBatches"),
    itemId: v.id("contentPlan"),
    attempt: v.number(),
    requestKey: v.string(),
    checkpointKey: v.string(),
    destinationKey: v.string(),
    providerRequestSha256: v.string(),
    providerReceipt: v.union(
      planWeekNanoBananaProviderReceipt,
      planWeekLegacyNovitaProviderReceipt,
    ),
    artifactReceipt: v.optional(v.object({
      version: v.literal("plan-week-thumbnail-artifact/v1"),
      providerRequestSha256: v.string(),
      destinationKey: v.string(),
      byteLength: v.number(),
      sha256: v.string(),
      etag: v.string(),
      createdAt: v.number(),
    })),
    createdAt: v.number(),
    finalizedAt: v.optional(v.number()),
  })
    .index("by_checkpoint", ["ownerId", "channelId", "checkpointKey"])
    .index("by_request_hash", ["ownerId", "requestKey", "providerRequestSha256"])
    .index("by_item", ["itemId", "attempt"])
    .index("by_batch", ["batchId", "createdAt"]),

  // Per-channel YouTube OAuth tokens — so each channel uploads to its OWN
  // YouTube channel. Onboarding a channel = one consent → one row here. Read
  // server-side by upload_draft; never surfaced to the client.
  youtubeAuth: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    // New grants are encrypted before they reach Convex. `refreshToken`
    // remains optional only while existing rows are migrated.
    refreshTokenCiphertext: v.optional(v.string()),
    refreshToken: v.optional(v.string()),
    ytChannelId: v.optional(v.string()),
    ytTitle: v.optional(v.string()),
    grantedScopes: v.optional(v.array(v.string())),
    tokenVersion: v.optional(v.number()),
    status: v.optional(
      v.union(v.literal("active"), v.literal("revoked"), v.literal("error")),
    ),
    scopeHealth: v.optional(
      v.union(v.literal("healthy"), v.literal("partial"), v.literal("unknown")),
    ),
    connectedAt: v.optional(v.number()),
    validatedAt: v.optional(v.number()),
    lastRefreshAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    dataRetentionPolicy: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_channel", ["channelId"])
    .index("by_owner", ["ownerId"]),

  // Encrypted YouTube resumable-upload capabilities. A row is bound to one
  // owner/channel/upload key so retries can query the remote byte range and
  // continue after a Trigger worker restart without crossing account lines.
  youtubeUploadSessions: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    uploadKey: v.string(),
    sessionUrlCiphertext: v.string(),
    fileSize: v.number(),
    fileSha256: v.string(),
    metadataSha256: v.string(),
    uploadedBytes: v.number(),
    chunkSize: v.number(),
    status: v.union(
      v.literal("initiated"),
      v.literal("uploading"),
      v.literal("completed"),
      v.literal("expired"),
      v.literal("failed"),
    ),
    videoId: v.optional(v.string()),
    privacyStatus: v.optional(v.string()),
    publishAt: v.optional(v.string()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_owner_upload_key", ["ownerId", "uploadKey"])
    .index("by_channel", ["channelId"]),

  // Internal-only, revocable channel publishing authority. Pipeline booleans
  // are configuration hints; this action list + exact external-config digest is
  // the runtime authorization source of truth.
  channelPublishPolicies: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    allowedActions: v.array(
      v.union(
        v.literal("youtube_public"),
        v.literal("youtube_scheduled"),
        v.literal("youtube_short_public"),
        v.literal("crosspost"),
      ),
    ),
    pipelineFingerprint: v.string(),
    status: v.union(v.literal("active"), v.literal("revoked")),
    version: v.number(),
    approvedBy: v.optional(v.string()),
    approvalEvidence: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    revokedBy: v.optional(v.string()),
    revocationEvidence: v.optional(v.string()),
    revokedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_channel", ["channelId"])
    .index("by_owner", ["ownerId"]),

  // Durable, connector-bound publishing ledger. The idempotency key is exactly
  // (connectorId, immutable video artifact id, intentVersion); claims are leased
  // atomically so duplicate scheduler ticks cannot create duplicate uploads.
  publishIntents: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    runId: v.optional(v.id("runs")),
    videoArtifactId: v.string(),
    videoArtifactKey: v.string(),
    videoSha256: v.string(),
    thumbnailArtifactKey: v.optional(v.string()),
    thumbnailSha256: v.optional(v.string()),
    intentVersion: v.number(),
    idempotencyKey: v.string(),
    metadataSha256: v.string(),
    title: v.string(),
    description: v.string(),
    tags: v.array(v.string()),
    categoryId: v.string(),
    privacyStatus: v.union(
      v.literal("private"),
      v.literal("unlisted"),
      v.literal("public"),
    ),
    publishAt: v.optional(v.number()),
    containsSyntheticMedia: v.boolean(),
    madeForKids: v.boolean(),
    status: v.union(
      v.literal("awaiting_approval"),
      v.literal("approved"),
      v.literal("scheduled"),
      v.literal("dispatching"),
      v.literal("retry_wait"),
      v.literal("uploaded"),
      v.literal("dead_letter"),
      v.literal("cancelled"),
      v.literal("blocked_connector"),
    ),
    approvedBy: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    approvalEvidence: v.optional(v.string()),
    approvalKind: v.optional(
      v.union(
        v.literal("private_first"),
        v.literal("channel_policy"),
        v.literal("manual_intent"),
      ),
    ),
    approvalPolicyVersion: v.optional(v.number()),
    approvalPolicyFingerprint: v.optional(v.string()),
    attempts: v.number(),
    maxAttempts: v.number(),
    // First authorized provider-dispatch time. This is deliberately separate
    // from publishAt (public visibility) and nextAttemptAt (mutable retry due).
    dispatchAt: v.optional(v.number()),
    nextAttemptAt: v.number(),
    leaseOwner: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    quotaDay: v.optional(v.string()),
    youtubeVideoId: v.optional(v.string()),
    watchUrl: v.optional(v.string()),
    lastError: v.optional(v.string()),
    experimentId: v.optional(v.id("contentExperiments")),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_idempotency", ["ownerId", "idempotencyKey"])
    .index("by_due", ["status", "nextAttemptAt"])
    .index("by_status_lease", ["status", "leaseExpiresAt"])
    .index("by_channel_status", ["channelId", "status"])
    .index("by_channel_quota_day", ["channelId", "quotaDay"])
    .index("by_owner_created", ["ownerId", "createdAt"])
    .index("by_owner_status_publish_at", ["ownerId", "status", "publishAt"])
    .index("by_channel_status_publish_at", ["channelId", "status", "publishAt"])
    .index("by_owner_status_privacy_publish_completed_at", [
      "ownerId",
      "status",
      "privacyStatus",
      "publishAt",
      "completedAt",
    ])
    .index("by_channel_status_privacy_publish_completed_at", [
      "channelId",
      "status",
      "privacyStatus",
      "publishAt",
      "completedAt",
    ]),

  analyticsIngestions: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    source: v.union(
      v.literal("youtube_data_api"),
      v.literal("youtube_analytics_api"),
    ),
    metricDefinitionVersion: v.string(),
    windowStart: v.string(),
    windowEnd: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("partial"),
      v.literal("failed"),
    ),
    recordsWritten: v.number(),
    lastError: v.optional(v.string()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_channel_started", ["channelId", "startedAt"])
    .index("by_connector_started", ["connectorId", "startedAt"]),

  // Versioned creative assignment and its observed outcome. This keeps title,
  // thumbnail, hook, and visual decisions joined to the exact published video.
  contentExperiments: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    runId: v.optional(v.id("runs")),
    publishIntentId: v.optional(v.id("publishIntents")),
    youtubeVideoId: v.optional(v.string()),
    experimentKey: v.string(),
    version: v.number(),
    hypothesis: v.optional(v.string()),
    titleVariant: v.string(),
    thumbnailVariant: v.optional(v.string()),
    hookVariant: v.optional(v.string()),
    visualVariant: v.optional(v.string()),
    status: v.union(v.literal("assigned"), v.literal("observed"), v.literal("closed")),
    outcome: v.optional(v.any()),
    outcomeIngestionId: v.optional(v.id("analyticsIngestions")),
    createdAt: v.number(),
    observedAt: v.optional(v.number()),
  })
    .index("by_key", ["ownerId", "experimentKey"])
    .index("by_video", ["youtubeVideoId"])
    .index("by_channel_created", ["channelId", "createdAt"]),

  // Recommendations are proposals, never active policy. Activation requires a
  // passing offline evidence evaluation and an authenticated operator approval.
  learningRecommendations: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    recommendationKey: v.string(),
    kind: v.union(v.literal("show_bible"), v.literal("retention_rule")),
    target: v.union(v.literal("creative_brief"), v.literal("script_playbook")),
    basePolicyVersion: v.number(),
    proposedPolicyVersion: v.number(),
    sourceVideoIds: v.array(v.string()),
    dataWindowStart: v.string(),
    dataWindowEnd: v.string(),
    proposal: v.any(),
    offlineEvaluation: v.object({
      method: v.string(),
      sampleSize: v.number(),
      baselineScore: v.optional(v.number()),
      candidateScore: v.optional(v.number()),
      passed: v.boolean(),
      notes: v.string(),
    }),
    status: v.union(
      v.literal("proposed"),
      v.literal("approved"),
      v.literal("activated"),
      v.literal("rejected"),
    ),
    approvedBy: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    activatedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["ownerId", "recommendationKey"])
    .index("by_owner_status", ["ownerId", "status"])
    .index("by_channel_created", ["channelId", "createdAt"]),

  // A factual cinematic episode is deliberately separate from a normal
  // channel run. It stores only immutable review handoffs and can never
  // authorize a provider call or public/scheduled upload by itself.
  casefileEpisodes: defineTable({
    ownerId: v.string(),
    caseId: v.string(),
    /** Content identity of this immutable source-evidence revision. */
    sourcePacketFingerprint: v.string(),
    status: v.union(
      v.literal("source_admitted"),
      v.literal("awaiting_evidence_review"),
      v.literal("awaiting_cinematic_direction"),
      v.literal("awaiting_cinematic_review"),
      v.literal("render_admitted"),
    ),
    workflow: v.any(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_source_packet", ["ownerId", "sourcePacketFingerprint"])
    .index("by_owner_status", ["ownerId", "status"])
    .index("by_owner_case_updated", ["ownerId", "caseId", "updatedAt"])
    .index("by_owner_updated", ["ownerId", "updatedAt"]),

  // Single project-wide "what are we working toward right now" record, so
  // both automation and Daniel can query current intent/priorities. Not
  // per-owner scoped (one project, one active goal) — history is simply the
  // set of rows ordered by updatedAt; the latest is authoritative.
  projectGoals: defineTable({
    statement: v.string(),
    priorities: v.array(v.string()),
    setBy: v.string(),
    updatedAt: v.number(),
  }).index("by_updatedAt", ["updatedAt"]),
});
