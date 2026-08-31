import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import {
  acceptCharacterLoRARegistryEntry,
  assertCharacterSheetDatasetBinding,
  CHARACTER_LORA_REGISTRY_VERSION,
  CHARACTER_SHEET_DATASET_VERSION,
  characterLoRARegistryIdentity,
  CharacterLoRARegistryEntrySchema,
  CharacterLoRATrainingRequestSchema,
  CharacterSheetDatasetManifestSchema,
  CharacterSheetDatasetPlanSchema,
  NARRATIVE_SERIES_INTELLIGENCE_VERSION,
  NarrativeEpisodeSeriesBindingSchema,
  NarrativeSeriesPlanSchema,
  NarrativeShotControlContractSchema,
} from "@/engine/narrativeSeriesIntelligence";
import { canonicalJson } from "@/lib/canonicalJson";

/**
 * Durable, provider-neutral state for planned narrative series and character
 * identity adapters. This module intentionally only stores independently
 * verified contracts. It never submits a training job, calls a renderer, or
 * treats a training request as a provider invocation.
 */

const NARRATIVE_EPISODE_RECEIPT_VERSION = "narrative-episode-receipt/v1" as const;
const MAX_CONTRACT_BYTES = 750_000;

const trainingRequestResult = v.union(
  v.object({
    kind: v.literal("recorded"),
    trainingRequestId: v.id("characterLoRATrainingRequests"),
    registryIdentity: v.string(),
  }),
  v.object({
    kind: v.literal("wait_for_existing"),
    trainingRequestId: v.id("characterLoRATrainingRequests"),
    registryIdentity: v.string(),
  }),
  v.object({
    kind: v.literal("reuse_accepted"),
    registryEntryId: v.id("characterLoRARegistryEntries"),
    registryIdentity: v.string(),
  }),
);

function assertFingerprint(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`narrativeSeriesState: ${label} must be a lowercase SHA-256 fingerprint`);
  }
}

function assertSafeOwnerId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 320 || /[\u0000-\u001f]/.test(value)) {
    throw new Error("narrativeSeriesState: invalid owner identity");
  }
}

function assertContractSize(value: unknown, label: string): void {
  const bytes = new TextEncoder().encode(canonicalJson(value)).byteLength;
  if (bytes > MAX_CONTRACT_BYTES) {
    throw new Error(`narrativeSeriesState: ${label} exceeds the durable contract size limit`);
  }
}

