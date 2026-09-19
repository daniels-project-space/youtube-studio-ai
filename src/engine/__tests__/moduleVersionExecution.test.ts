import assert from "node:assert/strict";
import { manifestFromBlock } from "@/engine/moduleManifest";
import { compilePipeline, type PipelinePolicy } from "@/engine/pipelineCompiler";
import { _clear, registerManifest, registerManifestVersion } from "@/engine/registry";
import { assertRequiredDownstreamHandoffs, runPipeline } from "@/engine/runner";
import { STAGE_REUSE_RECONCILIATION_MARKER } from "@/engine/stageReuseContract";
import type { Block, RunStageSink } from "@/engine/types";
import { validatePipeline } from "@/engine/validate";

type Row = Awaited<ReturnType<NonNullable<RunStageSink["getResumeState"]>>>[number];
type ArtifactBatch = Parameters<NonNullable<RunStageSink["upsertArtifacts"]>>[0];
const OLD = "1.0.0";
const NEW = "2.0.0";
// Catalog IDs let the real compiler run. No production block is imported or registered.
const SOURCE = "composer_brief";
const CONSUMER = "music";
const policy: PipelinePolicy = {
  id: "cpu-version-fixture", version: "1.0.0", minimumCertification: "contract",
  requiredCapabilities: [], requireCrewBindings: false,
  requireStoryAlignmentForGeneratedVisuals: false, allowOpaqueMigrationArtifacts: true,
};
const options = {
  ownerId: "version-owner", runId: "version-run", channelId: "version-channel",
  keyPrefix: "owners/version/", budgetUsd: 0, defaultRetries: 0,
  seedStore: { fixtureInput: "same input" },
};

function localSink() {
  const rows = new Map<string, Row>();
  const artifacts: ArtifactBatch[] = [];
  const io = { reads: 0, writes: 0, rehydrates: 0 };
  const sink: RunStageSink = {
    async upsert(args) {
      io.writes++;
      const previous = rows.get(args.block) ?? { block: args.block, status: "queued" };
      rows.set(args.block, structuredClone({ ...previous,
        ...Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)) }));
    },
    async getResumeState() { io.reads++; return structuredClone([...rows.values()]); },
    async upsertArtifacts(args) { io.writes++; artifacts.push(structuredClone(args)); },
  };
  const rehydrate = async (_id: string, outputs: Record<string, unknown>) => {
    io.rehydrates++;
    return { ok: true, outputs: structuredClone(outputs) };
  };
  return { rows, artifacts, io, sink, rehydrate };
}

function fixture() {
  _clear();
  const calls: string[] = [];
  const source = (version: string) => {
    const block: Block = {
      id: SOURCE, consumes: ["fixtureInput"], produces: ["fixtureValue"],
      async run(ctx) {
        calls.push(`source:${version}`);
        return { fixtureValue: { input: ctx.store.fixtureInput, implementation: version } };
      },
    };
    return manifestFromBlock(block, {
      version, capabilities: [], certification: "contract", certificationEvidence: "pure CPU fixture only",
      requiredDownstreamCapabilities: ["fixture.consume"],
      requiredDownstreamConsumes: { "fixture.consume": "fixtureValue" },
    });
  };
  const original = source(OLD);
  const alternate = source(NEW);
  registerManifest(original);
  registerManifest(manifestFromBlock({
    id: CONSUMER, consumes: ["fixtureValue"], produces: ["fixtureObserved"],
    async run(ctx) {
      calls.push("consumer");
      assert.ok(ctx.artifactRefs?.fixtureValue, "runner supplies the real producer artifact reference");
      return { fixtureObserved: {
        value: ctx.store.fixtureValue,
        producerVersion: ctx.artifactRefs.fixtureValue.producerVersion,
      } };
    },
  }, { version: OLD, capabilities: ["fixture.consume"], certification: "contract",
    certificationEvidence: "pure CPU fixture only" }));
  const resolve = (version?: string) => validatePipeline([
    { block: SOURCE, ...(version === undefined ? {} : { version }), params: { fixed: true } },
    { block: CONSUMER },
  ], ["fixtureInput"]);
  return { calls, original, alternate, resolve };
}

