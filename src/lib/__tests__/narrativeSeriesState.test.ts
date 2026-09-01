import assert from "node:assert/strict";

import {
  acceptCharacterLoRA,
  getAcceptedCharacterLoRA,
  getEpisodeReceiptForRun,
  getSeriesPlan,
  listAcceptedCharacterLoRAsForOwner,
  recordCharacterLoRATrainingRequest,
  recordCharacterSheetDataset,
  recordCharacterSheetDatasetPlan,
  recordEpisodeReceipt,
  recordSeriesPlan,
} from "../../../convex/narrativeSeriesState";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { buildEpisodeGraph } from "@/engine/episodeGraph";
import {
  assessCharacterLoRATrainingAdmission,
  bindNarrativeEpisodeToSeries,
  createCharacterSheetDatasetManifest,
  createCharacterSheetDatasetPlan,
  createNarrativeSeriesPlan,
  createNarrativeShotControlContract,
} from "@/engine/narrativeSeriesIntelligence";
import { planStorySpine } from "@/engine/storySpine";
import { createSerializedProgramEpisodeContext } from "@/lib/serializedProgramEpisodeContext";

type Stored = Record<string, unknown> & { _id: string };

const OWNER = "owner_a";
const CHANNEL = "channel_a";
const RUN = "run_a";
const digest = (character: string) => character.repeat(64);

function identity(role: "owner" | "service", ownerId = OWNER) {
  return {
    subject: role === "owner" ? ownerId : "service:youtube-studio-ai",
    issuer: "https://youtube-studio-ai.local",
    tokenIdentifier: `test|${role}`,
    role,
    owner_id: ownerId,
  };
}

function createMemoryState() {
  const tables = new Map<string, Stored[]>();
  const documents = new Map<string, Stored>([
    [CHANNEL, { _id: CHANNEL, ownerId: OWNER }],
    [RUN, { _id: RUN, ownerId: OWNER, channelId: CHANNEL }],
  ]);
  let next = 0;

  const rows = (table: string): Stored[] => {
    const existing = tables.get(table);
    if (existing) return existing;
    const created: Stored[] = [];
    tables.set(table, created);
    return created;
  };

  const db = {
    normalizeId: (_table: string, value: string) => value,
    get: async (id: string) => documents.get(String(id)) ?? null,
    query: (table: string) => ({
      withIndex: (
        _index: string,
        select: (query: { eq: (field: string, value: unknown) => unknown }) => unknown,
      ) => {
        const predicates: Array<readonly [string, unknown]> = [];
        const query = {
          eq(field: string, value: unknown) {
            predicates.push([field, value]);
            return query;
          },
        };
        select(query);
        const matches = () => rows(table).filter((row) =>
          predicates.every(([field, value]) => row[field] === value),
        );
        return {
          first: async () => matches()[0] ?? null,
          unique: async () => {
            const found = matches();
            if (found.length > 1) throw new Error(`test database unique index collision in ${table}`);
            return found[0] ?? null;
          },
          collect: async () => matches(),
        };
      },
    }),
    insert: async (table: string, value: Record<string, unknown>) => {
      const id = `${table}:${++next}`;
      const row = { ...value, _id: id } as Stored;
      rows(table).push(row);
      documents.set(id, row);
      return id;
    },
  };

  return {
    rows,
    context(role: "owner" | "service", ownerId = OWNER) {
      return {
        auth: { getUserIdentity: async () => identity(role, ownerId) },
        db,
      };
    },
  };
}

async function invoke<T>(definition: unknown, context: unknown, args: unknown): Promise<T> {
  return await (definition as {
    _handler: (handlerContext: unknown, handlerArgs: unknown) => Promise<T>;
  })._handler(context, args);
}

async function expectRejected(operation: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(operation, pattern);
}

