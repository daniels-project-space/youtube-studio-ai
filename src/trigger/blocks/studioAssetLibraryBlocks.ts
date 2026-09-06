import {
  StudioAssetKindSchema,
  createStudioLtxShotAdapterSelections,
  studioAssetRecipeProjection,
  studioLtxCreativeAdapterSelection,
  studioPostproductionRecipeProjection,
  type StudioAssetResolveRequest,
  type StudioPostproductionAssetKind,
} from "@/engine/studioAssetLibrary";
import { NarrativeShotControlContractSchema } from "@/engine/narrativeSeriesIntelligence";
import { COST_PATCH_KEY, type Block } from "@/engine/types";
import { DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT } from "@/lib/ltxCreativeAdapter";
import {
  NARRATIVE_SERIES_RUN_SELECTOR_SEED_KEY,
  parseNarrativeSeriesAcceptedCharacterAdapters,
  parseNarrativeSeriesRunSelector,
} from "@/lib/narrativeSeriesRunAdmission";
import { resolveStudioAssetsForPipeline } from "@/lib/studioAssetLibraryRuntime";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";

// These are prompt/plan-only assets consumed by Visual Matter. A treatment
// recipe is still selected only when the sealed pipeline declares that exact
// treatment, so it cannot leak a clay/anime/drawn look into another channel.
const DEFAULT_KINDS = ["camera_recipe", "motion_recipe", "prompt_recipe", "visual_treatment_recipe"] as const;
const POSTPRODUCTION_TARGETS = [
  { key: "audio", assetKind: "audio_recipe", moduleId: "music" },
  { key: "overlay", assetKind: "overlay_template", moduleId: "quote_overlays" },
  { key: "motionGraphics", assetKind: "motion_graphics_template", moduleId: "visual_inserts" },
  { key: "transition", assetKind: "transition_template", moduleId: "timeline_assemble" },
] as const satisfies readonly { readonly key: string; readonly assetKind: StudioPostproductionAssetKind; readonly moduleId: string }[];

function convex(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

function nonEmptyText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`studio_asset_resolve: ${field} must be a non-empty string`);
  }
  return value.trim();
}

function requestedKinds(value: unknown): StudioAssetResolveRequest["requiredKinds"] {
  if (value === undefined) return [...DEFAULT_KINDS];
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) {
    throw new Error("studio_asset_resolve: requiredKinds must contain 1–12 approved Studio asset kinds");
  }
  return value.map((kind) => StudioAssetKindSchema.parse(kind));
}

async function resolveDirectLtxSelection(
  baseRequest: Omit<StudioAssetResolveRequest, "requiredKinds">,
  targetCharacterRegistryIdentities: readonly string[] | undefined,
) {
  const request = {
    ...baseRequest,
    ...(targetCharacterRegistryIdentities !== undefined
      ? { targetCharacterRegistryIdentities: [...targetCharacterRegistryIdentities] }
      : {}),
  };
  // Prefer an exact tested combination. The one-adapter fallback remains
  // useful for an individual character but can never substitute for a
  // multi-character stack or a portable style stack.
  const stackResolution = await resolveStudioAssetsForPipeline({
    client: convex(),
    request: { ...request, requiredKinds: ["standard_lora_stack"] },
  });
  const resolution = stackResolution.status === "no_approved_match"
    ? await resolveStudioAssetsForPipeline({
        client: convex(),
        request: { ...request, requiredKinds: ["standard_lora_adapter"] },
      })
    : stackResolution;
  return {
    resolution,
    selection: studioLtxCreativeAdapterSelection(resolution) ?? null,
  };
}

function exactCharacterRegistryIdentitiesForShot(input: {
  readonly continuityCharacterIds: readonly string[];
  readonly registryIdentityByCharacterId: ReadonlyMap<string, string>;
}): readonly string[] | null {
  if (input.continuityCharacterIds.length === 0) return [];
  const identities = input.continuityCharacterIds.map((characterId) => input.registryIdentityByCharacterId.get(characterId));
  // Never apply one actor's LoRA to a mixed shot that also contains an
  // unregistered actor. That would create a false continuity guarantee.
  if (identities.some((identity) => !identity)) return null;
  const exact = [...new Set(identities as string[])].sort();
  if (exact.length !== input.continuityCharacterIds.length) {
    throw new Error("studio_ltx_adapter_resolve cannot bind multiple visible characters to one registry identity");
  }
  return exact;
}

