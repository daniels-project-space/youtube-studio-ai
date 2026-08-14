import assert from "node:assert/strict";
import {
  CHANNEL_INCEPTION_FAMILY_POLICIES,
  CHANNEL_INCEPTION_MODULE_CONTRACTS,
  CHANNEL_INCEPTION_MODULE_KEYS,
  assertChannelInceptionContracts,
} from "@/engine/channelInceptionContracts";
import {
  buildChannelInceptionPlan,
  channelInceptionContentSha256,
  channelInceptionOutputKey,
  channelInceptionStage,
  type ChannelInceptionPlan,
  type ChannelInceptionRequest,
} from "@/engine/channelInceptionPlan";
import { FAMILY_KEYS, type FamilyKey } from "@/engine/families";
import { GOLDEN_MODULES } from "@/engine/golden";
import { catalogExecutionBinding } from "@/engine/goldenExecution";

const PIPELINE_FINGERPRINT = "pipeline-designer-v2026-08-07";

function fixture(
  name: string,
  slug: string,
  family: FamilyKey,
  nicheKey: string,
  overrides: Partial<ChannelInceptionRequest> = {},
): ChannelInceptionRequest {
  return {
    ownerId: "owner_daniel",
    channelRef: `channel:${slug}`,
    name,
    slug,
    family,
    nicheKey,
    locale: "en",
    sourceRevision: `${slug}@2026-08-07`,
    pipelineSourceFingerprint: `${PIPELINE_FINGERPRINT}:${family}`,
    ...overrides,
  };
}

const REAL_FAMILY_FIXTURES: readonly ChannelInceptionRequest[] = [
  fixture("The Quiet Stoic", "quiet-stoic", "narrated_stock", "stoic philosophy wisdom"),
  fixture("Rainy Neon Lofi", "rainy-neon-lofi", "music_loop", "Lo-Fi Music"),
  fixture("Gratitude Springs", "gratitude-springs", "sleep", "ambient sleep meditation"),
  fixture("Inked Histories", "inked-histories", "comic", "History"),
  fixture("Chalk & Compound", "chalk-compound", "whiteboard", "Finance"),
  fixture("Vertical Stoic Cuts", "vertical-stoic-cuts", "shorts", "stoic philosophy resilience"),
  fixture("Cinematic Crime Files", "cinematic-crime-files", "cinematic", "crime history"),
];

function assertTopologicalAndUnique(plan: ChannelInceptionPlan): void {
  const seen = new Set<string>();
  const stageKeys = new Set<string>();
  for (const stage of plan.stages) {
    assert(!seen.has(stage.moduleKey), `${stage.moduleKey} must appear once`);
    assert(!stageKeys.has(stage.stageKey), `${stage.stageKey} must be unique`);
    for (const dependency of stage.dependsOn) {
      assert(seen.has(dependency), `${stage.moduleKey} dependency ${dependency} must be planned first`);
    }
    assert.equal(stage.providerCallsAuthorized, false);
    assert.match(stage.inputFingerprint, /^[a-f0-9]{64}$/);
    assert(stage.idempotencyKey.endsWith(stage.inputFingerprint));
    seen.add(stage.moduleKey);
    stageKeys.add(stage.stageKey);
  }
  const readiness = channelInceptionStage(plan, "channel-inception-readiness")!;
  assert.equal(
    readiness.dependsOn.length,
    plan.stages.length - 1,
    "the materialized readiness tile must consume every included stage receipt",
  );
}

function contractsAreHonestCatalogReferences(): void {
  assert.doesNotThrow(() => assertChannelInceptionContracts());
  assert.equal(CHANNEL_INCEPTION_MODULE_CONTRACTS.length, 10);
  assert.deepEqual(
    Object.keys(CHANNEL_INCEPTION_FAMILY_POLICIES).sort(),
    [...FAMILY_KEYS].sort(),
  );

  for (const contract of CHANNEL_INCEPTION_MODULE_CONTRACTS) {
    assert.equal(contract.certification, "contract");
    assert.equal(contract.catalogStatus, "reference");
    const catalog = GOLDEN_MODULES.find((module) => module.key === contract.key);
    assert(catalog, `${contract.key} must be visible in the catalog`);
    assert.equal(catalog.status, "reference");
    const binding = catalogExecutionBinding(contract.key);
    assert.equal(binding.kind, "catalog-only");
    assert.deepEqual(binding.executableIds, []);
  }
}

