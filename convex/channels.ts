import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { moduleSurface, configurableModules } from "@/engine/moduleRegistry";
import { validateKnobs, type KnobValues, type KnobValue } from "@/engine/customization";

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
  imageKey: v.optional(v.string()),
  bannerKey: v.optional(v.string()),
  thumbnailIdentity: v.optional(
    v.object({
      colorPalette: v.array(v.string()),
      visualStyle: v.string(),
      textPosition: v.string(),
      avoid: v.array(v.string()),
    }),
  ),
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
});

// "banana" = the engine (src/lib/banana.ts); "title_card" = explicit operator
// choice. claude_flux/ideogram are retired engines kept for existing rows.
const thumbnailerValidator = v.union(
  v.literal("banana"),
  v.literal("title_card"),
  v.literal("claude_flux"),
  v.literal("ideogram"),
);

const pipelineValidator = v.array(
  v.object({
    block: v.string(),
    params: v.optional(v.any()),
  }),
);

/**
 * Validate ONE module's operator config (`{ preset?, ...knobValues }`) against
 * its CustomizationSurface. Returns the cleaned config (preset preserved,
 * knob values defaulted/validated) or throws on illegal preset/value — so no
 * silent bad config is ever written. Unknown blockId (no surface) ⇒ rejected.
 */
function validateModuleConfig(
  blockId: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const surface = moduleSurface(blockId);
  if (!surface) throw new Error(`setModuleConfig: unknown/non-configurable module '${blockId}'`);

  const { preset, ...rest } = config as { preset?: unknown } & Record<string, unknown>;
  if (preset !== undefined) {
    if (typeof preset !== "string" || !(preset in surface.presets)) {
      throw new Error(`setModuleConfig: '${blockId}' has no preset '${String(preset)}'`);
    }
  }
  // Only knob-typed scalars are validatable; reject anything else loudly.
  const knobValues: KnobValues = {};
  for (const [k, val] of Object.entries(rest)) {
    if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
      knobValues[k] = val as KnobValue;
    } else {
      throw new Error(`setModuleConfig: '${blockId}.${k}' is not a scalar knob value`);
    }
  }
  const r = validateKnobs(surface, knobValues);
  if (!r.ok) throw new Error(`setModuleConfig: '${blockId}' invalid — ${r.errors.join("; ")}`);

  // Store ONLY the operator's explicit choices (preset + overrides), not the
  // full defaulted bag — resolveKnobs re-applies defaults at read time.
  const cleaned: Record<string, unknown> = {};
  if (typeof preset === "string") cleaned.preset = preset;
  for (const k of Object.keys(knobValues)) cleaned[k] = knobValues[k];
  return cleaned;
}