function sameFrozenContract(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

async function requireOwnedChannel(
  ctx: Pick<MutationCtx | QueryCtx, "db">,
  ownerId: string,
  channelId: Id<"channels">,
  purpose: string,
) {
  const channel = await ctx.db.get(channelId);
  if (!channel || channel.ownerId !== ownerId) {
    throw new Error(`narrativeSeriesState: ${purpose} channel ownership mismatch`);
  }
  return channel;
}

async function requireOwnedRun(
  ctx: Pick<MutationCtx | QueryCtx, "db">,
  ownerId: string,
  channelId: Id<"channels">,
  runId: Id<"runs">,
  purpose: string,
) {
  const run = await ctx.db.get(runId);
  if (!run || run.ownerId !== ownerId || run.channelId !== channelId) {
    throw new Error(`narrativeSeriesState: ${purpose} run ownership/channel mismatch`);
  }
  return run;
}

function assertPlanOwnership(value: unknown, ownerId: string, channelId: Id<"channels">) {
  assertContractSize(value, "narrative series plan");
  const plan = NarrativeSeriesPlanSchema.parse(value);
  if (plan.accountId !== ownerId || plan.channelId !== String(channelId)) {
    throw new Error("narrativeSeriesState: narrative series plan is not bound to the requested owner and channel");
  }
  assertFingerprint(plan.fingerprint, "narrative series plan fingerprint");
  return plan;
}

function assertDatasetPlanOwnership(value: unknown, ownerId: string, channelId: Id<"channels">) {
  assertContractSize(value, "character-sheet dataset plan");
  const plan = CharacterSheetDatasetPlanSchema.parse(value);
  if (plan.accountId !== ownerId || plan.channelId !== String(channelId)) {
    throw new Error("narrativeSeriesState: character-sheet plan is not bound to the requested owner and channel");
  }
  assertFingerprint(plan.fingerprint, "character-sheet plan fingerprint");
  return plan;
}

function assertDatasetManifestOwnership(value: unknown, ownerId: string, channelId: Id<"channels">) {
  assertContractSize(value, "character-sheet dataset manifest");
  const manifest = CharacterSheetDatasetManifestSchema.parse(value);
  if (manifest.accountId !== ownerId || manifest.channelId !== String(channelId)) {
    throw new Error("narrativeSeriesState: character-sheet dataset is not bound to the requested owner and channel");
  }
  assertFingerprint(manifest.fingerprint, "character-sheet dataset fingerprint");
  return manifest;
}

function assertImmutablePlanRow(row: { readonly plan: unknown; readonly fingerprint: string }, plan: unknown): void {
  const stored = NarrativeSeriesPlanSchema.parse(row.plan);
  if (stored.fingerprint !== row.fingerprint || !sameFrozenContract(stored, plan)) {
    throw new Error("narrativeSeriesState: immutable narrative series plan conflict");
  }
}

function assertImmutableDatasetPlanRow(row: { readonly plan: unknown; readonly planFingerprint: string }, plan: unknown): void {
  const stored = CharacterSheetDatasetPlanSchema.parse(row.plan);
  if (stored.fingerprint !== row.planFingerprint || !sameFrozenContract(stored, plan)) {
    throw new Error("narrativeSeriesState: immutable character-sheet plan conflict");
  }
}

function assertImmutableDatasetRow(row: { readonly manifest: unknown; readonly datasetFingerprint: string }, manifest: unknown): void {
  const stored = CharacterSheetDatasetManifestSchema.parse(row.manifest);
  if (stored.fingerprint !== row.datasetFingerprint || !sameFrozenContract(stored, manifest)) {
    throw new Error("narrativeSeriesState: immutable character-sheet dataset conflict");
  }
}

function assertImmutableTrainingRequestRow(
  row: { readonly request: unknown; readonly requestFingerprint: string },
  request: unknown,
): void {
  const stored = CharacterLoRATrainingRequestSchema.parse(row.request);
  if (stored.fingerprint !== row.requestFingerprint || !sameFrozenContract(stored, request)) {
    throw new Error("narrativeSeriesState: immutable character LoRA training request conflict");
  }
}

function assertRegistryRowIntegrity(row: { readonly entry: unknown; readonly registryIdentity: string }) {
  const entry = CharacterLoRARegistryEntrySchema.parse(row.entry);
  const acceptedAdapter = entry.acceptedAdapter;
  if (entry.status !== "accepted" || entry.registryIdentity !== row.registryIdentity || !acceptedAdapter) {
    throw new Error("narrativeSeriesState: accepted character LoRA registry row is corrupt");
  }
  // Zod's cross-field refinement is runtime-safe but does not narrow the
  // optional field for TypeScript. Return the proven adapter explicitly so
  // inventory projections can never accidentally expose an undefined receipt.
  return Object.freeze({ ...entry, acceptedAdapter });
}

function sameAcceptedEntry(
  existing: ReturnType<typeof CharacterLoRARegistryEntrySchema.parse>,
  incoming: ReturnType<typeof CharacterLoRARegistryEntrySchema.parse>,
): boolean {
  return existing.registryIdentity === incoming.registryIdentity
    && existing.accountId === incoming.accountId
    && existing.channelId === incoming.channelId
    && existing.characterId === incoming.characterId
    && existing.characterSpecFingerprint === incoming.characterSpecFingerprint
    && existing.datasetFingerprint === incoming.datasetFingerprint
    && existing.trainingRequestFingerprint === incoming.trainingRequestFingerprint
    && existing.status === incoming.status
    && sameFrozenContract(existing.acceptedAdapter, incoming.acceptedAdapter);
}

/** Owner-scoped read of one immutable narrative planning horizon. */
export const getSeriesPlan = query({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    fingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    assertSafeOwnerId(args.ownerId);
    assertFingerprint(args.fingerprint, "narrative series plan fingerprint");
    const row = await ctx.db
      .query("narrativeSeriesPlans")
      .withIndex("by_channel_fingerprint", (q) =>
        q.eq("channelId", args.channelId).eq("fingerprint", args.fingerprint),
      )
      .unique();
    if (row && row.ownerId !== args.ownerId) {
      throw new Error("narrativeSeriesState: narrative series plan owner mismatch");
    }
    return row;
  },
});

