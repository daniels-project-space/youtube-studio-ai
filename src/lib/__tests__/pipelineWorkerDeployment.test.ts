import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  assertPipelineWorkerDeployment,
  normalizePipelineWorkerDeployment,
  pipelineWorkerDeploymentDispatchOptions,
  resolvePipelineWorkerDeployment,
  type PipelineWorkerDeployment,
} from "@/lib/pipelineWorkerDeployment";
import { pipelineInvocationSha256 } from "@/lib/pipelineInvocationHash";
import {
  decidePipelineInvocationClaim,
  normalizePipelineInvocationSnapshot,
  pipelineInvocationSnapshotsEqual,
  type PipelineInvocationSnapshot,
} from "@/lib/pipelineInvocationSnapshot";
import { stableJson } from "@/lib/publishingPolicy";

const binding: PipelineWorkerDeployment = {
  version: "20260919.26", projectId: "project-test", environmentId: "environment-test",
};
const fields = ["version", "projectId", "environmentId"] as const;
const malformedStrings = [undefined, null, false, 26, {}, [], "", " ", "\t\n", " padded", "padded "];
const capture = {
  workerVersion: binding.version, projectId: binding.projectId, environmentId: binding.environmentId,
};

function historicalSnapshot(): PipelineInvocationSnapshot {
  return {
    version: 1, ownerId: "owner-test", runId: "run-test", channelId: "channel-test",
    source: "channel", entries: [{ block: "music", params: { provider: "suno" } }],
    seedStore: {}, budgetUsd: 10, keyPrefix: "owner/test/", remoteBlocks: [], defaultRetries: 0,
    compilationFingerprint: "a".repeat(64), compilationPolicyId: "test", compilationPolicyVersion: "1",
    compilationModules: [], compilationCapabilities: [], reservedMaxCostUsd: 0,
  };
}

function normalization(): void {
  const normalized = normalizePipelineWorkerDeployment(binding);
  assert.deepEqual(normalized, binding);
  assert.notEqual(normalized, binding, "normalization owns its returned binding");
  assert.deepEqual(normalizePipelineWorkerDeployment({
    environmentId: binding.environmentId, version: binding.version, projectId: binding.projectId,
  }), binding);
  for (const version of ["20260919.26", "0", "dev", "test-version", "opaque/revision:one"]) {
    assert.equal(normalizePipelineWorkerDeployment({ ...binding, version }).version, version);
    assert.equal(resolvePipelineWorkerDeployment({ ...capture, workerVersion: version }).version, version);
  }
  for (const value of [undefined, null, false, "20260919.26", 26, [], {}, () => binding]) {
    assert.throws(() => normalizePipelineWorkerDeployment(value), /pipeline worker deployment/);
  }
  assert.throws(() => normalizePipelineWorkerDeployment({ ...binding, latest: true }), /unknown fields/);
  for (const field of fields) {
    for (const value of malformedStrings) {
      const malformed = { ...binding, [field]: value } as PipelineWorkerDeployment;
      assert.throws(() => normalizePipelineWorkerDeployment(malformed), new RegExp(field));
      assert.throws(() => pipelineWorkerDeploymentDispatchOptions(malformed), new RegExp(field));
      assert.throws(() => assertPipelineWorkerDeployment(binding, malformed), new RegExp(field));
      assert.throws(() => assertPipelineWorkerDeployment(malformed, binding), new RegExp(field));
    }
  }
}

