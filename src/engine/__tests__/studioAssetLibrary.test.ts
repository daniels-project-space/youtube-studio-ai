import assert from "node:assert/strict";

import {
  createStudioLtxShotAdapterSelections,
  createStudioLtxReleaseAdapterBinding,
  createStudioAssetReleaseUsageReceipt,
  createStudioAssetLibraryEntry,
  resolveStudioAssetLibrary,
  assertStudioLtxReleaseAdapterBinding,
  assertStudioAssetReleaseUsageReceipt,
  studioAssetRecipeProjection,
  studioAssetRecipeProjectionFromUnknown,
  studioAssetLibraryInventory,
  studioLtxCreativeAdapterSelection,
  studioLtxCreativeAdapterSelectionFromUnknown,
  studioLtxShotAdapterSelectionsFromUnknown,
  studioPostproductionRecipeProjection,
  studioPostproductionRecipeProjectionFromUnknown,
  type StudioAssetLibraryEntryCore,
  type StudioAssetResolveRequest,
} from "@/engine/studioAssetLibrary";
import { sha256Hex } from "@/lib/sha256";
import { DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT } from "@/lib/ltxCreativeAdapter";

const digest = (value: string) => sha256Hex(value);
const OWNER = "owner-1";
const CHANNEL = "channel-1";
const SERIES = "brick-chronicles";
const SERIES_BINDING = digest("series-binding");
const HERO_CHARACTER_REGISTRY = digest("series-hero-character-registry");
const RUNTIME = digest("dedicated-comfy-ltx-runtime");

function core(overrides: Partial<StudioAssetLibraryEntryCore> = {}): StudioAssetLibraryEntryCore {
  return {
    version: "studio-asset-library/v1",
    logicalId: "dolly-orbit-v1",
    title: "Dolly orbit grammar",
    scope: "owned_studio",
    assetKind: "camera_recipe",
    identitySensitivity: "portable",
    status: "approved",
    compatibility: {
      families: ["comic"],
      contentLanes: ["cinematic_ai"],
      moduleIds: ["visual_matter"],
      treatments: ["brick_built_stop_motion"],
      runtimeFingerprint: RUNTIME,
    },
    approval: {
      provenanceFingerprint: digest("camera-provenance"),
      qualityEvidenceFingerprint: digest("camera-quality"),
      qualityScore: 93,
      approvedBy: "reviewer-1",
      approvedAt: 1_700_000_000_000,
    },
    recipe: {
      version: "studio-asset-recipe/v1",
      promptFragments: ["slow controlled dolly orbit"],
      controlValues: { duration: "3s" },
      instructionFingerprint: digest("slow controlled dolly orbit|3s"),
    },
    ...overrides,
  };
}

function request(requiredKinds: StudioAssetResolveRequest["requiredKinds"]): StudioAssetResolveRequest {
  return {
    ownerId: OWNER,
    channelId: CHANNEL,
    seriesIdentity: SERIES,
    seriesBindingFingerprint: SERIES_BINDING,
    family: "comic",
    contentLane: "cinematic_ai",
    moduleId: "visual_matter",
    treatment: "brick_built_stop_motion",
    runtimeFingerprint: RUNTIME,
    requiredKinds: [...requiredKinds],
    targetId: "shot-12",
    acceptedCharacterRegistryIdentities: [HERO_CHARACTER_REGISTRY],
  };
}

