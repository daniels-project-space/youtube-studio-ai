import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createAcceptedMusicArrangement } from "../src/engine/acceptedMusicArrangement";
import { probeYuE2NativeWav } from "../src/lib/yue2NativeAudio";
import { createYuE2AcceptedArrangementRequest, YuE2EvaluationClient } from "../src/lib/yue2Evaluation";
import { verifyYuE2ExecutionAccounting, verifyYuE2ExecutionPolicy } from "../src/lib/yue2ExecutionAccounting";

// Opt-in sibling-runtime integration. No provider credentials, GPU, or paid inference.
let stage = "fixture startup";
async function main(): Promise<void> {
  const runtime = process.env.YUE2_TEST_RUNTIME;
  if (!runtime) throw new Error("Set YUE2_TEST_RUNTIME to the isolated runtime checkout");
  const root = await mkdtemp(join(tmpdir(), "studio-yue2-supervised-"));
  const worker = spawn(join(runtime, ".venv-test/bin/python"), [
    join(runtime, "tests/serve_supervised_cpu_fixture.py"), "--root", join(root, "worker"),
  ], { cwd: runtime, env: { NODE_ENV: "test", PATH: process.env.PATH, HOME: root, PYTHONPATH: join(runtime, "src"),
    OPENBLAS_NUM_THREADS: "1", OMP_NUM_THREADS: "1" }, stdio: ["pipe", "pipe", "pipe"] });
  const closed = once(worker, "close");
  const lines = createInterface({ input: worker.stdout });
  const messages: Array<Record<string, unknown>> = [];
  let malformed = false;
  lines.on("line", (line) => { try { messages.push(JSON.parse(line)); } catch { malformed = true; } });
  worker.stderr.resume();
  const pause = () => new Promise((done) => setTimeout(done, 30));
  try {
    const startDeadline = Date.now() + 20000;
    while (!messages.length && worker.exitCode === null && Date.now() < startDeadline) await pause();
    assert.ok(messages.length && !malformed, "Synthetic worker failed to start");
    const { endpoint, token, policy } = messages[0];
    assert.equal(typeof endpoint, "string");
    assert.equal(typeof token, "string");
    assert.ok(policy && typeof policy === "object");
    stage = "policy verification";
    const reader = new YuE2EvaluationClient({ endpoint: endpoint as string, bearerToken: token as string });
    const verifiedPolicy = verifyYuE2ExecutionPolicy(policy, await reader.fetchExecutionPolicy());
    const arrangement = createAcceptedMusicArrangement({
      ownerId: "supervised-fixture-owner", channelId: "supervised-fixture-channel", runId: "supervised-fixture-run",
      topic: "Synthetic contract integration", sourceBrief: { musicPrompt: "Test only" },
      arrangement: { role: "primary_music", direction: "Synthetic test only", requestedDurationSec: 60,
        form: "continuous", ending: "natural_cadence", playback: "once",
        sections: ["opening", "middle", "closing", "ending"].map((id, index) => ({
          id, label: id, startFraction: index / 4, endFraction: (index + 1) / 4,
          energy: 0.2, instruction: "Hold steady",
        })) },
    });
    const request = createYuE2AcceptedArrangementRequest({ arrangement, seed: 42, personalCreatorAcknowledged: true });
    const client = new YuE2EvaluationClient({ endpoint: endpoint as string, bearerToken: token as string,
      executionPolicySha256: verifiedPolicy.submissionPolicySha256 });
    stage = "policy admission";
    for (const wrongHash of [undefined, "f".repeat(64)]) {
      const response = await fetch(`${endpoint}/v1/jobs`, { method: "POST", signal: AbortSignal.timeout(5000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json",
          ...(wrongHash ? { "X-YuE2-Execution-Policy-SHA256": wrongHash } : {}) }, body: JSON.stringify(request.job) });
      assert.equal(response.status, 409, "Missing/changed policy must fail before admission");
      await response.arrayBuffer();
    }
    stage = "supervised execution";
    let result = await client.evaluate(request, { submit: true });
    const deadline = Date.now() + 20000;
    while (result.status === "pending" && Date.now() < deadline) {
      await pause();
      result = await client.evaluate(request, { recoverOnly: true });
    }
    assert.equal(result.status, "completed");
    if (result.status !== "completed") throw new Error("Supervised fixture did not complete");
    const audio = join(root, "native.wav");
    await writeFile(audio, result.audio, { flag: "wx" });
    await probeYuE2NativeWav(audio, result.completion.result, result.audio.byteLength);
    stage = "accounting verification";
    const accounting = verifyYuE2ExecutionAccounting({ request, expectedPolicy: policy,
      ...await client.fetchExecutionAccounting(request) });
    assert.equal(accounting.status, "measured_allocation_estimate");
    assert.equal(accounting.supervisorStatus, "completed");
    assert.ok(accounting.allocatedCostUsdMicros !== null && accounting.allocatedCostUsdMicros > 0);
    assert.equal(accounting.providerBilledCostUsdMicros, null);
    assert.equal(accounting.qualification.production_approved, false);
    assert.equal((await client.evaluate(request, { recoverOnly: true })).status, "completed");
    stage = "shutdown and inference count";
    worker.stdin.end("stop\n");
    const shutdownTimer = setTimeout(() => worker.kill("SIGKILL"), 10000);
    try { await closed; } finally { clearTimeout(shutdownTimer); }
    assert.equal(worker.exitCode, 0);
    assert.equal(messages.at(-1)?.calls, 1, "Recovery never purchases another inference");
    console.log("PASS supervised Python HTTP + Studio client: strict admission, native FLOAT audio, GET-only recovery, one synthetic inference; GPU compatibility and provider bill unqualified");
  } finally {
    if (worker.exitCode === null && worker.signalCode === null) {
      worker.stdin.end("stop\n");
      const timer = setTimeout(() => worker.kill("SIGKILL"), 10000);
      try { await closed; } finally { clearTimeout(timer); }
    }
    lines.close();
    await rm(root, { recursive: true, force: true });
  }
}

void main().catch(() => { console.error(`Supervised YuE integration failed at ${stage}; no production changes made`); process.exitCode = 1; });
