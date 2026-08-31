import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  CHANNEL_COMPOSITION_RECEIPT_VERSION,
  CHANNEL_PROGRAM_BRIEF_VERSION,
  CHANNEL_SHOW_PROFILE_VERSION,
} from "@/engine/channelContractVersions";

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
    // Strictly opt-in per channel. When true AND the cinematic_ai lane is
    // active, `generation-scheduler` researches a fresh real case via
    // `researchCase()` (fail-closed, zero-fabrication) each due cycle instead
    // of expecting a human-curated packet from the /api/casefile-episodes
    // desk workflow. Undefined/false = today's behavior, unchanged — this
    // must never silently start applying to every existing cinematic_ai
    // channel.
    casefileAutoResearchEnabled: v.optional(v.boolean()),
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
      // Stable catalog key for data lookups; `niche` below stays presentation-only.
      nicheKey: v.optional(v.string()),
      // The niche this channel competes in (drives competitor research).
      niche: v.optional(v.string()),
      // Canonical creator program, retained as immutable channel identity.
      programBrief: v.optional(
        v.object({
          version: v.literal(CHANNEL_PROGRAM_BRIEF_VERSION),
          catalogFingerprint: v.string(),
          family: v.string(),
          nicheKey: v.string(),
          subcategory: v.optional(v.string()),
          locale: v.string(),
          concept: v.string(),
          audience: v.optional(v.string()),
          sampleTopics: v.optional(v.array(v.string())),
          // Parsed as the canonical discriminated program intent by the
          // engine contract at every admission/retry boundary.
          programIntent: v.optional(v.any()),
        }),
      ),
  // Optional only for historical rows. New admissions must bind this to
  // the canonical brief and the sealed show profile in `channels`.
  programRoute: v.optional(v.any()),
  // Canonical brief-and-route diagnosis. V8-safe engine validation at the
  // mutation boundary keeps this envelope backward-compatible for old rows.
  creatorIntentDiagnosis: v.optional(v.any()),
  showProfile: v.optional(
        v.object({
          version: v.literal(CHANNEL_SHOW_PROFILE_VERSION),
          programBriefFingerprint: v.string(),
          familyManifestFingerprint: v.string(),
          contentLaneFingerprint: v.string(),
          creativeCapabilityCatalogFingerprint: v.string(),
          selectedCapabilityKeys: v.array(v.string()),
          composition: v.optional(
            v.object({
              version: v.literal(CHANNEL_COMPOSITION_RECEIPT_VERSION),
              key: v.string(),
              definitionVersion: v.string(),
              definitionFingerprint: v.string(),
              family: v.string(),
              title: v.string(),
              qualityFocus: v.array(v.string()),
              fingerprint: v.string(),
            }),
          ),
          // New capability-owned composition authority. Engine receipt
          // validation binds this sealed discriminated structure before a
          // write, while this permissive envelope preserves historical rows.
          compositionBinding: v.optional(v.any()),
          // The route receipt is validated by the V8-safe engine parser; keep
          // this outer persistence envelope permissive for historical rows.
          programRoute: v.optional(v.any()),
          designedPipelineFingerprint: v.string(),
          fingerprint: v.string(),
        }),
      ),
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
    // Reversible operator organization for the finished-master Library. This
    // never deletes a run, asset, certificate, or YouTube video; historical
    // rows without the field are treated as active.
    libraryState: v.optional(v.union(v.literal("active"), v.literal("archived"))),
    libraryStateUpdatedAt: v.optional(v.number()),
    // A thumbnail refresh is always a separate no-video candidate run. The
    // source master and its thumbnail remain untouched until a later explicit
    // YouTube acceptance flow exists. These fields form a durable, bounded
    // outbox so a lost Trigger acknowledgement cannot purchase twice.
    thumbnailRefreshSourceRunId: v.optional(v.id("runs")),
    thumbnailRefreshReplayFingerprint: v.optional(v.string()),
    thumbnailRefreshDispatchKey: v.optional(v.string()),
    thumbnailRefreshMaximumCostUsd: v.optional(v.number()),
    thumbnailRefreshApproval: v.optional(v.any()),
    thumbnailRefreshApprovalFingerprint: v.optional(v.string()),
    thumbnailRefreshDispatchState: v.optional(v.union(
      v.literal("awaiting_approval"),
      v.literal("pending"),
      v.literal("queued"),
      v.literal("consumed"),
      v.literal("blocked"),
    )),
    thumbnailRefreshDispatchAttempts: v.optional(v.number()),
    thumbnailRefreshDispatchUpdatedAt: v.optional(v.number()),
    thumbnailRefreshDispatchQueuedAt: v.optional(v.number()),
    thumbnailRefreshDispatchQueueDeadlineAt: v.optional(v.number()),
    thumbnailRefreshDispatchTriggerRunId: v.optional(v.string()),
    thumbnailRefreshDispatchLastError: v.optional(v.string()),
    // Conservative, server-derived release provenance. This is deliberately
    // separate from publishing state: a stored QA boolean alone can never
    // promote a run to `release_evidence_recorded`.
    releaseEvidenceStatus: v.optional(v.union(
      v.literal("not_ready"),
      v.literal("legacy_unverified"),
      v.literal("evidence_incomplete"),
      v.literal("release_evidence_recorded"),
    )),
    releaseEvidenceCertificateFingerprint: v.optional(v.string()),
    releaseEvidenceCertificateKey: v.optional(v.string()),
    releaseEvidenceUpdatedAt: v.optional(v.number()),
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
    // Route-owned serial execution selector. Unlike a generic calendar topic,
    // this contains only immutable plan/route identifiers and is revalidated
    // before the invocation snapshot or any provider-capable stage begins.
    narrativeSeriesSelector: v.optional(v.any()),
    // Write-once parent checkpoint for an admitted Channel Inception probe.
    // This is claimed before Trigger dispatch, so a lost response reuses the
    // exact child receipt, frozen overrides, context, run id, and cost cap.
    probeDispatchEnvelope: v.optional(v.any()),
    probeDispatchEnvelopeFingerprint: v.optional(v.string()),
    probeDispatchClaimedAt: v.optional(v.number()),
    probeDispatchKey: v.optional(v.string()),
    // Dedicated outbox for an owner-confirmed full private benchmark. Unlike a
    // shortened inception probe, this runs the exact master/QA route and can
    // only earn a later release-qualification receipt—never an upload.
    routeQualificationBenchmarkDispatchEnvelope: v.optional(v.any()),
    routeQualificationBenchmarkDispatchEnvelopeFingerprint: v.optional(v.string()),
    routeQualificationBenchmarkDispatchKey: v.optional(v.string()),
    routeQualificationBenchmarkRequestApproval: v.optional(v.any()),
    routeQualificationBenchmarkRequestApprovalFingerprint: v.optional(v.string()),
    routeQualificationBenchmarkMaximumCostUsd: v.optional(v.number()),
    routeQualificationBenchmarkPreparationLastError: v.optional(v.string()),
    routeQualificationBenchmarkPreparationUpdatedAt: v.optional(v.number()),
    routeQualificationBenchmarkDispatchState: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("queued"),
        v.literal("consumed"),
        v.literal("blocked"),
      ),
    ),
    routeQualificationBenchmarkDispatchAttempts: v.optional(v.number()),
    routeQualificationBenchmarkDispatchQueuedAt: v.optional(v.number()),
    routeQualificationBenchmarkDispatchQueueDeadlineAt: v.optional(v.number()),
    routeQualificationBenchmarkDispatchTriggerRunId: v.optional(v.string()),
    routeQualificationBenchmarkDispatchLastError: v.optional(v.string()),
    // Immutable base-run → sibling receipt. This is a separate outbox from a
    // probe: fan-out dispatch can be lost after its child row is committed, so
    // every replay must recover this exact payload and global Trigger key.
    bundleParentRunId: v.optional(v.id("runs")),
    bundleParentChannelId: v.optional(v.id("channels")),
    bundleDispatchKey: v.optional(v.string()),
    bundleDispatchEnvelope: v.optional(v.any()),
    bundleDispatchEnvelopeFingerprint: v.optional(v.string()),
    bundleDispatchState: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("dispatching"),
        v.literal("enqueued"),
        v.literal("failed"),
      ),
    ),
    bundleDispatchAttempts: v.optional(v.number()),
    bundleDispatchNextAttemptAt: v.optional(v.number()),
    bundleDispatchDeadlineAt: v.optional(v.number()),
    bundleDispatchLeaseToken: v.optional(v.string()),
    bundleDispatchLeaseExpiresAt: v.optional(v.number()),
    // An accepted sibling may wait behind one bounded, same-channel remote
    // render. This is exceptional and reaper-honored only for this receipt.
    bundleDispatchQueueDeadlineAt: v.optional(v.number()),
    bundleDispatchLastError: v.optional(v.string()),
    bundleDispatchClaimedAt: v.optional(v.number()),
    bundleDispatchUpdatedAt: v.optional(v.number()),
    bundleDispatchEnqueuedAt: v.optional(v.number()),
    // Exact upload intent currently fencing post-upload continuation for this
    // run. The intent id and immutable artifact id are installed before the
    // dispatcher can call YouTube, and are cleared only by an exact successful
    // pipeline completion.
    blockedPublishIntentId: v.optional(v.id("publishIntents")),
    blockedPublishArtifactId: v.optional(v.string()),
    // Durable continuation outbox. A Trigger enqueue can fail after YouTube has
    // accepted the upload; `pending` survives that gap for the nightly Doctor,
    // `queued` records a bounded enqueue receipt, `manual_recovery_required`
    // stops exhausted delivery loops, and `completed` is retained as audit
    // evidence after the blocking fence is cleared.
    publishContinuationState: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("queued"),
        v.literal("manual_recovery_required"),
        v.literal("completed"),
      ),
    ),
    publishContinuationIntentId: v.optional(v.id("publishIntents")),
    publishContinuationArtifactId: v.optional(v.string()),
    publishContinuationVideoId: v.optional(v.string()),
    publishContinuationAttempts: v.optional(v.number()),
    publishContinuationUpdatedAt: v.optional(v.number()),
    publishContinuationQueuedAt: v.optional(v.number()),
    publishContinuationQueueDeadlineAt: v.optional(v.number()),
    publishContinuationCompletedAt: v.optional(v.number()),
    publishContinuationTriggerRunId: v.optional(v.string()),
    publishContinuationLastError: v.optional(v.string()),
    // A deliberate two-phase factual-review boundary. The immutable receipt
    // lives in `factualReviewCheckpoints`; this compact projection lets the
    // scheduler and run lease fail closed without shipping review payloads to
    // ordinary run subscribers.
    factualReviewCheckpointId: v.optional(v.id("factualReviewCheckpoints")),
    factualReviewCheckpointFingerprint: v.optional(v.string()),
    factualReviewState: v.optional(v.union(
      v.literal("awaiting"),
      v.literal("approved"),
      v.literal("resumed"),
      v.literal("rejected"),
      v.literal("blocked"),
    )),
    // Owner approval creates this bounded outbox. It is deliberately separate
    // from task retry: only the exact frozen checkpoint may move pending →
    // queued → consumed, while terminal corruption/decline stays blocked.
    factualReviewResumeState: v.optional(v.union(
      v.literal("pending"),
      v.literal("queued"),
      v.literal("consumed"),
      v.literal("blocked"),
    )),
    factualReviewApprovalFingerprint: v.optional(v.string()),
    factualReviewResumeAttempts: v.optional(v.number()),
    factualReviewResumeUpdatedAt: v.optional(v.number()),
    factualReviewResumeQueuedAt: v.optional(v.number()),
    // A Trigger acceptance is not proof that the serialized task will ever
    // start. This bounded handoff deadline lets the factual-review outbox
    // reissue the same owner-approved receipt if that accepted delivery dies
    // before it can consume the execution lease.
    factualReviewResumeQueueDeadlineAt: v.optional(v.number()),
    factualReviewResumeTriggerRunId: v.optional(v.string()),
    factualReviewResumeLastError: v.optional(v.string()),
    // Owner-selected, immutable source-data-story packs use a dedicated
    // initial-dispatch outbox. This is intentionally distinct from ordinary
    // cadence: no scheduled plan may carry factual claims or replace this
    // sealed pack selector.
    reviewedDataStoryInitialDispatchState: v.optional(v.union(
      v.literal("pending"),
      v.literal("queued"),
      v.literal("consumed"),
      v.literal("blocked"),
    )),
    reviewedDataStoryInitialAdmission: v.optional(v.object({
      version: v.literal("reviewed-data-story-initial-run-admission/v1"),
      ownerId: v.string(),
      channelId: v.string(),
      selector: v.object({ packId: v.id("reviewedEvidencePacks"), contentFingerprint: v.string() }),
      routeSeedFingerprint: v.string(),
      showProfileFingerprint: v.string(),
      pipelineFingerprint: v.string(),
      topicFingerprint: v.string(),
      selectedCapabilityKeys: v.array(v.string()),
      admissionFingerprint: v.string(),
    })),
    reviewedDataStoryInitialAdmissionFingerprint: v.optional(v.string()),
    reviewedDataStoryInitialDispatchAttempts: v.optional(v.number()),
    reviewedDataStoryInitialDispatchQueuedAt: v.optional(v.number()),
    reviewedDataStoryInitialDispatchQueueDeadlineAt: v.optional(v.number()),
    reviewedDataStoryInitialDispatchTriggerRunId: v.optional(v.string()),
    reviewedDataStoryInitialDispatchLastError: v.optional(v.string()),
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
    // Incremented for every execution-lease claim. Trigger writes carry this
    // generation so a worker that wakes after recovery cannot overwrite the
    // newer execution's stage, artifact, or terminal state.
    executionAttempts: v.optional(v.number()),
    // Durable, bounded self-heal generation. Missing legacy rows mean h0;
    // a repair advances this atomically with superseding its requested stages
    // so a recovered orchestrator cannot accidentally reattach to h0 work.
    selfHealGeneration: v.optional(v.number()),
    // Reaper-issued same-run recovery is deliberately bounded. Missing means
    // a pre-rollout row; the reaper treats it as zero and never backfills by
    // re-dispatching more than the cap.
    leaseRecoveryAttempts: v.optional(v.number()),
    // A parent orchestrator may wait for a bounded remote render child. This
    // exact dispatch receipt proves which lease generation may occupy the
    // extended deadline; a late/duplicate child fails before provider work.
    remoteChildWaitLeaseOwner: v.optional(v.string()),
    remoteChildWaitExecutionLeaseToken: v.optional(v.number()),
    remoteChildWaitBlockId: v.optional(v.string()),
    remoteChildWaitDispatchKey: v.optional(v.string()),
    remoteChildWaitUntil: v.optional(v.number()),
    // Immutable ceiling for a checkpointed remote child. `remoteChildWaitUntil`
    // is a short sliding liveness receipt; only the exact child generation can
    // renew it, and never beyond this original bounded work deadline.
    remoteChildWaitDeadline: v.optional(v.number()),
    // Serial episode contention is not a terminal pipeline failure. A
    // service-only mutation writes this small durable outbox before asking
    // Trigger to re-enter the frozen same-run invocation after the current
    // episode lease expires.
    serializedProgramEpisodeRetryAt: v.optional(v.number()),
    serializedProgramEpisodeRetryAttempts: v.optional(v.number()),
    serializedProgramEpisodeRetryLastError: v.optional(v.string()),
    // Set only by the lease reaper when a dead execution has a complete,
    // immutable invocation snapshot. The scheduler may re-dispatch that exact
    // run once; claiming the execution lease clears this marker.
    leaseRecoveryPending: v.optional(v.boolean()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_channel", ["channelId"])
    // Packaging-only thumbnail candidates share the durable run/stage lease
    // infrastructure, but are not ordinary video runs. These indexes let
    // cadence and channel-card projections select source productions without
    // collecting a channel's full history or mistaking packaging work for a
    // queued episode.
    .index("by_channel_thumbnail_refresh_source", ["channelId", "thumbnailRefreshSourceRunId"])
    .index("by_channel_started", ["channelId", "startedAt"])
    .index("by_channel_status", ["channelId", "status"])
    .index("by_channel_status_thumbnail_refresh_source", [
      "channelId",
      "status",
      "thumbnailRefreshSourceRunId",
    ])
    .index("by_channel_probe_dispatch", ["channelId", "probeDispatchKey"])
    .index("by_owner_thumbnail_refresh_source", [
      "ownerId",
      "thumbnailRefreshSourceRunId",
      "thumbnailRefreshReplayFingerprint",
    ])
    .index("by_owner_thumbnail_refresh_dispatch", [
      "ownerId",
      "thumbnailRefreshDispatchState",
      "thumbnailRefreshDispatchQueueDeadlineAt",
    ])
    .index("by_owner_channel_route_qualification_benchmark_dispatch", [
      "ownerId",
      "channelId",
      "routeQualificationBenchmarkDispatchKey",
    ])
    .index("by_owner_route_qualification_benchmark_dispatch", [
      "ownerId",
      "routeQualificationBenchmarkDispatchState",
    ])
    .index("by_owner_route_qualification_benchmark_dispatch_deadline", [
      "ownerId",
      "routeQualificationBenchmarkDispatchState",
      "routeQualificationBenchmarkDispatchQueueDeadlineAt",
    ])
    .index("by_channel_bundle_dispatch", ["channelId", "bundleDispatchKey"])
    .index("by_status_started", ["status", "startedAt"])
    // Expired rows are read in deadline order. The legacy startedAt index
    // remains for compatibility/backfill but cannot let live heartbeats starve
    // actually-expired leases behind a bounded scan.
    .index("by_status_lease_expires_at", ["status", "leaseExpiresAt"])
    .index("by_owner_factual_review_resume", ["ownerId", "factualReviewResumeState"])
    .index("by_owner_factual_review_resume_queue_deadline", [
      "ownerId",
      "factualReviewResumeState",
      "factualReviewResumeQueueDeadlineAt",
    ])
    .index("by_owner_reviewed_data_story_initial_dispatch", [
      "ownerId",
      "reviewedDataStoryInitialDispatchState",
    ])
    .index("by_owner_reviewed_data_story_initial_dispatch_deadline", [
      "ownerId",
      "reviewedDataStoryInitialDispatchState",
      "reviewedDataStoryInitialDispatchQueueDeadlineAt",
    ])
    .index("by_owner_channel_reviewed_data_story_admission", [
      "ownerId",
      "channelId",
      "reviewedDataStoryInitialAdmissionFingerprint",
    ])
    // Service-only durable outbox for a serialized episode contention retry.
    // The dispatcher reads only queued receipts due at or before its tick.
    .index("by_owner_serialized_program_episode_retry", [
      "ownerId",
      "status",
      "serializedProgramEpisodeRetryAt",
    ])
    // Bounded fan-out delivery outbox. One index finds intentionally deferred
    // dispatches; the other recovers a dispatcher that died after Trigger
    // accepted a request but before it recorded its durable enqueue receipt.
    .index("by_owner_bundle_dispatch_due", [
      "ownerId",
      "bundleDispatchState",
      "bundleDispatchNextAttemptAt",
    ])
    .index("by_owner_bundle_dispatch_lease", [
      "ownerId",
      "bundleDispatchState",
      "bundleDispatchLeaseExpiresAt",
    ])
    .index("by_owner_publish_continuation", [
      "ownerId",
      "publishContinuationState",
      "publishContinuationUpdatedAt",
    ])
    .index("by_owner_publish_continuation_queue_deadline", [
      "ownerId",
      "publishContinuationState",
      "publishContinuationQueueDeadlineAt",
    ]),

  // A real Convex-transaction lease for the short channel-scoped R2
  // read/compare/write critical section in originality_gate. It prevents two
  // concurrent Trigger runs from both accepting the same lexical script based
  // on an out-of-date corpus snapshot.
  scriptSelfDedupLeases: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.string(),
    leaseToken: v.string(),
    acquiredAt: v.number(),
    updatedAt: v.number(),
    leaseExpiresAt: v.number(),
  }).index("by_channel", ["channelId"]),

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
    // A remote Trigger child must prove its currently active run/child lease
    // inside every worker-lifecycle mutation. Direct/local callers
    // deliberately leave this false.
    remoteChildFenceRequired: v.optional(v.boolean()),
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
    // For remote children, retain the parent receipt that owns this mutable
    // controller slot so a recovered generation can atomically take over a
    // stale observer without ever granting that observer lifecycle authority.
    executionAttemptToken: v.optional(v.string()),
    executionClaimedAt: v.optional(v.number()),
    remoteChildExecutionLeaseOwner: v.optional(v.string()),
    remoteChildExecutionLeaseToken: v.optional(v.number()),
    remoteChildExecutionDispatchKey: v.optional(v.string()),
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

  // Immutable, owner-operated reusable recipe/adapter catalog. Media bytes
  // remain in R2; a Studio entry carries only a content-addressed resource
  // reference and evidence-bound compatibility metadata. Lifecycle changes
  // append a superseding revision instead of mutating an approved entry.
  studioAssetLibraryEntries: defineTable({
    ownerId: v.string(),
    version: v.literal("studio-asset-library/v1"),
    logicalId: v.string(),
    fingerprint: v.string(),
    scope: v.union(
      v.literal("owned_studio"),
      v.literal("channel"),
      v.literal("series"),
    ),
    channelId: v.optional(v.id("channels")),
    seriesIdentity: v.optional(v.string()),
    assetKind: v.string(),
    status: v.union(
      v.literal("approved"),
      v.literal("deprecated"),
      v.literal("revoked"),
    ),
    entry: v.any(),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_fingerprint", ["ownerId", "fingerprint"])
    .index("by_owner_logical_id", ["ownerId", "logicalId"])
    .index("by_channel", ["channelId"]),

  // Immutable release observations for Studio assets that were actually
  // reused in a calibrated, hard-gate-passing final master. These are ranking
  // evidence only: they cannot approve, train, or publish an asset.
  studioAssetReleaseUsageObservations: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    certificateFingerprint: v.string(),
    usageReceiptFingerprint: v.string(),
    assetEntryFingerprint: v.string(),
    moduleId: v.string(),
    family: v.string(),
    contentLane: v.string(),
    treatment: v.optional(v.string()),
    finalMasterSha256: v.string(),
    visualScore: v.optional(v.number()),
    visualMinimumScore: v.optional(v.number()),
    usage: v.any(),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_channel", ["channelId"])
    .index("by_run", ["runId"])
    .index("by_owner_context", ["ownerId", "family", "contentLane", "moduleId"])
    .index("by_owner_certificate_asset_module", ["ownerId", "certificateFingerprint", "assetEntryFingerprint", "moduleId"]),

  // A passing final master may suggest a *channel-scoped* reusable recipe, but
  // it is never resolvable until an owner approves it after certificate
  // re-verification. Candidate rows retain the private R2 certificate pointer;
  // browser inventory receives only a redacted projection.
  studioAssetPromotionCandidates: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    candidateFingerprint: v.string(),
    certificateFingerprint: v.string(),
    finalMasterSha256: v.string(),
    candidate: v.any(),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_fingerprint", ["ownerId", "candidateFingerprint"])
    .index("by_channel", ["channelId"])
    .index("by_run", ["runId"]),

  // Append-only approval boundary for a pending Studio asset candidate. The
  // entry itself stays immutable; retrying the same owner action is idempotent.
  studioAssetPromotionApprovals: defineTable({
    ownerId: v.string(),
    candidateFingerprint: v.string(),
    assetEntryId: v.id("studioAssetLibraryEntries"),
    assetEntryFingerprint: v.string(),
    approvedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_candidate", ["ownerId", "candidateFingerprint"]),

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

  // Atomic episode ownership for a sealed serialized_program/v1 route. This
  // is deliberately separate from legacy title memory: a human title cannot
  // be used as an episode counter or a cross-run reservation key.
  serializedProgramEpisodes: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    version: v.literal("serialized_program_episode/v1"),
    seriesIdentity: v.string(),
    routeFingerprint: v.string(),
    // Full frozen run-seed identity closes the gap where a route projection is
    // unchanged but its sealed directives or creator context differ.
    routeRunSeedFingerprint: v.optional(v.string()),
    seriesTitle: v.string(),
    seriesCount: v.optional(v.number()),
    episodeNumber: v.number(),
    // A real run id is part of the reservation's fencing boundary. Keeping
    // this typed prevents a service caller from minting an unattached claim.
    runId: v.id("runs"),
    claimToken: v.string(),
    status: v.union(v.literal("claimed"), v.literal("completed")),
    topic: v.optional(v.string()),
    topicMemoryKey: v.optional(v.string()),
    // Immutable, bounded projection of the continuity state that was merged
    // in the same completion transaction. Later pipeline blocks read this
    // row-bound receipt rather than the mutable seriesStoryState table.
    serializedProgramEpisodeContext: v.optional(
      v.object({
        version: v.literal("serialized_program_episode_context/v1"),
        routeFingerprint: v.string(),
        routeRunSeedFingerprint: v.string(),
        runId: v.string(),
        seriesIdentity: v.string(),
        seriesTitle: v.string(),
        seriesCount: v.optional(v.number()),
        episodeNumber: v.number(),
        topic: v.string(),
        topicMemoryKey: v.string(),
        continuity: v.object({
          arcSummary: v.optional(v.string()),
          recentPlotBeats: v.array(v.object({ episode: v.number(), beat: v.string() })),
          unresolvedThreads: v.array(v.string()),
          entities: v.array(v.object({ name: v.string(), role: v.string() })),
        }),
        fingerprint: v.string(),
      }),
    ),
    claimedAt: v.number(),
    updatedAt: v.number(),
    leaseExpiresAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_channel_series", ["channelId", "seriesIdentity"])
    .index("by_channel_series_episode", ["channelId", "seriesIdentity", "episodeNumber"])
    .index("by_channel_series_run", ["channelId", "seriesIdentity", "runId"]),

  // Provider-neutral, immutable season horizons. The full contract is parsed
  // against the engine schema before every write; the indexed fingerprint is
  // the idempotency boundary, not a mutable "latest plan" pointer.
  narrativeSeriesPlans: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    accountId: v.string(),
    version: v.literal("narrative-series-intelligence/v1"),
    fingerprint: v.string(),
    seriesIdentity: v.string(),
    seriesTitle: v.string(),
    programBriefFingerprint: v.string(),
    visualStyle: v.string(),
    plan: v.any(),
    createdAt: v.number(),
  })
    .index("by_channel_fingerprint", ["channelId", "fingerprint"])
    .index("by_channel_series_identity", ["channelId", "seriesIdentity"]),

  // Exactly one frozen visual-continuity handoff per admitted run. This stores
  // no renderer choice or provider job: it binds the planned episode, completed
  // serialized context, and neutral camera/first-last-frame controls.
  narrativeEpisodeReceipts: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    version: v.literal("narrative-episode-receipt/v1"),
    seriesPlanFingerprint: v.string(),
    episodeBindingFingerprint: v.string(),
    shotControlFingerprint: v.string(),
    episodeNumber: v.number(),
    plannedEpisodeId: v.string(),
    visualStyle: v.string(),
    episodeBinding: v.any(),
    shotControl: v.any(),
    createdAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_channel_series_plan", ["channelId", "seriesPlanFingerprint"]),

  // One immutable character-sheet plan per exact script/policy/character
  // fingerprint. Images live in R2 and appear only in the later dataset
  // manifest, never inline in Convex.
  characterSheetDatasetPlans: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    accountId: v.string(),
    version: v.literal("character-sheet-dataset/v1"),
    planFingerprint: v.string(),
    channelPolicyFingerprint: v.string(),
    characterId: v.string(),
    characterSpecFingerprint: v.string(),
    scriptTreatmentFingerprint: v.string(),
    plan: v.any(),
    createdAt: v.number(),
  })
    .index("by_channel_plan_fingerprint", ["channelId", "planFingerprint"])
    .index("by_channel_character_spec", ["channelId", "characterId", "characterSpecFingerprint"]),

  // Immutable manifest for a complete, rights-cleared character-sheet dataset.
  // The stored artifact keys/hashes are validated by the engine contract.
  characterSheetDatasets: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    accountId: v.string(),
    version: v.literal("character-sheet-dataset/v1"),
    datasetFingerprint: v.string(),
    sheetPlanFingerprint: v.string(),
    characterId: v.string(),
    manifest: v.any(),
    createdAt: v.number(),
  })
    .index("by_channel_dataset_fingerprint", ["channelId", "datasetFingerprint"])
    .index("by_channel_sheet_plan", ["channelId", "sheetPlanFingerprint"]),

  // A frozen admission evaluation, explicitly not a training invocation. At
  // most one admitted request may exist for a character specification; blocked
  // evaluations remain as audit evidence but cannot create provider work here.
  characterLoRATrainingRequests: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    accountId: v.string(),
    version: v.literal("character-lora-registry/v1"),
    requestFingerprint: v.string(),
    registryIdentity: v.string(),
    sheetPlanFingerprint: v.string(),
    datasetFingerprint: v.string(),
    channelPolicyFingerprint: v.string(),
    characterId: v.string(),
    characterSpecFingerprint: v.string(),
    status: v.union(v.literal("blocked"), v.literal("admitted")),
    providerInvocation: v.literal("not_started"),
    request: v.any(),
    createdAt: v.number(),
  })
    .index("by_request_fingerprint", ["requestFingerprint"])
    .index("by_registry_identity", ["registryIdentity"])
    .index("by_channel_character_spec", ["channelId", "characterId", "characterSpecFingerprint"]),

  // Accepted adapters only. The entry is write-once and becomes the mandatory
  // reuse target for that owner/channel/character specification. A separate
  // future adapter may produce a receipt, but cannot be invoked by this table.
  characterLoRARegistryEntries: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    accountId: v.string(),
    version: v.literal("character-lora-registry/v1"),
    registryIdentity: v.string(),
    trainingRequestFingerprint: v.string(),
    datasetFingerprint: v.string(),
    characterId: v.string(),
    characterSpecFingerprint: v.string(),
    status: v.literal("accepted"),
    acceptedAdapter: v.any(),
    entry: v.any(),
    acceptedAt: v.number(),
  })
    .index("by_owner_accepted", ["ownerId", "acceptedAt"])
    .index("by_registry_identity", ["registryIdentity"])
    .index("by_training_request_fingerprint", ["trainingRequestFingerprint"])
    .index("by_channel_character_spec", ["channelId", "characterId", "characterSpecFingerprint"]),

  // Release-controlled, owner-scoped LTX runtime benchmark evidence. An
  // admission cannot launch a worker on its own; it becomes usable only when
  // a run snapshots it and revalidates it before each parent/remote pre-spend
  // assertion. Revocations are append-only to keep stale retries fail-closed.
  reviewedLtxRuntimeAdmissions: defineTable({
    ownerId: v.string(),
    version: v.literal("reviewed-ltx-runtime-admission/v1"),
    admissionFingerprint: v.string(),
    profileFingerprint: v.string(),
    admission: v.any(),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_admission", ["ownerId", "admissionFingerprint"]),

  reviewedLtxRuntimeRevocations: defineTable({
    ownerId: v.string(),
    version: v.literal("reviewed-ltx-runtime-revocation/v1"),
    admissionFingerprint: v.string(),
    reason: v.string(),
    revocationFingerprint: v.string(),
    revokedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_revocation", ["ownerId", "revocationFingerprint"]),

  // Owner-scoped A2Vid capability evidence for the separate self-hosted LTX
  // 2.5 music-to-video worker. This is a reusable benchmarked runtime record,
  // not a render queue or worker credential. Per-clip audio/reference/budget
  // admission remains required downstream.
  musicVideoA2VidRuntimeAdmissions: defineTable({
    ownerId: v.string(),
    version: v.literal("music-video-a2vid-runtime-admission/v1"),
    admissionFingerprint: v.string(),
    runtimeFingerprint: v.string(),
    admission: v.any(),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_admission", ["ownerId", "admissionFingerprint"]),

  musicVideoA2VidRuntimeRevocations: defineTable({
    ownerId: v.string(),
    version: v.literal("music-video-a2vid-runtime-revocation/v1"),
    admissionFingerprint: v.string(),
    reason: v.string(),
    revocationFingerprint: v.string(),
    revokedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_revocation", ["ownerId", "revocationFingerprint"]),

  // Immutable staged route-qualification receipts. A preflight says only that
  // a later, explicit private benchmark may be considered; a release receipt
  // carries the sealed QA/provenance hashes but still cannot dispatch, render,
  // release, or publish on its own. Supersession is represented forward by a
  // new immutable row, never by mutating an earlier receipt or a "current"
  // status flag.
  productionRouteQualificationReceipts: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    version: v.literal("production-route-qualification-receipt/v1"),
    level: v.union(
      v.literal("route_preflight_ready"),
      v.literal("route_release_qualified"),
    ),
    bindingFingerprint: v.string(),
    family: v.string(),
    contentLaneKey: v.string(),
    programBriefFingerprint: v.string(),
    showProfileFingerprint: v.string(),
    routeKey: v.string(),
    routeAdmission: v.union(v.literal("automatic"), v.literal("supervised_private")),
    routeFingerprint: v.string(),
    compositionFingerprint: v.string(),
    pipelineFingerprint: v.string(),
    receiptFingerprint: v.string(),
    supersedesReceiptFingerprint: v.optional(v.string()),
    // Present only in release-qualified envelopes; this is a compact hash, not
    // the preflight payload or a mutable run/admission reference.
    preflightReceiptFingerprint: v.optional(v.string()),
    // Present only in release-qualified envelopes. The actual master remains
    // in object storage and must be independently verified by a later gate.
    finalMasterSha256: v.optional(v.string()),
    /** Full engine-validated compact envelope; never bytes or provider JSON. */
    receipt: v.any(),
    createdAt: v.number(),
  })
    .index("by_channel_receipt", ["channelId", "receiptFingerprint"])
    .index("by_channel_level_binding", ["channelId", "level", "bindingFingerprint"])
    .index("by_channel_level_binding_created", ["channelId", "level", "bindingFingerprint", "createdAt"]),

  // Real episodic story-state memory (Phase 4 — episodic continuity). One row
  // per legacy (channelId, seriesTitle), or per serialized
  // (channelId, seriesIdentity): a running arc summary, prior plot beats,
  // unresolved narrative threads, and known entities (name + one-line ROLE
  // only — never wardrobe/appearance, which is a separate concern owned by
  // the character/wardrobe continuity system). `topic_select`'s SERIES MODE
  // reads this to ground its continuation LLM call in real prior plot content
  // (not just prior titles), then writes an updated summary back in the same
  // call. No row for a series = today's exact title-only-continuity behavior.
  seriesStoryState: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    seriesTitle: v.string(),
    // Present only for a sealed serialized-program route.  This deliberately
    // keeps route renewals with the same human title from sharing an arc, and
    // leaves historical title-keyed series state on its legacy namespace.
    seriesIdentity: v.optional(v.string()),
    arcSummary: v.string(),
    plotBeats: v.array(
      v.object({
        episode: v.number(),
        beat: v.string(),
        at: v.number(),
      }),
    ),
    unresolvedThreads: v.array(v.string()),
    entities: v.array(
      v.object({
        name: v.string(),
        role: v.string(),
      }),
    ),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_channel", ["channelId"])
    .index("by_channel_series", ["channelId", "seriesTitle"])
    .index("by_channel_series_identity", ["channelId", "seriesIdentity"]),

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
    // A point-in-time copy of the immutable release mapping observed while
    // this metric was ingested. It is provenance metadata, never a score,
    // causal attribution, recommendation, or publishing authorization.
    observedReleaseProvenance: v.optional(v.object({
      provenanceId: v.id("videoReleaseProvenance"),
      version: v.literal("video-release-provenance/v1"),
      runId: v.id("runs"),
      releaseCertificateKey: v.string(),
      releaseCertificateFingerprint: v.string(),
      finalMasterSha256: v.string(),
      qualityBindingVersion: v.string(),
      qualityBindingFingerprint: v.string(),
      qualityEvidenceFingerprint: v.string(),
      contentLaneKey: v.string(),
      renderer: v.string(),
      programRoute: v.optional(v.object({
        routeFingerprint: v.string(),
        family: v.string(),
        contentLaneKey: v.string(),
        programBriefFingerprint: v.optional(v.string()),
      })),
      releaseEvidenceStatus: v.literal("release_evidence_recorded"),
      evidenceStatus: v.union(
        v.literal("complete"),
        v.literal("partial"),
        v.literal("unmeasured"),
      ),
      // Scope only: plan-only is pre-render; final-master never means all-covered.
      storyMeasurementCoverage: v.optional(v.union(
        v.literal("unmeasured"),
        v.literal("plan_only"),
        v.literal("final_master"),
        v.literal("scope_undeclared"),
      )),
      uploadedAt: v.number(),
      recordedAt: v.number(),
    })),
    snapshotAt: v.number(),
  })
    .index("by_channel", ["channelId"])
    .index("by_video", ["youtubeVideoId", "snapshotAt"])
    // A durable stats-refresh batch owns at most one snapshot per video. This
    // makes a worker replay update the same observation instead of appending
    // duplicate rows after a crash between a provider response and completion.
    .index("by_ingestion_video", ["ingestionId", "youtubeVideoId"]),

  // Write-once bridge between an uploaded YouTube video and the certified
  // release/QA evidence that was actually bound to its final-master bytes.
  // Rows are installed only by the service-authenticated upload seam. They do
  // not make performance, quality, or causal claims; analytics observes them
  // later as provenance metadata when it ingests a snapshot.
  videoReleaseProvenance: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    publishIntentId: v.id("publishIntents"),
    youtubeVideoId: v.string(),
    version: v.literal("video-release-provenance/v1"),
    releaseCertificateKey: v.string(),
    releaseCertificateFingerprint: v.string(),
    finalMasterSha256: v.string(),
    qualityBindingVersion: v.string(),
    qualityBindingFingerprint: v.string(),
    qualityEvidenceFingerprint: v.string(),
    contentLaneKey: v.string(),
    renderer: v.string(),
    programRoute: v.optional(v.object({
      routeFingerprint: v.string(),
      family: v.string(),
      contentLaneKey: v.string(),
      programBriefFingerprint: v.optional(v.string()),
    })),
    releaseEvidenceStatus: v.literal("release_evidence_recorded"),
    // Completeness of the evidence receipt only; no outcome or quality grade.
    evidenceStatus: v.union(
      v.literal("complete"),
      v.literal("partial"),
      v.literal("unmeasured"),
    ),
    // Scope only: plan-only is pre-render; final-master never means all-covered.
    storyMeasurementCoverage: v.optional(v.union(
      v.literal("unmeasured"),
      v.literal("plan_only"),
      v.literal("final_master"),
      v.literal("scope_undeclared"),
    )),
    uploadedAt: v.number(),
    recordedAt: v.number(),
  })
    .index("by_owner_youtube_video", ["ownerId", "youtubeVideoId"])
    .index("by_youtube_video", ["youtubeVideoId"])
    .index("by_channel", ["channelId"])
    .index("by_run", ["runId"]),

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
    // Bounded pre-pipeline Casefile research safety state. A queued plan that
    // repeatedly cannot converge is made visibly manual-required rather than
    // being silently reattached by every scheduler cycle.
    casefileResearchStartedAt: v.optional(v.number()),
    casefileResearchFailureCount: v.optional(v.number()),
    casefileResearchFirstFailedAt: v.optional(v.number()),
    casefileResearchLastFailedAt: v.optional(v.number()),
    casefileResearchLastOutcome: v.optional(v.string()),
    casefileResearchBlockedAt: v.optional(v.number()),
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
    // Immutable final-master release-evidence pointer. Unlike package art,
    // this seals the exact QA certificate that every delayed/retried upload
    // must revalidate before it can call YouTube. Optional only for historical
    // rows; new intent creation always supplies the complete pair.
    releaseEvidenceCertificateKey: v.optional(v.string()),
    releaseEvidenceCertificateFingerprint: v.optional(v.string()),
    thumbnailArtifactKey: v.optional(v.string()),
    thumbnailSha256: v.optional(v.string()),
    // Package-art proof stays distinct from the final-master certificate. It
    // lets a delayed publisher revalidate that a fictional thumbnail belongs
    // to its frozen route and exact bytes before applying it on YouTube.
    thumbnailScenarioVisualTreatmentProvenance: v.optional(v.any()),
    thumbnailScenarioVisualTreatmentProvenanceFingerprint: v.optional(v.string()),
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

  // Exactly one bounded stats-refresh batch may be active per channel. The
  // cursor advances only when its ingestion terminally completes, so a Trigger
  // retry resumes the frozen page rather than starting a full upload-history
  // scan from the newest row again.
  analyticsRefreshCursors: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    historyCursor: v.optional(v.string()),
    historyCompletedAt: v.optional(v.number()),
    freshnessWindowStartedAfter: v.optional(v.number()),
    freshnessCursor: v.optional(v.string()),
    freshnessNextAt: v.optional(v.number()),
    lastCompletedCadenceKey: v.optional(v.string()),
    lastCompletedAt: v.optional(v.number()),
    // Monotonically fences a late worker from an earlier batch generation.
    // Optional only to tolerate rows written before worker fencing existed.
    nextBatchGeneration: v.optional(v.number()),
    activeState: v.optional(
      v.union(v.literal("active"), v.literal("manual_reconciliation_required")),
    ),
    activeBatch: v.optional(v.object({
      batchKey: v.string(),
      cadenceKey: v.string(),
      mode: v.union(v.literal("freshness"), v.literal("history"), v.literal("rollup")),
      scanStartedAfter: v.number(),
      scanCursorBefore: v.optional(v.string()),
      scanCursorAfter: v.optional(v.string()),
      scanIsDone: v.boolean(),
      ingestionId: v.id("analyticsIngestions"),
      connectorId: v.id("youtubeAuth"),
      connectorVersion: v.number(),
      // A claimed worker is the sole owner allowed to alter this generation.
      // Existing rows may lack these while they are quarantined on first use.
      generation: v.optional(v.number()),
      workerLeaseToken: v.optional(v.string()),
      workerLeaseExpiresAt: v.optional(v.number()),
      workerLeaseAttempt: v.optional(v.number()),
      videoIds: v.array(v.string()),
      videoStats: v.optional(v.array(v.object({
        youtubeVideoId: v.string(),
        channelId: v.string(),
        views: v.number(),
        likes: v.number(),
        comments: v.number(),
      }))),
      videoRequestStatus: v.union(
        v.literal("pending"),
        v.literal("request_started"),
        v.literal("fetched"),
        v.literal("manual_reconciliation_required"),
      ),
      videoRequestToken: v.optional(v.string()),
      videoRequestStartedAt: v.optional(v.number()),
      videoStatsFetchedAt: v.optional(v.number()),
      channelRollup: v.optional(v.object({
        found: v.boolean(),
        subscriberCount: v.number(),
        viewCount: v.number(),
        videoCount: v.number(),
      })),
      channelRequestStatus: v.union(
        v.literal("pending"),
        v.literal("request_started"),
        v.literal("fetched"),
        v.literal("manual_reconciliation_required"),
      ),
      channelRequestToken: v.optional(v.string()),
      channelRequestStartedAt: v.optional(v.number()),
      channelRollupFetchedAt: v.optional(v.number()),
      preDispatchFailureCount: v.number(),
      commitFailureCount: v.optional(v.number()),
      commitDeadlineAt: v.optional(v.number()),
      lastError: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_channel", ["ownerId", "channelId"])
    .index("by_owner_active_updated", ["ownerId", "activeState", "updatedAt"])
    .index("by_channel", ["channelId"]),

  // Exactly one bounded, cursor-resumable learning batch may be active for a
  // channel.  Its item results live on this small row so a Trigger replay can
  // continue from a saved Analytics response rather than rereading every
  // historical settled upload (or making the same quota request twice).
  learningAnalyticsProgress: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    historyCursor: v.optional(v.string()),
    historyCompletedAt: v.optional(v.number()),
    // A freshness sweep freezes its lower bound and cursor until it is fully
    // consumed.  This prevents a daily newest-page loop from starving older
    // entries in the bounded recent window.
    freshnessWindowStartedAfter: v.optional(v.number()),
    freshnessCursor: v.optional(v.string()),
    freshnessNextAt: v.optional(v.number()),
    // Mirrors the bounded R2 ledger retention.  It is a durable dedupe fence,
    // not an unbounded historical index.
    processedVideoIds: v.array(v.string()),
    activeBatch: v.optional(v.object({
      batchKey: v.string(),
      mode: v.union(v.literal("history"), v.literal("freshness")),
      scanStartedAfter: v.number(),
      scanCursorBefore: v.optional(v.string()),
      scanCursorAfter: v.optional(v.string()),
      scanIsDone: v.boolean(),
      ingestionId: v.id("analyticsIngestions"),
      // Absent is the original v1 query shape; v2 freezes engagedViews.
      metricDefinitionVersion: v.optional(v.string()),
      // New batches carry immutable connector provenance. Optional preserves
      // legacy rows long enough for the runtime to fail them closed/manual.
      connectorId: v.optional(v.id("youtubeAuth")),
      connectorVersion: v.optional(v.number()),
      status: v.union(
        v.literal("collecting"),
        v.literal("ledger_write_started"),
        v.literal("manual_reconciliation_required"),
      ),
      items: v.array(v.object({
        runId: v.id("runs"),
        youtubeVideoId: v.string(),
        publishedAt: v.number(),
        requestStatus: v.union(
          v.literal("pending"),
          v.literal("request_started"),
          v.literal("request_dispatch_started"),
          v.literal("fetched"),
          v.literal("ambiguous"),
        ),
        requestStartedAt: v.optional(v.number()),
        requestDispatchStartedAt: v.optional(v.number()),
        requestDispatchCapabilityToken: v.optional(v.string()),
        requestDispatchCapabilityExpiresAt: v.optional(v.number()),
        requestDispatchCapabilityConsumedAt: v.optional(v.number()),
        requestDispatchHttpDeadlineAt: v.optional(v.number()),
        fetchedAt: v.optional(v.number()),
        ambiguousAt: v.optional(v.number()),
        lastError: v.optional(v.string()),
        views: v.optional(v.number()),
        engagedViews: v.optional(v.number()),
        avgViewPct: v.optional(v.number()),
        ctr: v.optional(v.number()),
        title: v.optional(v.string()),
        topic: v.optional(v.string()),
        thumbnailStrategy: v.optional(v.string()),
      })),
      ledgerWriteStartedAt: v.optional(v.number()),
      ledgerFingerprint: v.optional(v.string()),
      // A batch is single-flight.  Only this exact worker generation may turn
      // a live request_started item into a response, ambiguity, ledger write,
      // or cursor advance.  A competing manual/scheduled task observes busy
      // rather than invalidating the healthy worker's response.
      workerLeaseToken: v.optional(v.string()),
      workerLeaseGeneration: v.optional(v.number()),
      workerLeaseExpiresAt: v.optional(v.number()),
      workerHeartbeatAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_channel", ["ownerId", "channelId"])
    .index("by_channel", ["channelId"]),

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
  //
  // The claim is the irreversible model-call boundary for Show Bible learning.
  // `claimed` can expire only before the provider marker.  Once
  // `provider_started` is stored, every outcome is reconciliation-only: no
  // automatic lease expiry can turn uncertainty into a second paid generation.
  // A small owner-scoped round-robin cursor prevents a many-channel owner from
  // fanning one daily refresh into unbounded Show Bible model calls.
  showBibleOwnerAdmissionState: defineTable({
    ownerId: v.string(),
    roundRobinCursor: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  // Every approved Show Bible model permission is retained as a daily owner
  // budget receipt.  Deferred claims have no row here, so they can receive a
  // fair future turn without silently spending today\'s capped envelope.
  showBibleGenerationAdmissions: defineTable({
    ownerId: v.string(),
    day: v.string(),
    channelId: v.id("channels"),
    recommendationKey: v.string(),
    fairnessKey: v.string(),
    reservedMaxTokens: v.number(),
    status: v.union(
      v.literal("reserved"),
      v.literal("provider_started"),
      v.literal("provider_dispatch_started"),
      v.literal("finalized"),
      v.literal("manual_reconciliation_required"),
      v.literal("pre_provider_exhausted"),
      v.literal("operator_rearmed"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_day", ["ownerId", "day"])
    .index("by_owner_key", ["ownerId", "recommendationKey"])
    .index("by_owner_channel_day", ["ownerId", "channelId", "day"]),

  showBibleProposalClaims: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    recommendationKey: v.string(),
    basePolicyVersion: v.number(),
    proposedPolicyVersion: v.number(),
    request: v.object({
      role: v.literal("showrunner"),
      system: v.string(),
      prompt: v.string(),
      maxTokens: v.number(),
    }),
    baseBrief: v.any(),
    sourceVideoIds: v.array(v.string()),
    dataWindowStart: v.string(),
    dataWindowEnd: v.string(),
    offlineEvaluation: v.object({
      method: v.string(),
      sampleSize: v.number(),
      baselineScore: v.optional(v.number()),
      candidateScore: v.optional(v.number()),
      passed: v.boolean(),
      notes: v.string(),
    }),
    status: v.union(
      v.literal("deferred_owner_budget"),
      v.literal("claimed"),
      v.literal("provider_started"),
      v.literal("provider_dispatch_started"),
      v.literal("ambiguous"),
      v.literal("finalized"),
      v.literal("pre_provider_exhausted"),
    ),
    claimToken: v.string(),
    // Only v2 separates a no-dispatch provider_started gap from a durable
    // dispatch-attempt marker.  Legacy v1 rows remain reconciliation-only.
    claimProtocolVersion: v.optional(v.string()),
    fairnessKey: v.optional(v.string()),
    ownerAdmissionId: v.optional(v.id("showBibleGenerationAdmissions")),
    preProviderAttempts: v.number(),
    claimExpiresAt: v.optional(v.number()),
    providerStartedAt: v.optional(v.number()),
    providerDispatchStartedAt: v.optional(v.number()),
    ambiguousAt: v.optional(v.number()),
    deferredAt: v.optional(v.number()),
    deferredAdmissionDay: v.optional(v.string()),
    deferredReason: v.optional(v.string()),
    // Explicit, owner-bound operator attestations are retained even after a
    // no-dispatch rearm.  They never apply to ambiguous/dispatch-started rows.
    operatorResolutionAudit: v.optional(v.array(v.object({
      action: v.literal("rearm_no_dispatch"),
      actor: v.string(),
      reason: v.string(),
      evidence: v.string(),
      attestedAt: v.number(),
      resolvedAt: v.number(),
      priorClaimToken: v.string(),
    }))),
    operatorResolutionCount: v.optional(v.number()),
    lastError: v.optional(v.string()),
    recommendationId: v.optional(v.id("learningRecommendations")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner_key", ["ownerId", "recommendationKey"])
    .index("by_owner_updated", ["ownerId", "updatedAt"])
    .index("by_channel_updated", ["channelId", "updatedAt"]),

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

  // A reusable factual-evidence receipt, deliberately isolated from channel
  // runs and Casefile.  The row is immutable after admission: it records the
  // exact reviewer-bound packet that a separately supervised explainer may
  // reference, and can never authorize rendering, provider spend, or publish.
  editorialEvidencePackets: defineTable({
    ownerId: v.string(),
    subject: v.string(),
    contentFingerprint: v.string(),
    reviewerId: v.string(),
    reviewId: v.string(),
    reviewedAt: v.string(),
    release: v.literal("private_human_editorial_review_only"),
    requiresHumanEditorialReview: v.literal(true),
    packet: v.any(),
    createdAt: v.number(),
  })
    .index("by_owner_review", ["ownerId", "reviewId"])
    .index("by_owner_content", ["ownerId", "contentFingerprint"])
    .index("by_owner_created", ["ownerId", "createdAt"]),

  // Immutable factual-review receipt created only after the actual script,
  // narration/TTS, Story Spine, and Episode Graph have all completed. The row
  // stores identities/hashes, never mutable browser review data. The raw
  // source-data ledger remains its authority; a derived editorial packet is
  // not sufficient for Phase I admission or resume.
  factualReviewCheckpoints: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    version: v.literal("factual-review-checkpoint/v1"),
    invocationSha256: v.string(),
    sourceAuthority: v.object({
      authorityKind: v.literal("data_story_source_ledger"),
      authorityContentFingerprint: v.string(),
      rawLedgerFingerprint: v.string(),
      reviewedPackId: v.id("reviewedEvidencePacks"),
      reviewedPackContentFingerprint: v.string(),
      routeSeedFingerprint: v.string(),
      topicFingerprint: v.string(),
      showProfileFingerprint: v.string(),
      selectedCapabilityKeys: v.array(v.string()),
    }),
    artifacts: v.array(v.object({
      key: v.string(),
      artifactId: v.string(),
      payloadHash: v.string(),
      producerModule: v.string(),
      producerVersion: v.string(),
      schemaVersion: v.string(),
    })),
    checkpointFingerprint: v.string(),
    decision: v.union(
      v.literal("awaiting"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("blocked"),
    ),
    createdAt: v.number(),
    reviewerId: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    rejectedAt: v.optional(v.number()),
    blockedAt: v.optional(v.number()),
    blockedReason: v.optional(v.string()),
    approvalFingerprint: v.optional(v.string()),
  })
    .index("by_run", ["runId"])
    .index("by_owner_decision", ["ownerId", "decision"])
    .index("by_owner_created", ["ownerId", "createdAt"]),

  // A reusable, immutable owner-scoped factual-evidence handoff. This is
  // deliberately not a pipeline input by itself: it persists a fresh
  // human-approved source authority, frozen route seed, and sealed Show
  // Profile/capability projection for a later explicitly supervised consumer.
  // No row in this table may dispatch a provider, render, run, release, or
  // publish action without a separate policy-specific admission path.
  reviewedEvidencePacks: defineTable({
    ownerId: v.string(),
    contentFingerprint: v.string(),
    routeSeedFingerprint: v.string(),
    topicFingerprint: v.string(),
    authorityContentFingerprint: v.string(),
    routeKey: v.string(),
    family: v.string(),
    contentLaneKey: v.string(),
    showProfileFingerprint: v.string(),
    capabilityFingerprint: v.string(),
    selectedCapabilityKeys: v.array(v.string()),
    authorityKind: v.union(
      v.literal("editorial_evidence_packet"),
      v.literal("data_story_source_ledger"),
    ),
    // Editorial authority is valid only when this is a durable owner-owned
    // receipt. Data-story ledger authority intentionally keeps its separately
    // validated immutable ledger directly in the pack instead.
    editorialEvidencePacketId: v.optional(v.id("editorialEvidencePackets")),
    reviewerId: v.string(),
    reviewId: v.string(),
    reviewedAt: v.string(),
    reviewedEvidenceRouteBindingFingerprint: v.optional(v.string()),
    /** Full engine-validated immutable receipt; no browser/result payload shape. */
    pack: v.any(),
    createdAt: v.number(),
  })
    .index("by_owner_review", ["ownerId", "reviewId"])
    .index("by_owner_content", ["ownerId", "contentFingerprint"])
    .index("by_owner_route_profile", ["ownerId", "routeSeedFingerprint", "showProfileFingerprint"])
    .index("by_owner_authority", ["ownerId", "authorityContentFingerprint"])
    .index("by_owner_created", ["ownerId", "createdAt"]),

  // SPEND LEDGER for the automatic Casefile case-research path
  // (`src/engine/casefileCaseResearcher.ts`'s `researchCase()`, dispatched by
  // `generation-scheduler`). That call spends real money — one live
  // Browserbase/Stagehand session per `searchWeb()` plus an Anthropic
  // semantic-verification call per critique iteration — BEFORE
  // `run-pipeline` starts, so it is structurally outside every
  // `invocation.budgetUsd` check the rest of the system enforces. One row is
  // written per billable dispatch attempt (success OR fail-closed research
  // failure; a genuinely skipped/ineligible dispatch costs nothing and is
  // never recorded). The scheduler counts today's rows across ALL channels
  // and refuses to research past the configured ceiling.
  casefileResearchAttempts: defineTable({
    ownerId: v.string(),
    channelId: v.id("channels"),
    /** UTC day bucket, "YYYY-MM-DD". Counting key — never a display value. */
    day: v.string(),
    attemptedAt: v.number(),
  })
    .index("by_owner_day", ["ownerId", "day"])
    .index("by_channel_day", ["channelId", "day"]),

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