function dispatchAndCapture(): void {
  assert.deepEqual(pipelineWorkerDeploymentDispatchOptions(), {});
  assert.deepEqual(pipelineWorkerDeploymentDispatchOptions(undefined), {});
  assert.deepEqual(pipelineWorkerDeploymentDispatchOptions(binding), { version: binding.version });
  assert.throws(() => pipelineWorkerDeploymentDispatchOptions(null as unknown as PipelineWorkerDeployment));
  assert.deepEqual(resolvePipelineWorkerDeployment(capture), binding);
  for (const versions of [
    { runVersion: binding.version }, { deploymentVersion: binding.version },
    { runVersion: binding.version, deploymentVersion: binding.version },
  ]) {
    assert.deepEqual(resolvePipelineWorkerDeployment({ ...capture, ...versions }), binding);
  }
  for (const field of ["runVersion", "deploymentVersion"] as const) {
    for (const value of [...malformedStrings.filter((value) => value !== undefined), "other-version"]) {
      assert.throws(() => resolvePipelineWorkerDeployment({
        ...capture, [field]: value,
      } as Parameters<typeof resolvePipelineWorkerDeployment>[0]), new RegExp(field));
    }
  }
  for (const field of ["workerVersion", "projectId", "environmentId"] as const) {
    for (const value of malformedStrings) {
      assert.throws(() => resolvePipelineWorkerDeployment({
        ...capture, [field]: value,
      } as Parameters<typeof resolvePipelineWorkerDeployment>[0]), /pipeline worker deployment/);
    }
  }
  const previousVersion = process.env.TRIGGER_VERSION;
  process.env.TRIGGER_VERSION = binding.version;
  try {
    assert.throws(() => resolvePipelineWorkerDeployment({
      ...capture, workerVersion: undefined,
      runVersion: binding.version, deploymentVersion: binding.version,
    }), /version/, "neither context aliases nor an environment pin replace missing worker identity");
    assert.deepEqual(pipelineWorkerDeploymentDispatchOptions(), {}, "historical dispatch ignores environment");
    assert.equal(Object.hasOwn(normalizePipelineInvocationSnapshot(historicalSnapshot()), "workerDeployment"), false);
    assert.deepEqual(resolvePipelineWorkerDeployment({ ...capture, workerVersion: "different-worker" }), {
      ...binding, version: "different-worker",
    }, "a supplied opaque worker identity is never replaced by the environment");
  } finally {
    if (previousVersion === undefined) delete process.env.TRIGGER_VERSION;
    else process.env.TRIGGER_VERSION = previousVersion;
  }
  assert.doesNotThrow(() => assertPipelineWorkerDeployment(binding, { ...binding }));
  for (const field of fields) {
    assert.throws(() => assertPipelineWorkerDeployment(binding, {
      ...binding, [field]: `${binding[field]}-other`,
    }), new RegExp(`${field} mismatch`));
  }
}

function snapshotBinding(): void {
  const historical = historicalSnapshot();
  const normalized = normalizePipelineInvocationSnapshot(historical);
  assert.equal(JSON.stringify(normalized), JSON.stringify(historical), "historical JSON byte shape is unchanged");
  assert.equal(Object.hasOwn(normalized, "workerDeployment"), false);
  const historicalHash = "4eae1ebe632a87f68dd57bc33ea2e4534905bc5aa4cc64e4749ad470ba34d63f";
  assert.equal(pipelineInvocationSha256(historical), historicalHash, "golden hash captured before implementation");
  assert.equal(createHash("sha256").update(stableJson(historical)).digest("hex"), historicalHash);
  assert.equal(pipelineInvocationSha256({ ...historical, workerDeployment: undefined }), historicalHash);

  const bound = normalizePipelineInvocationSnapshot({ ...historical, workerDeployment: binding });
  assert.deepEqual(bound.workerDeployment, binding);
  assert.notEqual(bound.workerDeployment, binding);
  assert.deepEqual(normalizePipelineInvocationSnapshot(JSON.parse(JSON.stringify(bound))), bound);
  assert.equal(pipelineInvocationSnapshotsEqual(bound, historical), false);
  assert.notEqual(pipelineInvocationSha256(bound), historicalHash);
  assert.equal(pipelineInvocationSha256({ ...bound, workerDeployment: {
    environmentId: binding.environmentId, projectId: binding.projectId, version: binding.version,
  } }), pipelineInvocationSha256(bound), "binding key order does not change the canonical hash");

  for (const field of fields) {
    const changed = { ...bound, workerDeployment: { ...binding, [field]: `${binding[field]}-other` } };
    assert.notEqual(pipelineInvocationSha256(bound), pipelineInvocationSha256(changed));
    assert.equal(pipelineInvocationSnapshotsEqual(bound, changed), false);
    assert.throws(() => decidePipelineInvocationClaim({
      run: {
        ownerId: bound.ownerId, runId: bound.runId, channelId: bound.channelId, status: "running",
        snapshot: bound, sha256: pipelineInvocationSha256(bound), hasExecutionHistory: true,
      },
      ownerId: bound.ownerId, runId: bound.runId, channelId: bound.channelId,
      snapshot: changed, sha256: pipelineInvocationSha256(changed),
    }), /immutable/);
    for (const value of malformedStrings) {
      assert.throws(() => normalizePipelineInvocationSnapshot({
        ...historical, workerDeployment: { ...binding, [field]: value } as PipelineWorkerDeployment,
      }), /pipeline worker deployment/);
    }
  }
  for (const value of [null, [], {}, false, "", 26, () => binding, Symbol("binding")]) {
    assert.throws(() => normalizePipelineInvocationSnapshot({
      ...historical, workerDeployment: value as unknown as PipelineWorkerDeployment,
    }), /pipeline worker deployment/, "JSON cloning cannot silently drop a malformed binding");
  }
}

normalization();
dispatchAndCapture();
snapshotBinding();
console.log("PIPELINE WORKER DEPLOYMENT PASS: strict identity, opaque versions, no fallback, historical hash, immutable binding");
