import assert from "node:assert/strict";

import {
  STUDIO_REUSABLE_MEDIA_VERSION,
  assertStudioReusableMediaEntry,
  createStudioReusableMediaEntry,
  createStudioReusableMediaUsageReceipt,
  resolveStudioReusableMedia,
  studioReusableMediaInventory,
  studioReusableMediaPolicy,
  type StudioReusableMediaEntry,
} from "@/engine/studioReusableMedia";
import { approvedThirdPartyStockSource } from "@/lib/thirdPartyStockEvidence";
import { sha256Hex } from "@/lib/sha256";
import { designPipeline } from "@/engine/designer";
import { FAMILIES, familyDurationContract } from "@/engine/families";

const hash = (value: string) => sha256Hex(value);

function stockEntry(input: {
  ordinal: number;
  channelId?: string;
  durationSec?: number;
  tags?: readonly string[];
  evergreen?: boolean;
  score?: number;
}): StudioReusableMediaEntry {
  const ordinal = input.ordinal;
  return createStudioReusableMediaEntry({
    version: STUDIO_REUSABLE_MEDIA_VERSION,
    logicalId: `stoic_clip_${ordinal}`,
    ownerId: "owner_daniel",
    channelId: input.channelId ?? "channel_stoic",
    family: "narrated_stock",
    nicheKey: "psychology",
    subcategory: "stoicism",
    kind: "b_roll_video",
    status: "approved",
    title: `Stoic ruins ${ordinal}`,
    editorialTags: [...(input.tags ?? ["stoic", "ruins"])],
    evergreen: input.evergreen ?? false,
    resource: {
      r2Key: `owner/owner_daniel/channel/channel_stoic/media-library/${ordinal}.mp4`,
      contentSha256: hash(`clip-${ordinal}`),
      contentType: "video/mp4",
      byteLength: 1_000 + ordinal,
      durationSec: input.durationSec ?? 12,
      width: 3840,
      height: 2160,
    },
    source: {
      origin: "third_party_stock",
      source: approvedThirdPartyStockSource({
        provider: "pexels",
        assetId: `asset-${ordinal}`,
        assetUrl: `https://www.pexels.com/video/${1000 + ordinal}/`,
      }),
      acquiredAt: 1_780_000_000_000 + ordinal,
      relevanceScore: 8.5,
    },
    origin: {
      sourceRunId: `source_run_${ordinal}`,
      finalMasterSha256: hash(`master-${ordinal}`),
      finalMasterReleaseCertificateFingerprint: hash(`certificate-${ordinal}`),
      visualReviewReceiptFingerprint: hash(`review-${ordinal}`),
      qualityEvidenceFingerprint: hash(`quality-${ordinal}`),
    },
    quality: {
      hardGateReady: true,
      calibrationComplete: true,
      finalMasterVisualScore: input.score ?? 9,
      finalMasterVisualMinimumScore: 8,
    },
    maximumLifetimeUses: 6,
    cooldownEpisodes: 2,
  });
}

const exactStoic = studioReusableMediaPolicy({
  family: "narrated_stock",
  nicheKey: "psychology",
  subcategory: "stoicism",
});
assert.equal(exactStoic.mode, "timeline");
assert.equal(exactStoic.maximumTimelineFraction, 0.4);
assert.deepEqual(exactStoic.permittedKinds, ["b_roll_video", "ambient_video", "generated_visual_clip"]);

for (const policy of [
  studioReusableMediaPolicy({ family: "cinematic", nicheKey: "crime", subcategory: "true-crime" }),
  studioReusableMediaPolicy({ family: "whiteboard", nicheKey: "history", subcategory: "world-history" }),
  studioReusableMediaPolicy({ family: "loreshort", nicheKey: "history", subcategory: "wars-empires" }),
]) {
  assert.equal(policy.mode, "forbidden", "crime, history, heist and lore lanes must stay fully original");
  assert.equal(policy.maximumTimelineFraction, 0);
}

assert.equal(
  studioReusableMediaPolicy({ family: "narrated_stock", nicheKey: "psychology", subcategory: "mental-health" }).mode,
  "forbidden",
  "a broad family or niche must never accidentally opt a channel into media reuse",
);
assert.equal(studioReusableMediaPolicy({ family: "sleep", nicheKey: "lifestyle" }).mode, "timeline");
assert.equal(studioReusableMediaPolicy({ family: "music_loop", nicheKey: "lofi" }).mode, "reference_only");

const entries = Array.from({ length: 8 }, (_, index) => stockEntry({
  ordinal: index + 1,
  durationSec: 12,
  tags: index < 5 ? ["stoic", "ruins"] : ["unrelated"],
}));
const baseRequest = {
  ownerId: "owner_daniel",
  channelId: "channel_stoic",
  runId: "run_9",
  family: "narrated_stock" as const,
  nicheKey: "psychology",
  subcategory: "stoicism",
  targetTimelineSeconds: 100,
  perAssetMaximumScreenSeconds: 12,
  queryTags: ["stoic", "ruins"],
  kinds: ["b_roll_video" as const],
};

