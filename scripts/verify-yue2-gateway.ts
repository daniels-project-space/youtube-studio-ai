import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { YuE2EvaluationClient, YUE2_MANIFEST, YUE2_RUNTIME_MANIFEST_SHA256,
  YUE2_WORKER_CONTRACT, YUE2_QUALIFICATION, validateYuE2Endpoint } from "../src/lib/yue2Evaluation";
import { verifyYuE2ExecutionPolicy } from "../src/lib/yue2ExecutionAccounting";

async function main() {
  assert.equal(process.argv.length, 3, "Supply the expected operator policy file");
  const configuredEndpoint = process.env.YUE2_EVALUATION_URL;
  assert.ok(configuredEndpoint, "Vault-injected worker URL required");
  const endpoint = validateYuE2Endpoint(configuredEndpoint);
  const token = process.env.YUE2_EVALUATION_TOKEN;
  assert.ok(token, "Vault-injected worker token required");
  const policyBytes = await readFile(process.argv[2]);
  assert.ok(policyBytes.length <= 65536);
  const policy = JSON.parse(policyBytes.toString("utf8"));
  const client = new YuE2EvaluationClient({ endpoint, bearerToken: token });
  for (const authorization of [undefined, "Bearer invalid-gateway-test"]) {
    const response = await fetch(`${endpoint}/v1/health`, {
      headers: authorization ? { Authorization: authorization } : {},
      redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    await response.body?.cancel();
    assert.equal(response.status, 401);
  }
  const response = await fetch(`${endpoint}/v1/health`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200, "Gateway must reach the actual worker");
  const health = await response.json();
  assert.equal(health.contract, YUE2_WORKER_CONTRACT);
  assert.deepEqual(health.manifest, YUE2_MANIFEST);
  assert.equal(health.manifest_sha256, YUE2_RUNTIME_MANIFEST_SHA256);
  assert.deepEqual(health.qualification, YUE2_QUALIFICATION);
  assert.equal(health.queue_capacity, 1);
  assert.equal(health.worker_state, "ready");
  assert.equal(health.error, null);
  verifyYuE2ExecutionPolicy(policy, await client.fetchExecutionPolicy());
  console.log(JSON.stringify({ endpoint, authenticatedWorkerReady: true, anonymousDenied: true,
    manifestVerified: true, executionPolicyVerified: true, jobsSubmitted: 0, productionApproved: false }));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ status: "failed", errorType: error instanceof Error ? error.name : "unknown" }));
  process.exitCode = 1;
});
