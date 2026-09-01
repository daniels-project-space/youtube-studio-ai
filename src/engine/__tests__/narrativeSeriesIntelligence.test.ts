import assert from "node:assert/strict";

import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { buildEpisodeGraph } from "@/engine/episodeGraph";
import {
  CharacterSheetSourcePolicySchema,
  acceptCharacterLoRARegistryEntry,
  assessCharacterLoRATrainingAdmission,
  bindNarrativeEpisodeToSeries,
  createCharacterSheetDatasetManifest,
  createCharacterSheetDatasetPlan,
  createNarrativeSeriesPlan,
  createNarrativeShotControlContract,
  narrativeVisualStyleProfile,
  planNarrativeShortsExpansion,
  resolveAcceptedCharacterLoRA,
} from "@/engine/narrativeSeriesIntelligence";
import { planStorySpine } from "@/engine/storySpine";
import { createSerializedProgramEpisodeContext } from "@/lib/serializedProgramEpisodeContext";

const digest = (char: string) => char.repeat(64);

const brief = createChannelProgramBrief({
  family: "cinematic",
  nicheKey: "history",
  concept: "A recurring brick-built adventure series that explains how historic inventions changed everyday life.",
  audience: "Curious viewers who like short character-led explanations of history and technology.",
  locale: "en",
  sampleTopics: ["How a printing press changed a city", "How a bridge changed trade", "How a clock changed work"],
  serializedProgram: {
    version: "serialized_program/v1",
    seriesTitle: "The Workshop Chronicles",
    seriesCount: 8,
  },
});

const seriesPlan = createNarrativeSeriesPlan({
  accountId: "account-daniel",
  channelId: "channel-workshop",
  seriesIdentity: "serialized_program_episode/v1/route-a/workshop/8",
  channelProgramBrief: brief,
  visualStyle: "brick_animation",
  planningHorizonEpisodes: 3,
  episodesPerSeason: 2,
  plannedSeasonCount: 2,
  topicCandidates: [
    {
      topic: "How a printing press changed a city",
      premise: "Mira discovers why a faster way to share ideas changes a whole town.",
      recurringCharacterIds: ["character-mira"],
      discovery: {
        status: "editorial_hypothesis",
        nicheKey: "history",
        audienceNeed: "Understand why printing became a turning point in daily life.",
        queryHypotheses: ["how did the printing press change cities"],
        evidenceRefs: ["research:printing-press-city-context/v1"],
      },
    },
    {
      topic: "How a bridge changed trade",
      premise: "Mira follows a busy route and sees how a bridge shortens the distance between neighbours.",
      recurringCharacterIds: ["character-mira"],
      discovery: {
        status: "editorial_hypothesis",
        nicheKey: "history",
        audienceNeed: "See how infrastructure changes ordinary journeys and trade.",
        queryHypotheses: ["how bridges changed trade"],
        evidenceRefs: ["research:bridge-trade-context/v1"],
      },
    },
    {
      topic: "How a clock changed work",
      premise: "Mira learns why a shared clock changes the rhythm of a growing town.",
      recurringCharacterIds: ["character-mira"],
      discovery: {
        status: "editorial_hypothesis",
        nicheKey: "history",
        audienceNeed: "Understand why shared timekeeping changed work and coordination.",
        queryHypotheses: ["how clocks changed work"],
        evidenceRefs: ["research:timekeeping-work-context/v1"],
      },
    },
  ],
});

assert.equal(seriesPlan.episodes.length, 3);
assert.equal(seriesPlan.episodes[2]?.seasonNumber, 2, "the horizon should look across the next season when configured");
assert.equal(seriesPlan.episodes[0]?.discovery.status, "editorial_hypothesis");
assert.equal(seriesPlan.episodes[0]?.shorts.publishAuthorization, "none", "a prospective Short must never be treated as publishable");
assert.match(seriesPlan.fingerprint, /^[a-f0-9]{64}$/);

for (const style of ["claymotion", "brick_animation", "anime", "drawn"] as const) {
  const profile = narrativeVisualStyleProfile(style);
  assert.equal(profile.style, style);
  assert(profile.characterSheetFocus.length > 0, `${style} needs an explicit continuity focus`);
  assert(profile.storyboardFocus.length > 0, `${style} needs storyboard language`);
}