/** Owner-scoped read of the frozen per-run visual-continuity handoff. */
export const getEpisodeReceiptForRun = query({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    assertSafeOwnerId(args.ownerId);
    const row = await ctx.db
      .query("narrativeEpisodeReceipts")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .unique();
    if (row && (row.ownerId !== args.ownerId || row.channelId !== args.channelId)) {
      throw new Error("narrativeSeriesState: narrative episode receipt owner/channel mismatch");
    }
    return row;
  },
});

/** Owner-scoped lookup of the accepted reusable LoRA for a character specification. */
export const getAcceptedCharacterLoRA = query({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    characterId: v.string(),
    characterSpecFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    assertSafeOwnerId(args.ownerId);
    assertFingerprint(args.characterSpecFingerprint, "character specification fingerprint");
    const rows = await ctx.db
      .query("characterLoRARegistryEntries")
      .withIndex("by_channel_character_spec", (q) =>
        q.eq("channelId", args.channelId)
          .eq("characterId", args.characterId)
          .eq("characterSpecFingerprint", args.characterSpecFingerprint),
      )
      .collect();
    if (rows.length > 1) {
      throw new Error("narrativeSeriesState: duplicate accepted character LoRA entries for one character specification");
    }
    const row = rows[0] ?? null;
    if (row && row.ownerId !== args.ownerId) {
      throw new Error("narrativeSeriesState: accepted character LoRA owner mismatch");
    }
    return row;
  },
});

/**
 * Service-only insert-if-absent. A plan is frozen by its contract fingerprint;
 * a retry may return the original row, but it can never edit a horizon in
 * place.
 */
export const recordSeriesPlan = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    plan: v.any(),
  },
  returns: v.id("narrativeSeriesPlans"),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "narrative series plan persistence");
    assertSafeOwnerId(args.ownerId);
    await requireOwnedChannel(ctx, args.ownerId, args.channelId, "narrative series plan persistence");
    const plan = assertPlanOwnership(args.plan, args.ownerId, args.channelId);
    const existing = await ctx.db
      .query("narrativeSeriesPlans")
      .withIndex("by_channel_fingerprint", (q) =>
        q.eq("channelId", args.channelId).eq("fingerprint", plan.fingerprint),
      )
      .unique();
    if (existing) {
      if (existing.ownerId !== args.ownerId || existing.accountId !== plan.accountId) {
        throw new Error("narrativeSeriesState: narrative series plan ownership conflict");
      }
      assertImmutablePlanRow(existing, plan);
      return existing._id;
    }
    return await ctx.db.insert("narrativeSeriesPlans", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      accountId: plan.accountId,
      version: NARRATIVE_SERIES_INTELLIGENCE_VERSION,
      fingerprint: plan.fingerprint,
      seriesIdentity: plan.seriesIdentity,
      seriesTitle: plan.seriesTitle,
      programBriefFingerprint: plan.programBriefFingerprint,
      visualStyle: plan.visualStyle,
      plan,
      createdAt: Date.now(),
    });
  },
});

/**
 * Service-only per-run receipt. The receipt binds a pre-existing frozen plan,
 * a completed serialized-episode context, and a renderer-neutral shot-control
 * contract. No render adapter is selected or invoked here.
 */