/**
 * Character LoRAs are reusable only inside the sealed series plan that
 * admitted them—and only when the current episode includes that character.
 * This is a free pre-lookup check; it never retrains or reaches a provider.
 */
export function narrativeSeriesLoraScopeForStudio(store: Record<string, unknown>): Pick<
  StudioAssetResolveRequest,
  "seriesIdentity" | "seriesBindingFingerprint" | "acceptedCharacterRegistryIdentities"
> {
  const rawSelector = store[NARRATIVE_SERIES_RUN_SELECTOR_SEED_KEY];
  if (rawSelector === undefined) return {};
  const selector = parseNarrativeSeriesRunSelector(rawSelector);
  const rawCurrent = store["narrativeAcceptedCharacterAdapters"];
  if (rawCurrent === undefined && selector.acceptedCharacterAdapters.length > 0) {
    throw new Error(
      "studio_ltx_adapter_resolve requires narrative_series_visual_controls before selecting a series character LoRA",
    );
  }
  const current = parseNarrativeSeriesAcceptedCharacterAdapters(rawCurrent ?? []);
  const permitted = new Map(
    selector.acceptedCharacterAdapters.map((adapter) => [
      `${adapter.characterId}\u0000${adapter.characterSpecFingerprint}`,
      adapter.registryIdentity,
    ]),
  );
  for (const adapter of current) {
    const identity = `${adapter.characterId}\u0000${adapter.characterSpecFingerprint}`;
    if (permitted.get(identity) !== adapter.registryIdentity) {
      throw new Error("studio_ltx_adapter_resolve received a character adapter outside its frozen series selector");
    }
  }
  return {
    seriesIdentity: selector.seriesIdentity,
    seriesBindingFingerprint: selector.seriesPlanFingerprint,
    acceptedCharacterRegistryIdentities: current.map((adapter) => adapter.registryIdentity),
  };
}

const studioAssetResolve: Block = {
  id: "studio_asset_resolve",
  consumes: [],
  produces: ["studioAssetLibraryResolution", "studioAssetRecipeProjection"],
  paid: false,
  run: async (ctx) => {
    const kinds = requestedKinds(ctx.params["requiredKinds"]);
    if (ctx.params["enabled"] === false) {
      const resolution = {
        status: "no_approved_match" as const,
        missingKinds: kinds,
        blockers: ["Studio Asset Library resolution is disabled for this pipeline"],
      };
      return {
        studioAssetLibraryResolution: resolution,
        studioAssetRecipeProjection: studioAssetRecipeProjection(resolution),
        [COST_PATCH_KEY]: 0,
      };
    }
    const request: StudioAssetResolveRequest = {
      ownerId: ctx.ownerId,
      channelId: ctx.channelId,
      family: nonEmptyText(ctx.params["family"], "family"),
      contentLane: nonEmptyText(ctx.params["contentLane"], "contentLane"),
      moduleId: nonEmptyText(ctx.params["moduleId"], "moduleId"),
      requiredKinds: kinds,
      selectionMode: "best_effort",
      ...(typeof ctx.params["treatment"] === "string" && ctx.params["treatment"].trim()
        ? { treatment: ctx.params["treatment"].trim() }
        : {}),
      ...(typeof ctx.params["runtimeFingerprint"] === "string" && ctx.params["runtimeFingerprint"].trim()
        ? { runtimeFingerprint: ctx.params["runtimeFingerprint"].trim() }
        : {}),
    };
    const resolution = await resolveStudioAssetsForPipeline({ client: convex(), request });
    const projection = studioAssetRecipeProjection(resolution);
    ctx.log(
      resolution.status === "resolved"
        ? `studio_asset_resolve: reused ${projection.sourceEntryFingerprints.length} approved recipe asset(s)`
        : `studio_asset_resolve: ${resolution.status}; no unapproved cross-channel fallback is permitted`,
    );
    return {
      studioAssetLibraryResolution: resolution,
      studioAssetRecipeProjection: projection,
      [COST_PATCH_KEY]: 0,
    };
  },
};

