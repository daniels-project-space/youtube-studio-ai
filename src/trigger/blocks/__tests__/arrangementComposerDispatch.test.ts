import assert from "node:assert/strict";
import { registerAllBlocks, _resetBlocks } from "@/engine/blocks";
import { getManifest } from "@/engine/registry";
import { validatePipeline } from "@/engine/validate";
import { runPipeline } from "@/engine/runner";
import { compilePipeline } from "@/engine/pipelineCompiler";
import { ExecutionError } from "@/engine/executionErrors";
import { agentJsonConfiguration } from "@/agents/mastra";
import { createModelUsageScope, priceModelUsage } from "@/lib/modelUsage";
import {
  arrangementComposerReservation,
  assertArrangementComposerInput,
  ARRANGEMENT_COMPOSER_MAX_INPUT_BYTES,
} from "@/lib/arrangementComposerBudget";
import type { RunStageSink, StageContext } from "@/engine/types";
import { ARRANGEMENT_COMPOSER_VERSION } from "../musicArrangementBlocks";

const seedStore = {
  topic: "Steady unmetered night texture", channelSlug: "composer-dispatch", channelName: "Dispatch fixture",
  showBible: {
    positioning: "Original instrumental drone", vibe: "Flat, no climax", iconicMotif: "None",
    worksInSpace: ["Steady sound"], avoidInSpace: ["Generic build"], activeCrew: ["composer"], refreshedAt: 1,
  },
};
const response = {
  arrangement: {
    role: "primary_music", direction: "Unmetered steady drone without a build or drop.",
    requestedDurationSec: 180, form: "continuous", ending: "seamless_wrap", playback: "repeat",
    sections: Array.from({ length: 4 }, (_, index) => ({
      id: `interval-${index + 1}`, label: `Interval ${index + 1}`,
      startFraction: index / 4, endFraction: (index + 1) / 4, energy: 0.2,
      instruction: "Maintain the same unmetered drone and level.",
    })),
  },
  duckDb: -12, bedLufs: -20,
};

type ResumeRow = Awaited<ReturnType<NonNullable<RunStageSink["getResumeState"]>>>[number];
function localSink() {
  const rows = new Map<string, ResumeRow>();
  const artifacts: Parameters<NonNullable<RunStageSink["upsertArtifacts"]>>[0][] = [];
  const sink: RunStageSink = {
    upsert: async (row) => {
      const previous = rows.get(row.block) ?? { block: row.block, status: "queued" };
      rows.set(row.block, structuredClone({ ...previous,
        ...Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)) }));
    },
    getResumeState: async () => structuredClone([...rows.values()]),
    upsertArtifacts: async (batch) => { artifacts.push(structuredClone(batch)); },
  };
  return { sink, rows, artifacts };
}