const spine = planStorySpine({
  topic: "How a printing press changed a city",
  narrationDurationSec: 40,
  sentenceTimings: [
    { text: "Mira finds a printing press and asks how one workshop can change a city.", start: 0, end: 20 },
    { text: "As more pages travel through the streets, neighbours can share ideas far more quickly.", start: 20, end: 40 },
  ],
  styleDNA: { recurringSubject: "Mira", setting: "a bright brick-built printing workshop" },
});

const graph = buildEpisodeGraph({
  seriesId: "series-workshop-chronicles",
  episodeId: "episode-printing-press-city",
  topic: "How a printing press changed a city",
  audience: "general" as const,
  durationSec: 40,
  sources: [
    { id: "source-script-workshop", kind: "script" as const, label: "Approved workshop script", locator: "script://workshop/printing/v1" },
  ],
  characterIds: ["character-mira"],
  settingIds: ["setting-workshop"],
  characters: [{ id: "character-mira", displayName: "Mira", continuityLock: "Mira keeps her yellow jacket, green satchel, and round glasses." }],
  settings: [{ id: "setting-workshop", displayName: "Printing workshop", continuityLock: "Warm brick-built workshop with a blue press and paper trays." }],
  beats: [
    {
      id: "beat-printing-question",
      kind: "question" as const,
      t0: 0,
      t1: 20,
      scenePurpose: "Ask the historic question through Mira's discovery.",
      sourceRefs: ["source-script-workshop"],
      characterIds: ["character-mira"],
      settingId: "setting-workshop",
      text: "Mira finds a printing press and asks how one workshop can change a city.",
      camera: { framing: "medium" as const, move: "push" as const },
      visualState: { action: "Mira studies the blue press and a freshly printed page.", props: ["printing press", "printed page"] },
      transition: "cut" as const,
      storySpineBeatIds: ["beat-0001"],
      storySpineSentenceIds: ["sentence-0001"],
    },
    {
      id: "beat-printing-result",
      kind: "result" as const,
      t0: 20,
      t1: 40,
      scenePurpose: "Show the city receiving ideas more quickly.",
      sourceRefs: ["source-script-workshop"],
      characterIds: ["character-mira"],
      settingId: "setting-workshop",
      text: "As more pages travel through the streets, neighbours can share ideas far more quickly.",
      camera: { framing: "wide" as const, move: "track" as const },
      visualState: { action: "Mira watches printed pages leave the workshop for the city.", props: ["printed pages", "satchel"] },
      transition: "match_cut" as const,
      storySpineBeatIds: ["beat-0002"],
      storySpineSentenceIds: ["sentence-0002"],
    },
  ],
  causalEdges: [
    { id: "edge-printing-result", fromBeatId: "beat-printing-question", toBeatId: "beat-printing-result", relation: "answers" as const, rationale: "The second beat answers the opening question.", sourceRefs: ["source-script-workshop"] },
  ],
});

const context = createSerializedProgramEpisodeContext({
  routeFingerprint: digest("a"),
  routeRunSeedFingerprint: digest("b"),
  runId: "run-printing-1",
  seriesIdentity: seriesPlan.seriesIdentity,
  seriesTitle: seriesPlan.seriesTitle,
  seriesCount: 8,
  episodeNumber: 1,
  topic: graph.topic,
  topicMemoryKey: "topic:printing-city",
  continuity: { arcSummary: "Mira follows ordinary inventions and the people they connect.", entities: [{ name: "Mira", role: "recurring guide" }] },
});

const binding = bindNarrativeEpisodeToSeries({
  plan: seriesPlan,
  serializedEpisodeContext: context,
  episodeGraph: graph,
  storySpine: spine,
});
const controls = createNarrativeShotControlContract({
  binding,
  immutableProjectBriefFingerprint: digest("c"),
  visualStyle: "brick_animation",
  episodeGraph: graph,
  storySpine: spine,
});
assert.equal(controls.visualStyle, "brick_animation");
assert.equal(controls.castLocks[0]?.characterId, "character-mira");
assert(controls.shots.every((shot) => shot.firstFrameConstraint && shot.lastFrameConstraint));
assert.equal(controls.requiredAdapterCapabilities.includes("reusable_cast_or_character_adapter"), true);

