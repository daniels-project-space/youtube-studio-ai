import assert from "node:assert/strict";
import { registerAllBlocks, _resetBlocks } from "@/engine/blocks";
import { _clear, allManifests, getManifest, registerManifest, registerManifestVersion } from "@/engine/registry";
import { runPipeline } from "@/engine/runner";
import { validatePipeline } from "@/engine/validate";
import { COST_PATCH_KEY, type RunStageSink, type StageContext } from "@/engine/types";
import { recordModelUsage } from "@/lib/modelUsage";
import { music } from "../musicBlocks";
import { createProviderAwareMusicManifest, MUSIC_PROVIDER_OUTPUTS_VERSION } from "../providerAwareMusic";

type Row = Awaited<ReturnType<NonNullable<RunStageSink["getResumeState"]>>>[number];
function localSink() {
  const rows = new Map<string, Row>();
  const sink: RunStageSink = {
    async upsert(value) {
      const prior = rows.get(value.block) ?? { block: value.block, status: "queued" };
      rows.set(value.block, structuredClone({ ...prior,
        ...Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) }));
    },
    async getResumeState() { return structuredClone([...rows.values()]); },
  };
  return { rows, sink };
}
const base = {
  musicKey: "owner/fixture/runs/music/music.mp3", musicProvider: "mureka",
  musicUrl: "https://synthetic.invalid/music.mp3",
  channelMusicProgramKey: "owner/fixture/runs/music/program.json",
  channelMusicProgramFingerprint: "a".repeat(64),
  musicQualityReviewStatus: "not-required-provider-route",
  musicRuntimeReceiptKey: undefined, musicNativeWavKey: undefined,
  [COST_PATCH_KEY]: 0.03,
};
const context: StageContext = {
  ownerId: "fixture", channelId: "channel", runId: "music", keyPrefix: "owner/fixture/",
  params: {}, store: { topic: "Synthetic score" }, budgetUsd: 100, log: () => {},
};

