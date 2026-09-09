import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

type CorpusCase = {
  runId: string;
  channelId: string;
  channelName: string;
  file: string;
  byteLength: number;
  sha256: string;
  sourceProjectionSha256: string;
  narration: Array<{
    stageId: string;
    block: string;
    sourcePath: string;
    characters: number;
    sha256: string;
  }>;
};

const directory = resolve("test-fixtures/title-baseline");
const manifest = JSON.parse(readFileSync(resolve(directory, "manifest.json"), "utf8")) as {
  version: string;
  deployment: string;
  liveGenerationPerformed: boolean;
  providerModelCalls: number;
  historicalReplayReadyCases: number;
  caseCount: number;
  completeNarrationCases: number;
  cases: CorpusCase[];
};
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function verifyCase(binding: CorpusCase, bytes: Buffer) {
  assert.equal(bytes.byteLength, binding.byteLength, "frozen fixture byte length changed");
  assert.equal(sha256(bytes), binding.sha256, "frozen fixture bytes changed");
  const fixture = JSON.parse(bytes.toString("utf8"));
  assert.equal(fixture.version, "title-baseline-source/v1");
  assert.equal(fixture.historicalReplayReady, false, "retained sources are not invocation snapshots");
  assert.equal(fixture.liveGenerationPerformed, false, "source capture is not generation evidence");
  assert.equal(fixture.provenance.deployment, manifest.deployment);
  assert.equal(fixture.availability.frozenHistoricalInvocation, false);
  assert.ok(fixture.availability.missing.length > 0, "missing invocation inputs must stay explicit");
  assert.equal(fixture.source.runId, binding.runId);
  assert.equal(fixture.source.run.channelId, binding.channelId);
  assert.equal(fixture.source.run.hasInvocationSnapshot, false);
  assert.equal(fixture.source.currentChannel.id, binding.channelId);
  assert.equal(fixture.source.currentChannel.name, binding.channelName);
  assert.equal(sha256(JSON.stringify(fixture.source)), binding.sourceProjectionSha256);

  const stages = fixture.source.stages as Array<{
    id: string;
    block: string;
    outputs?: { narrationText?: string };
  }>;
  const retainedNarrations = stages.filter((stage) => typeof stage.outputs?.narrationText === "string");
  assert.equal(retainedNarrations.length, binding.narration.length, "every retained narration needs a digest");
  for (const reference of binding.narration) {
    assert.equal(reference.sourcePath, "runStages.outputs.narrationText");
    const matches = stages.filter((stage) => stage.id === reference.stageId);
    assert.equal(matches.length, 1, "narration must bind exactly one retained stage");
    const stage = matches[0];
    assert.equal(stage.block, reference.block);
    const narration = stage.outputs?.narrationText;
    assert.equal(typeof narration, "string", "descriptions cannot substitute for narration");
    assert.equal(narration!.length, reference.characters);
    assert.equal(sha256(narration!), reference.sha256);
  }
}

assert.equal(manifest.version, "title-baseline-manifest/v1");
assert.equal(manifest.deployment, "astute-camel-689");
assert.equal(manifest.caseCount, 8);
assert.equal(manifest.cases.length, manifest.caseCount);
assert.equal(new Set(manifest.cases.map((entry) => entry.runId)).size, manifest.caseCount);
assert.equal(manifest.liveGenerationPerformed, false);
assert.equal(manifest.providerModelCalls, 0);
assert.equal(manifest.historicalReplayReadyCases, 0);
assert.equal(manifest.completeNarrationCases, 5);
assert.equal(manifest.cases.filter((entry) => entry.narration.length > 0).length, 5);
assert.deepEqual(
  readdirSync(directory).filter((file) => file.endsWith(".json") && file !== "manifest.json").sort(),
  manifest.cases.map((entry) => `${entry.runId}.json`).sort(),
);

for (const binding of manifest.cases) {
  assert.equal(binding.file, `test-fixtures/title-baseline/${binding.runId}.json`);
  const bytes = readFileSync(resolve(directory, `${binding.runId}.json`));
  verifyCase(binding, bytes);
  assert.throws(() => verifyCase(binding, Buffer.concat([bytes, Buffer.from(" ")])), /byte length changed/);
  assert.throws(() => verifyCase({ ...binding, channelId: "wrong-channel" }, bytes));
  assert.throws(() => verifyCase({ ...binding, sourceProjectionSha256: "0".repeat(64) }, bytes));
  const mislabeled = JSON.parse(bytes.toString("utf8"));
  mislabeled.historicalReplayReady = true;
  const mislabeledBytes = Buffer.from(JSON.stringify(mislabeled));
  assert.throws(() => verifyCase({
    ...binding,
    byteLength: mislabeledBytes.byteLength,
    sha256: sha256(mislabeledBytes),
  }, mislabeledBytes), /retained sources are not invocation snapshots/);
  if (binding.narration.length) {
    const altered = structuredClone(binding);
    altered.narration[0].sha256 = "0".repeat(64);
    assert.throws(() => verifyCase(altered, bytes));
  }
}

console.log("titleBaselineCorpus: eight frozen source packets, five narration hashes, truthful replay limits and corruption rejection passed");