async function main() {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalRates = process.env.MODEL_PRICE_OVERRIDES_JSON;
  process.env.OPENROUTER_API_KEY = "offline-arrangement-fixture";
  delete process.env.MODEL_PRICE_OVERRIDES_JSON;
  const model = agentJsonConfiguration("composer_arrangement").model;
  let requests = 0;
  let checks = 0;
  let leaseValid = true;
  let invalidResponse = false;
  const observedCharge = 0.0017; // Fixture invoice, intentionally different from the reservation.
  const lease = async () => {
    checks++;
    if (!leaseValid) throw new ExecutionError("INLINE_PAID_EXECUTION_LEASE_REQUIRED: expired fixture", {
      code: "INLINE_PAID_EXECUTION_LEASE_REQUIRED", retryable: false,
    });
  };
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(init?.method, "POST");
    assert.equal(checks, requests + 1, "a fresh lease check immediately precedes each HTTP purchase");
    requests++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, model);
    assert.equal(body.max_tokens, 6000);
    assert.ok(body.messages.some((message: { content: string }) => message.content.includes("unmetered")));
    return Response.json({
      id: `fixture-${requests}`, model,
      choices: [{ message: { content: JSON.stringify(invalidResponse ? { ...response, arrangement: null } : response) } }],
      usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200,
        cost: observedCharge, is_byok: false },
    });
  };
  try {
    _resetBlocks(); registerAllBlocks();
    const selected = getManifest("composer_brief", ARRANGEMENT_COMPOSER_VERSION)!;
    const reservation = arrangementComposerReservation(model);
    assert.equal(reservation, priceModelUsage({ provider: "openrouter", model, kind: "text",
      inputTokens: 65536 + 1024, outputTokens: 6000 }).costUsd);
    assert.ok(reservation > 0.0225, "reservation includes input, not just the 6000 output tokens");
    assert.equal(selected.costAndLatency.maxCostUsd, reservation);
    const context = (): StageContext => ({
      ownerId: "owner-dispatch", channelId: "channel-dispatch", runId: "run-dispatch",
      keyPrefix: "test/dispatch/", budgetUsd: 1, stageBudgetUsd: reservation,
      params: {}, store: seedStore, log: () => {}, assertInlinePaidExecutionLease: lease,
    });
    const reset = () => { requests = 0; checks = 0; leaseValid = true; invalidResponse = false; };

    for (const stageBudgetUsd of [undefined, NaN, reservation / 2, 2]) {
      await assert.rejects(selected.execute({ ...context(), stageBudgetUsd }), /stage budget/);
      assert.equal(requests, 0);
    }
    const resolved = validatePipeline([
      { block: "composer_brief", version: ARRANGEMENT_COMPOSER_VERSION }, { block: "music_arrangement_plan" },
    ], Object.keys(seedStore));
    const compilation = compilePipeline(resolved, {
      id: "arrangement-dispatch-evaluation", version: "1.0.0", minimumCertification: "contract",
      requiredCapabilities: ["crew.accepted_music_arrangement", "music.arrangement.accepted"],
      requireCrewBindings: true, requireStoryAlignmentForGeneratedVisuals: true, allowOpaqueMigrationArtifacts: false,
    });
    assert.equal(compilation.reservedMaxCostUsd, reservation, "actual compiler reserves the pinned model's bounded request");
    const insufficient = await runPipeline(resolved, {
      ...context(), budgetUsd: reservation / 2, seedStore, defaultRetries: 0, ...localSink(),
    });
    assert.equal(insufficient.ok, false);
    assert.match(insufficient.error ?? "", /budget reservation rejected/);
    assert.equal(requests, 0); assert.equal(checks, 0);

    await assert.rejects(selected.execute({ ...context(), store: { ...seedStore,
      showBible: { ...seedStore.showBible, positioning: "\u00e9".repeat(40_000) },
    } }), /UTF-8 bytes/);
    assert.equal(requests, 0); assert.equal(checks, 0);
    assert.doesNotThrow(() => assertArrangementComposerInput("x".repeat(ARRANGEMENT_COMPOSER_MAX_INPUT_BYTES - 1), "s"));
    assert.throws(() => assertArrangementComposerInput("x".repeat(ARRANGEMENT_COMPOSER_MAX_INPUT_BYTES), "s"), /UTF-8 bytes/);
    assert.throws(() => arrangementComposerReservation("unknown-model"), /unpriced/);

    leaseValid = false;
    await assert.rejects(selected.execute(context()), /expired fixture/);
    assert.equal(requests, 0); assert.equal(checks, 1);
    await assert.rejects(selected.execute({ ...context(), assertInlinePaidExecutionLease: undefined }), /no execution authority/);
    assert.equal(requests, 0);

    reset();
    const scope = createModelUsageScope();
    await scope.run(async () => {
      const first = await selected.execute(context());
      leaseValid = false;
      assert.deepEqual(await selected.execute(context()), first, "memoized valid response reuses without another purchase");
    });
    assert.equal(requests, 1); assert.equal(checks, 1);
    assert.equal(scope.snapshot().costUsd, observedCharge);

    reset();
    const local = localSink();
    const runOptions = { ...context(), seedStore, defaultRetries: 0, ...local,
      rehydrate: async (_id: string, outputs: Record<string, unknown>) => ({ ok: true, outputs: structuredClone(outputs) }),
    };
    const first = await runPipeline(resolved, runOptions);
    assert.equal(first.ok, true, first.error);
    assert.equal(first.costTotal, observedCharge);
    assert.equal(local.rows.get("composer_brief")?.cost, observedCharge);
    const resumed = await runPipeline(resolved, runOptions);
    assert.equal(resumed.ok, true, resumed.error);
    assert.equal(resumed.costTotal, observedCharge);
    assert.equal(requests, 1); assert.equal(checks, 1);

    reset(); invalidResponse = true;
    const failureSink = localSink();
    const failed = await runPipeline(resolved, { ...context(), seedStore, defaultRetries: 0, ...failureSink });
    assert.equal(failed.ok, false);
    assert.equal(failed.costTotal, observedCharge);
    assert.equal(failureSink.rows.get("composer_brief")?.cost, observedCharge);
    assert.equal(failed.store.acceptedMusicArrangement, undefined);
    assert.equal(requests, 1); assert.equal(checks, 1);
    const failedResume = await runPipeline(resolved, { ...context(), seedStore, defaultRetries: 0, ...failureSink });
    assert.equal(failedResume.ok, false, "a paid invalid response cannot be silently repurchased on resume");
    assert.equal(failedResume.costTotal, observedCharge);
    assert.equal(requests, 1); assert.equal(checks, 1);

    const rateKey = `openrouter:${model.replace(/^google\//u, "")}`;
    process.env.MODEL_PRICE_OVERRIDES_JSON = JSON.stringify({ [rateKey]: { inputUsdPerMillion: 2, outputUsdPerMillion: 5 } });
    assert.equal(arrangementComposerReservation(model), (66560 * 2 + 6000 * 5) / 1_000_000);
    assert.equal(selected.costAndLatency.maxCostUsd, arrangementComposerReservation(model));
    reset();
    await assert.rejects(selected.execute(context()), /stage budget/, "changed rates cannot silently outgrow the admitted envelope");
    assert.equal(requests, 0);
    console.log("ARRANGEMENT COMPOSER DISPATCH PASS: real agentJson/OpenRouter HTTP boundary, bounded model-priced admission, stale/missing lease and oversize refusal, cache/resume no repurchase, actual usage once including rejected output");
  } finally {
    _resetBlocks(); globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey;
    if (originalRates === undefined) delete process.env.MODEL_PRICE_OVERRIDES_JSON; else process.env.MODEL_PRICE_OVERRIDES_JSON = originalRates;
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