/**
 * Browser-safe inventory projection for the owner-facing Studio library.
 * This deliberately excludes adapterReference, dataset artifact keys, and
 * raw provider payloads: a visible identity registry row is not a model
 * download, path disclosure, or render permission.
 */
export const listAcceptedCharacterLoRAsForOwner = query({
  args: {
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "accepted character LoRA Studio inventory");
    assertSafeOwnerId(args.ownerId);
    const rows = await ctx.db
      .query("characterLoRARegistryEntries")
      .withIndex("by_owner_accepted", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    return rows.map((row) => {
      const entry = assertRegistryRowIntegrity(row);
      return {
        registryIdentity: entry.registryIdentity,
        characterId: entry.characterId,
        characterSpecFingerprint: entry.characterSpecFingerprint,
        datasetFingerprint: entry.datasetFingerprint,
        provider: entry.acceptedAdapter.provider,
        adapterFlavor: entry.acceptedAdapter.adapterFlavor,
        runtimeProfileFingerprint: entry.acceptedAdapter.runtimeProfileFingerprint,
        acceptedAt: entry.createdAt,
      };
    });
  },
});

export const recordEpisodeReceipt = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    seriesPlanFingerprint: v.string(),
    episodeBinding: v.any(),
    shotControl: v.any(),
  },
  returns: v.id("narrativeEpisodeReceipts"),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "narrative episode receipt persistence");
    assertSafeOwnerId(args.ownerId);
    assertFingerprint(args.seriesPlanFingerprint, "narrative series plan fingerprint");
    await requireOwnedChannel(ctx, args.ownerId, args.channelId, "narrative episode receipt persistence");
    await requireOwnedRun(ctx, args.ownerId, args.channelId, args.runId, "narrative episode receipt persistence");
    assertContractSize(args.episodeBinding, "narrative episode binding");
    assertContractSize(args.shotControl, "narrative shot-control contract");
    const episodeBinding = NarrativeEpisodeSeriesBindingSchema.parse(args.episodeBinding);
    const shotControl = NarrativeShotControlContractSchema.parse(args.shotControl);
    if (
      episodeBinding.seriesPlanFingerprint !== args.seriesPlanFingerprint
      || shotControl.episodeBindingFingerprint !== episodeBinding.fingerprint
    ) {
      throw new Error("narrativeSeriesState: per-run narrative receipt fingerprints are not mutually bound");
    }
    const planRow = await ctx.db
      .query("narrativeSeriesPlans")
      .withIndex("by_channel_fingerprint", (q) =>
        q.eq("channelId", args.channelId).eq("fingerprint", args.seriesPlanFingerprint),
      )
      .unique();
    if (!planRow || planRow.ownerId !== args.ownerId) {
      throw new Error("narrativeSeriesState: per-run narrative receipt requires its immutable owner-owned series plan");
    }
    const plan = assertPlanOwnership(planRow.plan, args.ownerId, args.channelId);
    const plannedEpisode = plan.episodes.find((episode) => episode.id === episodeBinding.plannedEpisodeId);
    if (!plannedEpisode || plannedEpisode.episodeNumber !== episodeBinding.episodeNumber) {
      throw new Error("narrativeSeriesState: episode binding does not refer to an episode inside its frozen series plan");
    }
    const serializedRows = await ctx.db
      .query("serializedProgramEpisodes")
      .withIndex("by_channel_series_run", (q) =>
        q.eq("channelId", args.channelId)
          .eq("seriesIdentity", plan.seriesIdentity)
          .eq("runId", args.runId),
      )
      .collect();
    if (serializedRows.length !== 1) {
      throw new Error("narrativeSeriesState: per-run narrative receipt requires exactly one serialized episode receipt");
    }
    const serialized = serializedRows[0]!;
    if (
      serialized.ownerId !== args.ownerId
      || serialized.status !== "completed"
      || serialized.episodeNumber !== episodeBinding.episodeNumber
      || serialized.serializedProgramEpisodeContext?.fingerprint !== episodeBinding.serializedEpisodeContextFingerprint
    ) {
      throw new Error("narrativeSeriesState: episode binding is not backed by the completed frozen serialized-episode context");
    }
    const existing = await ctx.db
      .query("narrativeEpisodeReceipts")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .unique();
    if (existing) {
      const same = existing.ownerId === args.ownerId
        && existing.channelId === args.channelId
        && existing.seriesPlanFingerprint === args.seriesPlanFingerprint
        && existing.episodeBindingFingerprint === episodeBinding.fingerprint
        && existing.shotControlFingerprint === shotControl.fingerprint
        && sameFrozenContract(existing.episodeBinding, episodeBinding)
        && sameFrozenContract(existing.shotControl, shotControl);
      if (!same) throw new Error("narrativeSeriesState: immutable per-run narrative receipt conflict");
      return existing._id;
    }
    return await ctx.db.insert("narrativeEpisodeReceipts", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      runId: args.runId,
      version: NARRATIVE_EPISODE_RECEIPT_VERSION,
      seriesPlanFingerprint: args.seriesPlanFingerprint,
      episodeBindingFingerprint: episodeBinding.fingerprint,
      shotControlFingerprint: shotControl.fingerprint,
      episodeNumber: episodeBinding.episodeNumber,
      plannedEpisodeId: episodeBinding.plannedEpisodeId,
      visualStyle: shotControl.visualStyle,
      episodeBinding,
      shotControl,
      createdAt: Date.now(),
    });
  },
});

