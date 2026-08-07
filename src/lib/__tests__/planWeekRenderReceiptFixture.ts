import { createHash } from "node:crypto";
import { generationProfile } from "@/engine/generationProfiles";
import { canonicalJson } from "@/lib/canonicalJson";
import type { NovitaImageProviderReceipt } from "@/lib/novitaMedia";
import { toNovitaPhaseProfile } from "@/lib/novitaRenderFarm";
import {
  makePlanWeekArtifactReceipt,
  makePlanWeekProviderRenderReceipt,
  type PlanWeekRenderScope,
} from "@/lib/planWeekRenderReceipt";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function planWeekProviderResultFixture(): NovitaImageProviderReceipt {
  const profile = generationProfile("production");
  const imageProfile = toNovitaPhaseProfile(profile, "image");
  const costUsd = 0.04;
  const billingReceipt = {
    provider: "novita" as const,
    currency: "USD" as const,
    receiptId: "receipt-plan-week-1",
    gpuSku: "L40S",
    gpuCount: 1,
    gpuSeconds: 5,
    gpuRateUsdPerSecond: 0.008,
    startupUsd: 0,
    storageUsd: 0,
    costUsd,
  };
  const requestCanonicalJson = canonicalJson({
    jobs: [{ id: "thumbnail-item-1", prompt: "text-free scene" }],
    jobsSel: "full",
    maxConcurrent: 1,
    maxCostUsd: 0.04,
    nshard: 1,
    prefix: "owners/o/channels/c/runs/r/plan-week/b/items/i/attempt-1/images",
    profile: imageProfile,
  });
  return {
    key:
      `imagecraft/owners/o/channels/c/runs/r/plan-week/b/items/i/attempt-1/images/` +
      `image-${"b".repeat(32)}/stills/thumbnail-item-1.png`,
    jobId: `image-${"b".repeat(32)}`,
    model: `${profile.image.model}@${profile.image.revision}`,
    profileId: profile.id,
    width: profile.image.width,
    height: profile.image.height,
    costUsd,
    billingReceipt,
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
    manifestSha256: "c".repeat(64),
    requestSha256: sha256(`image\0${requestCanonicalJson}`),
    requestCanonicalJson,
    billingReceiptSha256: sha256(canonicalJson(billingReceipt)),
  };
}

export function finalizedPlanWeekRenderReceiptFixture(
  scope: PlanWeekRenderScope,
  createdAt = 1_900_000_000_000,
) {
  const providerReceipt = makePlanWeekProviderRenderReceipt(
    scope,
    planWeekProviderResultFixture(),
    createdAt,
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