const blockedShorts = planNarrativeShortsExpansion({
  seriesPlan,
  episodeBinding: binding,
  episodeGraph: graph,
  parentReleaseReadiness: {
    finalMasterReleaseEvidence: "missing",
    sourceProvenance: "unknown",
    selectedMomentRights: "unknown",
    portraitAssemblyAndReviewEvidence: "missing",
    automaticDraftCreationAllowed: true,
  },
});
assert.equal(blockedShorts.status, "blocked");
assert.equal(blockedShorts.candidates.length, 0);

const candidateShorts = planNarrativeShortsExpansion({
  seriesPlan,
  episodeBinding: binding,
  episodeGraph: graph,
  parentReleaseReadiness: {
    finalMasterReleaseEvidence: "verified",
    finalMasterCertificateFingerprint: digest("d"),
    sourceProvenance: "first_party",
    selectedMomentRights: "cleared",
    automaticDraftCreationAllowed: true,
  },
});
assert.equal(candidateShorts.status, "candidate_briefs_ready");
assert.equal(candidateShorts.automaticAction, "draft_only_after_post_transform_review");
assert.equal(candidateShorts.publishAuthorization, "none");
assert.equal(candidateShorts.candidates[0]?.parentBeatId, "beat-printing-question");

const invalidPortraitRetry = planNarrativeShortsExpansion({
  seriesPlan,
  episodeBinding: binding,
  episodeGraph: graph,
  parentReleaseReadiness: {
    finalMasterReleaseEvidence: "verified",
    finalMasterCertificateFingerprint: digest("d"),
    sourceProvenance: "first_party",
    selectedMomentRights: "cleared",
    portraitAssemblyAndReviewEvidence: "invalid",
    automaticDraftCreationAllowed: true,
  },
});
assert.equal(invalidPortraitRetry.status, "blocked");

const policy = {
  policyFingerprint: digest("e"),
  state: "sealed" as const,
  characterLoRATrainingEnabled: true,
  automaticAdmissionEnabled: true,
  attestedErnieCharacterSheetEnabled: true,
  perCharacterSpendCapCents: 400,
};
const sheetPlan = createCharacterSheetDatasetPlan({
  accountId: "account-daniel",
  channelId: "channel-workshop",
  sealedChannelPolicy: policy,
  character: {
    characterId: "character-mira",
    displayName: "Mira",
    identityLock: "Yellow jacket, green satchel, round glasses, warm curious expression, brick-built proportions.",
    visualStyle: "brick_animation",
  },
  scriptTreatmentFingerprint: digest("f"),
  sourcePolicy: {
    kind: "attested_ernie_character_sheet",
    provider: "novita",
    route: "ernie-image-novita-4090",
    providerReceiptRequired: true,
    outputUse: "one_time_script_derived_character_lora_dataset_only",
    ordinaryProductionVisualUseProhibited: true,
  },
});
assert.equal(sheetPlan.sourcePolicy.kind, "attested_ernie_character_sheet");
assert.equal(sheetPlan.requiredViews.length, 6);

const dataset = createCharacterSheetDatasetManifest({
  plan: sheetPlan,
  assets: sheetPlan.requiredViews.map((view, index) => ({
    view,
    r2Key: `owners/account-daniel/channels/channel-workshop/characters/mira/${view}.png`,
    contentSha256: digest(String(index + 1)),
    assetReceiptFingerprint: digest(String(index + 2)),
  })),
  rights: { status: "verified", scope: "training_and_inference", rightsReceiptFingerprint: digest("1") },
  coverage: { status: "passed", coverageReceiptFingerprint: digest("2") },
});
const admission = assessCharacterLoRATrainingAdmission({
  sealedChannelPolicy: policy,
  sheetPlan,
  datasetManifest: dataset,
  budgetReservation: {
    reservationId: "reservation-mira-001",
    budgetLedgerFingerprint: digest("3"),
    currency: "USD",
    plannedSpendCents: 320,
    reservedCents: 320,
    status: "held",
  },
  capabilityBenchmark: {
    provider: "ltx",
    adapterFlavor: "ic_lora",
    runtimeProfileFingerprint: digest("4"),
    requiredCapabilities: ["character_adapter_loading", "identity_consistency", "first_last_frame_support", "camera_motion_control"],
    status: "passed",
    proofReceiptFingerprint: digest("5"),
  },
  existingRegistryEntries: [],
});
assert.equal(admission.decision, "training_admitted", "all sealed-policy, rights, budget, and benchmark gates must pass before a request is admitted");
if (admission.decision !== "training_admitted") throw new Error("expected admitted character LoRA request");
assert.equal(admission.request.providerInvocation, "not_started", "planning must not call a provider");