function everyFamilyGetsOnlyApplicableModules(): void {
  for (const request of REAL_FAMILY_FIXTURES) {
    const plan = buildChannelInceptionPlan(request);
    assert.equal(plan.mode, "plan-only");
    assert.equal(plan.providerCallsAuthorized, false);
    assertTopologicalAndUnique(plan);
    for (const required of [
      "channel-inception-research",
      "channel-inception-positioning",
      "channel-inception-seo",
      "channel-inception-avatar",
      "channel-inception-banner",
      "channel-inception-thumbnails",
      "channel-inception-pipeline",
      "channel-inception-probe",
      "channel-inception-readiness",
    ] as const) {
      assert(channelInceptionStage(plan, required), `${request.name} must plan ${required}`);
    }
    assert.equal(
      channelInceptionStage(plan, "channel-inception-probe")!.maximumCostUsd,
      request.family === "cinematic" ? 55 : 3,
      `${request.family} must receive its truthful proof-render authority`,
    );

    const voice = channelInceptionStage(plan, "channel-inception-voice");
    if (request.family === "music_loop") {
      assert.equal(voice, undefined, "lofi/music-loop must omit VO entirely");
      assert(plan.omittedModules.some((module) => module.moduleKey === "channel-inception-voice"));
      const seo = channelInceptionStage(plan, "channel-inception-seo")!;
      assert.equal(seo.params.requiresNarrativePlaybook, false);
      const pipeline = channelInceptionStage(plan, "channel-inception-pipeline")!;
      assert(!pipeline.dependsOn.includes("channel-inception-voice"));
    } else {
      assert(voice, `${request.family} is narrated and needs a voice readiness owner`);
      assert(channelInceptionStage(plan, "channel-inception-pipeline")!.dependsOn.includes("channel-inception-voice"));
    }
  }
}

function comicOwnsItsConsumedCast(): void {
  const plan = buildChannelInceptionPlan(
    fixture("Inked Histories", "inked-histories", "comic", "History"),
  );
  const voice = channelInceptionStage(plan, "channel-inception-voice")!;
  assert.equal(voice.executionOwner, "family-engine");
  assert.equal(voice.params.ownership, "family-engine");
  assert.equal(plan.familyPolicy.voiceOwnership, "family-engine");
}

function protectedArtIsIndependentAndNeverOverwritten(): void {
  const quietAvatar = {
    assetKey: "channels/quiet-stoic/art/avatar-approved.png",
    contentFingerprint: "quiet-stoic-avatar-approved-v1",
  };
  const quietBanner = {
    assetKey: "channels/quiet-stoic/art/banner.png",
    contentFingerprint: "quiet-stoic-banner-garbled-v1",
  };
  const base = fixture(
    "The Quiet Stoic",
    "quiet-stoic",
    "narrated_stock",
    "stoic philosophy wisdom",
    {
      brand: {
        avatar: { existing: quietAvatar, protectExisting: true },
        banner: { existing: quietBanner, regenerate: true },
      },
    },
  );
  const plan = buildChannelInceptionPlan(base);
  const avatar = channelInceptionStage(plan, "channel-inception-avatar")!;
  const banner = channelInceptionStage(plan, "channel-inception-banner")!;
  assert.equal(avatar.params.asset.action, "preserve-protected");
  assert.equal(avatar.params.asset.overwriteExisting, false);
  assert.equal(banner.params.banner.action, "generate-versioned-candidate");
  assert.equal(banner.params.banner.overwriteExisting, false);
  assert(!avatar.dependsOn.includes("channel-inception-banner"));
  assert(!banner.dependsOn.includes("channel-inception-avatar"));

  const changedBannerPlan = buildChannelInceptionPlan({
    ...base,
    brand: {
      ...base.brand,
      banner: {
        existing: { ...quietBanner, contentFingerprint: "quiet-stoic-banner-candidate-v2" },
        regenerate: true,
      },
    },
  });
  assert.equal(
    channelInceptionStage(changedBannerPlan, "channel-inception-avatar")!.stageKey,
    avatar.stageKey,
    "banner-only changes must not invalidate the protected avatar stage",
  );
  assert.notEqual(
    channelInceptionStage(changedBannerPlan, "channel-inception-banner")!.stageKey,
    banner.stageKey,
  );
  assert.notEqual(changedBannerPlan.inceptionKey, plan.inceptionKey);
}