/** Service-only immutable character-sheet planning receipt. */
export const recordCharacterSheetDatasetPlan = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    plan: v.any(),
  },
  returns: v.id("characterSheetDatasetPlans"),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "character-sheet plan persistence");
    assertSafeOwnerId(args.ownerId);
    await requireOwnedChannel(ctx, args.ownerId, args.channelId, "character-sheet plan persistence");
    const plan = assertDatasetPlanOwnership(args.plan, args.ownerId, args.channelId);
    const existing = await ctx.db
      .query("characterSheetDatasetPlans")
      .withIndex("by_channel_plan_fingerprint", (q) =>
        q.eq("channelId", args.channelId).eq("planFingerprint", plan.fingerprint),
      )
      .unique();
    if (existing) {
      if (existing.ownerId !== args.ownerId || existing.accountId !== plan.accountId) {
        throw new Error("narrativeSeriesState: character-sheet plan ownership conflict");
      }
      assertImmutableDatasetPlanRow(existing, plan);
      return existing._id;
    }
    return await ctx.db.insert("characterSheetDatasetPlans", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      accountId: plan.accountId,
      version: CHARACTER_SHEET_DATASET_VERSION,
      planFingerprint: plan.fingerprint,
      channelPolicyFingerprint: plan.channelPolicyFingerprint,
      characterId: plan.character.characterId,
      characterSpecFingerprint: plan.characterSpecFingerprint,
      scriptTreatmentFingerprint: plan.scriptTreatmentFingerprint,
      plan,
      createdAt: Date.now(),
    });
  },
});

