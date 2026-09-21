import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAcceptedMusicArrangement } from "@/engine/acceptedMusicArrangement";
import { YuE2RecoveryScopeSchema } from "@/lib/yue2DurableEvaluation";

const arrangement = createAcceptedMusicArrangement({
  ownerId: "owner", channelId: "channel", runId: "run", topic: "Quiet source",
  sourceBrief: { direction: "Retain the quiet source" },
  arrangement: { role: "narration_bed", requestedDurationSec: 60, form: "continuous",
    ending: "seamless_wrap", playback: "repeat", direction: "Soft bowed strings with a restrained pulse",
    sections: ["opening", "middle", "return", "ending"].map((id, index) => ({
      id, label: id, startFraction: index / 4, endFraction: (index + 1) / 4,
      energy: 0.2, instruction: "Preserve the same quiet pulse",
    })) },
});
const policy = { schema_version: 1, provider: "openrelay", allocation_basis: "supervised_dispatch_wall_time",
  rate_source: "operator_configured", rate_reference: "fixture", runtime_id: "fixture",
  hourly_rate_usd_micros: 1_000_000, max_execution_seconds: 60, termination_grace_seconds: 5,
  reserved_allocation_usd_micros: 20_000 };
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load, originalFetch = globalThis.fetch, originalLog = console.log;
const outcomes: string[] = [], queued: unknown[][] = [], calls: Array<{ recoverOnly?: boolean }> = [];
let status = "pending", failDelivery = false;
const environment = { YUE2_EVALUATION_URL: "https://worker.invalid", YUE2_EVALUATION_TOKEN: "t".repeat(32),
  TRIGGER_SECRET_KEY: "fixture-trigger-secret" };
const boundaries = {
  bootstrapSecrets: async () => {},
  YuE2RecoveryScopeSchema, validateDurableYuE2Evaluation: () => {},
  executeDurableYuE2Evaluation: async (input: { recoverOnly?: boolean; request: { job: { job_id: string } } }) => {
    calls.push(input);
    return { status, jobId: input.request.job.job_id, bindingKey: "retained-binding" };
  },
};
const globals = globalThis as unknown as Record<string, unknown>;
globals.yue2RecoveryTestBoundaries = boundaries;
const hooks = (Module as unknown as { registerHooks(options: {
  resolve(id: string, context: unknown, next: (id: string, context: unknown) => unknown): unknown;
}): { deregister(): void } }).registerHooks({ resolve(id, context, next) {
  const names = /\/bootstrap(?:\.ts)?$/.test(id) ? ["bootstrapSecrets"]
    : /\/yue2DurableEvaluation(?:\.ts)?$/.test(id)
      ? ["YuE2RecoveryScopeSchema", "validateDurableYuE2Evaluation", "executeDurableYuE2Evaluation"] : undefined;
  if (names) return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(
    names.map(name => `export const ${name} = globalThis.yue2RecoveryTestBoundaries.${name};`).join("\n")) };
  return next(id, context);
} });
loader._load = function(id, ...args) {
  if (id === "@/lib/yue2DurableEvaluation") return boundaries;
  if (id === "@trigger.dev/sdk/v3") return {
    configure: (options: unknown) => assert.deepEqual(options, { secretKey: environment.TRIGGER_SECRET_KEY }),
    tasks: { trigger: async (...input: unknown[]) => {
      queued.push(input);
      if (failDelivery) throw new Error("delivery unavailable");
      return { id: "recovery-run" };
    } },
  };
  return originalLoad.call(this, id, ...args);
};
globalThis.fetch = async () => { throw new Error("external network forbidden"); };
console.log = (...values) => { outcomes.push(values.join(" ")); };

async function main() {
  const root = await mkdtemp(join(tmpdir(), "yue2-recovery-dispatch-"));
  try {
    const arrangementPath = join(root, "arrangement.json"), policyPath = join(root, "policy.json");
    await writeFile(arrangementPath, JSON.stringify(arrangement)); await writeFile(policyPath, JSON.stringify(policy));
    const { runYuE2EvaluationCli } = createRequire(import.meta.url)("../../scripts/evaluate-yue2-music") as typeof import("../../scripts/evaluate-yue2-music");
    const base = ["--arrangement", arrangementPath, "--seed", "42", "--personal-creator", "--submit", "--durable-r2", "--execution-policy", policyPath];
    await runYuE2EvaluationCli([...base, "--queue-recovery"], environment);
    assert.equal(calls.length, 1); assert.equal(queued.length, 1);
    const [id, payload, options] = queued[0] as [string, { jobId: string }, unknown];
    assert.equal(id, "yue2-evaluation-recovery");
    assert.deepEqual(payload, { ownerId: "owner", channelId: "channel", runId: "run", jobId: payload.jobId });
    assert.deepEqual(options, { idempotencyKey: `${payload.jobId}:recovery:v1`, idempotencyKeyTTL: "24h" });
    assert.equal(JSON.parse(outcomes.at(-1)!).recoveryRunId, "recovery-run");
    assert.ok(!JSON.stringify(queued).includes(environment.TRIGGER_SECRET_KEY));
    for (const next of ["completed", "held"]) {
      status = next; await runYuE2EvaluationCli([...base, "--queue-recovery"], environment);
      assert.equal(queued.length, 1, "terminal outcomes never schedule recovery");
    }
    status = "pending"; await runYuE2EvaluationCli(base, environment);
    assert.equal(queued.length, 1, "ordinary CLI behavior remains opt-in");
    const before = calls.length;
    await assert.rejects(() => runYuE2EvaluationCli([...base, "--queue-recovery"], { ...environment, TRIGGER_SECRET_KEY: "" }));
    await assert.rejects(() => runYuE2EvaluationCli([...base.filter(flag => flag !== "--submit"), "--queue-recovery"], environment));
    assert.equal(calls.length, before, "queue prerequisites fail before worker work");
    failDelivery = true;
    await assert.rejects(() => runYuE2EvaluationCli([...base, "--queue-recovery"], environment), /delivery unavailable/);
    assert.equal(JSON.parse(outcomes.at(-1)!).status, "pending", "lost delivery retains the already-paid job identity in CLI output");
    failDelivery = false;
    await runYuE2EvaluationCli([...base, "--queue-recovery", "--recover-only"], environment);
    assert.equal(calls.at(-1)!.recoverOnly, true);
    assert.deepEqual(queued[0], queued.at(-1), "delivery recovery retains the exact idempotent request");
  } finally { await rm(root, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  loader._load = originalLoad; globalThis.fetch = originalFetch; console.log = originalLog;
  hooks.deregister(); delete globals.yue2RecoveryTestBoundaries;
  if (!process.exitCode) console.log("YUE2 RECOVERY DISPATCH PASS: real CLI caller, explicit opt-in, preflight, terminal suppression, bounded payload, stable lost-delivery recovery");
});