async function main() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("provider contract test forbids network"); };
  try {
    _resetBlocks(); registerAllBlocks();
    const original = getManifest("music")!;
    assert.equal(original.block, music);
    assert.ok(original.produces.musicRuntimeReceiptKey);
    const registered = getManifest("music", MUSIC_PROVIDER_OUTPUTS_VERSION)!;
    assert.ok(registered.produces.channelMusicProgramKey);
    assert.ok(registered.optionalProduces.musicRuntimeReceiptKey);
    assert.ok(!registered.produces.musicRuntimeReceiptKey);
    assert.ok(!allManifests().includes(registered));

    let calls = 0;
    let response: Record<string, unknown> | null | undefined = { ...base };
    let scopedCharge = 0;
    let received: StageContext | undefined;
    const fakeLegacy = { ...original, block: { ...original.block, run: async (ctx: StageContext) => {
      calls++; received = ctx;
      if (scopedCharge) recordModelUsage({ provider: "fixture", model: "fixture-model", kind: "text", reportedCostUsd: scopedCharge });
      // Malformed delegate fixtures intentionally cross the typed boundary.
      return structuredClone(response) as Record<string, unknown>;
    } } };
    const selected = createProviderAwareMusicManifest(fakeLegacy);
    for (const provider of ["mureka", "suno"] as const) {
      response = { ...base, musicProvider: provider };
      const patch = await selected.execute(context);
      assert.equal(received, context, "generator receives the original context unchanged");
      assert.equal(patch.musicProvider, provider);
      assert.equal(patch[COST_PATCH_KEY], 0.03);
      assert.ok(!("musicRuntimeReceiptKey" in patch));
      assert.ok(!("musicNativeWavKey" in patch));
    }
    for (const status of ["awaiting-human-audition", "passed-prepared-weekly-audition"]) {
      response = { ...base, musicProvider: "minimax_music3", musicQualityReviewStatus: status,
        musicRuntimeReceiptKey: "owner/fixture/runtime.json", musicNativeWavKey: "owner/fixture/native.wav" };
      assert.deepEqual(await selected.execute(context), response, "MiniMax evidence and pending/approved state stay intact");
    }
    const before = calls;
    for (const raw of ["owner/fixture/reused.wav", "", null]) {
      await assert.rejects(selected.execute({ ...context, store: { ...context.store, reuseMusicKey: raw } }), /raw reuseMusicKey/);
    }
    assert.equal(calls, before, "unproven reuse refuses before any generation");
    response = { ...base };
    const prepared = { ...context, store: { ...context.store, preparedMusic: { sentinel: "validated-by-real-delegate" } } };
    await selected.execute(prepared);
    assert.equal(received, prepared, "the wrapper does not substitute its own prepared-music validator");

    for (const patch of [
      { musicProvider: "reuse" }, { musicProvider: "unknown" }, { musicKey: " " },
      { channelMusicProgramKey: undefined }, { channelMusicProgramFingerprint: "bad" },
      { musicProvider: "minimax_music3", musicQualityReviewStatus: "awaiting-human-audition" },
      { musicProvider: "minimax_music3", musicRuntimeReceiptKey: "receipt", musicNativeWavKey: "native" },
      { musicRuntimeReceiptKey: "foreign-provider-receipt" },
      { musicQualityReviewStatus: "passed-prepared-weekly-audition" }, { [COST_PATCH_KEY]: NaN },
    ]) {
      response = { ...base, ...patch };
      await assert.rejects(selected.execute(context), /PAID_STAGE_RECONCILIATION_REQUIRED/);
    }

    _clear(); registerManifest(fakeLegacy); registerManifestVersion(selected);
    const resolved = validatePipeline([{ block: "music", version: MUSIC_PROVIDER_OUTPUTS_VERSION }], ["topic"]);
    response = { ...base };
    const passed = await runPipeline(resolved, { ...context, seedStore: context.store, defaultRetries: 0, sink: localSink().sink });
    assert.equal(passed.ok, true, passed.error);
    assert.equal(passed.costTotal, 0.03);
    assert.equal(passed.store.musicRuntimeReceiptKey, undefined);

    scopedCharge = 0.05;
    response = { ...base, musicProvider: "minimax_music3", musicQualityReviewStatus: "awaiting-human-audition" };
    const saved = localSink();
    const options = { ...context, seedStore: context.store, defaultRetries: 2, sink: saved.sink };
    const beforeFailure = calls;
    const failed = await runPipeline(resolved, options);
    assert.equal(failed.ok, false);
    assert.ok(Math.abs(failed.costTotal - 0.08) < 1e-10, "rejected output retains delegate charge plus scoped model usage");
    assert.match(failed.error ?? "", /PAID_STAGE_RECONCILIATION_REQUIRED/);
    assert.equal(calls, beforeFailure + 1);
    const resumed = await runPipeline(resolved, options);
    assert.equal(resumed.ok, false);
    assert.ok(Math.abs(resumed.costTotal - 0.08) < 1e-10);
    assert.equal(calls, beforeFailure + 1, "held paid output cannot silently regenerate on resume");
    for (const malformed of [null, undefined]) {
      response = malformed;
      const malformedOptions = { ...options, sink: localSink().sink };
      const beforeMalformed = calls;
      const rejected = await runPipeline(resolved, malformedOptions);
      assert.equal(rejected.ok, false);
      assert.match(rejected.error ?? "", /PAID_STAGE_RECONCILIATION_REQUIRED/);
      assert.equal(rejected.costTotal, scopedCharge, "only known scoped usage is charged when no delegate charge exists");
      assert.equal((await runPipeline(resolved, malformedOptions)).ok, false);
      assert.equal(calls, beforeMalformed + 1, "null or undefined paid output remains held on resume");
    }
    console.log("PROVIDER-AWARE MUSIC PASS: exact selected ABI, strict provider receipts, no raw reuse, charge preservation and no repurchase; delegate I/O synthetic");
  } finally { _resetBlocks(); globalThis.fetch = originalFetch; }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