/** Service-only immutable dataset manifest after its assets/rights are independently verified. */
export const recordCharacterSheetDataset = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    sheetPlanFingerprint: v.string(),
    manifest: v.any(),
  },
  returns: v.id("characterSheetDatasets"),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "character-sheet dataset persistence");
    assertSafeOwnerId(args.ownerId);
    assertFingerprint(args.sheetPlanFingerprint, "character-sheet plan fingerprint");
    await requireOwnedChannel(ctx, args.ownerId, args.channelId, "character-sheet dataset persistence");
    const manifest = assertDatasetManifestOwnership(args.manifest, args.ownerId, args.channelId);
    if (manifest.sheetPlanFingerprint !== args.sheetPlanFingerprint) {
      throw new Error("narrativeSeriesState: dataset manifest does not bind the requested character-sheet plan");
    }
    const planRow = await ctx.db
      .query("characterSheetDatasetPlans")
      .withIndex("by_channel_plan_fingerprint", (q) =>
        q.eq("channelId", args.channelId).eq("planFingerprint", args.sheetPlanFingerprint),
      )
      .unique();
    if (!planRow || planRow.ownerId !== args.ownerId) {
      throw new Error("narrativeSeriesState: character-sheet dataset requires its immutable owner-owned plan");
    }
    const plan = assertDatasetPlanOwnership(planRow.plan, args.ownerId, args.channelId);
    assertCharacterSheetDatasetBinding({ plan, manifest });
    const existing = await ctx.db
      .query("characterSheetDatasets")
      .withIndex("by_channel_dataset_fingerprint", (q) =>
        q.eq("channelId", args.channelId).eq("datasetFingerprint", manifest.fingerprint),
      )
      .unique();
    if (existing) {
      if (existing.ownerId !== args.ownerId || existing.accountId !== manifest.accountId) {
        throw new Error("narrativeSeriesState: character-sheet dataset ownership conflict");
      }
      assertImmutableDatasetRow(existing, manifest);
      return existing._id;
    }
    return await ctx.db.insert("characterSheetDatasets", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      accountId: manifest.accountId,
      version: CHARACTER_SHEET_DATASET_VERSION,
      datasetFingerprint: manifest.fingerprint,
      sheetPlanFingerprint: manifest.sheetPlanFingerprint,
      characterId: manifest.characterId,
      manifest,
      createdAt: Date.now(),
    });
  },
});

/**
 * Service-only one-time admission ledger. A matching accepted adapter is
 * returned for reuse; a pending request for the same character specification
 * is returned for waiting. Neither path can submit a provider job.
 */