function createFixture() {
  const programBrief = createChannelProgramBrief({
    family: "cinematic",
    nicheKey: "history",
    concept: "A recurring brick-built adventure series that explains how ordinary inventions changed daily life.",
    audience: "Curious viewers who enjoy character-led explanations of history and technology.",
    locale: "en",
    sampleTopics: ["How a printing press changed a city"],
    serializedProgram: {
      version: "serialized_program/v1",
      seriesTitle: "The Workshop Chronicles",
      seriesCount: 8,
    },
  });
  const seriesPlan = createNarrativeSeriesPlan({
    accountId: OWNER,
    channelId: CHANNEL,
    seriesIdentity: "serialized_program_episode/v1/route-a/workshop/8",
    channelProgramBrief: programBrief,
    visualStyle: "brick_animation",
    planningHorizonEpisodes: 1,
    topicCandidates: [{
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
    }],
  });
  const storySpine = planStorySpine({
    topic: "How a printing press changed a city",
    narrationDurationSec: 40,
    sentenceTimings: [
      { text: "Mira finds a printing press and asks how one workshop can change a city.", start: 0, end: 20 },
      { text: "As more pages travel through the streets, neighbours can share ideas quickly.", start: 20, end: 40 },
    ],
    styleDNA: { recurringSubject: "Mira", setting: "a bright brick-built printing workshop" },
  });
  const episodeGraph = buildEpisodeGraph({
    seriesId: "series-workshop-chronicles",
    episodeId: "episode-printing-press-city",
    topic: "How a printing press changed a city",
    audience: "general" as const,
    durationSec: 40,
    sources: [{ id: "source-script", kind: "script" as const, label: "Approved script", locator: "script://workshop/printing/v1" }],
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
        sourceRefs: ["source-script"],
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
        sourceRefs: ["source-script"],
        characterIds: ["character-mira"],
        settingId: "setting-workshop",
        text: "As more pages travel through the streets, neighbours can share ideas quickly.",
        camera: { framing: "wide" as const, move: "track" as const },
        visualState: { action: "Mira watches printed pages leave the workshop for the city.", props: ["printed pages", "satchel"] },
        transition: "match_cut" as const,
        storySpineBeatIds: ["beat-0002"],
        storySpineSentenceIds: ["sentence-0002"],
      },
    ],
    causalEdges: [{
      id: "edge-printing-result",
      fromBeatId: "beat-printing-question",
      toBeatId: "beat-printing-result",
      relation: "answers" as const,
      rationale: "The second beat answers the opening question.",
      sourceRefs: ["source-script"],
    }],
  });
  const serializedContext = createSerializedProgramEpisodeContext({
    routeFingerprint: digest("a"),
    routeRunSeedFingerprint: digest("b"),
    runId: RUN,
    seriesIdentity: seriesPlan.seriesIdentity,
    seriesTitle: seriesPlan.seriesTitle,
    seriesCount: 8,
    episodeNumber: 1,
    topic: episodeGraph.topic,
    topicMemoryKey: "topic:printing-city",
    continuity: { arcSummary: "Mira follows ordinary inventions and the people they connect.", entities: [{ name: "Mira", role: "recurring guide" }] },
  });
  const episodeBinding = bindNarrativeEpisodeToSeries({
    plan: seriesPlan,
    serializedEpisodeContext: serializedContext,
    episodeGraph,
    storySpine,
  });
  const shotControl = createNarrativeShotControlContract({
    binding: episodeBinding,
    immutableProjectBriefFingerprint: digest("c"),
    visualStyle: "brick_animation",
    episodeGraph,
    storySpine,
  });
  const policy = {
    policyFingerprint: digest("d"),
    state: "sealed" as const,
    characterLoRATrainingEnabled: true,
    automaticAdmissionEnabled: true,
    attestedErnieCharacterSheetEnabled: true,
    perCharacterSpendCapCents: 400,
  };
  const sheetPlan = createCharacterSheetDatasetPlan({
    accountId: OWNER,
    channelId: CHANNEL,
    sealedChannelPolicy: policy,
    character: {
      characterId: "character-mira",
      displayName: "Mira",
      identityLock: "Yellow jacket, green satchel, round glasses, warm curious expression, brick-built proportions.",
      visualStyle: "brick_animation",
    },
    scriptTreatmentFingerprint: digest("e"),
    sourcePolicy: {
      kind: "attested_ernie_character_sheet",
      provider: "novita",
      route: "ernie-image-novita-4090",
      providerReceiptRequired: true,
      outputUse: "one_time_script_derived_character_lora_dataset_only",
      ordinaryProductionVisualUseProhibited: true,
    },
  });
  const dataset = createCharacterSheetDatasetManifest({
    plan: sheetPlan,
    assets: sheetPlan.requiredViews.map((view, index) => ({
      view,
      r2Key: `owners/${OWNER}/channels/${CHANNEL}/characters/mira/${view}.png`,
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
  if (admission.decision !== "training_admitted") throw new Error("fixture expected an admitted LoRA request");
  return { seriesPlan, serializedContext, episodeBinding, shotControl, sheetPlan, dataset, admission: admission.request };
}

async function main() {
  const state = createMemoryState();
  const service = state.context("service");
  const owner = state.context("owner");
  const fixture = createFixture();

  // Browser identities may read their own channel state, but cannot freeze
  // plans, create training requests, or manufacture adapter receipts.
  await expectRejected(
    () => invoke(recordSeriesPlan, owner, { ownerId: OWNER, channelId: CHANNEL, plan: fixture.seriesPlan }),
    /requires the bound studio service identity/i,
  );
  assert.equal(state.rows("narrativeSeriesPlans").length, 0, "owner-denied writes must leave no state behind");

  const seriesPlanId = await invoke<string>(recordSeriesPlan, service, {
    ownerId: OWNER,
    channelId: CHANNEL,
    plan: fixture.seriesPlan,
  });
  assert.equal(
    await invoke<string>(recordSeriesPlan, service, { ownerId: OWNER, channelId: CHANNEL, plan: fixture.seriesPlan }),
    seriesPlanId,
    "identical series-plan retries must return the frozen row",
  );
  const savedPlan = await invoke<Stored | null>(getSeriesPlan, owner, {
    ownerId: OWNER,
    channelId: CHANNEL,
    fingerprint: fixture.seriesPlan.fingerprint,
  });
  assert.equal(savedPlan?._id, seriesPlanId);
  await expectRejected(
    () => invoke(getSeriesPlan, state.context("owner", "owner_b"), {
      ownerId: "owner_b",
      channelId: CHANNEL,
      fingerprint: fixture.seriesPlan.fingerprint,
    }),
    /Studio resource access denied/i,
  );
  await expectRejected(
    () => invoke(recordSeriesPlan, state.context("service", "owner_b"), {
      ownerId: "owner_b",
      channelId: CHANNEL,
      plan: fixture.seriesPlan,
    }),
    /Studio resource access denied/i,
  );
  assert.equal(state.rows("narrativeSeriesPlans").length, 1, "cross-owner access must not create or change plans");

  state.rows("serializedProgramEpisodes").push({
    _id: "serialized-episode-a",
    ownerId: OWNER,
    channelId: CHANNEL,
    seriesIdentity: fixture.seriesPlan.seriesIdentity,
    runId: RUN,
    status: "completed",
    episodeNumber: 1,
    serializedProgramEpisodeContext: fixture.serializedContext,
  });
  const episodeReceiptId = await invoke<string>(recordEpisodeReceipt, service, {
    ownerId: OWNER,
    channelId: CHANNEL,
    runId: RUN,
    seriesPlanFingerprint: fixture.seriesPlan.fingerprint,
    episodeBinding: fixture.episodeBinding,
    shotControl: fixture.shotControl,
  });
  assert.equal(
    await invoke<string>(recordEpisodeReceipt, service, {
      ownerId: OWNER,
      channelId: CHANNEL,
      runId: RUN,
      seriesPlanFingerprint: fixture.seriesPlan.fingerprint,
      episodeBinding: fixture.episodeBinding,
      shotControl: fixture.shotControl,
    }),
    episodeReceiptId,
    "a run can only retain one identical frozen episode receipt",
  );
  const savedEpisode = await invoke<Stored | null>(getEpisodeReceiptForRun, owner, {
    ownerId: OWNER,
    channelId: CHANNEL,
    runId: RUN,
  });
  assert.equal(savedEpisode?._id, episodeReceiptId);

  const sheetPlanId = await invoke<string>(recordCharacterSheetDatasetPlan, service, {
    ownerId: OWNER,
    channelId: CHANNEL,
    plan: fixture.sheetPlan,
  });
  assert.equal(state.rows("characterSheetDatasetPlans").length, 1);
  assert.ok(sheetPlanId);
  const datasetId = await invoke<string>(recordCharacterSheetDataset, service, {
    ownerId: OWNER,
    channelId: CHANNEL,
    sheetPlanFingerprint: fixture.sheetPlan.fingerprint,
    manifest: fixture.dataset,
  });
  assert.ok(datasetId);

  const requestResult = await invoke<{
    kind: string;
    trainingRequestId?: string;
    registryIdentity: string;
  }>(recordCharacterLoRATrainingRequest, service, {
    ownerId: OWNER,
    channelId: CHANNEL,
    sheetPlanFingerprint: fixture.sheetPlan.fingerprint,
    datasetFingerprint: fixture.dataset.fingerprint,
    request: fixture.admission,
  });
  assert.equal(requestResult.kind, "recorded");
  assert.equal(state.rows("characterLoRATrainingRequests").length, 1);
  assert.equal((state.rows("characterLoRATrainingRequests")[0]?.request as { providerInvocation?: string }).providerInvocation, "not_started");
  const repeatedRequest = await invoke<{
    kind: string;
    trainingRequestId?: string;
    registryIdentity: string;
  }>(recordCharacterLoRATrainingRequest, service, {
    ownerId: OWNER,
    channelId: CHANNEL,
    sheetPlanFingerprint: fixture.sheetPlan.fingerprint,
    datasetFingerprint: fixture.dataset.fingerprint,
    request: fixture.admission,
  });
  assert.equal(repeatedRequest.kind, "wait_for_existing", "an admitted request is a one-time durable handoff");
  assert.equal(state.rows("characterLoRATrainingRequests").length, 1);

  const registryEntryId = await invoke<string>(acceptCharacterLoRA, service, {
    ownerId: OWNER,
    channelId: CHANNEL,
    trainingRequestFingerprint: fixture.admission.fingerprint,
    acceptedAdapter: {
      provider: "ltx",
      adapterFlavor: "ic_lora",
      runtimeProfileFingerprint: digest("4"),
      adapterReference: "registry://characters/mira/ic-lora/v1",
      lifecycleReceiptFingerprint: digest("6"),
      benchmarkProofReceiptFingerprint: digest("5"),
    },
  });
  assert.equal(
    await invoke<string>(acceptCharacterLoRA, service, {
      ownerId: OWNER,
      channelId: CHANNEL,
      trainingRequestFingerprint: fixture.admission.fingerprint,
      acceptedAdapter: {
        provider: "ltx",
        adapterFlavor: "ic_lora",
        runtimeProfileFingerprint: digest("4"),
        adapterReference: "registry://characters/mira/ic-lora/v1",
        lifecycleReceiptFingerprint: digest("6"),
        benchmarkProofReceiptFingerprint: digest("5"),
      },
    }),
    registryEntryId,
    "accepted LoRA receipt retries must be idempotent",
  );
  const reusable = await invoke<Stored | null>(getAcceptedCharacterLoRA, owner, {
    ownerId: OWNER,
    channelId: CHANNEL,
    characterId: fixture.sheetPlan.character.characterId,
    characterSpecFingerprint: fixture.sheetPlan.characterSpecFingerprint,
  });
  assert.equal(reusable?._id, registryEntryId);
  const newAttempt = await invoke<{
    kind: string;
    registryIdentity: string;
  }>(recordCharacterLoRATrainingRequest, service, {
    ownerId: OWNER,
    channelId: CHANNEL,
    sheetPlanFingerprint: fixture.sheetPlan.fingerprint,
    datasetFingerprint: fixture.dataset.fingerprint,
    request: fixture.admission,
  });
  assert.equal(newAttempt.kind, "reuse_accepted", "accepted character adapters must be reused, never re-requested");
  assert.equal(state.rows("characterLoRARegistryEntries").length, 1);

  const inventory = await invoke<Array<Record<string, unknown>>>(listAcceptedCharacterLoRAsForOwner, service, {
    ownerId: OWNER,
  });
  assert.equal(inventory.length, 1, "the Studio inventory should expose the one accepted reusable adapter");
  assert.equal(inventory[0]?.characterId, fixture.sheetPlan.character.characterId);
  assert.equal(inventory[0]?.provider, "ltx");
  assert.equal(inventory[0]?.adapterFlavor, "ic_lora");
  assert.equal(inventory[0]?.registryIdentity, reusable?.registryIdentity);
  assert.ok(!("adapterReference" in (inventory[0] ?? {})), "Studio inventory must never expose adapter locations");
  await expectRejected(
    () => invoke(listAcceptedCharacterLoRAsForOwner, owner, { ownerId: OWNER }),
    /requires the bound studio service identity/i,
  );

  console.log("NARRATIVE SERIES STATE TESTS PASS");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