async function main() {
  const camera = createStudioAssetLibraryEntry(core());
  const demonstratedCamera = createStudioAssetLibraryEntry(core({
    logicalId: "dolly-orbit-demonstrated-v1",
    title: "Demonstrated dolly orbit grammar",
    approval: {
      ...core().approval,
      provenanceFingerprint: digest("demonstrated-camera-provenance"),
    },
  }));
  const demonstratedCameraUsage = ["one", "two", "three"].map((suffix) =>
    createStudioAssetReleaseUsageReceipt({
      finalMaster: { sha256: digest(`demonstrated-camera-master-${suffix}`), durationSec: 12 },
      family: "comic",
      contentLane: "cinematic_ai",
      treatment: "brick_built_stop_motion",
      visualReview: {
        reviewFingerprint: `demonstrated-camera-review-${suffix}`,
        reviewReceiptFingerprint: digest(`demonstrated-camera-review-receipt-${suffix}`),
      },
      qualityEvidence: {
        bindingFingerprint: digest(`demonstrated-camera-quality-binding-${suffix}`),
        qualityEvidenceFingerprint: digest(`demonstrated-camera-quality-${suffix}`),
        hardGateReady: true,
        calibrationComplete: true,
        visualStatus: "pass",
        visualScore: 8.2,
        visualMinimumScore: 7,
      },
      uses: [{
        assetEntryFingerprint: demonstratedCamera.fingerprint,
        moduleId: "visual_matter",
        projectionFingerprint: digest(`demonstrated-camera-projection-${suffix}`),
      }],
    }),
  );
  const feedbackTiebreak = resolveStudioAssetLibrary({
    request: request(["camera_recipe"]),
    entries: [camera, demonstratedCamera],
    releaseUsageReceipts: demonstratedCameraUsage,
  });
  assert.equal(feedbackTiebreak.status, "resolved");
  if (feedbackTiebreak.status === "resolved") {
    assert.equal(
      feedbackTiebreak.bundle.entries[0]?.logicalId,
      "dolly-orbit-demonstrated-v1",
      "three exact passing masters may break an otherwise-equal Studio approval tie",
    );
  }
  const reused = resolveStudioAssetLibrary({ request: request(["camera_recipe"]), entries: [camera] });
  assert.equal(reused.status, "resolved");
  if (reused.status === "resolved") assert.deepEqual(reused.bundle.entries.map((entry) => entry.logicalId), ["dolly-orbit-v1"]);

  const unspecifiedTreatment = resolveStudioAssetLibrary({
    request: { ...request(["camera_recipe"]), treatment: undefined },
    entries: [camera],
  });
  assert.equal(
    unspecifiedTreatment.status,
    "no_approved_match",
    "a treatment-bound camera recipe must never be reused when the run did not seal a treatment",
  );
  if (unspecifiedTreatment.status === "no_approved_match") {
    assert.deepEqual(unspecifiedTreatment.missingKinds, ["camera_recipe"]);
  }

  const illegalStudioCharacter = core({
    logicalId: "hero-character-lora",
    assetKind: "standard_lora_adapter",
    identitySensitivity: "series",
    lora: {
      candidateId: "hero-character-lora",
      adapterClass: "standard_lora",
      adapterSha256: digest("hero-adapter"),
      benchmarkFingerprint: digest("hero-benchmark"),
      runtimeFingerprint: RUNTIME,
      controlKinds: [],
      requiresSeriesBinding: true,
    },
    resource: { r2Key: "owners/owner/channels/channel/series/hero.safetensors", contentSha256: digest("hero-bytes"), contentType: "application/octet-stream", byteLength: 42 },
  });
  assert.throws(() => createStudioAssetLibraryEntry(illegalStudioCharacter), /must be portable/);

  const seriesCharacterAdapter = createStudioAssetLibraryEntry(core({
    logicalId: "series-hero-character-lora",
    title: "Series hero character LoRA",
    scope: "series",
    channelId: CHANNEL,
    seriesIdentity: SERIES,
    assetKind: "standard_lora_adapter",
    identitySensitivity: "series",
    compatibility: {
      families: ["cinematic"],
      contentLanes: ["cinematic_ai"],
      moduleIds: ["novita_render_video"],
      treatments: [],
      runtimeFingerprint: DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT,
    },
    resource: {
      r2Key: "owners/owner/channels/channel/series/hero.safetensors",
      contentSha256: digest("hero-character-adapter"),
      contentType: "application/octet-stream",
      byteLength: 42,
    },
    approval: {
      ...core().approval,
      qualityEvidenceFingerprint: digest("hero-character-benchmark"),
    },
    lora: {
      candidateId: "ltx-creative-series-hero-character",
      adapterClass: "standard_lora",
      adapterSha256: digest("hero-character-adapter"),
      benchmarkFingerprint: digest("hero-character-benchmark"),
      runtimeFingerprint: DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT,
      renderStrength: 0.68,
      controlKinds: [],
      requiresSeriesBinding: true,
      seriesBindingFingerprint: SERIES_BINDING,
      characterRegistryIdentity: HERO_CHARACTER_REGISTRY,
    },
    recipe: undefined,
  }));
  const exactSeriesCharacter = resolveStudioAssetLibrary({
    request: {
      ...request(["standard_lora_adapter"]),
      family: "cinematic",
      contentLane: "cinematic_ai",
      moduleId: "novita_render_video",
      treatment: undefined,
      runtimeFingerprint: DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT,
      targetCharacterRegistryIdentities: [HERO_CHARACTER_REGISTRY],
    },
    entries: [seriesCharacterAdapter],
  });
  assert.equal(exactSeriesCharacter.status, "resolved", "a series-bound character adapter needs an exact plan binding");
  const exactSeriesCharacterSelection = studioLtxCreativeAdapterSelection(exactSeriesCharacter);
  assert.ok(exactSeriesCharacterSelection, "an exact current-shot character adapter can reach the direct standard-LoRA path");
  assert.deepEqual(
    exactSeriesCharacterSelection.targetCharacterRegistryIdentities,
    [HERO_CHARACTER_REGISTRY],
    "the direct selection retains its complete immutable character target",
  );
  const exactSeriesManifest = {
    version: "1.0.0" as const,
    generation: {
      contractVersion: "1.0.0" as const,
      profileId: "production" as const,
      model: "Lightricks/LTX-2.5",
      revision: "ce298b6b078f52562e928b55a62d6f34cbe58c2b",
      checkpoint: "ltx-2.5-distilled-fp8.safetensors",
      precision: "bf16" as const,
      width: 2560,
      height: 1408,
      steps: 8,
      allowFallback: false as const,
      fps: 24,
      guidanceScale: 1,
      pipeline: "distilled" as const,
      twoStageRefine: true as const,
      textEncoderCheckpoint: "gemma-3-12b-it-qat-q4_0.safetensors",
      videoVaeCheckpoint: "ltx-2.5-vae.safetensors",
      audioVaeCheckpoint: "ltx-2.5-audio-vae.safetensors",
      spatialUpscalerCheckpoint: "ltx-2.5-spatial-upscaler.safetensors",
      quantization: "fp8-cast" as const,
      offload: "cpu" as const,
      spatialUpscaleFactor: 2 as const,
      stageOneWidth: 1280,
      stageOneHeight: 704,
      outputWidth: 2560,
      outputHeight: 1408,
    },
    durationSec: 4,
    items: [{
      shotId: "shot-hero-001",
      clipKey: "owner/owner/runs/run-1/novita/video/shot-hero-001.mp4",
      t0: 0,
      t1: 4,
      sourceSentenceIds: ["sentence-001"],
      continuityState: "hero remains in the same brick-built workshop",
      creativeAdapter: exactSeriesCharacterSelection.selection,
    }],
  };
  const releaseAdapterBinding = createStudioLtxReleaseAdapterBinding({
    shotRenderManifest: exactSeriesManifest,
    globalSelection: exactSeriesCharacterSelection,
  });
  assert.ok(releaseAdapterBinding, "a Studio-selected LTX adapter must become release-certifiable provenance");
  assert.equal(
    assertStudioLtxReleaseAdapterBinding(releaseAdapterBinding).globalSelectionFingerprint,
    exactSeriesCharacterSelection.fingerprint,
    "the release binding must retain the exact global selection rather than a loose adapter id",
  );
  assert.throws(
    () => createStudioLtxReleaseAdapterBinding({
      shotRenderManifest: {
        ...exactSeriesManifest,
        items: [{
          ...exactSeriesManifest.items[0],
          creativeAdapter: { id: "ltx-creative-wrong-character", strength: 0.68 },
        }],
      },
      globalSelection: exactSeriesCharacterSelection,
    }),
    /does not match the approved Studio selection/,
    "a final certificate cannot claim Studio continuity when the persisted LTX manifest used another adapter",
  );
  const releaseUsage = createStudioAssetReleaseUsageReceipt({
    finalMaster: { sha256: digest("studio-release-master"), durationSec: 4 },
    family: "cinematic",
    contentLane: "cinematic_ai",
    treatment: "brick_built_stop_motion",
    visualReview: {
      reviewFingerprint: "visual-review-studio-release-001",
      reviewReceiptFingerprint: digest("visual-review-receipt"),
    },
    qualityEvidence: {
      bindingFingerprint: digest("studio-release-quality-binding"),
      qualityEvidenceFingerprint: digest("studio-release-quality-evidence"),
      hardGateReady: true,
      calibrationComplete: true,
      visualStatus: "pass",
      visualScore: 8.4,
      visualMinimumScore: 7,
    },
    uses: [
      {
        assetEntryFingerprint: seriesCharacterAdapter.fingerprint,
        moduleId: "novita_render_video",
        projectionFingerprint: releaseAdapterBinding.fingerprint,
      },
      {
        assetEntryFingerprint: seriesCharacterAdapter.fingerprint,
        moduleId: "novita_render_video",
        projectionFingerprint: releaseAdapterBinding.fingerprint,
      },
    ],
  });
  assert.equal(
    assertStudioAssetReleaseUsageReceipt(releaseUsage).uses.length,
    1,
    "a passing release keeps one deterministic usage observation per asset/module pair",
  );
  assert.throws(
    () => assertStudioAssetReleaseUsageReceipt({
      ...releaseUsage,
      quality: { ...releaseUsage.quality, visualScore: 9.5 },
    }),
    /fingerprint/i,
    "a Studio quality observation cannot be rewritten after a release is sealed",
  );
  assert.throws(
    () => createStudioAssetReleaseUsageReceipt({
      finalMaster: { sha256: digest("unqualified-studio-release-master"), durationSec: 4 },
      family: "cinematic",
      contentLane: "cinematic_ai",
      visualReview: {
        reviewFingerprint: "visual-review-unqualified-001",
        reviewReceiptFingerprint: digest("visual-review-unqualified-receipt"),
      },
      qualityEvidence: {
        bindingFingerprint: digest("unqualified-quality-binding"),
        qualityEvidenceFingerprint: digest("unqualified-quality-evidence"),
        hardGateReady: false,
        calibrationComplete: true,
        visualStatus: "advisory",
      },
      uses: [{
        assetEntryFingerprint: seriesCharacterAdapter.fingerprint,
        moduleId: "novita_render_video",
        projectionFingerprint: releaseAdapterBinding.fingerprint,
      }],
    }),
    /hard-gate-passing/i,
    "a merely advisory run must never train the Studio reuse signal",
  );
  const absentEpisodeCharacter = resolveStudioAssetLibrary({
    request: {
      ...request(["standard_lora_adapter"]),
      family: "cinematic",
      contentLane: "cinematic_ai",
      moduleId: "novita_render_video",
      treatment: undefined,
      runtimeFingerprint: DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT,
      acceptedCharacterRegistryIdentities: [],
    },
    entries: [seriesCharacterAdapter],
  });
  assert.equal(
    absentEpisodeCharacter.status,
    "no_approved_match",
    "a character LoRA must not leak into an episode where that character is absent",
  );
  const staleSeriesCharacter = resolveStudioAssetLibrary({
    request: {
      ...request(["standard_lora_adapter"]),
      family: "cinematic",
      contentLane: "cinematic_ai",
      moduleId: "novita_render_video",
      treatment: undefined,
      runtimeFingerprint: DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT,
      seriesBindingFingerprint: digest("revised-series-plan"),
    },
    entries: [seriesCharacterAdapter],
  });
  assert.equal(
    staleSeriesCharacter.status,
    "no_approved_match",
    "a character adapter trained for an older series plan must never silently resolve for a revised plan",
  );

  assert.throws(
    () => createStudioAssetLibraryEntry(core({
      logicalId: "unbound-union-control-ltx",
      title: "Unbound Union control adapter",
      assetKind: "ic_lora_adapter",
      lora: {
        candidateId: "unbound-union-control-ltx",
        adapterClass: "ic_lora",
        adapterSha256: digest("unbound-union-adapter"),
        benchmarkFingerprint: digest("unbound-union-benchmark"),
        runtimeFingerprint: RUNTIME,
        controlKinds: ["reference_sheet"],
        requiresSeriesBinding: true,
      },
      resource: { r2Key: "studio/ltx/unbound-union-control.safetensors", contentSha256: digest("unbound-union-bytes"), contentType: "application/octet-stream", byteLength: 512 },
      recipe: undefined,
    })),
    /exact Comfy workflow/i,
    "an IC-LoRA cannot look usable in Studio without the exact pinned workflow asset",
  );
  const comfyWorkflow = createStudioAssetLibraryEntry(core({
    logicalId: "ltx-comfy-union-control-workflow",
    title: "LTX Comfy Union Control workflow",
    assetKind: "comfy_workflow",
    compatibility: {
      families: ["comic"],
      contentLanes: ["cinematic_ai"],
      moduleIds: ["visual_matter"],
      treatments: ["brick_built_stop_motion"],
      runtimeFingerprint: RUNTIME,
    },
    resource: { r2Key: "studio/workflows/ltx-union-control.json", contentSha256: digest("ltx-comfy-union-control-workflow"), contentType: "application/json", byteLength: 512 },
    recipe: undefined,
  }));
  const ic = createStudioAssetLibraryEntry(core({
    logicalId: "union-control-ltx",
    title: "Union control adapter",
    assetKind: "ic_lora_adapter",
    lora: {
      candidateId: "union-control-ltx",
      adapterClass: "ic_lora",
      adapterSha256: digest("union-adapter"),
      benchmarkFingerprint: digest("union-benchmark"),
      runtimeFingerprint: RUNTIME,
      controlKinds: ["reference_sheet", "pose"],
      comfyWorkflowFingerprint: comfyWorkflow.fingerprint,
      requiresSeriesBinding: true,
    },
    resource: { r2Key: "studio/ltx/union-control.safetensors", contentSha256: digest("union-adapter"), contentType: "application/octet-stream", byteLength: 512 },
    approval: {
      ...core().approval,
      qualityEvidenceFingerprint: digest("union-benchmark"),
    },
    recipe: undefined,
  }));
  const guide = createStudioAssetLibraryEntry(core({
    logicalId: "hero-sheet-shot-12",
    title: "Hero guide for shot 12",
    scope: "series",
    channelId: CHANNEL,
    seriesIdentity: SERIES,
    assetKind: "control_guide",
    identitySensitivity: "series",
    compatibility: {
      families: ["comic"],
      contentLanes: ["cinematic_ai"],
      moduleIds: ["visual_matter"],
      treatments: ["brick_built_stop_motion"],
      runtimeFingerprint: RUNTIME,
    },
    resource: { r2Key: "owners/owner-1/channels/channel-1/series/brick/shot-12.png", contentSha256: digest("guide-bytes"), contentType: "image/png", byteLength: 1024 },
    controlGuide: { controlKind: "reference_sheet", seriesBindingFingerprint: SERIES_BINDING, targetId: "shot-12" },
    recipe: undefined,
  }));
  const icWithoutWorkflow = resolveStudioAssetLibrary({ request: request(["ic_lora_adapter"]), entries: [ic, guide] });
  assert.equal(icWithoutWorkflow.status, "blocked", "an IC-LoRA must not resolve without its exact stored Comfy workflow");
  const icResolved = resolveStudioAssetLibrary({ request: request(["ic_lora_adapter"]), entries: [ic, guide, comfyWorkflow] });
  assert.equal(icResolved.status, "resolved");
  if (icResolved.status === "resolved") assert.deepEqual(icResolved.bundle.entries.map((entry) => entry.assetKind), ["ic_lora_adapter", "control_guide", "comfy_workflow"]);
  assert.throws(
    () => studioLtxCreativeAdapterSelection(icResolved),
    /IC-LoRA controls require the dedicated ComfyUI\/LTX worker/i,
    "an IC-LoRA/control-guide bundle must never be routed into the plain direct LTX --lora worker path",
  );

  const wrongChannelGuide = createStudioAssetLibraryEntry(core({
    logicalId: "other-channel-guide",
    title: "Other channel guide",
    scope: "series",
    channelId: "channel-2",
    seriesIdentity: SERIES,
    assetKind: "control_guide",
    identitySensitivity: "series",
    resource: { r2Key: "owners/owner-1/channels/channel-2/guide.png", contentSha256: digest("other-guide"), contentType: "image/png", byteLength: 1024 },
    controlGuide: { controlKind: "reference_sheet", seriesBindingFingerprint: SERIES_BINDING, targetId: "shot-12" },
    recipe: undefined,
  }));
  const isolated = resolveStudioAssetLibrary({ request: request(["ic_lora_adapter"]), entries: [ic, wrongChannelGuide] });
  assert.equal(isolated.status, "blocked");

  const missing = resolveStudioAssetLibrary({ request: request(["camera_recipe", "ic_lora_adapter"]), entries: [camera] });
  assert.equal(missing.status, "no_approved_match");
  if (missing.status === "no_approved_match") assert.deepEqual(missing.missingKinds, ["ic_lora_adapter"]);

  const partial = resolveStudioAssetLibrary({
    request: { ...request(["camera_recipe", "motion_recipe"]), selectionMode: "best_effort" },
    entries: [camera],
  });
  assert.equal(partial.status, "resolved", "independent approved recipes may be reused without inventing a missing one");
  if (partial.status === "resolved") {
    assert.deepEqual(partial.missingKinds, ["motion_recipe"]);
    const projection = studioAssetRecipeProjection(partial);
    assert.deepEqual(projection.cameraAddenda, ["slow controlled dolly orbit"]);
    assert.deepEqual(projection.motionAddenda, []);
    assert.deepEqual(projection.promptAddenda, []);
    assert.equal(projection.sourceEntryFingerprints.length, 1);
    assert.equal(
      studioAssetRecipeProjectionFromUnknown({ ...projection, fingerprint: digest("tampered-projection") }).sourceEntryFingerprints.length,
      0,
      "a downstream planner must discard a projection whose signed contents no longer match its fingerprint",
    );
  }

  const overlayTemplate = createStudioAssetLibraryEntry(core({
    logicalId: "inked-quote-card-v1",
    title: "Inked quote-card grammar",
    assetKind: "overlay_template",
    compatibility: {
      families: ["narrated_stock"],
      contentLanes: ["narrated_stock"],
      moduleIds: ["quote_overlays"],
      treatments: [],
    },
    recipe: {
      version: "studio-asset-recipe/v1",
      promptFragments: ["quiet editorial quote card with warm archival restraint"],
      controlValues: { quoteOverlayPreset: "ink_card", ignoredControl: "never-project-me" },
      instructionFingerprint: digest("inked quote card v1"),
    },
  }));
  const overlayResolution = resolveStudioAssetLibrary({
    request: {
      ownerId: OWNER,
      channelId: CHANNEL,
      family: "narrated_stock",
      contentLane: "narrated_stock",
      moduleId: "quote_overlays",
      requiredKinds: ["overlay_template"],
    },
    entries: [overlayTemplate],
  });
  const overlayProjection = studioPostproductionRecipeProjection(overlayResolution, "overlay_template");
  assert.equal(overlayProjection.quoteOverlayPreset, "ink_card");
  assert.equal(overlayProjection.dataInsertPreset, null);
  assert.deepEqual(overlayProjection.promptAddenda, ["quiet editorial quote card with warm archival restraint"]);
  assert.equal(overlayProjection.sourceEntryFingerprints.length, 1);
  assert.equal(
    studioPostproductionRecipeProjectionFromUnknown(
      { ...overlayProjection, quoteOverlayPreset: "signal_card" },
      "overlay_template",
    ).sourceEntryFingerprints.length,
    0,
    "a downstream renderer must discard a post-production template if its signed preset changes",
  );
  assert.equal(
    studioPostproductionRecipeProjectionFromUnknown(overlayProjection, "audio_recipe").sourceEntryFingerprints.length,
    0,
    "a quote-card template must never be reusable as an audio recipe",
  );

  const transitionTemplate = createStudioAssetLibraryEntry(core({
    logicalId: "quiet-title-dip-v1",
    title: "Quiet title dip",
    assetKind: "transition_template",
    compatibility: {
      families: ["narrated_stock"],
      contentLanes: ["narrated_stock"],
      moduleIds: ["timeline_assemble"],
      treatments: [],
    },
    recipe: {
      version: "studio-asset-recipe/v1",
      promptFragments: ["brief title-to-body dip that preserves the edit cadence"],
      controlValues: { transitionPreset: "dip_to_black", ignoredControl: "never-project-me" },
      instructionFingerprint: digest("quiet title dip v1"),
    },
  }));
  const transitionProjection = studioPostproductionRecipeProjection(
    resolveStudioAssetLibrary({
      request: {
        ownerId: OWNER,
        channelId: CHANNEL,
        family: "narrated_stock",
        contentLane: "narrated_stock",
        moduleId: "timeline_assemble",
        requiredKinds: ["transition_template"],
      },
      entries: [transitionTemplate],
    }),
    "transition_template",
  );
  assert.equal(transitionProjection.transitionPreset, "dip_to_black");
  assert.equal(
    studioPostproductionRecipeProjectionFromUnknown(
      { ...transitionProjection, transitionPreset: "hardcut" },
      "transition_template",
    ).sourceEntryFingerprints.length,
    0,
    "a tampered Studio transition template must be discarded before assembly",
  );

  const directLtxAdapter = createStudioAssetLibraryEntry(core({
    logicalId: "direct-ltx-faceless-mannequin",
    title: "Direct LTX faceless mannequin adapter",
    assetKind: "standard_lora_adapter",
    compatibility: {
      families: ["cinematic"],
      contentLanes: ["cinematic_ai"],
      moduleIds: ["novita_render_video"],
      treatments: [],
      runtimeFingerprint: DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT,
    },
    resource: {
      r2Key: "studio/ltx/faceless-mannequin.safetensors",
      contentSha256: digest("worker-manifest-adapter-bytes"),
      contentType: "application/octet-stream",
      byteLength: 512,
    },
    approval: {
      ...core().approval,
      qualityEvidenceFingerprint: digest("direct-ltx-benchmark"),
    },
    lora: {
      candidateId: "ltx-creative-faceless-mannequin",
      adapterClass: "standard_lora",
      adapterSha256: digest("worker-manifest-adapter-bytes"),
      benchmarkFingerprint: digest("direct-ltx-benchmark"),
      runtimeFingerprint: DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT,
      renderStrength: 0.72,
      controlKinds: [],
      requiresSeriesBinding: false,
    },
    recipe: undefined,
  }));
  const directResolution = resolveStudioAssetLibrary({
    request: {
      ownerId: OWNER,
      channelId: CHANNEL,
      family: "cinematic",
      contentLane: "cinematic_ai",
      moduleId: "novita_render_video",
      runtimeFingerprint: DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT,
      requiredKinds: ["standard_lora_adapter"],
    },
    entries: [directLtxAdapter],
  });
  const directSelection = studioLtxCreativeAdapterSelection(directResolution);
  if (!directSelection || "adapters" in directSelection.selection) {
    throw new Error("expected the legacy one-adapter Studio selection");
  }
  if (directResolution.status === "resolved") {
    const corruptedMixedRuntimeBundle = {
      ...directResolution,
      bundle: {
        ...directResolution.bundle,
        entries: [...directResolution.bundle.entries, ic],
      },
    };
    assert.throws(
      () => studioLtxCreativeAdapterSelection(corruptedMixedRuntimeBundle),
      /IC-LoRA controls require the dedicated ComfyUI\/LTX worker/i,
      "a corrupted mixed bundle must fail rather than silently dropping its IC control on the direct worker",
    );
  }
  assert.equal(directSelection.selection.id, "ltx-creative-faceless-mannequin");
  assert.equal(directSelection.selection.strength, 0.72);
  assert.equal(directSelection.selection.expectedManifestSha256, digest("worker-manifest-adapter-bytes"));
  assert.deepEqual(
    directSelection.targetCharacterRegistryIdentities,
    [],
    "portable quality/style LoRAs are explicitly distinct from character-bound selections",
  );
  const shotSelections = createStudioLtxShotAdapterSelections({
    narrativeShotControlFingerprint: digest("episode-shot-control"),
    shots: [
      {
        shotId: "shot-hero-closeup",
        continuityCharacterRegistryIdentities: [HERO_CHARACTER_REGISTRY],
        selection: exactSeriesCharacterSelection,
      },
      {
        shotId: "shot-establishing",
        continuityCharacterRegistryIdentities: [],
        selection: directSelection,
      },
    ],
  });
  assert.deepEqual(
    studioLtxShotAdapterSelectionsFromUnknown(shotSelections),
    shotSelections,
    "a complete shot map remains fingerprint-bound before it reaches LTX",
  );
  assert.throws(
    () => createStudioLtxShotAdapterSelections({
      narrativeShotControlFingerprint: digest("episode-shot-control"),
      shots: [
        {
          shotId: "shot-wrong-cast",
          continuityCharacterRegistryIdentities: [],
          selection: exactSeriesCharacterSelection,
        },
      ],
    }),
    /complete visible cast/i,
    "a character LoRA cannot be attached to an establishing or another-character shot",
  );
  assert.equal(
    JSON.stringify(directSelection).includes("safetensors"),
    false,
    "the renderer receives a proof-bound candidate selection, never the Studio resource path",
  );
  assert.throws(
    () => studioLtxCreativeAdapterSelectionFromUnknown({ ...directSelection!, fingerprint: digest("adapter-selection-tampered") }),
    /fingerprint/i,
    "a worker-bound Studio selection must reject tampering before direct rendering",
  );
  const { fingerprint: _directEntryFingerprint, ...directAdapterCore } = directLtxAdapter;
  void _directEntryFingerprint;
  const cameraLtxAdapter = createStudioAssetLibraryEntry({
    ...directAdapterCore,
    logicalId: "direct-ltx-deliberate-orbit",
    title: "Direct LTX deliberate orbit",
    resource: {
      r2Key: "studio/ltx/deliberate-orbit.safetensors",
      contentSha256: digest("worker-manifest-orbit-adapter-bytes"),
      contentType: "application/octet-stream",
      byteLength: 512,
    },
    approval: {
      ...directAdapterCore.approval,
      qualityEvidenceFingerprint: digest("direct-ltx-orbit-benchmark"),
    },
    lora: {
      ...directAdapterCore.lora!,
      candidateId: "ltx-creative-deliberate-orbit",
      adapterSha256: digest("worker-manifest-orbit-adapter-bytes"),
      benchmarkFingerprint: digest("direct-ltx-orbit-benchmark"),
      renderStrength: 0.42,
    },
  });
  const { lora: _ignoredLora, resource: _ignoredResource, ...stackBase } = directAdapterCore;
  void _ignoredLora;
  void _ignoredResource;
  const directLtxStack = createStudioAssetLibraryEntry({
    ...stackBase,
    logicalId: "direct-ltx-mannequin-orbit-stack",
    title: "Direct LTX mannequin + orbit stack",
    assetKind: "standard_lora_stack",
    approval: {
      ...stackBase.approval,
      qualityEvidenceFingerprint: digest("mannequin-orbit-review"),
    },
    recipe: {
      version: "studio-asset-recipe/v1",
      promptFragments: [],
      controlValues: {},
      instructionFingerprint: digest("direct-ltx-mannequin-orbit-stack-recipe"),
    },
    loraStack: {
      adapterEntryFingerprints: [directLtxAdapter.fingerprint, cameraLtxAdapter.fingerprint],
      characterRegistryIdentities: [],
      runtimeFingerprint: DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT,
      benchmark: {
        rtx4090ProfileBenchmarked: true,
        visualVerdict: "pass",
        calibratedAdapters: [
          { id: "ltx-creative-faceless-mannequin", strength: 0.72 },
          { id: "ltx-creative-deliberate-orbit", strength: 0.42 },
        ],
        qualityDeltas: [
          { metric: "material_identity_consistency", baselineScore: 7.2, adaptedScore: 8.3 },
          { metric: "camera_motion_adherence", baselineScore: 7.1, adaptedScore: 8.2 },
        ],
        evidence: {
          version: "ltx-creative-adapter-benchmark-evidence/v1",
          evidenceManifestKey: "benchmarks/mannequin-orbit/evidence.json",
          immutableEvidenceObjectVersionId: "r2-version-mannequin-orbit-001",
          evidenceSha256: digest("mannequin-orbit-evidence"),
          outputVideoKey: "benchmarks/mannequin-orbit/output.mp4",
          outputVideoSha256: digest("mannequin-orbit-output"),
          outputDurationMs: 5_000,
          outputArtifactReceiptFingerprint: digest("mannequin-orbit-output-receipt"),
          visualReviewReceiptFingerprint: digest("mannequin-orbit-review"),
          reviewedAt: "2026-08-23T00:00:00Z",
          reviewedBy: "visual-qa",
        },
      },
    },
  });
  const { fingerprint: _directLtxStackFingerprint, ...directLtxStackCore } = directLtxStack;
  void _directLtxStackFingerprint;
  const mismatchedStrengthStack = createStudioAssetLibraryEntry({
    ...directLtxStackCore,
    logicalId: "direct-ltx-mannequin-orbit-mismatched-strength-stack",
    title: "Direct LTX mannequin + orbit mismatched-strength stack",
    loraStack: {
      ...directLtxStackCore.loraStack!,
      benchmark: {
        ...directLtxStackCore.loraStack!.benchmark,
        calibratedAdapters: [
          { id: "ltx-creative-faceless-mannequin", strength: 0.68 },
          { id: "ltx-creative-deliberate-orbit", strength: 0.42 },
        ],
      },
    },
  });
  const mismatchedStrengthResolution = resolveStudioAssetLibrary({
    request: {
      ownerId: OWNER,
      channelId: CHANNEL,
      family: "cinematic",
      contentLane: "cinematic_ai",
      moduleId: "novita_render_video",
      runtimeFingerprint: DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT,
      requiredKinds: ["standard_lora_stack"],
    },
    entries: [mismatchedStrengthStack, directLtxAdapter, cameraLtxAdapter],
  });
  assert.throws(
    () => studioLtxCreativeAdapterSelection(mismatchedStrengthResolution),
    /entry strengths do not match its exact combined benchmark/i,
    "Studio must reject a stack whose stored adapter strengths differ from its retained combined benchmark",
  );
  assert.throws(
    () => createStudioAssetLibraryEntry({
      ...directLtxStackCore,
      loraStack: {
        ...directLtxStackCore.loraStack!,
        adapterEntryFingerprints: [
          ...directLtxStackCore.loraStack!.adapterEntryFingerprints,
          digest("third-direct-ltx-adapter"),
        ],
      },
    }),
    /at most 2 complementary adapters/i,
    "the Studio must reject a third direct LoRA before a stack can be promoted",
  );
  assert.throws(
    () => createStudioAssetLibraryEntry({
      ...directLtxStackCore,
      approval: {
        ...directLtxStackCore.approval,
        qualityEvidenceFingerprint: digest("unrelated-stack-review"),
      },
    }),
    /exact combined-stack visual benchmark/i,
    "a stack cannot inherit a generic approval instead of the exact combined LoRA evidence",
  );
  const { fingerprint: _directLtxAdapterFingerprint, ...directLtxAdapterCore } = directLtxAdapter;
  void _directLtxAdapterFingerprint;
  assert.throws(
    () => createStudioAssetLibraryEntry({
      ...directLtxAdapterCore,
      resource: {
        ...directLtxAdapterCore.resource!,
        contentSha256: digest("wrong-direct-adapter-bytes"),
      },
    }),
    /exact adapter bytes/i,
    "a Studio LoRA record cannot point at bytes other than those in its sealed worker benchmark",
  );
  assert.throws(
    () => createStudioAssetLibraryEntry({
      ...directLtxAdapterCore,
      approval: {
        ...directLtxAdapterCore.approval,
        qualityEvidenceFingerprint: digest("unrelated-direct-review"),
      },
    }),
    /exact benchmark evidence/i,
    "a Studio LoRA record cannot be ranked from unrelated quality evidence",
  );
  const weakerLtxStack = createStudioAssetLibraryEntry({
    ...directLtxStackCore,
    logicalId: "direct-ltx-mannequin-orbit-weaker-stack",
    title: "Direct LTX mannequin + orbit weaker stack",
    approval: {
      ...directLtxStackCore.approval,
      qualityEvidenceFingerprint: digest("mannequin-orbit-weaker-review"),
      qualityScore: 100,
    },
    loraStack: {
      ...directLtxStackCore.loraStack!,
      benchmark: {
        ...directLtxStackCore.loraStack!.benchmark,
        qualityDeltas: [
          { metric: "material_identity_consistency", baselineScore: 7.5, adaptedScore: 8.05 },
          { metric: "camera_motion_adherence", baselineScore: 7.45, adaptedScore: 8.1 },
        ],
        evidence: {
          ...directLtxStackCore.loraStack!.benchmark.evidence,
          visualReviewReceiptFingerprint: digest("mannequin-orbit-weaker-review"),
        },
      },
    },
  });
  const stackResolution = resolveStudioAssetLibrary({
    request: {
      ownerId: OWNER,
      channelId: CHANNEL,
      family: "cinematic",
      contentLane: "cinematic_ai",
      moduleId: "novita_render_video",
      runtimeFingerprint: DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT,
      requiredKinds: ["standard_lora_stack"],
    },
    entries: [weakerLtxStack, directLtxStack, directLtxAdapter, cameraLtxAdapter],
  });
  const stackSelection = studioLtxCreativeAdapterSelection(stackResolution);
  assert.ok(stackSelection && "adapters" in stackSelection.selection);
  assert.deepEqual(
    stackSelection.selection.adapters.map((adapter) => adapter.id),
    ["ltx-creative-faceless-mannequin", "ltx-creative-deliberate-orbit"],
    "the Studio resolves only the exact independently byte-bound stack members from the stronger measured stack",
  );
  assert.deepEqual(
    stackSelection.sourceEntryFingerprints.slice(0, 1),
    [directLtxStack.fingerprint],
    "an unproven manual approval score cannot outrank a stronger exact combined-stack benchmark",
  );
  assert.equal(stackSelection.sourceEntryFingerprints.length, 3);
  const incompleteStack = resolveStudioAssetLibrary({
    request: {
      ownerId: OWNER,
      channelId: CHANNEL,
      family: "cinematic",
      contentLane: "cinematic_ai",
      moduleId: "novita_render_video",
      runtimeFingerprint: DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT,
      requiredKinds: ["standard_lora_stack"],
    },
    entries: [directLtxStack, directLtxAdapter],
  });
  assert.equal(incompleteStack.status, "blocked", "a stack cannot silently lose an exact benchmarked adapter");
  const inventory = studioAssetLibraryInventory([directLtxAdapter, directLtxStack]);
  assert.equal(inventory.length, 2);
  assert.equal(
    inventory.find((asset) => asset.logicalId === "direct-ltx-faceless-mannequin")?.resource?.contentSha256,
    digest("worker-manifest-adapter-bytes"),
  );
  assert.equal(
    inventory.find((asset) => asset.assetKind === "standard_lora_stack")?.loraStack?.adapterCount,
    2,
    "browser-safe Studio inventory exposes the combined benchmarked stack count, never raw adapter paths",
  );
  assert.equal(
    Object.hasOwn(inventory[0]?.resource ?? {}, "r2Key"),
    false,
    "the browser-facing inventory must not expose Studio object locations",
  );

  const tampered = resolveStudioAssetLibrary({ request: request(["camera_recipe"]), entries: [{ ...camera, fingerprint: digest("tampered") }] });
  assert.equal(tampered.status, "blocked", "resolver must not silently admit a malformed/tampered entry");
}

void main();