export const recordCharacterLoRATrainingRequest = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    sheetPlanFingerprint: v.string(),
    datasetFingerprint: v.string(),
    request: v.any(),
  },
  returns: trainingRequestResult,
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "character LoRA training request persistence");
    assertSafeOwnerId(args.ownerId);
    assertFingerprint(args.sheetPlanFingerprint, "character-sheet plan fingerprint");
    assertFingerprint(args.datasetFingerprint, "character-sheet dataset fingerprint");
    await requireOwnedChannel(ctx, args.ownerId, args.channelId, "character LoRA training request persistence");
    assertContractSize(args.request, "character LoRA training request");
    const request = CharacterLoRATrainingRequestSchema.parse(args.request);
    assertFingerprint(request.fingerprint, "character LoRA training request fingerprint");
    if (
      request.accountId !== args.ownerId
      || request.channelId !== String(args.channelId)
      || request.sheetPlanFingerprint !== args.sheetPlanFingerprint
      || request.datasetFingerprint !== args.datasetFingerprint
      || request.providerInvocation !== "not_started"
    ) {
      throw new Error("narrativeSeriesState: character LoRA training request is not bound to this owner/channel/dataset and must not have been invoked");
    }
    const [planRow, datasetRow] = await Promise.all([
      ctx.db
        .query("characterSheetDatasetPlans")
        .withIndex("by_channel_plan_fingerprint", (q) =>
          q.eq("channelId", args.channelId).eq("planFingerprint", args.sheetPlanFingerprint),
        )
        .unique(),
      ctx.db
        .query("characterSheetDatasets")
        .withIndex("by_channel_dataset_fingerprint", (q) =>
          q.eq("channelId", args.channelId).eq("datasetFingerprint", args.datasetFingerprint),
        )
        .unique(),
    ]);
    if (!planRow || !datasetRow || planRow.ownerId !== args.ownerId || datasetRow.ownerId !== args.ownerId) {
      throw new Error("narrativeSeriesState: character LoRA request requires owner-owned immutable plan and dataset records");
    }
    const plan = assertDatasetPlanOwnership(planRow.plan, args.ownerId, args.channelId);
    const dataset = assertDatasetManifestOwnership(datasetRow.manifest, args.ownerId, args.channelId);
    assertCharacterSheetDatasetBinding({ plan, manifest: dataset });
    const expectedRegistryIdentity = characterLoRARegistryIdentity({
      accountId: plan.accountId,
      channelId: plan.channelId,
      characterId: plan.character.characterId,
      characterSpecFingerprint: plan.characterSpecFingerprint,
      datasetFingerprint: dataset.fingerprint,
    });
    if (
      request.registryIdentity !== expectedRegistryIdentity
      || request.characterId !== plan.character.characterId
      || request.characterSpecFingerprint !== plan.characterSpecFingerprint
      || request.channelPolicyFingerprint !== plan.channelPolicyFingerprint
    ) {
      throw new Error("narrativeSeriesState: character LoRA request does not match its frozen character-sheet dataset binding");
    }
    const exactRequest = await ctx.db
      .query("characterLoRATrainingRequests")
      .withIndex("by_request_fingerprint", (q) => q.eq("requestFingerprint", request.fingerprint))
      .unique();
    if (exactRequest) {
      if (exactRequest.ownerId !== args.ownerId || exactRequest.channelId !== args.channelId) {
        throw new Error("narrativeSeriesState: character LoRA request fingerprint ownership conflict");
      }
      assertImmutableTrainingRequestRow(exactRequest, request);
    }
    const acceptedRows = await ctx.db
      .query("characterLoRARegistryEntries")
      .withIndex("by_channel_character_spec", (q) =>
        q.eq("channelId", args.channelId)
          .eq("characterId", request.characterId)
          .eq("characterSpecFingerprint", request.characterSpecFingerprint),
      )
      .collect();
    if (acceptedRows.length > 1) {
      throw new Error("narrativeSeriesState: duplicate accepted LoRAs exist for one character specification");
    }
    const acceptedRow = acceptedRows[0];
    if (acceptedRow) {
      const accepted = assertRegistryRowIntegrity(acceptedRow);
      if (accepted.accountId !== args.ownerId || accepted.channelId !== String(args.channelId)) {
        throw new Error("narrativeSeriesState: accepted LoRA ownership conflict");
      }
      return {
        kind: "reuse_accepted" as const,
        registryEntryId: acceptedRow._id,
        registryIdentity: accepted.registryIdentity,
      };
    }
    const pendingRows = await ctx.db
      .query("characterLoRATrainingRequests")
      .withIndex("by_channel_character_spec", (q) =>
        q.eq("channelId", args.channelId)
          .eq("characterId", request.characterId)
          .eq("characterSpecFingerprint", request.characterSpecFingerprint),
      )
      .collect();
    const pending = pendingRows.find((row) => row.status === "admitted");
    if (pending) {
      if (pending.ownerId !== args.ownerId) {
        throw new Error("narrativeSeriesState: pending character LoRA request ownership conflict");
      }
      return {
        kind: "wait_for_existing" as const,
        trainingRequestId: pending._id,
        registryIdentity: pending.registryIdentity,
      };
    }
    if (exactRequest) {
      return {
        kind: "recorded" as const,
        trainingRequestId: exactRequest._id,
        registryIdentity: request.registryIdentity,
      };
    }
    const trainingRequestId = await ctx.db.insert("characterLoRATrainingRequests", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      accountId: request.accountId,
      version: CHARACTER_LORA_REGISTRY_VERSION,
      requestFingerprint: request.fingerprint,
      registryIdentity: request.registryIdentity,
      sheetPlanFingerprint: request.sheetPlanFingerprint,
      datasetFingerprint: request.datasetFingerprint,
      channelPolicyFingerprint: request.channelPolicyFingerprint,
      characterId: request.characterId,
      characterSpecFingerprint: request.characterSpecFingerprint,
      status: request.status,
      providerInvocation: request.providerInvocation,
      request,
      createdAt: Date.now(),
    });
    return {
      kind: "recorded" as const,
      trainingRequestId,
      registryIdentity: request.registryIdentity,
    };
  },
});