function starterSlateReusesAcceptedWork(): void {
  const request = fixture("Neon Rain Penthouse", "neon-rain-penthouse", "music_loop", "Lo-Fi Music", {
    starter: {
      topicCount: 3,
      previewCount: 2,
      acceptedTopicFingerprints: ["topic-b", "topic-a", "topic-a"],
      acceptedPreviewFingerprints: ["preview-a"],
    },
  });
  const plan = buildChannelInceptionPlan(request);
  const thumbnails = channelInceptionStage(plan, "channel-inception-thumbnails")!;
  assert.deepEqual(thumbnails.params.topics.acceptedFingerprints, ["topic-a", "topic-b"]);
  assert.equal(thumbnails.params.topics.missingCount, 1);
  assert.equal(thumbnails.params.previews.missingCount, 1);

  const reordered = buildChannelInceptionPlan({
    ...request,
    starter: {
      ...request.starter,
      acceptedTopicFingerprints: ["topic-a", "topic-b"],
    },
  });
  assert.equal(reordered.inceptionKey, plan.inceptionKey, "equivalent accepted work must dedupe to one plan");
}

function plansAndOutputKeysAreContentAddressed(): void {
  const request = fixture("Gratitude Springs", "gratitude-springs", "sleep", "ambient sleep meditation");
  const plan = buildChannelInceptionPlan(request);
  assert.deepEqual(plan, buildChannelInceptionPlan({ ...request }));
  assert.deepEqual(
    buildChannelInceptionPlan(plan.requestSnapshot),
    plan,
    "the persisted canonical request must reproduce the exact plan on retry",
  );
  const revisedPlan = buildChannelInceptionPlan({ ...request, sourceRevision: "gratitude-springs@2026-08-08" });
  assert.notEqual(revisedPlan.inceptionKey, plan.inceptionKey, "request revisions must version the plan");
  assert.deepEqual(
    revisedPlan.stages.map((stage) => stage.stageKey),
    plan.stages.map((stage) => stage.stageKey),
    "an administrative revision must reuse unchanged content-addressed stage work",
  );
  assert.equal(
    channelInceptionContentSha256({ b: 2, a: 1 }),
    channelInceptionContentSha256({ a: 1, b: 2 }),
  );
  const stage = channelInceptionStage(
    plan,
    "channel-inception-avatar",
  )!;
  const digest = "a".repeat(64);
  const output = channelInceptionOutputKey({
    stageKey: stage.stageKey,
    logicalOutput: "Avatar Candidate",
    contentSha256: digest,
  });
  assert.equal(output, `${stage.stageKey}/outputs/avatar-candidate/${digest}`);
  assert.throws(
    () => channelInceptionOutputKey({ stageKey: stage.stageKey, logicalOutput: "avatar", contentSha256: "bad" }),
    /64-character hex digest/,
  );
}

function optionalProbeAndInvalidIntentsFailSafely(): void {
  const noProbe = buildChannelInceptionPlan({
    ...fixture("Dusk Frequency", "dusk-frequency", "music_loop", "Lo-Fi Music"),
    includeProbe: false,
  });
  assert.equal(channelInceptionStage(noProbe, "channel-inception-probe"), undefined);
  assert(
    noProbe.omittedModules.some(
      (module) => module.moduleKey === "channel-inception-probe" && module.reason === "probe-disabled",
    ),
  );
  assert(!channelInceptionStage(noProbe, "channel-inception-readiness")!.dependsOn.includes("channel-inception-probe"));

  assert.throws(
    () => buildChannelInceptionPlan({
      ...fixture("Rainy Neon Lofi", "rainy-neon-lofi", "music_loop", "Lo-Fi Music"),
      voice: { existingCastFingerprint: "unused-cast" },
    }),
    /omits voice inception/,
  );
  assert.throws(
    () => buildChannelInceptionPlan({
      ...fixture("The Quiet Stoic", "quiet-stoic", "narrated_stock", "stoicism"),
      brand: { avatar: { protectExisting: true } },
    }),
    /cannot be protected without an existing asset/,
  );
  assert.throws(
    () => buildChannelInceptionPlan({
      ...fixture("The Quiet Stoic", "quiet-stoic", "narrated_stock", "stoicism"),
      brand: {
        avatar: {
          existing: { assetKey: "approved-avatar", contentFingerprint: "approved-v1" },
          protectExisting: true,
          regenerate: true,
        },
      },
    }),
    /cannot be protected and regenerated together/,
  );
}

function main(): void {
  assert.deepEqual(
    CHANNEL_INCEPTION_MODULE_CONTRACTS.map((contract) => contract.key),
    [...CHANNEL_INCEPTION_MODULE_KEYS],
  );
  contractsAreHonestCatalogReferences();
  everyFamilyGetsOnlyApplicableModules();
  comicOwnsItsConsumedCast();
  protectedArtIsIndependentAndNeverOverwritten();
  starterSlateReusesAcceptedWork();
  plansAndOutputKeysAreContentAddressed();
  optionalProbeAndInvalidIntentsFailSafely();
  console.log("channel inception contracts and family-aware plan tests passed");
}

main();
