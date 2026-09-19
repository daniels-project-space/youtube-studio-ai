import assert from "node:assert/strict";
import Module from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  AcceptedMusicArrangementSchema, projectAcceptedMusicArrangementToYuEStyle,
  type AcceptedMusicArrangement, type AcceptedMusicArrangementDraft,
} from "@/engine/acceptedMusicArrangement";
import { compilePipeline, type PipelinePolicy } from "@/engine/pipelineCompiler";
import { runPipeline } from "@/engine/runner";
import { stageReuseHash } from "@/engine/stageReuse";
import type { PipelineEntry, RunStageSink } from "@/engine/types";
import { validatePipeline } from "@/engine/validate";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import {
  createYuE2AcceptedArrangementRequest, validateYuE2EvaluationRequest, YuE2EvaluationClient,
} from "@/lib/yue2Evaluation";

const composerVersion = "2.0.0-accepted-arrangement";
const policy: PipelinePolicy = {
  id: "accepted-arrangement-cpu-handoff", version: "1.0.0", minimumCertification: "contract",
  requiredCapabilities: ["crew.composer_cue_sheet", "music.arrangement.accepted"],
  requireCrewBindings: true, requireStoryAlignmentForGeneratedVisuals: true, allowOpaqueMigrationArtifacts: false,
};
const seedStore = {
  topic: "Explicit synthetic arrangement handoff fixture",
  channelSlug: "arrangement-fixture", channelName: "Arrangement Fixture",
  showBible: { positioning: "Synthetic CPU test, not a production channel", vibe: "stable texture",
    iconicMotif: "none", worksInSpace: [], avoidInSpace: [], activeCrew: ["composer"], refreshedAt: 0 },
};

type Row = Awaited<ReturnType<NonNullable<RunStageSink["getResumeState"]>>>[number];
function localSink() {
  const rows = new Map<string, Row>();
  const artifacts: Array<Parameters<NonNullable<RunStageSink["upsertArtifacts"]>>[0]> = [];
  const sink: RunStageSink = {
    async upsert(args) {
      const previous = rows.get(args.block) ?? { block: args.block, status: "queued" };
      rows.set(args.block, structuredClone({ ...previous,
        ...Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)) }));
    },
    async getResumeState() { return structuredClone([...rows.values()]); },
    async upsertArtifacts(args) { artifacts.push(structuredClone(args)); },
  };
  return { rows, artifacts, sink };
}

function draft(role: AcceptedMusicArrangementDraft["role"], shaped = false): AcceptedMusicArrangementDraft {
  const instructions = shaped
    ? ["Sparse opening texture.", "Introduce the authored soft pulse.", "Withdraw the pulse beneath speech.", "Let the accepted texture end naturally."]
    : Array.from({ length: 4 }, () => "Maintain the same texture and level throughout this interval.");
  return {
    role, direction: "Synthetic evaluation: glass harmonics and soft room texture; no percussion or vocals.",
    requestedDurationSec: role === "short_form_bed" ? 20 : 120,
    form: shaped ? "through_composed" : "continuous",
    ending: shaped ? "natural_cadence" : "seamless_wrap", playback: shaped ? "once" : "repeat",
    sections: instructions.map((instruction, index) => ({ id: `interval-${index + 1}`, label: `Interval ${index + 1}`,
      startFraction: index / 4, endFraction: (index + 1) / 4,
      energy: shaped ? [0.2, 0.4, 0.15, 0.1][index] : 0.25, instruction })),
  };
}

function expectedStyle(arrangement: AcceptedMusicArrangementDraft): string {
  return [
    `Role: ${arrangement.role}.`, `Requested duration: ${arrangement.requestedDurationSec} seconds.`,
    `Form: ${arrangement.form}.`, `Ending: ${arrangement.ending}.`, `Playback: ${arrangement.playback}.`,
    "Technical restriction: instrumental only; no vocals or lyrics.", "Direction:", arrangement.direction,
    "Sections (fractions of the requested duration):",
    ...arrangement.sections.flatMap((section) => [
      `Section ${section.id}: ${section.label}; startFraction ${section.startFraction}; endFraction ${section.endFraction}; energy ${section.energy}.`,
      section.instruction,
    ]),
  ].join("\n");
}