/** Validate a whole `moduleConfig` map; drops blocks that aren't configurable. */
function validateModuleConfigMap(
  map: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!map) return undefined;
  const configurable = new Set(configurableModules().map((m) => m.blockId));
  const out: Record<string, unknown> = {};
  for (const [blockId, cfg] of Object.entries(map)) {
    if (!configurable.has(blockId)) continue; // ignore stale/unknown blocks silently
    if (cfg && typeof cfg === "object") {
      out[blockId] = validateModuleConfig(blockId, cfg as Record<string, unknown>);
    }
  }
  return Object.keys(out).length ? out : undefined;
}

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
    styleDNA: v.optional(v.any()),
    // Initial per-module operator config from the onboarding "Pipeline style"
    // step: { [blockId]: { preset?, ...knobValues } }. Validated per block
    // against its CustomizationSurface (illegal config dropped, never stored).
    moduleConfig: v.optional(v.record(v.string(), v.any())),
    budget: v.number(),
    status: v.optional(v.string()),
    groupId: v.optional(v.string()),
    language: v.optional(v.string()),
    groupRole: v.optional(v.string()),
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
      styleDNA: args.styleDNA,
      // Validate the onboarding-supplied module config (illegal → throws).
      moduleConfig: validateModuleConfigMap(args.moduleConfig),
      budget: args.budget,
      status: args.status ?? "draft",
      groupId: args.groupId,
      language: args.language,
      groupRole: args.groupRole,
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
    const ch = await ctx.db.get(args.channelId);
    if (!ch) return null;

    // 1. TOMBSTONE: a compact structural print (identity/pipeline/DNA/playbook
    // shapes — never run data or media) survives as the only residue.
    const compact = {
      name: ch.name,
      slug: ch.slug,
      template: ch.template,
      folder: ch.folder,
      identity: ch.identity,
      pipeline: ch.pipeline,
      schedule: ch.schedule,
      styleDNA: ch.styleDNA,
      architectReport: ch.architectReport
        ? { summary: (ch.architectReport as { summary?: string }).summary, applied: (ch.architectReport as { applied?: unknown[] }).applied }
        : undefined,
      thumbnailPlaybook: ch.thumbnailPlaybook
        ? { rules: (ch.thumbnailPlaybook as { rules?: unknown }).rules, patterns: (ch.thumbnailPlaybook as { patterns?: unknown }).patterns }
        : undefined,
      scriptPlaybook: ch.scriptPlaybook
        ? {
            hookRules: (ch.scriptPlaybook as { hookRules?: unknown }).hookRules,
            openingDevices: (ch.scriptPlaybook as { openingDevices?: unknown }).openingDevices,
            voiceRules: (ch.scriptPlaybook as { voiceRules?: unknown }).voiceRules,
          }
        : undefined,
      youtubeCreated: ch.youtubeCreated,
    };
    let snapshot = JSON.stringify(compact);
    if (snapshot.length > 60_000) {
      snapshot = JSON.stringify({ ...compact, styleDNA: undefined, thumbnailPlaybook: undefined, scriptPlaybook: undefined });
    }
    await ctx.db.insert("channelArchives", {
      ownerId: ch.ownerId,
      slug: ch.slug,
      name: ch.name,
      archivedAt: Date.now(),
      snapshot,
    });

    // 2. CASCADE: remove every row that references the channel — runs and
    // their stages/logs/assets, plan, topic memory, analytics, the YT link.
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .collect();
    for (const r of runs) {
      for (const s of await ctx.db.query("runStages").withIndex("by_run", (q) => q.eq("runId", r._id)).collect()) {
        await ctx.db.delete(s._id);
      }
      for (const lg of await ctx.db.query("runLogs").withIndex("by_run", (q) => q.eq("runId", r._id)).collect()) {
        await ctx.db.delete(lg._id);
      }
      await ctx.db.delete(r._id);
    }
    const sweep = async (table: "assets" | "topicMemory" | "videoAnalytics" | "channelAnalytics" | "contentPlan" | "youtubeAuth", index: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await (ctx.db.query(table as any) as any)
        .withIndex(index, (q: { eq: (f: string, v: unknown) => unknown }) => q.eq("channelId", args.channelId))
        .collect();
      for (const row of rows as { _id: Parameters<typeof ctx.db.delete>[0] }[]) await ctx.db.delete(row._id);
    };
    await sweep("assets", "by_channel");
    await sweep("topicMemory", "by_channel");
    await sweep("videoAnalytics", "by_channel");
    await sweep("channelAnalytics", "by_channel_date");
    await sweep("contentPlan", "by_channel_order");
    await sweep("youtubeAuth", "by_channel");

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
    styleDNA: v.optional(v.any()),
    architectReport: v.optional(v.any()),
    thumbnailPlaybook: v.optional(v.any()),
    scriptPlaybook: v.optional(v.any()),
    // Folder filing ("" = unfile).
    folder: v.optional(v.string()),
    budget: v.optional(v.number()),
    status: v.optional(v.string()),
    schedule: v.optional(
      v.object({ frequency: v.string(), days: v.optional(v.array(v.number())) }),
    ),
    groupId: v.optional(v.string()),
    language: v.optional(v.string()),
    groupRole: v.optional(v.string()),
    youtubeCreated: v.optional(
      v.object({
        ytChannelId: v.optional(v.string()),
        handle: v.optional(v.string()),
        url: v.optional(v.string()),
        createdAt: v.number(),
        status: v.optional(v.string()),
        avatarSet: v.optional(v.boolean()),
      }),
    ),
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
    // "" means UNFILE (optional args can't carry null).
    if (rest.folder === "") patch.folder = undefined;
    await ctx.db.patch(channelId, patch);
    return null;
  },
});

/**
 * Set ONE module's operator config on a channel. Validates `config`
 * (`{ preset?, ...knobValues }`) against the module's CustomizationSurface via
 * validateKnobs BEFORE writing — an illegal preset/knob throws and nothing is
 * persisted (no silent bad config). Powers the Settings "Pipeline modules"
 * section ("toggle captions with a click") + the onboarding step.
 *
 * Pass an empty object (`{}`) to reset the block to module defaults (the entry
 * is removed from moduleConfig, so resolveKnobs falls back to its preset/defaults).
 */
export const setModuleConfig = mutation({
  args: {
    channelId: v.id("channels"),
    blockId: v.string(),
    config: v.record(v.string(), v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.channelId);
    if (!existing) throw new Error(`channel not found: ${args.channelId}`);

    const next: Record<string, unknown> = { ...(existing.moduleConfig ?? {}) };
    const cleaned = validateModuleConfig(args.blockId, args.config); // throws on illegal
    if (Object.keys(cleaned).length === 0) {
      delete next[args.blockId]; // reset → fall back to defaults at read time
    } else {
      next[args.blockId] = cleaned;
    }
    await ctx.db.patch(args.channelId, {
      moduleConfig: Object.keys(next).length ? next : undefined,
    });
    return null;
  },
});

/** All channels in a multi-language group (base + siblings), for the group UI. */
export const listGroup = query({
  args: { groupId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("channels")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
  },
});