/**
 * Resolve post-production templates independently for their exact consumer.
 * A compatible quote-card template cannot leak into data graphics or music,
 * and no template can alter a Story Spine, source evidence, timing, or cut.
 */
const studioPostproductionAssetResolve: Block = {
  id: "studio_postproduction_asset_resolve",
  consumes: [],
  produces: [
    "studioPostproductionAssetResolutions",
    "studioAudioRecipeProjection",
    "studioOverlayRecipeProjection",
    "studioMotionGraphicsRecipeProjection",
    "studioTransitionRecipeProjection",
  ],
  paid: false,
  run: async (ctx) => {
    const enabled = ctx.params["enabled"] !== false;
    const family = nonEmptyText(ctx.params["family"], "family");
    const contentLane = nonEmptyText(ctx.params["contentLane"], "contentLane");
    const resolved = await Promise.all(POSTPRODUCTION_TARGETS.map(async (target) => {
      if (!enabled) {
        return [target.key, {
          status: "no_approved_match" as const,
          missingKinds: [target.assetKind],
          blockers: ["Studio post-production asset resolution is disabled for this pipeline"],
        }] as const;
      }
      return [target.key, await resolveStudioAssetsForPipeline({
        client: convex(),
        request: {
          ownerId: ctx.ownerId,
          channelId: ctx.channelId,
          family,
          contentLane,
          moduleId: target.moduleId,
          requiredKinds: [target.assetKind],
          selectionMode: "best_effort",
        },
      })] as const;
    }));
    const resolutions = Object.fromEntries(resolved);
    const audio = resolutions["audio"];
    const overlay = resolutions["overlay"];
    const motionGraphics = resolutions["motionGraphics"];
    const transition = resolutions["transition"];
    const reused = resolved.filter(([, resolution]) => resolution.status === "resolved").length;
    ctx.log(
      `studio_postproduction_asset_resolve: ${reused}/4 compatible approved template(s) reused; ` +
        "missing templates remain an explicit new-candidate signal",
    );
    return {
      studioPostproductionAssetResolutions: resolutions,
      studioAudioRecipeProjection: studioPostproductionRecipeProjection(audio, "audio_recipe"),
      studioOverlayRecipeProjection: studioPostproductionRecipeProjection(overlay, "overlay_template"),
      studioMotionGraphicsRecipeProjection: studioPostproductionRecipeProjection(motionGraphics, "motion_graphics_template"),
      studioTransitionRecipeProjection: studioPostproductionRecipeProjection(transition, "transition_template"),
      [COST_PATCH_KEY]: 0,
    };
  },
};

/**
 * The direct worker supports a small, explicitly benchmarked standard-LoRA
 * stack through its sealed model manifest. This stage deliberately runs after
 * accepted still QA: no adapter selection is allowed to influence an
 * unreviewed cinematic take.
 * IC-LoRAs remain absent here because the direct worker is not a Comfy control
 * runtime and cannot truthfully consume guide pixels.
 */
