import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/canonicalJson";
import { generationProfile } from "@/engine/generationProfiles";
import { toNovitaPhaseProfile } from "@/lib/novitaRenderFarm";
import {
  NANO_BANANA_THUMBNAIL_PROFILE,
  nanoBananaThumbnailCostUsd,
  nanoBananaThumbnailPromptCostUsd,
} from "@/lib/nanoBananaThumbnailContract";
import {
  makePlanWeekArtifactReceipt,
  makePlanWeekProviderRenderReceipt,
  planWeekNanoBananaRequestContext,
  type LegacyPlanWeekNovitaProviderRenderReceipt,
  type PlanWeekNanoBananaSourceReceipt,
  type PlanWeekRenderScope,
} from "@/lib/planWeekRenderReceipt";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function planWeekProviderResultFixture(
  scope: PlanWeekRenderScope,
  createdAt = 1_900_000_000_000,
): PlanWeekNanoBananaSourceReceipt {
  const profile = NANO_BANANA_THUMBNAIL_PROFILE;
  const sourceKey =
    `owner/${scope.ownerId}/plan-batches/${scope.batchId}/items/${scope.itemId}` +
    `/attempt-${scope.attempt}/nano-banana/source.json`;
  const requestCanonicalJson = canonicalJson({
    apiVersion: profile.apiVersion,
    context: planWeekNanoBananaRequestContext(scope, sourceKey),
    model: profile.model,
    operation: "generateContent",
    body: {
      contents: [{
        parts: [{
          text: "Text-free cinematic fixture. ABSOLUTE RULE — PICTURE ONLY, NO TEXT: no letters.",
        }],
      }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: profile.aspectRatio },
      },
    },
  });
  const promptTokenCount = 120;
  const providerResponseMetadataCanonicalJson = canonicalJson({
    modelVersion: "gemini-2.5-flash-image-2025-08",
    responseId: "fixture-response-1",
    usageMetadata: {
      candidatesTokenCount: 1_290,
      promptTokenCount,
      totalTokenCount: 1_410,
    },
  });
  const prompt = (
    JSON.parse(requestCanonicalJson) as {
      body: { contents: Array<{ parts: Array<{ text: string }> }> };
    }
  ).body.contents[0].parts[0].text;
  return {
    sourceKey,
    provider: profile.provider,
    model: profile.model,
    apiVersion: profile.apiVersion,
    modelVersion: "gemini-2.5-flash-image-2025-08",
    responseId: "fixture-response-1",
    route: profile.route,
    width: profile.providerOutputWidth,
    height: profile.providerOutputHeight,
    promptUtf8Bytes: Buffer.byteLength(prompt, "utf8"),
    promptTokenCount,
    promptCostUsd: nanoBananaThumbnailPromptCostUsd(promptTokenCount),
    outputCostUsd: profile.outputImageUsd,
    costUsd: nanoBananaThumbnailCostUsd(promptTokenCount),
    sourceContentType: "image/png",
    providerRequestCanonicalJson: requestCanonicalJson,
    providerRequestSha256: sha256(`nano-banana-provider\0${requestCanonicalJson}`),
    providerResponseMetadataCanonicalJson,
    providerResponseMetadataSha256: sha256(
      `nano-banana-response-metadata\0${providerResponseMetadataCanonicalJson}`,
    ),
    responseSha256: "b".repeat(64),
    createdAt,
  };
}

/** Historical immutable fixture: validates read compatibility, never a new-write path. */
export function legacyPlanWeekProviderReceiptFixture(
  scope: PlanWeekRenderScope,
  createdAt = 1_800_000_000_000,
): LegacyPlanWeekNovitaProviderRenderReceipt {
  const profile = generationProfile("production");
  const imageProfile = toNovitaPhaseProfile(profile, "image");
  const costUsd = 0.04;
  const billingReceipt = {
    provider: "novita" as const,
    currency: "USD" as const,
    receiptId: "receipt-plan-week-legacy-1",
    gpuSku: "L40S",
    gpuCount: 1,
    gpuSeconds: 5,
    gpuRateUsdPerSecond: 0.008,
    startupUsd: 0,
    storageUsd: 0,
    costUsd,
  };
  const prefix = "owners/o/channels/c/runs/r/plan-week/b/items/i/attempt-1/images";
  const providerJobId = `image-${"c".repeat(32)}`;
  const outputId = "thumbnail-item-legacy";
  const sourceKey = `imagecraft/${prefix}/${providerJobId}/stills/${outputId}.png`;
  const requestCanonicalJson = canonicalJson({
    jobs: [{ id: outputId, prompt: "text-free legacy scene" }],
    jobsSel: "full",
    maxConcurrent: 1,
    maxCostUsd: 0.04,
    nshard: 1,
    prefix,
    profile: imageProfile,
  });
  return {
    version: "plan-week-provider-render/v1",
    ...scope,
    provider: "novita",
    providerJobId,
    sourceKey,
    model: profile.image.model,
    modelRevision: profile.image.revision,
    profileId: profile.id,
    width: profile.image.width,
    height: profile.image.height,
    costUsd,
    runtimeAttestation: {
      provider: "novita",
      capacityMode: profile.infrastructure.capacityMode,
      weightStorage: profile.infrastructure.weightStorage,
      cacheMount: profile.infrastructure.cacheMount,
      checkpointing: profile.infrastructure.checkpointing,
      idleShutdownSeconds: profile.infrastructure.idleShutdownSeconds,
      gpuCount: 1,
      model: profile.image.model,
      revision: profile.image.revision,
      checkpoint: profile.image.checkpoint,
    },
    profileSha256: sha256(canonicalJson(imageProfile)),
    manifestSha256: "d".repeat(64),
    requestSha256: sha256(`image\0${requestCanonicalJson}`),
    requestCanonicalJson,
    billingReceiptSha256: sha256(canonicalJson(billingReceipt)),
    billingReceipt,
    createdAt,
  };
}

export function finalizedPlanWeekRenderReceiptFixture(
  scope: PlanWeekRenderScope,
  createdAt = 1_900_000_000_000,
) {
  const providerReceipt = makePlanWeekProviderRenderReceipt(
    scope,
    planWeekProviderResultFixture(scope, createdAt),
  );
  const artifactReceipt = makePlanWeekArtifactReceipt({
    provider: providerReceipt,
    destinationKey: scope.destinationKey,
    byteLength: 12_345,
    sha256: "d".repeat(64),
    etag: '"etag-1"',
    createdAt: createdAt + 1,
  });
  return { providerReceipt, artifactReceipt };
}
