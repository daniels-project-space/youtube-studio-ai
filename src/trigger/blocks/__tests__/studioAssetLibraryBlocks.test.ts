import assert from "node:assert/strict";

import type { StageContext } from "@/engine/types";
import { createNarrativeSeriesRunSelector } from "@/lib/narrativeSeriesRunAdmission";
import { sha256Hex } from "@/lib/sha256";
import { narrativeSeriesLoraScopeForStudio, STUDIO_ASSET_LIBRARY_BLOCKS } from "../studioAssetLibraryBlocks";

const digest = (value: string) => sha256Hex(value);

function stage(params: Record<string, unknown>): StageContext {
  return {
    ownerId: "owner-studio-library-test",
    channelId: "channel-studio-library-test",
    runId: "run-studio-library-test",
    keyPrefix: "owners/owner-studio-library-test/channels/channel-studio-library-test",
    params,
    store: {},
    budgetUsd: 0,
    log: () => undefined,
  };
}

async function main(): Promise<void> {
  const selector = createNarrativeSeriesRunSelector({
    version: "narrative-series-run-selector/v1",
    seriesPlanFingerprint: digest("series-plan"),
    seriesIdentity: "brick-chronicles",
    routeFingerprint: digest("route"),
    routeRunSeedFingerprint: digest("route-seed"),
    programBriefFingerprint: digest("brief"),
    acceptedCharacterAdapters: [{
      characterId: "character-hero",
      characterSpecFingerprint: digest("hero-spec"),
      registryIdentity: digest("hero-registry"),
    }],
  });
  const seriesScope = narrativeSeriesLoraScopeForStudio({
    narrativeSeriesRunSelector: selector,
    narrativeAcceptedCharacterAdapters: selector.acceptedCharacterAdapters,
  });
  assert.deepEqual(seriesScope, {
    seriesIdentity: "brick-chronicles",
    seriesBindingFingerprint: digest("series-plan"),
    acceptedCharacterRegistryIdentities: [digest("hero-registry")],
  });
  assert.throws(
    () => narrativeSeriesLoraScopeForStudio({ narrativeSeriesRunSelector: selector }),
    /requires narrative_series_visual_controls/i,
    "a series character adapter cannot resolve before the episode-local character filter has run",
  );
  assert.throws(
    () => narrativeSeriesLoraScopeForStudio({
      narrativeSeriesRunSelector: selector,
      narrativeAcceptedCharacterAdapters: [{
        ...selector.acceptedCharacterAdapters[0]!,
        registryIdentity: digest("other-registry"),
      }],
    }),
    /outside its frozen series selector/i,
    "a swapped character registry identity must fail before Studio or GPU resolution",
  );

  const resolver = STUDIO_ASSET_LIBRARY_BLOCKS.find((block) => block.id === "studio_asset_resolve");
  assert(resolver, "the provider-free Studio resolver must be registered as a pipeline block");
  assert.deepEqual(resolver.produces, ["studioAssetLibraryResolution", "studioAssetRecipeProjection"]);
  const postproductionResolver = STUDIO_ASSET_LIBRARY_BLOCKS.find((block) => block.id === "studio_postproduction_asset_resolve");
  assert(postproductionResolver, "the provider-free Studio post-production resolver must be registered as a pipeline block");
  assert.deepEqual(postproductionResolver.produces, [
    "studioPostproductionAssetResolutions",
    "studioAudioRecipeProjection",
    "studioOverlayRecipeProjection",
    "studioMotionGraphicsRecipeProjection",
    "studioTransitionRecipeProjection",
  ]);
  const directLtxResolver = STUDIO_ASSET_LIBRARY_BLOCKS.find((block) => block.id === "studio_ltx_adapter_resolve");
  assert(directLtxResolver, "the direct open-weight LTX 2.5 Novita adapter resolver must be registered as a pipeline block");
  assert.deepEqual(
    directLtxResolver.produces,
    [
      "studioLtxAdapterResolution",
      "studioLtxCreativeAdapterSelection",
      "studioLtxCreativeAdapterSelectionsByShot",
    ],
  );

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("a disabled Studio resolver must not call a remote service");
  }) as typeof fetch;
  try {
    const output = await resolver.run(stage({
      enabled: false,
      family: "cinematic",
      contentLane: "cinematic_ai",
      moduleId: "visual_matter",
      requiredKinds: ["camera_recipe", "motion_recipe"],
    }));
    const projection = output.studioAssetRecipeProjection as { readonly fingerprint: string };
    assert.deepEqual(output.studioAssetLibraryResolution, {
      status: "no_approved_match",
      missingKinds: ["camera_recipe", "motion_recipe"],
      blockers: ["Studio Asset Library resolution is disabled for this pipeline"],
    });
    assert.deepEqual(output.studioAssetRecipeProjection, {
      version: "studio-asset-recipe-projection/v1",
      cameraAddenda: [],
      motionAddenda: [],
      promptAddenda: [],
      sourceEntryFingerprints: [],
      fingerprint: projection.fingerprint,
    });
    assert.equal(output.__costUsd, 0);

    const defaultKindsOutput = await resolver.run(stage({
      enabled: false,
      family: "cinematic",
      contentLane: "cinematic_ai",
      moduleId: "visual_matter",
    }));
    assert.deepEqual(
      (defaultKindsOutput.studioAssetLibraryResolution as { readonly missingKinds: readonly string[] }).missingKinds,
      ["camera_recipe", "motion_recipe", "prompt_recipe", "visual_treatment_recipe"],
      "the default Visual Matter lookup must include treatment recipes alongside reusable camera, motion, and prompt direction",
    );

    const postproductionOutput = await postproductionResolver.run(stage({
      enabled: false,
      family: "narrated_stock",
      contentLane: "narrated_stock",
    }));
    const overlay = postproductionOutput.studioOverlayRecipeProjection as {
      readonly assetKind: string;
      readonly promptAddenda: readonly string[];
      readonly sourceEntryFingerprints: readonly string[];
    };
    assert.equal(overlay.assetKind, "overlay_template");
    assert.deepEqual(overlay.promptAddenda, []);
    assert.deepEqual(overlay.sourceEntryFingerprints, []);
    assert.equal(postproductionOutput.__costUsd, 0);

    const directLtxOutput = await directLtxResolver.run(stage({
      enabled: false,
      family: "cinematic",
      contentLane: "cinematic_ai",
    }));
    assert.equal(directLtxOutput.studioLtxCreativeAdapterSelection, null);
    assert.equal(directLtxOutput.studioLtxCreativeAdapterSelectionsByShot, null);
    assert.equal(directLtxOutput.__costUsd, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalls, 0, "typed disabled resolution must not spend or call a provider");

  await assert.rejects(
    () => directLtxResolver.run(stage({ enabled: false, family: "cinematic", contentLane: "narrated_stock" })),
    /contentLane cinematic_ai/i,
    "a direct LTX adapter lookup must reject another lane before any remote resolver or GPU path",
  );

  await assert.rejects(
    () => resolver.run(stage({
      enabled: false,
      family: "cinematic",
      contentLane: "cinematic_ai",
      moduleId: "visual_matter",
      requiredKinds: ["not-an-asset-kind"],
    })),
    /not-an-asset-kind|invalid_enum_value/i,
    "invalid requested kinds must fail before a remote resolver can be constructed",
  );

  console.log("STUDIO ASSET LIBRARY BLOCK TESTS PASS");
}

void main();
