import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { readYuE2File } from "../src/scripts/evaluate-yue2-music";
import { AcceptedMusicArrangementSchema } from "../src/engine/acceptedMusicArrangement";
import { COST_PATCH_KEY, type StageContext } from "../src/engine/types";
import { validateYuE2ExecutionPolicy } from "../src/lib/yue2ExecutionAccounting";
import { createYuE2MusicManifest } from "../src/trigger/blocks/yue2Music";

/** Storage-only qualification of the real shared source module; new dispatch is forbidden. */
async function main() {
  const { values } = parseArgs({ options: {
    arrangement: { type: "string" }, policy: { type: "string" }, seed: { type: "string" },
  }, strict: true, allowPositionals: false });
  assert.ok(values.arrangement && values.policy && values.seed);
  const arrangement = AcceptedMusicArrangementSchema.parse(JSON.parse((await readYuE2File(values.arrangement, 256 * 1024)).toString("utf8")));
  const executionPolicy = validateYuE2ExecutionPolicy(JSON.parse((await readYuE2File(values.policy, 65536)).toString("utf8")));
  const maxCostUsd = executionPolicy.reserved_allocation_usd_micros / 1_000_000;
  const endpoint = new URL(process.env.YUE2_EVALUATION_URL!);
  const originalFetch = globalThis.fetch;
  let workerRequests = 0, authorizationAttempts = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === endpoint.origin) { workerRequests++; throw new Error("Storage-only verification forbids worker access"); }
    return originalFetch(input, init);
  };
  try {
    const manifest = createYuE2MusicManifest();
    const context: StageContext = {
      ownerId: arrangement.ownerId, channelId: arrangement.channelId, runId: arrangement.runId,
      keyPrefix: `owner/${arrangement.ownerId}/`, budgetUsd: maxCostUsd, stageBudgetUsd: maxCostUsd,
      params: { seed: Number(values.seed), personalCreatorAcknowledged: true, maxCostUsd, executionPolicy },
      store: { topic: arrangement.topic, acceptedMusicArrangement: arrangement }, log: () => {},
      assertInlinePaidExecutionLease: async () => { authorizationAttempts++; throw new Error("Storage-only verification cannot authorize dispatch"); },
    };
    const outputs = await manifest.execute(context);
    const candidate = manifest.produces.yue2MusicCandidate.schema.parse(outputs.yue2MusicCandidate);
    assert.equal(workerRequests, 0); assert.equal(authorizationAttempts, 0);
    assert.equal(outputs.musicKey, undefined); assert.equal(outputs.musicUrl, undefined);
    console.log(JSON.stringify({ version: "shared-yue2-music-storage-proof/v1", moduleVersion: manifest.version,
      workerRequests, authorizationAttempts, newlyDispatchedGpuJobs: 0,
      recoveredAllocationEstimateUsd: outputs[COST_PATCH_KEY], providerBilledCostUsd: null, candidate }));
  } finally { globalThis.fetch = originalFetch; }
}
void main().catch(() => { console.error("Shared YuE2 storage-only verification failed; no dispatch authorized"); process.exitCode = 1; });