const accepted = acceptCharacterLoRARegistryEntry({
  admission,
  acceptedAdapter: {
    provider: "ltx",
    adapterFlavor: "ic_lora",
    runtimeProfileFingerprint: digest("4"),
    adapterReference: "registry://characters/mira/ic-lora/v1",
    lifecycleReceiptFingerprint: digest("6"),
    benchmarkProofReceiptFingerprint: digest("5"),
  },
  now: 1_760_000_000_000,
});
assert.equal(accepted.status, "accepted");
assert.equal(resolveAcceptedCharacterLoRA({ sheetPlan, datasetManifest: dataset, registryEntries: [accepted] })?.registryIdentity, accepted.registryIdentity);
const aboveCap = assessCharacterLoRATrainingAdmission({
  sealedChannelPolicy: policy,
  sheetPlan,
  datasetManifest: dataset,
  budgetReservation: {
    reservationId: "reservation-mira-over-cap",
    budgetLedgerFingerprint: digest("7"),
    currency: "USD",
    plannedSpendCents: 401,
    reservedCents: 401,
    status: "held",
  },
  capabilityBenchmark: {
    provider: "ltx",
    adapterFlavor: "ic_lora",
    runtimeProfileFingerprint: digest("4"),
    requiredCapabilities: ["character_adapter_loading"],
    status: "passed",
    proofReceiptFingerprint: digest("5"),
  },
  existingRegistryEntries: [],
});
assert.equal(aboveCap.decision, "training_blocked", "a held reservation above the sealed per-character cap must fail closed");
const reuse = assessCharacterLoRATrainingAdmission({
  sealedChannelPolicy: policy,
  sheetPlan,
  datasetManifest: dataset,
  budgetReservation: {
    reservationId: "reservation-mira-002",
    budgetLedgerFingerprint: digest("7"),
    currency: "USD",
    plannedSpendCents: 320,
    reservedCents: 320,
    status: "held",
  },
  capabilityBenchmark: {
    provider: "ltx",
    adapterFlavor: "ic_lora",
    runtimeProfileFingerprint: digest("4"),
    requiredCapabilities: ["character_adapter_loading"],
    status: "passed",
    proofReceiptFingerprint: digest("5"),
  },
  existingRegistryEntries: [accepted],
});
assert.equal(reuse.decision, "reuse_accepted", "matching accepted character/spec/dataset must be reused, never retrained");

const disabledPolicy = { ...policy, characterLoRATrainingEnabled: false };
assert.throws(
  () => createCharacterSheetDatasetPlan({
    accountId: "account-daniel",
    channelId: "channel-workshop",
    sealedChannelPolicy: disabledPolicy,
    character: sheetPlan.character,
    scriptTreatmentFingerprint: digest("f"),
    sourcePolicy: sheetPlan.sourcePolicy,
  }),
  /does not enable character LoRA training/i,
);
assert.equal(
  CharacterSheetSourcePolicySchema.safeParse({
    kind: "gpt_image_2_character_sheet_candidate",
    outputUse: "character_lora_dataset_only",
    ordinaryProductionVisualUseProhibited: true,
  }).success,
  false,
  "OpenAI image candidates are not a supported character-sheet source",
);
assert.equal(
  CharacterSheetSourcePolicySchema.safeParse({
    kind: "nano_banana_pro_character_sheet_exception",
    outputUse: "one_time_script_derived_character_lora_dataset_only",
    ordinaryProductionVisualUseProhibited: true,
  }).success,
  false,
  "Nano Banana must remain thumbnail-only",
);

console.log("NARRATIVE SERIES INTELLIGENCE TESTS PASS");