// Also supplies real composer -> planner outputs to the Python HTTP/CLI integration script.
export async function runAcceptedMusicArrangementHandoffTests(): Promise<AcceptedMusicArrangement[]> {
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  const originalFetch = globalThis.fetch;
  let response: unknown;
  let expectedRole = "composer_arrangement";
  let llmCalls = 0;
  let httpCalls = 0;
  let leaseChecks = 0;
  let dispatchChecks = 0;
  const prompts: string[] = [];
  globalThis.fetch = async () => { httpCalls++; throw new Error("handoff fixture forbids every network request"); };
  loader._load = function (id, ...args) {
    if (id === "@/agents/mastra") return {
      ...originalLoad.call(this, id, ...args) as typeof import("@/agents/mastra"),
      agentJson: async (input: { role: string; prompt: string; schema: { parse: (value: unknown) => unknown };
        beforeDispatch?: () => Promise<void> }) => {
        assert.equal(input.role, expectedRole);
        if (input.role === "composer_arrangement") assert.equal(typeof input.beforeDispatch, "function");
        if (input.beforeDispatch) {
          await input.beforeDispatch();
          dispatchChecks++;
        }
        llmCalls++;
        prompts.push(input.prompt);
        return input.schema.parse(structuredClone(response));
      },
    };
    return originalLoad.call(this, id, ...args);
  };
  let resetBlocks: (() => void) | undefined;
  const accepted: AcceptedMusicArrangement[] = [];
  try {
    // Production modules must load after the LLM boundary intercept is installed.
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { registerAllBlocks, _resetBlocks } = require("@/engine/blocks") as typeof import("@/engine/blocks");
    const registry = require("@/engine/registry") as typeof import("@/engine/registry");
    const { composerBriefBlock } = require("../crewBlocks") as typeof import("../crewBlocks");
    /* eslint-enable @typescript-eslint/no-require-imports */
    resetBlocks = _resetBlocks;
    _resetBlocks(); registerAllBlocks(); registerAllBlocks();
    const baseline = registry.getManifest("composer_brief")!;
    const alternate = registry.getManifest("composer_brief", composerVersion)!;
    const planner = registry.getManifest("music_arrangement_plan")!;
    assert.equal(baseline.block, composerBriefBlock);
    assert.notEqual(alternate.block, baseline.block);
    assert.equal(alternate.block.paid, true);
    assert.equal(registry.allManifests().includes(alternate), false);
    assert.equal(planner.produces.acceptedMusicArrangement.opaque, false);
    assert.equal(baseline.capabilities.includes("crew.accepted_music_arrangement"), false);
    assert.ok(alternate.capabilities.includes("crew.accepted_music_arrangement"));
    assert.ok(planner.requiredCapabilities.includes("crew.accepted_music_arrangement"));
    assert.throws(() => validatePipeline([{ block: "composer_brief", version: "unknown-version" }], Object.keys(seedStore)));
    assert.throws(() => compilePipeline(validatePipeline([
      { block: "composer_brief" }, { block: "music_arrangement_plan" },
    ], Object.keys(seedStore)), policy), /requires upstream capability "crew\.accepted_music_arrangement"/);
    assert.equal(llmCalls, 0, "incompatible versions fail at compilation admission before the agent");
    assert.equal(httpCalls, 0, "incompatible versions cannot reach the worker");
    assert.equal(leaseChecks, 0);

    const execute = async (entries: PipelineEntry[], runId: string, lease: "allowed" | "missing" | "denied" = "allowed") => {
      const local = localSink();
      const resolved = validatePipeline(entries, Object.keys(seedStore));
      const compilation = compilePipeline(resolved, { ...policy, requiredCapabilities: [] });
      assert.ok(Number.isFinite(compilation.reservedMaxCostUsd));
      const result = await runPipeline(resolved, {
        ownerId: "owner-arrangement", channelId: "channel-arrangement", runId,
        keyPrefix: "fixtures/accepted-arrangement/", seedStore,
        budgetUsd: Math.max(1, compilation.reservedMaxCostUsd), defaultRetries: 0, sink: local.sink,
        ...(lease === "missing" ? {} : { assertInlinePaidExecutionLease: async () => {
          leaseChecks++;
          if (lease === "denied") throw new Error("fixture lease denied");
        } }),
      });
      return { ...local, result, resolved };
    };
    const entries: PipelineEntry[] = [
      { block: "composer_brief", version: composerVersion }, { block: "music_arrangement_plan" },
    ];
    for (const [index, arrangement] of [
      draft("primary_music"), draft("narration_bed"), draft("meditation_bed"), draft("short_form_bed"),
      draft("narration_bed", true),
    ].entries()) {
      response = { arrangement, duckDb: -12, bedLufs: -22 };
      const compilation = compilePipeline(validatePipeline(entries, Object.keys(seedStore)), policy);
      assert.ok(compilation.reservedMaxCostUsd > 0);
      const callsBefore: number = llmCalls;
      const leasesBefore: number = leaseChecks;
      const dispatchesBefore: number = dispatchChecks;
      const f = await execute(entries, `arrangement-${index}`);
      assert.equal(f.result.ok, true, f.result.error);
      assert.equal(llmCalls, callsBefore + 1, "planner and projection cannot call an LLM");
      assert.equal(dispatchChecks, dispatchesBefore + 1, "the fake agent must exercise the real dispatch gate");
      assert.ok(leaseChecks > leasesBefore, "the paid composer must check its lease");
      assert.equal(f.result.costTotal, 0, "only the explicitly fake LLM was invoked");
      assert.equal(compilation.modules[0].version, composerVersion);
      assert.equal(compilation.modules[1].id, "music_arrangement_plan");
      const artifact = AcceptedMusicArrangementSchema.parse(f.result.store.acceptedMusicArrangement);
      const producedBrief = f.result.store.musicBrief as {
        config: { voiceFx: string }; directives: Record<string, unknown>;
      };
      assert.equal(producedBrief.config.voiceFx, "none", "exercise the real default-none producer path");
      assert.equal(Object.hasOwn(producedBrief.directives, "voiceFx"), false, "producer must omit the JSON-unsafe optional value");
      assert.deepEqual(artifact.arrangement, arrangement, "no downstream authoring or section replacement");
      assert.equal(artifact.sourceBriefFingerprint, sha256Hex(canonicalJson(f.result.store.musicBrief)));
      const records = f.artifacts.flatMap((batch) => batch.artifacts);
      const briefRef = records.find((record) => record.artifact.key === "musicBrief")!.artifact;
      const acceptedRecord = records.find((record) => record.artifact.key === "acceptedMusicArrangement")!;
      assert.equal(briefRef.producerVersion, composerVersion);
      assert.equal(acceptedRecord.artifact.producerModule, "music_arrangement_plan");
      assert.equal(acceptedRecord.artifact.producerVersion, planner.version);
      assert.equal(acceptedRecord.artifact.type, "AcceptedMusicArrangement");
      assert.equal(acceptedRecord.artifact.payloadHash, stageReuseHash(artifact));
      assert.ok(acceptedRecord.inputArtifactIds.includes(briefRef.artifactId));
      const request = createYuE2AcceptedArrangementRequest({ arrangement: artifact, seed: 42, personalCreatorAcknowledged: true });
      assert.equal(request.programFingerprint, artifact.fingerprint);
      assert.equal(request.job.style, expectedStyle(arrangement));
      assert.equal(request.job.style, projectAcceptedMusicArrangementToYuEStyle(artifact));
      assert.doesNotMatch(request.job.style, /Key\/scale:|BPM|melodic lead|climax|tonic|### Arrangement/);
      assert.equal(request.job.lyrics, "");
      assert.deepEqual(validateYuE2EvaluationRequest(request), request);
      assert.equal(createYuE2AcceptedArrangementRequest({ arrangement: artifact, seed: 42, personalCreatorAcknowledged: true }).job.job_id, request.job.job_id);
      accepted.push(artifact);
    }
    assert.equal(new Set(accepted.map((artifact) => artifact.fingerprint)).size, 5);
    assert.ok(prompts.slice(0, 5).every((prompt) => prompt.includes("continuous flat arrangement is valid")));

    for (const lease of ["missing", "denied"] as const) {
      response = { arrangement: draft("primary_music"), duckDb: -12, bedLufs: -22 };
      const callsBefore: number = llmCalls;
      const f = await execute(entries, `lease-${lease}`, lease);
      assert.equal(f.result.ok, false);
      assert.match(f.result.error ?? "", /lease/i);
      assert.equal(llmCalls, callsBefore, "no fake generation is allowed without a live lease");
      assert.equal(f.result.store.acceptedMusicArrangement, undefined);
      assert.equal(f.rows.has("music_arrangement_plan"), false);
      assert.equal(httpCalls, 0);
    }

    for (const invalid of [
      { duckDb: -12, bedLufs: -22 },
      { arrangement: { ...draft("primary_music"), sections: draft("primary_music").sections.map((section) => ({ ...section, inventedTempo: 90 })) }, duckDb: -12, bedLufs: -22 },
      { arrangement: { ...draft("primary_music"), sections: draft("primary_music").sections.map((section, index) => ({ ...section, startFraction: index === 1 ? 0.3 : section.startFraction })) }, duckDb: -12, bedLufs: -22 },
    ]) {
      response = invalid;
      const f = await execute(entries, "invalid-composer");
      assert.equal(f.result.ok, false, "invalid authored arrangement cannot reach planning or a worker");
      assert.equal(f.result.store.acceptedMusicArrangement, undefined);
      assert.equal(f.rows.has("music_arrangement_plan"), false);
      assert.equal(httpCalls, 0);
    }
    expectedRole = "composer";
    response = { musicPrompt: "Legacy composer direction remains unchanged.", duckDb: -12, bedLufs: -22, voiceFx: "radio" };
    // Keep the legacy JSON-unsafe optional-undefined behavior out of this control;
    // its unversioned executable and existing explicit radio setting stay unchanged.
    const legacyEntry = { block: "composer_brief", params: { voiceFx: "radio" } };
    const legacy = await execute([legacyEntry], "legacy-default");
    assert.equal(legacy.result.ok, true, legacy.result.error);
    const legacyBrief = legacy.result.store.musicBrief as Record<string, unknown>;
    assert.equal(legacyBrief.musicPrompt, "Legacy composer direction remains unchanged.");
    assert.equal(legacyBrief.arrangement, undefined);
    assert.equal(legacy.resolved.blocks[0], composerBriefBlock);
    const callsBeforeMissing = llmCalls;
    await assert.rejects(planner.execute({
      ownerId: "owner-arrangement", channelId: "channel-arrangement", runId: "legacy-missing-arrangement",
      keyPrefix: "fixtures/accepted-arrangement/", params: {},
      store: { topic: seedStore.topic, musicBrief: legacyBrief }, budgetUsd: 1, log: () => {},
    }), /arrangement/);
    assert.equal(llmCalls, callsBeforeMissing, "planner cannot invent an arrangement from legacy prose");
    assert.ok(dispatchChecks > 0 && dispatchChecks <= leaseChecks, "every dispatch gate must reassert the lease");

    const request = createYuE2AcceptedArrangementRequest({ arrangement: accepted[0], seed: 42, personalCreatorAcknowledged: true });
    const changed = structuredClone(accepted[0]);
    changed.arrangement.sections[0].energy = 0.9;
    assert.throws(() => createYuE2AcceptedArrangementRequest({ arrangement: changed, seed: 42, personalCreatorAcknowledged: true }));
    const client = new YuE2EvaluationClient({ endpoint: "http://127.0.0.1:1", bearerToken: "fixture-token-".padEnd(40, "x") });
    await assert.rejects(client.evaluate({ ...request, acceptedArrangement: changed }, { submit: true }));
    assert.equal(httpCalls, 0, "missing/tampered/unknown section data never reaches worker HTTP");
    console.log("ACCEPTED MUSIC HANDOFF PASS - five real composer/planner/projection fixtures, strict refusals, typed artifact lineage, unchanged legacy composer; no network");
    return accepted;
  } finally {
    resetBlocks?.();
    loader._load = originalLoad;
    globalThis.fetch = originalFetch;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void runAcceptedMusicArrangementHandoffTests().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
