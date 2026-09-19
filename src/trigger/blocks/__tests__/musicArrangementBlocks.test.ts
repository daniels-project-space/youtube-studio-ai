import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import type { z } from "zod";
import type { ShowBible } from "@/engine/creative/types";
import {
  AcceptedMusicArrangementSchema,
  type AcceptedMusicArrangementDraft,
} from "@/engine/acceptedMusicArrangement";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { recordModelUsage } from "@/lib/modelUsage";
import { arrangementComposerReservation } from "@/lib/arrangementComposerBudget";
import { openRouterModel } from "@/lib/openRouter";
import type { RunStageSink, StageContext } from "@/engine/types";

type AgentRequest = { role: string; prompt: string; maxTokens: number; temperature: number; schema: z.ZodType; beforeDispatch?: () => Promise<void> };
const calls: AgentRequest[] = [];
let response: unknown;
let providerError: Error | undefined;
let fixtureChargeUsd: number | undefined;
let networkCalls = 0;
let routingProbe = false;
const routedRequests: { tier?: string; system?: string }[] = [];
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { networkCalls++; throw new Error("network forbidden in arrangement tests"); };
loader._load = function (id, ...args) {
  if (id === "@/agents/mastra" && !routingProbe) return {
    agentJsonConfiguration: () => ({ model: openRouterModel("intelligence"), system: "Fixture composer system" }),
    agentJson: async (request: AgentRequest) => {
      await request.beforeDispatch?.();
      calls.push(request);
      if (providerError) throw providerError;
      if (fixtureChargeUsd !== undefined) recordModelUsage({
        provider: "fixture", model: "fixture-composer", kind: "text", reportedCostUsd: fixtureChargeUsd,
      });
      return structuredClone(response);
    },
  };
  if (id === "@/lib/creativeText" && routingProbe) return {
    hasCreativeTextKey: () => true,
    creativeTextJson: async (request: { tier?: string; system?: string }) => {
      routedRequests.push(request);
      return structuredClone(response);
    },
  };
  return originalLoad.call(this, id, ...args);
};

const bible: ShowBible = {
  positioning: "Original instrumental sessions with explicitly authored musical form.",
  vibe: "Unhurried and restrained", iconicMotif: "A quiet horizon",
  worksInSpace: ["Stable focus"], avoidInSpace: ["Unrequested climax"],
  activeCrew: ["composer"], composerDoctrine: "Preserve the requested form without a generic dramatic arc.",
  refreshedAt: 1,
};
const flat: AcceptedMusicArrangementDraft = {
  role: "primary_music", direction: "Flat nocturnal drone. No build, drop, climax, or new motif.",
  requestedDurationSec: 180, form: "continuous", ending: "seamless_wrap", playback: "repeat",
  sections: Array.from({ length: 4 }, (_, index) => ({
    id: `interval-${index + 1}`, label: `Review interval ${index + 1}`,
    startFraction: index / 4, endFraction: (index + 1) / 4, energy: 0.2,
    instruction: "Hold the same steady drone and energy; no build or drop.",
  })),
};
const developing: AcceptedMusicArrangementDraft = {
  role: "narration_bed", direction: "Quiet uncertainty, a restrained turn, then a natural resolution.",
  requestedDurationSec: 120, form: "through_composed", ending: "natural_cadence", playback: "once",
  sections: flat.sections.map((section, index) => ({
    ...section, energy: [0.2, 0.3, 0.4, 0.15][index],
    instruction: ["Enter sparsely.", "Introduce the authored tension.", "Change to the answering harmony.", "Resolve and end naturally."][index],
  })),
};
const seedStore = {
  topic: "Night horizon", showBible: bible, channelSlug: "arrangement-evaluation", channelName: "Arrangement evaluation",
  styleDNA: { audio: { genre: "ambient strings", instrumentation: ["bowed strings"], textures: ["dry room"], bpmRange: [50, 60], moodArc: "steady", loopable: true } },
};
const stageContext = (store: Record<string, unknown> = seedStore): StageContext => ({
  ownerId: "owner-arrangement", channelId: "channel-arrangement", runId: "run-arrangement",
  keyPrefix: "test/arrangement/", budgetUsd: 1,
  stageBudgetUsd: arrangementComposerReservation(openRouterModel("intelligence")),
  assertInlinePaidExecutionLease: async () => {}, params: {}, store, log: () => {},
});