const ordinary = resolveStudioReusableMedia({
  request: { ...baseRequest, episodeOrdinal: 4 },
  entries: [...entries, stockEntry({ ordinal: 20, channelId: "channel_other", evergreen: true })],
});
assert.equal(ordinary.originalEpisode, false);
assert.equal(ordinary.maximumReusedTimelineSeconds, 40);
assert.equal(ordinary.plannedReusedTimelineSeconds, 40);
assert.equal(ordinary.plannedReusedTimelineFraction, 0.4);
assert.equal(ordinary.selections.length, 4);
assert.equal(ordinary.selections.at(-1)?.plannedScreenSeconds, 4, "the final clip must be trimmed at the hard 40% boundary");
assert(ordinary.selections.every((selection) => selection.r2Key.includes("channel_stoic")), "selection may not cross channels");

const originalThird = resolveStudioReusableMedia({
  request: { ...baseRequest, episodeOrdinal: 6 },
  entries,
});
assert.equal(originalThird.originalEpisode, true);
assert.equal(originalThird.plannedReusedTimelineSeconds, 0);
assert.deepEqual(originalThird.selections, []);
assert(originalThird.blockers.includes("episode_6_is_fully_original"));

const cooledDown = resolveStudioReusableMedia({
  request: { ...baseRequest, episodeOrdinal: 5 },
  entries,
  priorUses: [
    { assetFingerprint: entries[0]!.fingerprint, episodeOrdinal: 4 },
    { assetFingerprint: entries[1]!.fingerprint, episodeOrdinal: 3 },
  ],
});
assert(!cooledDown.selections.some((selection) => selection.assetFingerprint === entries[0]!.fingerprint));
assert(!cooledDown.selections.some((selection) => selection.assetFingerprint === entries[1]!.fingerprint));

const usage = createStudioReusableMediaUsageReceipt({
  plan: ordinary,
  finalMasterSha256: hash("final-master"),
  certificateFingerprint: hash("final-certificate"),
  actualUsage: {
    planFingerprint: ordinary.fingerprint,
    uses: ordinary.selections.map((selection) => ({
      assetFingerprint: selection.assetFingerprint,
      screenSeconds: selection.plannedScreenSeconds,
    })),
    reusedTimelineSeconds: ordinary.plannedReusedTimelineSeconds,
  },
});
assert.equal(usage.reusedTimelineFraction, 0.4);
assert.throws(() => createStudioReusableMediaUsageReceipt({
  plan: ordinary,
  finalMasterSha256: hash("final-master"),
  certificateFingerprint: hash("final-certificate"),
  actualUsage: {
    planFingerprint: ordinary.fingerprint,
    uses: [{ assetFingerprint: hash("unknown-asset"), screenSeconds: 1 }],
    reusedTimelineSeconds: 1,
  },
}), /outside its sealed selection plan/);

const inventory = studioReusableMediaInventory([entries[0]!]);
assert.equal(inventory.length, 1);
assert.equal("r2Key" in inventory[0]!, false, "browser inventory must not expose private object locations");
assert.equal("source" in inventory[0]!, false, "browser inventory must not expose provider source/license bodies");

assert.throws(() => assertStudioReusableMediaEntry({ ...entries[0], title: "tampered" }), /fingerprint/);

const exactVisualSourceByFamily = {
  narrated_stock: "stock_footage",
  music_loop: "keyframes",
  sleep: "stock_footage",
  comic: "motion_comic",
  shorts: "stock_footage",
  documentary_collage_short: "documotion_short",
  whiteboard: "whiteboard_scribe",
  loreshort: "lore_short",
  quizyear: "quiz_year",
  illustrated_explainer: "scene_compiler",
  children_learning: "scene_compiler",
  cinematic: "novita_render_images",
} as const;
for (const family of Object.keys(FAMILIES) as (keyof typeof FAMILIES)[]) {
  const designed = designPipeline({
    family,
    nicheKey: family === "narrated_stock"
      ? "psychology"
      : family === "music_loop"
        ? "lofi"
        : family === "loreshort"
          ? "history"
          : family === "cinematic"
            ? "crime"
            : "educational",
    subcategory: family === "narrated_stock" ? "stoicism" : family === "cinematic" ? "true-crime" : undefined,
    lengthMinutes: familyDurationContract(family).defaultSeconds / 60,
  });
  const reuseIndex = designed.pipeline.findIndex((entry) => entry.block === "studio_reusable_media_resolve");
  assert(reuseIndex >= 0, `${family} must claim an originality/reuse episode before visual sourcing`);
  assert.equal(
    designed.pipeline[reuseIndex + 1]?.block,
    exactVisualSourceByFamily[family],
    `${family} must resolve reuse immediately before its visual source`,
  );
}

console.log("studio reusable media policy and selection contracts passed");