async function main() {
  let cases = 0;
  try {
    {
      const f = fixture();
      const before = compilePipeline(f.resolve(), policy);
      registerManifestVersion(f.alternate);
      const legacy = f.resolve();
      const explicitOld = f.resolve(OLD);
      const selected = f.resolve(NEW);
      const after = compilePipeline(legacy, policy);
      const next = compilePipeline(selected, policy);
      assert.equal(legacy.manifests[0], f.original);
      assert.equal(selected.manifests[0], f.alternate);
      assert.equal(after.fingerprint, before.fingerprint, "registration cannot change legacy compilation");
      assert.equal(compilePipeline(explicitOld, policy).fingerprint, before.fingerprint);
      assert.notEqual(next.fingerprint, before.fingerprint, "version selection changes compilation identity");
      assert.equal(after.modules[0].version, OLD);
      assert.equal(next.modules[0].version, NEW);
      assert.equal(next.catalogFlow[0].executableVersion, NEW);
      assert.equal(next.modules[0].configFingerprint, before.modules[0].configFingerprint);
      assert.equal(next.reservedMaxCostUsd, 0);
      cases++;

      for (const [resolved, version] of [[legacy, OLD], [explicitOld, OLD], [selected, NEW]] as const) {
        const local = localSink();
        f.calls.length = 0;
        const result = await runPipeline(resolved, { ...options, ...local });
        assert.equal(result.ok, true, result.error);
        assert.equal(result.costTotal, 0);
        assert.deepEqual(f.calls, [`source:${version}`, "consumer"]);
        assert.deepEqual(result.store.fixtureObserved, {
          value: { input: "same input", implementation: version }, producerVersion: version,
        });
        const produced = local.artifacts.flatMap((batch) => batch.artifacts)
          .find((record) => record.artifact.key === "fixtureValue")!;
        assert.equal(produced.artifact.producerVersion, version);
        cases++;
      }
      f.calls.length = 0;
      assert.throws(() => f.resolve("99.0.0"), /unknown block.*version.*99\.0\.0/);
      assert.deepEqual(f.calls, [], "unknown version cannot fall back to either executable");
      cases++;
    }
    {
      const f = fixture();
      const local = localSink();
      const args = { ...options, ...local };
      const first = await runPipeline(f.resolve(), args);
      assert.equal(first.ok, true, first.error);
      const originalRows = structuredClone([...local.rows.values()]);
      const originalArtifacts = structuredClone(local.artifacts);
      registerManifestVersion(f.alternate);
      const legacy = await runPipeline(f.resolve(), args);
      assert.equal(legacy.ok, true, legacy.error);
      assert.equal(legacy.costTotal, 0);
      assert.deepEqual(f.calls, [`source:${OLD}`, "consumer"], "legacy resume reuses existing results");
      assert.deepEqual(local.artifacts, originalArtifacts, "resume cannot re-stamp lineage");
      for (const row of originalRows) {
        assert.deepEqual(local.rows.get(row.block)?.outputs, row.outputs);
        assert.deepEqual(local.rows.get(row.block)?.reuseReceipt, row.reuseReceipt);
      }
      cases++;

      const selected = f.resolve(NEW);
      const oldReference = originalArtifacts.flatMap((batch) => batch.artifacts)
        .find((record) => record.artifact.key === "fixtureValue")!.artifact;
      assert.equal(oldReference.producerVersion, OLD);
      assert.doesNotThrow(() => assertRequiredDownstreamHandoffs(
        f.resolve().manifests, 1, first.store, { fixtureValue: oldReference },
      ));
      assert.throws(() => assertRequiredDownstreamHandoffs(
        selected.manifests, 1, first.store, { fixtureValue: oldReference },
      ), /at version "2\.0\.0"; received producer version "1\.0\.0"/);
      cases++;

      const rehydratesBefore = local.io.rehydrates;
      for (let attempt = 0; attempt < 2; attempt++) {
        const refused = await runPipeline(selected, args);
        assert.equal(refused.ok, false, "old completed stages cannot satisfy a new module revision");
        assert.match(refused.error ?? "", new RegExp(STAGE_REUSE_RECONCILIATION_MARKER));
        if (attempt === 0) assert.match(refused.error ?? "", /module contract changed/);
        assert.equal(refused.costTotal, 0);
        assert.equal(refused.store.fixtureValue, undefined, "stale outputs never enter the new run store");
        assert.deepEqual(f.calls, [`source:${OLD}`, "consumer"], "refusal cannot execute replacement work");
        assert.equal(local.io.rehydrates, rehydratesBefore, "refusal precedes artifact restoration");
        assert.deepEqual(local.artifacts, originalArtifacts);
        for (const row of originalRows) {
          assert.deepEqual(local.rows.get(row.block)?.outputs, row.outputs, "retain reconciliation evidence");
          assert.deepEqual(local.rows.get(row.block)?.reuseReceipt, row.reuseReceipt);
        }
      }
      cases++;
      const fresh = localSink();
      const replacement = await runPipeline(selected, { ...options, ...fresh, runId: "new-version-run" });
      assert.equal(replacement.ok, true, replacement.error);
      assert.deepEqual(f.calls, [`source:${OLD}`, "consumer", `source:${NEW}`, "consumer"]);
      cases++;
    }
    for (const mutation of ["entry-version", "substituted-block", "length", "entry-id", "execute"] as const) {
      const f = fixture();
      registerManifestVersion(f.alternate);
      const resolved = f.resolve(NEW);
      if (mutation === "entry-version") resolved.entries[0].version = OLD;
      if (mutation === "substituted-block") resolved.blocks[0] = f.original.block;
      if (mutation === "length") resolved.blocks.pop();
      if (mutation === "entry-id") resolved.entries[0].block = "different-fixture";
      if (mutation === "execute") resolved.manifests[0] = { ...f.alternate, execute: f.original.execute };
      const local = localSink();
      assert.throws(() => compilePipeline(resolved, policy), /resolved (?:executable|pipeline)/);
      await assert.rejects(() => runPipeline(resolved, { ...options, ...local }), /resolved (?:executable|pipeline)/);
      assert.deepEqual(local.io, { reads: 0, writes: 0, rehydrates: 0 }, `${mutation}: reject before any sink I/O`);
      assert.deepEqual([...local.rows.values()], []);
      assert.deepEqual(local.artifacts, []);
      assert.deepEqual(f.calls, [], `${mutation}: no fake-block execution or provider work`);
      cases++;
    }
    console.log(`MODULE VERSION EXECUTION PASS - ${cases} compiler/runner/recovery cases; pure CPU fixtures, zero provider calls`);
  } finally {
    _clear();
  }
}

void main();
