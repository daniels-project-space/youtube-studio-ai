import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createAcceptedMusicArrangement } from "../src/engine/acceptedMusicArrangement";
import { canonicalJson } from "../src/lib/canonicalJson";
import { sha256Hex } from "../src/lib/sha256";
import { probeYuE2NativeWav } from "../src/lib/yue2NativeAudio";
import { createYuE2AcceptedArrangementRequest, YuE2EvaluationClient, YuE2EvaluationError } from "../src/lib/yue2Evaluation";
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
    const transportCalls: Array<{ method: string; path: string; jobId?: string }> = [];
    const observedFetch: typeof fetch = async (input, options) => {
      const url = input instanceof Request ? input.url : String(input);
      const jobId = options?.method === "POST" && typeof options.body === "string"
        ? JSON.parse(options.body).job_id as string : undefined;
      transportCalls.push({ method: options?.method ?? "GET", path: new URL(url).pathname, jobId });
      return fetch(input, options);
    };
    stage = "policy verification";
    const reader = new YuE2EvaluationClient({ endpoint: endpoint as string, bearerToken: token as string, fetch: observedFetch });
    const verifiedPolicy = verifyYuE2ExecutionPolicy(policy, await reader.fetchExecutionPolicy());
    const musicIntent = { role: "narration_bed" as const, requestedDurationSec: 60,
      form: "continuous" as const, ending: "natural_cadence" as const, playback: "once" as const };
    // Half-tempo native notation is a wire fixture, not a generated performance.
    const symbolicScore = (await readFile(join(runtime, "examples/thirty-second-instrumental.abc"), "utf8"))
      .replace("Q:1/4=72", "Q:1/4=36");
    const sourceBrief = { musicPrompt: "Test only", musicIntent, symbolicScore, symbolicScorePolicy: "instrumental" };
    const arrangement = createAcceptedMusicArrangement({
      ownerId: "supervised-fixture-owner", channelId: "supervised-fixture-channel", runId: "supervised-fixture-run",
      topic: "Synthetic contract integration", sourceBrief,
      arrangement: { ...musicIntent, direction: "Synthetic test only",
        sections: ["opening", "middle", "closing", "ending"].map((id, index) => ({
          id, label: id, startFraction: index / 4, endFraction: (index + 1) / 4,
          energy: 0.2, instruction: "Hold steady",
        })) },
    });
    const request = createYuE2AcceptedArrangementRequest({ arrangement, seed: 42, personalCreatorAcknowledged: true });
    assert.ok(request.job.schema_version === 2);
    assert.equal(request.job.score_policy, "instrumental");
    assert.equal(request.job.abc, symbolicScore);
    assert.deepEqual(request.acceptedArrangement.musicIntent, musicIntent);
    const client = new YuE2EvaluationClient({ endpoint: endpoint as string, bearerToken: token as string,
      executionPolicySha256: verifiedPolicy.submissionPolicySha256, fetch: observedFetch });
    stage = "explicit intent admission";
    const beforeInvalid = transportCalls.length;
    for (const role of ["primary_music", "meditation_bed", "short_form_bed"] as const) {
      const { fingerprint: originalFingerprint, ...body } = arrangement;
      assert.equal(originalFingerprint, sha256Hex(canonicalJson(body)));
      const changed = { ...body, arrangement: { ...body.arrangement, role } };
      const invalid = { ...changed, fingerprint: sha256Hex(canonicalJson(changed)) };
      assert.throws(() => createYuE2AcceptedArrangementRequest({ arrangement: invalid, seed: 42, personalCreatorAcknowledged: true }),
        /conflicts with explicit music intent/);
      await assert.rejects(client.evaluate({ ...request, acceptedArrangement: invalid }, { submit: true }));
    }
    assert.equal(transportCalls.length, beforeInvalid, "conflicting intent cannot even query or submit to the real worker");
    stage = "policy admission";
    for (const wrongHash of [undefined, "f".repeat(64)]) {
      const response: Response = await fetch(`${endpoint}/v1/jobs`, { method: "POST", signal: AbortSignal.timeout(5000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json",
          ...(wrongHash ? { "X-YuE2-Execution-Policy-SHA256": wrongHash } : {}) }, body: JSON.stringify(request.job) });
      assert.equal(response.status, 409, "Missing/changed policy must fail before admission");
      await response.arrayBuffer();
    }
    stage = "supervised execution";
    const invalidScore = await fetch(`${endpoint}/v1/jobs`, { method: "POST", signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json",
        "X-YuE2-Execution-Policy-SHA256": verifiedPolicy.submissionPolicySha256 },
      body: JSON.stringify({ ...request.job, abc: symbolicScore.replace("Q:1/4=36", "Q:1/4=72") }) });
    assert.equal(invalidScore.status, 400, "wrong-duration score must be refused before worker admission");
    await invalidScore.arrayBuffer();
    stage = "instrumental admission through real client";
    const vocalArrangement = createAcceptedMusicArrangement({ ...arrangement,
      sourceBrief: { ...sourceBrief, symbolicScore: symbolicScore.replace("z32", "c32") } });
    const vocalRequest = createYuE2AcceptedArrangementRequest({ arrangement: vocalArrangement, seed: 42, personalCreatorAcknowledged: true });
    assert.notEqual(vocalRequest.job.job_id, request.job.job_id);
    await assert.rejects(client.evaluate(vocalRequest, { submit: true }), (error: unknown) =>
      error instanceof YuE2EvaluationError && error.code === "worker_rejected_invalid_job" &&
      error.jobId === vocalRequest.job.job_id && !error.retryable && !error.safeToFallback);
    for (const directory of ["jobs", "http"]) {
      await assert.rejects(stat(join(root, "worker", directory, vocalRequest.job.job_id)), { code: "ENOENT" });
    }
    await assert.rejects(client.evaluate(vocalRequest, { submit: true }), (error: unknown) =>
      error instanceof YuE2EvaluationError && error.code === "submission_refused");
    await assert.rejects(client.evaluate(vocalRequest, { recoverOnly: true }));
    await assert.rejects(client.fetchExecutionAccounting(vocalRequest), (error: unknown) =>
      error instanceof YuE2EvaluationError && error.code === "execution_accounting_unavailable");
    assert.equal(transportCalls.filter(call => call.method === "POST" && call.jobId === vocalRequest.job.job_id).length, 1,
      "invalid instrumental notation is submitted once, never automatically regenerated or resubmitted");
    stage = "supervised instrumental execution";
    let result = await client.evaluate(request, { submit: true });
    const deadline = Date.now() + 20000;
    while (result.status === "pending" && Date.now() < deadline) {
      await pause();
      result = await client.evaluate(request, { recoverOnly: true });
    }
    assert.equal(result.status, "completed");
    if (result.status !== "completed") throw new Error("Supervised fixture did not complete");
    assert.deepEqual(result.completion.request.job, request.job);
    const audio = join(root, "native.wav");
    await writeFile(audio, result.audio, { flag: "wx" });
    await probeYuE2NativeWav(audio, result.completion.result, result.audio.byteLength);
    assert.equal(result.completion.result.frames, 48000, "fixture emits exactly one second, never a requested-duration success proof");
    assert.notEqual(result.completion.result.frames, musicIntent.requestedDurationSec * 48000);
    stage = "accounting verification";
    const accounting = verifyYuE2ExecutionAccounting({ request, expectedPolicy: policy,
      ...await client.fetchExecutionAccounting(request) });
    assert.equal(accounting.status, "measured_allocation_estimate");
    assert.equal(accounting.supervisorStatus, "completed");
    assert.ok(accounting.allocatedCostUsdMicros !== null && accounting.allocatedCostUsdMicros > 0);
    assert.equal(accounting.providerBilledCostUsdMicros, null);
    assert.equal(accounting.qualification.production_approved, false);
    assert.equal((await client.evaluate(request, { recoverOnly: true })).status, "completed");
    assert.equal(transportCalls.filter(call => call.method === "POST" && call.jobId === request.job.job_id).length, 1,
      "the admitted client sends exactly one POST across submission and recovery");
    assert.equal(transportCalls.filter(call => call.method === "POST" && call.path === "/v1/jobs").length, 2,
      "one rejected request and one valid request, with no recovery purchases");
    stage = "shutdown and inference count";
    worker.stdin.end("stop\n");
    const shutdownTimer = setTimeout(() => worker.kill("SIGKILL"), 10000);
    try { await closed; } finally { clearTimeout(shutdownTimer); }
    assert.equal(worker.exitCode, 0);
    assert.equal(messages.at(-1)?.calls, 1, "Recovery never purchases another inference");
    console.log("PASS supervised Python HTTP + Studio client: bound instrumental score policy, vocal rejection without job/accounting state, no resubmission, exact valid request, native FLOAT audio, one admitted inference and GET-only recovery; requested duration, GPU compatibility and provider bill unqualified");
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