async function main() {
  const load = createRequire(__filename);
  const { registerAllBlocks, _resetBlocks } = load("@/engine/blocks") as typeof import("@/engine/blocks");
  const registry = load("@/engine/registry") as typeof import("@/engine/registry");
  const { runPipeline } = load("@/engine/runner") as typeof import("@/engine/runner");
  const { validatePipeline } = load("@/engine/validate") as typeof import("@/engine/validate");
  const { validateArtifact } = load("@/engine/artifactSchemas") as typeof import("@/engine/artifactSchemas");
  const { composerBriefBlock } = load("../crewBlocks") as typeof import("../crewBlocks");
  const { ARRANGEMENT_COMPOSER_VERSION, musicArrangementPlan } = load("../musicArrangementBlocks") as typeof import("../musicArrangementBlocks");
  const { ComposerBriefWithArrangementSchema } = load("@/engine/creative/crew") as typeof import("@/engine/creative/crew");
  _resetBlocks();
  registerAllBlocks();
  const legacy = registry.getManifest("composer_brief")!;
  const selected = registry.getManifest("composer_brief", ARRANGEMENT_COMPOSER_VERSION)!;
  assert.equal(legacy.block, composerBriefBlock);
  assert.equal(selected.execute, selected.block.run);
  assert.equal(selected.certification.status, "contract");
  assert.ok(!registry.allManifests().includes(selected));
  assert.equal(registry.get("music_arrangement_plan"), musicArrangementPlan);
  assert.equal(legacy.costAndLatency.paid, false);
  assert.equal(selected.costAndLatency.paid, true);
  assert.equal(selected.costAndLatency.maxCostUsd, arrangementComposerReservation(openRouterModel("intelligence")));
  assert.equal(selected.block.paid, true);
  assert.deepEqual(selected.idempotency, { required: true, scope: "run_module" });
  assert.equal(selected.retryAndResume.durableCheckpoint, true);
  assert.ok(selected.securityAndSideEffects.effects.includes("paid_compute"));
  assert.deepEqual(selected.providerProfiles, [{
    id: openRouterModel("intelligence"), provider: "openrouter", quality: "production", allowFallback: false,
  }]);
  assert.ok(!legacy.capabilities.includes("crew.accepted_music_arrangement"));
  assert.deepEqual(selected.capabilities, [...legacy.capabilities, "crew.accepted_music_arrangement"]);
  const callsBeforeValidation = calls.length;
  for (const version of [undefined, legacy.version]) {
    assert.throws(() => validatePipeline([
      { block: "composer_brief", ...(version === undefined ? {} : { version }) },
      { block: "music_arrangement_plan" },
    ], Object.keys(seedStore)), /requires upstream capability "crew\.accepted_music_arrangement"/);
  }
  assert.equal(calls.length, callsBeforeValidation, "legacy pairing is rejected during graph validation before any text purchase");

  for (const arrangement of [flat, developing, { ...flat, ending: "natural_cadence" as const }, { ...developing, playback: "repeat" as const }]) {
    response = { arrangement, duckDb: -15, bedLufs: -20 };
    const outputs: Parameters<NonNullable<RunStageSink["upsertArtifacts"]>>[0][] = [];
    const resolved = validatePipeline([
      { block: "composer_brief", version: ARRANGEMENT_COMPOSER_VERSION, params: { targetSeconds: 1800 } },
      { block: "music_arrangement_plan" },
    ], Object.keys(seedStore));
    const beforeCalls = calls.length;
    const result = await runPipeline(resolved, {
      ...stageContext(), seedStore, defaultRetries: 0,
      sink: { upsert: async () => {}, upsertArtifacts: async (batch) => { outputs.push(batch); } },
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(calls.length, beforeCalls + 1, "only the composer calls the text boundary; planner is deterministic");
    const producedBrief = ComposerBriefWithArrangementSchema.parse(result.store.musicBrief);
    const accepted = AcceptedMusicArrangementSchema.parse(result.store.acceptedMusicArrangement);
    assert.deepEqual(producedBrief.arrangement, arrangement);
    assert.equal(Object.hasOwn(producedBrief.audio, "voiceFx"), false);
    assert.equal(Object.hasOwn(producedBrief.directives as object, "voiceFx"), false);
    assert.equal(producedBrief.musicPrompt, arrangement.direction);
    assert.deepEqual(accepted.arrangement, arrangement, "no inferred sections, normalization, or duration clamp");
    assert.equal(accepted.sourceBriefFingerprint, sha256Hex(canonicalJson(result.store.musicBrief)));
    for (const key of ["ownerId", "channelId", "runId"] as const) assert.equal(accepted[key], stageContext()[key]);
    assert.equal(accepted.topic, seedStore.topic);
    assert.deepEqual(validateArtifact(selected.produces.musicBrief, result.store.musicBrief), result.store.musicBrief);
    const producerRef = outputs.flatMap((batch) => batch.artifacts).find((row) => row.artifact.key === "musicBrief")!;
    assert.equal(producerRef.artifact.producerVersion, ARRANGEMENT_COMPOSER_VERSION);
    assert.ok(outputs.flatMap((batch) => batch.artifacts).some((row) => row.artifact.key === "acceptedMusicArrangement"));
    const request = calls.at(-1)!;
    assert.equal(request.role, "composer_arrangement");
    assert.equal(request.maxTokens, 6000);
    assert.equal(request.temperature, 0.8);
    assert.ok(request.prompt.includes(bible.composerDoctrine!));
    assert.ok(request.prompt.includes("ambient strings"));
    assert.ok(request.prompt.includes("30 min"));
    assert.ok(!request.schema.safeParse({ ...response as object, inventedField: true }).success);

    const plannerContext = stageContext({ topic: seedStore.topic, musicBrief: result.store.musicBrief });
    const first = await musicArrangementPlan.run(plannerContext);
    assert.deepEqual(await musicArrangementPlan.run(plannerContext), first);
    const changedBrief = { ...producedBrief, operatorEvidence: "Full source brief must be bound, not just direction." };
    const changed = AcceptedMusicArrangementSchema.parse((await musicArrangementPlan.run({
      ...plannerContext, store: { ...plannerContext.store, musicBrief: changedBrief },
    })).acceptedMusicArrangement);
    assert.notEqual(changed.sourceBriefFingerprint, accepted.sourceBriefFingerprint);
    assert.deepEqual(changed.arrangement, arrangement);
  }

  const malformed: unknown[] = [
    undefined,
    { ...flat, requestedDurationSec: 301 },
    { ...flat, requestedDurationSec: 9 },
    { ...flat, direction: " " },
    { ...flat, sections: flat.sections.slice(1) },
    { ...flat, sections: flat.sections.map((section) => ({ ...section, id: "duplicate" })) },
    { ...flat, sections: flat.sections.map((section, index) => index === 1 ? { ...section, startFraction: 0.3 } : section) },
    { ...flat, inventedField: "not allowed" },
  ];
  for (const arrangement of malformed) {
    response = { arrangement, duckDb: -15, bedLufs: -20 };
    await assert.rejects(selected.execute(stageContext()));
    const count = calls.length;
    await assert.rejects(musicArrangementPlan.run(stageContext({ topic: seedStore.topic, musicBrief: {
      musicPrompt: flat.direction, audio: { duckDb: -15, bedLufs: -20 }, arrangement,
    } })));
    assert.equal(calls.length, count, "planner never repairs rejected input with a text call");
  }
  response = { musicPrompt: "Prose is not an arrangement", duckDb: -15, bedLufs: -20 };
  await assert.rejects(selected.execute(stageContext()));
  response = { arrangement: flat, duckDb: -15, bedLufs: -20, voiceFx: "telephone" };
  await assert.rejects(selected.execute(stageContext()), /radio/);
  providerError = new Error("composer provider unavailable");
  await assert.rejects(selected.execute(stageContext()), /composer provider unavailable/);
  providerError = undefined;
  fixtureChargeUsd = 0.07; // Synthetic observed-charge evidence, not a provider rate or reservation.
  response = { arrangement: { ...flat, requestedDurationSec: 301 }, duckDb: -15, bedLufs: -20 };
  const failedStages: Parameters<RunStageSink["upsert"]>[0][] = [];
  const failed = await runPipeline(validatePipeline([
    { block: "composer_brief", version: ARRANGEMENT_COMPOSER_VERSION },
    { block: "music_arrangement_plan" },
  ], Object.keys(seedStore)), {
    ...stageContext(), seedStore, defaultRetries: 0,
    sink: { upsert: async (row) => { failedStages.push(row); } },
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.costTotal, fixtureChargeUsd, "schema rejection retains observed usage in the real runner");
  assert.equal(failed.store.acceptedMusicArrangement, undefined);
  assert.ok(failedStages.some((row) => row.status === "failed" && row.cost === fixtureChargeUsd));
  fixtureChargeUsd = undefined;
  response = { musicPrompt: "Legacy prose remains unchanged", duckDb: -12, bedLufs: -22 };
  const legacyOutput = await legacy.execute(stageContext());
  assert.equal((legacyOutput.musicBrief as { musicPrompt: string }).musicPrompt, "Legacy prose remains unchanged");
  assert.equal(Object.hasOwn(legacyOutput.musicBrief as object, "arrangement"), false);
  assert.equal(calls.at(-1)!.maxTokens, 2500);
  await assert.rejects(musicArrangementPlan.run(stageContext({ topic: seedStore.topic, ...legacyOutput })));
  routingProbe = true;
  const { agentJson } = load("@/agents/mastra") as typeof import("@/agents/mastra");
  const arrangementRequest = calls.find((request) => request.role === "composer_arrangement")!;
  response = { arrangement: flat, duckDb: -15, bedLufs: -20 };
  await agentJson({ ...arrangementRequest, role: "composer_arrangement" });
  const legacyRequest = calls.at(-1)!;
  response = { musicPrompt: "Legacy prose remains unchanged", duckDb: -12, bedLufs: -22 };
  await agentJson({ ...legacyRequest, role: "composer" });
  assert.equal(routedRequests.length, 2, "both roles use the actual agentJson route with mocked text transport");
  assert.equal(routedRequests[0].tier, routedRequests[1].tier, "opt-in role preserves the legacy model tier");
  assert.match(routedRequests[0].system ?? "", /unmetered drones are valid/);
  assert.doesNotMatch(routedRequests[0].system ?? "", /BPM band/);
  assert.match(routedRequests[1].system ?? "", /BPM band/, "legacy system instructions remain unchanged");
  assert.equal(networkCalls, 0);
  console.log("MUSIC ARRANGEMENT BLOCKS PASS: actual versioned composer -> typed artifact -> real runner/planner, exact flat/developing forms, independent ending/playback, source binding, fail-closed invalid output, legacy parity; zero live calls");
  _resetBlocks();
}

void main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  loader._load = originalLoad;
  globalThis.fetch = originalFetch;
});
