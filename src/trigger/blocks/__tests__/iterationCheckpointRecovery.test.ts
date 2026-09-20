import assert from "node:assert/strict";
import Module from "node:module";
import { runPipeline } from "@/engine/runner";
import { validatePipeline } from "@/engine/validate";

const missing = () => Object.assign(new Error("missing object"), {
  name: "NoSuchKey", $metadata: { httpStatusCode: 404 },
});
let readError: unknown;
let receipt: unknown;
let raw: Uint8Array | undefined;
let reads = 0, writes = 0, drafts = 0, critiques = 0;
const hook = "The cracked valve that stopped an entire factory";
const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (name, ...args) {
  if (name === "@/lib/storage") return {
    getObjectBytes: async (key: string, _bucket: unknown, options: unknown) => {
      assert.match(key, /\/(hook|entity)-checkpoints\/[a-f0-9]{64}\.json$/);
      assert.deepEqual(options, { maxBytes: 1024 * 1024, timeoutMs: 30_000 });
      reads++;
      if (readError) throw readError;
      return raw ?? new TextEncoder().encode(JSON.stringify(receipt));
    },
    putObject: async () => { writes++; },
  };
  if (name === "@/lib/creativeText") return {
    hasCreativeTextKey: () => true,
    creativeTextJson: async ({ prompt }: { prompt: string }) => {
      if (prompt.startsWith("Judge ONE hook")) {
        critiques++;
        return { pass: true, score: 1, issues: [] };
      }
      drafts++;
      return { hook, entities: [] };
    },
  };
  return originalLoad.call(this, name, ...args);
};

async function main() {
  const { registerAllBlocks } = await import("@/engine/blocks");
  registerAllBlocks();
  let cases = 0;
  for (const block of ["hook_craft", "entity_imagery"]) {
    async function run() {
      reads = 0; writes = 0; drafts = 0; critiques = 0;
      return runPipeline(validatePipeline([{ block, params: {} }], ["narrationText"]), {
        ownerId: "owner-checkpoint", channelId: "channel-checkpoint", runId: "run-checkpoint",
        keyPrefix: "owners/owner-checkpoint/", budgetUsd: 1, defaultRetries: 3,
        seedStore: { narrationText: "A factory inspection found a cracked valve. The crew stopped the line before anyone was hurt." },
        sink: { async upsert() {} },
      });
    }
    for (const error of [
      Object.assign(new Error("denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } }),
      Object.assign(new Error("unavailable"), { $metadata: { httpStatusCode: 503 } }),
      Object.assign(new Error("bucket missing"), { name: "NoSuchBucket", $metadata: { httpStatusCode: 404 } }),
      Object.assign(new Error("untrusted missing"), { name: "NoSuchKey" }),
      Object.assign(new Error("contradictory missing"), { name: "NoSuchKey", $metadata: { httpStatusCode: 403 } }),
      new Error("timeout"), new Error("object exceeds maxBytes"), new Error("credentials missing"),
    ]) {
      readError = error;
      const result = await run();
      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /PAID_STAGE_RECONCILIATION_REQUIRED/);
      assert.deepEqual([reads, writes, drafts, critiques], [1, 0, 0, 0], "no automatic retry or paid work on uncertain reads");
      cases++;
    }
    readError = undefined;
    const candidate = block === "hook_craft" ? { hook } : { proposed: [], resolved: [] };
    const invalidCandidate = block === "hook_craft" ? { hook: 42 } : { proposed: [42], resolved: [null] };
    for (const invalid of [null, false, [], {}, candidate,
      { ...candidate, costUsd: -1 }, { ...candidate, costUsd: "0.1" },
      { ...candidate, costUsd: 0.1, costReceiptId: "" }, { ...invalidCandidate, costUsd: 0.1 },
    ]) {
      receipt = invalid;
      const result = await run();
      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /checkpoint malformed/);
      assert.deepEqual([reads, writes, drafts, critiques], [1, 0, 0, 0]);
      cases++;
    }
    for (const bytes of [new TextEncoder().encode("{broken"), new Uint8Array([0xff])]) {
      raw = bytes;
      assert.equal((await run()).ok, false);
      assert.deepEqual([reads, writes, drafts, critiques], [1, 0, 0, 0]);
      cases++;
    }
    raw = undefined;
    for (const costReceiptId of [undefined, "retained-cost-receipt"]) {
      receipt = { ...candidate, costUsd: 0.01, ...(costReceiptId ? { costReceiptId } : {}) };
      const result = await run();
      assert.equal(result.ok, true, result.error);
      assert.deepEqual([reads, writes, drafts], [1, 0, 0], "legacy and current candidates reused without repurchasing");
      assert.equal(critiques, block === "hook_craft" ? 1 : 0, "reuse does not bypass independent hook review");
      cases++;
    }
    readError = missing();
    const result = await run();
    assert.equal(result.ok, true, result.error);
    assert.deepEqual([reads, writes, drafts], [1, 1, 1], "confirmed absence permits one normal purchase and checkpoint write");
    cases++;
  }
  console.log(`ITERATION CHECKPOINT RECOVERY PASS: ${cases} real-runner cases; no external generation`);
}

main().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => { loader._load = originalLoad; });