/**
 * Store a later adapter's independently verified success receipt. The adapter
 * is not called here. Once accepted, the character specification is a reuse
 * boundary: subsequent training requests return that same entry rather than
 * creating another training path.
 */
export const acceptCharacterLoRA = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    trainingRequestFingerprint: v.string(),
    acceptedAdapter: v.any(),
  },
  returns: v.id("characterLoRARegistryEntries"),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "accepted character LoRA persistence");
    assertSafeOwnerId(args.ownerId);
    assertFingerprint(args.trainingRequestFingerprint, "character LoRA training request fingerprint");
    await requireOwnedChannel(ctx, args.ownerId, args.channelId, "accepted character LoRA persistence");
    assertContractSize(args.acceptedAdapter, "accepted character LoRA adapter receipt");
    const requestRow = await ctx.db
      .query("characterLoRATrainingRequests")
      .withIndex("by_request_fingerprint", (q) =>
        q.eq("requestFingerprint", args.trainingRequestFingerprint),
      )
      .unique();
    if (!requestRow || requestRow.ownerId !== args.ownerId || requestRow.channelId !== args.channelId) {
      throw new Error("narrativeSeriesState: accepted LoRA requires its exact owner-owned training request");
    }
    const request = CharacterLoRATrainingRequestSchema.parse(requestRow.request);
    if (
      request.fingerprint !== args.trainingRequestFingerprint
      || request.status !== "admitted"
      || !request.autoEligible
      || request.providerInvocation !== "not_started"
    ) {
      throw new Error("narrativeSeriesState: only an uninvoked admitted character LoRA request may be accepted");
    }
    const accepted = acceptCharacterLoRARegistryEntry({
      admission: {
        decision: "training_admitted",
        registryIdentity: request.registryIdentity,
        request,
      },
      acceptedAdapter: args.acceptedAdapter,
      now: Date.now(),
    });
    const existingByRequest = await ctx.db
      .query("characterLoRARegistryEntries")
      .withIndex("by_training_request_fingerprint", (q) =>
        q.eq("trainingRequestFingerprint", args.trainingRequestFingerprint),
      )
      .unique();
    if (existingByRequest) {
      const existing = assertRegistryRowIntegrity(existingByRequest);
      if (!sameAcceptedEntry(existing, accepted)) {
        throw new Error("narrativeSeriesState: training request already accepted with a different immutable LoRA receipt");
      }
      return existingByRequest._id;
    }
    const existingForCharacter = await ctx.db
      .query("characterLoRARegistryEntries")
      .withIndex("by_channel_character_spec", (q) =>
        q.eq("channelId", args.channelId)
          .eq("characterId", accepted.characterId)
          .eq("characterSpecFingerprint", accepted.characterSpecFingerprint),
      )
      .collect();
    if (existingForCharacter.length > 0) {
      const existing = assertRegistryRowIntegrity(existingForCharacter[0]!);
      if (sameAcceptedEntry(existing, accepted)) return existingForCharacter[0]!._id;
      throw new Error("narrativeSeriesState: an accepted LoRA already exists for this character specification; reuse is mandatory");
    }
    return await ctx.db.insert("characterLoRARegistryEntries", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      accountId: accepted.accountId,
      version: CHARACTER_LORA_REGISTRY_VERSION,
      registryIdentity: accepted.registryIdentity,
      trainingRequestFingerprint: accepted.trainingRequestFingerprint,
      datasetFingerprint: accepted.datasetFingerprint,
      characterId: accepted.characterId,
      characterSpecFingerprint: accepted.characterSpecFingerprint,
      status: "accepted",
      acceptedAdapter: accepted.acceptedAdapter,
      entry: accepted,
      acceptedAt: accepted.createdAt,
    });
  },
});

/** Small pure helpers exposed for focused state tests; they do not touch Convex or providers. */
export const narrativeSeriesStateGuardsForTests = {
  assertPlanOwnership,
  assertDatasetPlanOwnership,
  assertDatasetManifestOwnership,
  sameFrozenContract,
};