const studioLtxAdapterResolve: Block = {
  id: "studio_ltx_adapter_resolve",
  // ORDERING, not an input: the report is never read here. Declaring it is what
  // forces adapter resolution to happen AFTER the keyframes have passed asset
  // QA, so a rejected still can never have a video adapter selected for it.
  consumes: ["assetQaReport"],
  produces: [
    "studioLtxAdapterResolution",
    "studioLtxCreativeAdapterSelection",
    "studioLtxCreativeAdapterSelectionsByShot",
  ],
  paid: false,
  run: async (ctx) => {
    if (ctx.params["contentLane"] !== "cinematic_ai") {
      throw new Error("studio_ltx_adapter_resolve requires contentLane cinematic_ai");
    }
    if (ctx.params["enabled"] === false) {
      return {
        studioLtxAdapterResolution: {
          status: "no_approved_match" as const,
          missingKinds: ["standard_lora_adapter"],
          blockers: ["Studio LTX adapter resolution is disabled for this pipeline"],
        },
        studioLtxCreativeAdapterSelection: null,
        studioLtxCreativeAdapterSelectionsByShot: null,
        [COST_PATCH_KEY]: 0,
      };
    }
    const baseRequest: Omit<StudioAssetResolveRequest, "requiredKinds"> = {
      ownerId: ctx.ownerId,
      channelId: ctx.channelId,
      family: nonEmptyText(ctx.params["family"], "family"),
      contentLane: "cinematic_ai",
      moduleId: "novita_render_video",
      runtimeFingerprint: DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT,
      ...(typeof ctx.params["treatment"] === "string" && ctx.params["treatment"].trim()
        ? { treatment: ctx.params["treatment"].trim() }
        : {}),
      ...narrativeSeriesLoraScopeForStudio(ctx.store),
    };
    const global = await resolveDirectLtxSelection(baseRequest, undefined);
    const resolution = global.resolution;
    const selected = global.selection;
    const rawShotControl = ctx.store["narrativeShotControl"];
    let selectedByShot: ReturnType<typeof createStudioLtxShotAdapterSelections> | null = null;
    if (rawShotControl !== undefined) {
      const shotControl = NarrativeShotControlContractSchema.parse(rawShotControl);
      const currentAdapters = parseNarrativeSeriesAcceptedCharacterAdapters(
        ctx.store["narrativeAcceptedCharacterAdapters"] ?? [],
      );
      const registryIdentityByCharacterId = new Map(
        currentAdapters.map((adapter) => [adapter.characterId, adapter.registryIdentity]),
      );
      const exactSelections = new Map<string, typeof selected>();
      for (const shot of shotControl.shots) {
        const exactCharacters = exactCharacterRegistryIdentitiesForShot({
          continuityCharacterIds: shot.continuityCharacterIds,
          registryIdentityByCharacterId,
        });
        if (!exactCharacters?.length) continue;
        const key = exactCharacters.join("\\u0000");
        if (!exactSelections.has(key)) {
          const exact = await resolveDirectLtxSelection(baseRequest, exactCharacters);
          exactSelections.set(key, exact.selection);
        }
      }
      selectedByShot = createStudioLtxShotAdapterSelections({
        narrativeShotControlFingerprint: shotControl.fingerprint,
        shots: shotControl.shots.map((shot) => {
          const exactCharacters = exactCharacterRegistryIdentitiesForShot({
            continuityCharacterIds: shot.continuityCharacterIds,
            registryIdentityByCharacterId,
          });
          const exact = exactCharacters?.length
            ? exactSelections.get(exactCharacters.join("\\u0000")) ?? null
            : null;
          // A portable selection is allowed when there is no exact character
          // recipe, but a partial character set never is.
          return {
            shotId: shot.shotId,
            continuityCharacterRegistryIdentities: exactCharacters ?? [],
            selection: exact ?? selected,
          };
        }),
      });
    }
    const selectedIds = selected
      ? ("adapters" in selected.selection ? selected.selection.adapters.map((adapter) => adapter.id) : [selected.selection.id])
      : [];
    ctx.log(
      selected
        ? `studio_ltx_adapter_resolve: selected approved ${selectedIds.join(", ")} for sealed direct-LTX verification`
        : "studio_ltx_adapter_resolve: no approved direct-LTX adapter; sealed base runtime remains in use",
    );
    return {
      studioLtxAdapterResolution: resolution,
      studioLtxCreativeAdapterSelection: selected ?? null,
      studioLtxCreativeAdapterSelectionsByShot: selectedByShot,
      [COST_PATCH_KEY]: 0,
    };
  },
};

export const STUDIO_ASSET_LIBRARY_BLOCKS: readonly Block[] = [
  studioAssetResolve,
  studioPostproductionAssetResolve,
  studioLtxAdapterResolve,
];
