import { register, _clear } from "@/engine/registry";
import { validatePipeline } from "@/engine/validate";
import { runPipeline } from "@/engine/runner";
import type { Block, RunStageSink } from "@/engine/types";

function memSink(completed: Array<{ block: string; outputs: unknown }> = []): RunStageSink {
  return { async upsert() {}, async getCompleted() { return completed; } };
}
const base = { ownerId: "o", runId: "r", channelId: "c", keyPrefix: "k/", budgetUsd: 0, log: () => {} };
function assert(c: boolean, m: string) { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) process.exitCode = 1; }

async function main() {
  // 1) transient error → retried to success
  let attempts = 0;
  const flaky: Block = { id: "flaky", consumes: [], produces: ["x"], run: async () => { attempts++; if (attempts < 3) throw new Error("503 service unavailable"); return { x: "ok" }; } };
  _clear(); register(flaky);
  const r1 = await runPipeline(validatePipeline([{ block: "flaky" }]), { ...base, sink: memSink(), defaultRetries: 3 });
  assert(r1.ok && attempts === 3, `transient 503 retried to success (attempts=${attempts})`);

  // 2) deterministic gate failure → NOT retried
  let g = 0;
  const gate: Block = { id: "gate", consumes: [], produces: ["y"], run: async () => { g++; throw new Error("gate FAILED: bad content"); } };
  _clear(); register(gate);
  const r2 = await runPipeline(validatePipeline([{ block: "gate" }]), { ...base, sink: memSink(), defaultRetries: 3 });
  assert(!r2.ok && g === 1, `deterministic failure not retried (attempts=${g})`);

  // 3) resume → completed block skipped, outputs restored
  let ran = false;
  const paid: Block = { id: "paid", consumes: [], produces: ["z"], run: async () => { ran = true; return { z: "fresh" }; } };
  _clear(); register(paid);
  const r3 = await runPipeline(validatePipeline([{ block: "paid" }]), { ...base, sink: memSink([{ block: "paid", outputs: { z: "cached" } }]), resume: true, rehydrate: async (_b, o) => ({ ok: true, outputs: o }) });
  assert(r3.ok && !ran && r3.store.z === "cached", `resumed: run skipped + outputs restored (ran=${ran})`);

  // 4) resume but rehydrate fails → re-run
  let ran4 = false;
  const paid4: Block = { id: "p4", consumes: [], produces: ["z"], run: async () => { ran4 = true; return { z: "fresh" }; } };
  _clear(); register(paid4);
  const r4 = await runPipeline(validatePipeline([{ block: "p4" }]), { ...base, sink: memSink([{ block: "p4", outputs: { z: "cached" } }]), resume: true, rehydrate: async () => ({ ok: false, outputs: {} }) });
  assert(r4.ok && ran4 && r4.store.z === "fresh", `rehydrate-fail → re-ran block (ran=${ran4})`);

  console.log(process.exitCode ? "\nRELIABILITY TEST FAILED" : "\nRELIABILITY TEST PASSED");
}
main().catch((e) => { console.error("FAILED:", e instanceof Error ? e.stack : e); process.exit(1); });
