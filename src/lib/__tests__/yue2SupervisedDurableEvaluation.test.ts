import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import Module from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAcceptedMusicArrangement, createMusicReviewContext } from "@/engine/acceptedMusicArrangement";
import { canonicalJson } from "@/lib/canonicalJson";
import {
  createYuE2AcceptedArrangementRequest, yue2Sha256, YUE2_MANIFEST, YUE2_QUALIFICATION,
  YUE2_RUNTIME_MANIFEST_SHA256, YUE2_WORKER_CONTRACT, YuE2EvaluationError,
} from "@/lib/yue2Evaluation";
import { verifyYuE2ExecutionAccounting, type YuE2ExecutionPolicy } from "@/lib/yue2ExecutionAccounting";
import type { YuE2DurableEvaluationInput } from "@/lib/yue2DurableEvaluation";

const token = "explicit_supervised_durable_fixture_token_123456";
const endpoint = "https://supervised-fixture.invalid";
const root = "owner/supervised-owner/runs/supervised-run/music/yue2-evaluation/";
const bindingKey = `${root}binding.json`, markerKey = `${root}submission-attempt.json`;
const candidateKey = `${root}candidate.json`, provenanceKey = `${root}provenance.json`;
const accountingKey = `${root}execution-accounting.json`;
const policy: YuE2ExecutionPolicy = {
  schema_version: 1, provider: "openrelay", allocation_basis: "supervised_dispatch_wall_time",
  rate_source: "operator_configured", rate_reference: "Synthetic CPU fixture, not provider billing",
  runtime_id: "supervised-durable-fixture", hourly_rate_usd_micros: 3_600_001,
  max_execution_seconds: 60, termination_grace_seconds: 5, reserved_allocation_usd_micros: 65001,
};
const request = createYuE2AcceptedArrangementRequest({
  arrangement: createAcceptedMusicArrangement({ ownerId: "supervised-owner", channelId: "supervised-channel", runId: "supervised-run",
    topic: "Synthetic supervised evaluation", sourceBrief: { musicPrompt: "Hold steady", reviewContext: createMusicReviewContext({
      topic: "Synthetic supervised evaluation", family: "music_loop", channelName: "Supervised fixture",
      promptContext: "Keep a quiet continuous texture. No dramatic build; preserve the channel's restrained personality.",
    }) },
    arrangement: { role: "primary_music", direction: "No invented build", requestedDurationSec: 60,
      form: "continuous", ending: "natural_cadence", playback: "once",
      sections: Array.from({ length: 4 }, (_, i) => ({ id: `section-${i}`, label: "Steady section",
        startFraction: i / 4, endFraction: (i + 1) / 4, energy: 0.2, instruction: "Remain steady" })) },
  }), seed: 42, personalCreatorAcknowledged: true,
});
type Receipt = { sha256: string; payload_json: string };
type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as RecordValue;
}
const decode = (receipt: Receipt) => record(JSON.parse(receipt.payload_json));
function seal(value: unknown): Receipt {
  const payload_json = `${canonicalJson(value)}\n`;
  return { payload_json, sha256: yue2Sha256(payload_json) };
}
function wav(frames = 4800) {
  const bytes = Buffer.alloc(44 + frames * 8);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(3, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(48000, 24); bytes.writeUInt32LE(384000, 28); bytes.writeUInt16LE(8, 32);
  bytes.writeUInt16LE(32, 34); bytes.write("data", 36); bytes.writeUInt32LE(frames * 8, 40);
  return bytes;
}
const audio = wav();
function policyReceipt(p = policy) {
  return seal({ contract: "yue2-execution-supervision/v1", policy: p, policy_sha256: seal(p).sha256,
    maximum_allocation_usd_micros: Number((BigInt(p.hourly_rate_usd_micros) * BigInt(p.max_execution_seconds + p.termination_grace_seconds) + BigInt(3599)) / BigInt(3600)),
    accounting_basis: "supervised_dispatch_wall_time", provider_billed_cost_usd_micros: null,
    descendant_policy: "linux-seccomp-threads-only-pdeathsig-sigkill" });
}
type Remote = "missing" | "pending" | "completed" | "failed" | "timed_out";
function evidence(remote: Remote) {
  const completed = remote === "completed", failed = remote === "failed", timeout = remote === "timed_out";
  const job = seal(request.job);
  const config = seal({ schema_version: 1, manifest: YUE2_MANIFEST, cache_dir: "/synthetic-cache",
    device: "cuda:0", local_files_only: true, candidate_count: 1,
    exports: ["official_pcm24_flac", "native_float32_wav", "native_float32_npy"] });
  const accepted = seal({ schema_version: 1, accepted_at: "2026-09-20T00:00:00Z", job: request.job,
    config: decode(config), job_sha256: job.sha256, config_sha256: config.sha256 });
  const runnerStarted = seal({ schema_version: 1, job_id: request.job.job_id, attempt: 1,
    started_at: "2026-09-20T00:00:00Z", pid: 2, job_sha256: job.sha256, config_sha256: config.sha256,
    environment: { backend: "explicit_fake_cpu_only" } });
  const runnerTerminal = seal({ schema_version: 1, job_id: request.job.job_id, attempt: 1,
    finished_at: "2026-09-20T00:00:01Z", status: completed ? "completed" : "failed", started_sha256: runnerStarted.sha256,
    result: completed ? { status: "complete", truncated: { abc: false, semantic: false }, sample_rate: 48000, channels: 2,
      frames: (current.audio.length - 44) / 8, audio_seconds: (current.audio.length - 44) / 384000, official_identity: "a".repeat(64), timing: { load: { seconds: 1 } },
      native_audio: "audio-native.wav", official_result: "song/result.json" } : null,
    error: completed ? null : { type: "FixtureFailure", message: "explicit synthetic failure" }, qualification: YUE2_QUALIFICATION,
    artifacts: completed ? { "audio-native.wav": { sha256: yue2Sha256(current.audio), bytes: current.audio.length },
      "song/result.json": { sha256: "b".repeat(64), bytes: 17 } } : {} });
  runnerTerminal.payload_json = runnerTerminal.payload_json.replace('"seconds":1}', '"seconds":1.0}');
  runnerTerminal.sha256 = yue2Sha256(runnerTerminal.payload_json);
  const start = seal({ contract: "yue2-execution-supervision/v1", job_id: request.job.job_id,
    started_at: "2026-09-20T00:00:00Z", supervisor_pid: 1, job_sha256: job.sha256,
    config_sha256: config.sha256, policy_sha256: seal(policy).sha256 });
  const outcome = seal({ contract: "yue2-execution-supervision/v1", start_sha256: start.sha256,
    finished_at: "2026-09-20T00:01:01Z", status: completed ? "completed" : timeout ? "timed_out" : "failed",
    terminal_sha256: timeout ? null : runnerTerminal.sha256, child_exitcode: timeout ? -9 : 0,
    termination_verified: true, child_timed_out: timeout, slot_releasable: !timeout,
    error: completed ? null : "supervision_requires_review" });
  const accounting = seal({ contract: "yue2-execution-supervision/v1", status: "measured_allocation_estimate",
    policy_sha256: seal(policy).sha256, outcome_sha256: outcome.sha256, elapsed_ns: timeout ? 61_000_000_000 : 1_000_000_001,
    allocated_cost_usd_micros: timeout ? 61001 : 1001, accounting_basis: "supervised_dispatch_wall_time",
    provider_billed_cost_usd_micros: null, rate_source: "operator_configured", rental_idle_excluded: true,
    hard_vm_bill_cap: false, budget_exceeded: false, execution_deadline_exceeded: timeout,
    execution_limit_scope: "child_process_only", measurement_boundary: "dispatch_start_through_runner_receipt_and_artifact_readback" });
  const terminalPresent = completed || failed;
  const receipt_payloads: { job: Receipt; config: Receipt; started?: Receipt; terminal?: Receipt } = {
    job, config, ...(remote !== "pending" ? { started: runnerStarted } : {}),
    ...(terminalPresent ? { terminal: runnerTerminal } : {}),
  };
  const statusResponse = { contract: YUE2_WORKER_CONTRACT, job_id: request.job.job_id,
    state: timeout ? "ambiguous" : remote === "pending" ? "accepted" : remote,
    job: request.job, job_sha256: job.sha256, config_sha256: config.sha256, accepted_sha256: accepted.sha256,
    qualification: YUE2_QUALIFICATION, progress: { phase: String(remote), receipt: "fixture" },
    receipt: terminalPresent ? decode(runnerTerminal) : null, receipt_payloads,
    error: null, artifacts: completed ? { "audio-native.wav": `/v1/jobs/${request.job.job_id}/artifacts/audio-native.wav` } : {} };
  const accountingResponse = { contract: "yue2-execution-accounting/v1", job_id: request.job.job_id,
    admission: seal({ schema_version: 1, accepted_sha256: accepted.sha256, policy_sha256: seal(policy).sha256, policy }),
    policy: policyReceipt(), start: remote === "pending" ? null : start,
    outcome: remote === "pending" ? null : outcome, accounting: remote === "pending" ? null : accounting,
    receipt_payloads: { accepted, ...receipt_payloads } };
  return { statusResponse, accountingResponse };
}
type Bundle = ReturnType<typeof evidence>;
function fixture() {
  return { objects: new Map<string, Buffer>(), calls: [] as string[], writes: [] as string[], reads: [] as string[],
    posts: 0, authorizations: 0, audio, remote: "missing" as Remote, postState: "completed" as Remote,
    advertisedPolicy: policy, offline: false, observedPolicy: false, audioFailure: false,
    responseCount: 0, mutateEvidence: undefined as ((value: Bundle, sequence: number) => void) | undefined,
    putFault: undefined as ((key: string, bytes: Uint8Array) => void) | undefined };
}
let current = fixture();
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load, originalFetch = globalThis.fetch;
loader._load = function (id, ...args) {
  if (id.endsWith("/storage")) return {
    getObjectBytes: async (key: string, bucket: unknown, options: { timeoutMs: number; maxBytes: number }) => {
      assert.equal(bucket, undefined); assert.equal(options.timeoutMs, 30_000);
      assert.ok(options.maxBytes > 0 && options.maxBytes <= 256 * 1024 * 1024);
      current.reads.push(key);
      const bytes = current.objects.get(key);
      if (!bytes) throw Object.assign(new Error("fixture missing"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
      assert.ok(bytes.length <= options.maxBytes);
      return Buffer.from(bytes);
    },
    putObject: async (key: string, bytes: Uint8Array, options: { ifNoneMatch?: string }) => {
      assert.equal(options.ifNoneMatch, "*");
      assert.ok(!Buffer.from(bytes).includes(Buffer.from(token)), "credentials never enter storage");
      current.writes.push(key); current.putFault?.(key, bytes);
      if (current.objects.has(key)) throw Object.assign(new Error("fixture collision"), { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } });
      current.objects.set(key, Buffer.from(bytes)); return key;
    },
  };
  return originalLoad.call(this, id, ...args);
};
globalThis.fetch = async (input, init = {}) => {
  assert.equal(current.offline, false, "cached evidence must not contact the worker");
  assert.equal(new Headers(init.headers).get("Authorization"), `Bearer ${token}`);
  const url = new URL(String(input)); assert.equal(url.origin, endpoint);
  const method = init.method ?? "GET", path = url.pathname;
  current.calls.push(`${method} ${path}`);
  if (path === "/v1/execution-policy") {
    current.observedPolicy = true; return Response.json(policyReceipt(current.advertisedPolicy));
  }
  if (path === "/v1/health") return Response.json({ contract: YUE2_WORKER_CONTRACT, manifest: YUE2_MANIFEST,
    manifest_sha256: YUE2_RUNTIME_MANIFEST_SHA256, qualification: YUE2_QUALIFICATION,
    queue_capacity: 1, worker_state: "ready", error: null, readiness_scope: "queue_idle_only_not_gpu_qualification" });
  if (method === "POST") {
    assert.equal(path, "/v1/jobs");
    assert.ok(current.objects.has(bindingKey) && current.objects.has(markerKey));
    assert.equal(current.observedPolicy, true, "policy must be independently fetched before POST");
    assert.equal(new Headers(init.headers).get("X-YuE2-Execution-Policy-SHA256"), seal(policy).sha256);
    assert.deepEqual(JSON.parse(String(init.body)), request.job);
    current.posts++; current.remote = current.postState;
  }
  if (current.remote === "missing") return Response.json({ contract: YUE2_WORKER_CONTRACT, state: "refused", error: "job_not_found" }, { status: 404 });
  if (path.endsWith("/artifacts/audio-native.wav")) {
    if (current.audioFailure) throw new Error("synthetic download failure after paid-work boundary");
    return new Response(new Uint8Array(current.audio));
  }
  const bundle = evidence(current.remote); current.mutateEvidence?.(bundle, ++current.responseCount);
  if (path.endsWith("/accounting")) return Response.json(bundle.accountingResponse);
  assert.ok(path === `/v1/jobs/${request.job.job_id}` || method === "POST");
  return Response.json(bundle.statusResponse);
};

// The storage seam is installed before loading the actual production durable adapter.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { executeDurableYuE2Evaluation: run, readDurableYuE2Candidate: review } = require("@/lib/yue2DurableEvaluation") as typeof import("@/lib/yue2DurableEvaluation");
const reviewScope = { ownerId: "supervised-owner", channelId: "supervised-channel", runId: "supervised-run" };
type Input = YuE2DurableEvaluationInput;
const args = (patch: Partial<Input> = {}): Input => ({ request, endpoint, bearerToken: token,
  expectedExecutionPolicy: policy, authorizeSubmission: async () => { current.authorizations++; }, ...patch });
async function rejected(operation: Promise<unknown>) {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof YuE2EvaluationError);
    assert.equal(error.retryable, false); assert.equal(error.safeToFallback, false);
    assert.ok(!error.message.includes(token)); return true;
  });
}
function saved(key: string): RecordValue {
  assert.ok(current.objects.has(key), `missing expected immutable object: ${key}`);
  return record(JSON.parse(current.objects.get(key)!.toString("utf8")));
}
function assertReference(value: unknown, expectedStatus = "completed", expectedCost = 1001) {
  const ref = record(value);
  assert.deepEqual(ref, { key: accountingKey, sha256: yue2Sha256(current.objects.get(accountingKey)!),
    policySha256: seal(policy).sha256, status: "measured_allocation_estimate", supervisorStatus: expectedStatus,
    elapsedNs: expectedStatus === "timed_out" ? 61_000_000_000 : 1_000_000_001,
    allocatedCostUsdMicros: expectedCost, providerBilledCostUsdMicros: null });
  const retained = saved(accountingKey);
  assert.equal(retained.version, "studio-yue2-durable-accounting/v1");
  assert.equal(retained.bindingSha256, yue2Sha256(current.objects.get(bindingKey)!));
  const verified = verifyYuE2ExecutionAccounting({ request, expectedPolicy: policy,
    statusResponse: retained.statusResponse, accountingResponse: retained.accountingResponse });
  assert.equal(verified.allocatedCostUsdMicros, expectedCost);
  assert.equal(verified.providerBilledCostUsdMicros, null);
}
async function recoverChild(path: string) {
  const snapshot = JSON.parse(readFileSync(path, "utf8")) as { objects: Array<[string, string]>; remote: Remote };
  current.objects = new Map(snapshot.objects.map(([key, bytes]) => [key, Buffer.from(bytes, "base64")]));
  current.remote = snapshot.remote;
  const result = await run(args({ recoverOnly: true, authorizeSubmission: async () => { throw new Error("recovery cannot authorize"); } }));
  console.log(JSON.stringify({ result, calls: current.calls, posts: current.posts, writes: current.writes }));
}

async function main() {
  let passed = 0;
  async function test(name: string, fn: () => Promise<void> | void) {
    current = fixture(); await fn(); passed++; console.log(`PASS ${name}`);
  }
  await test("fixture receipts pass the real accounting verifier for every lifecycle", () => {
    for (const state of ["pending", "completed", "failed", "timed_out"] as const) {
      const result = verifyYuE2ExecutionAccounting({ request, expectedPolicy: policy, ...evidence(state) });
      assert.equal(result.status, state === "pending" ? "unknown_hold" : "measured_allocation_estimate");
    }
  });
  await test("changed or missing policy cannot adopt a frozen supervised run", async () => {
    current.postState = "pending";
    assert.equal((await run(args())).status, "pending");
    const calls = current.calls.length;
    await rejected(run(args({ expectedExecutionPolicy: { ...policy, runtime_id: "different-worker" } })));
    await rejected(run(args({ expectedExecutionPolicy: undefined })));
    assert.equal(current.calls.length, calls); assert.equal(current.posts, 1);
  });
  await test("existing unsupervised binding cannot be silently adopted", async () => {
    current.objects.set(bindingKey, Buffer.from(canonicalJson({ version: "studio-yue2-durable-evaluation/v1",
      ownerId: request.acceptedArrangement.ownerId, channelId: request.acceptedArrangement.channelId,
      runId: request.acceptedArrangement.runId, endpoint, request })));
    await rejected(run(args()));
    assert.equal(current.calls.length + current.posts + current.writes.length, 0);
  });
  await test("pre-POST policy mismatch refuses before dispatch", async () => {
    current.advertisedPolicy = { ...policy, runtime_id: "wrong-runtime" };
    await rejected(run(args()));
    assert.equal(current.posts, 0);
    assert.ok(current.calls.includes("GET /v1/execution-policy"));
    assert.equal(current.objects.has(candidateKey), false);
  });
  await test("supervised completion seals v2 binding and candidate with standalone accounting", async () => {
    const result = await run(args());
    assert.equal(result.status, "completed");
    if (result.status !== "completed") throw new Error("expected completion");
    assert.equal(result.candidate.version, "studio-yue2-durable-candidate/v2");
    assert.equal(saved(bindingKey).version, "studio-yue2-durable-evaluation/v2");
    assert.deepEqual(saved(bindingKey).expectedExecutionPolicy, policy);
    assert.equal(saved(markerKey).version, "studio-yue2-durable-evaluation/v2");
    assertReference(record(result.candidate).executionAccounting);
    assert.equal(result.candidate.costStatus, "not_measured", "provider billing stays unknown");
    assert.equal(result.candidate.qualified, false); assert.equal(result.candidate.productionApproved, false);
    assert.equal(result.candidate.manualAudition, "pending");
    assert.ok(!("musicKey" in result.candidate));
    assert.deepEqual(current.objects.get(result.audioKey), audio);
    assert.ok(current.writes.indexOf(accountingKey) < current.writes.indexOf(candidateKey));
    assert.ok(current.objects.get(accountingKey)!.toString().includes("1.0"));
    const calls = current.calls.length, writes = current.writes.length;
    current.offline = true;
    const cached = await run(args({ recoverOnly: true }));
    assert.equal(cached.status, "completed"); assert.equal(cached.reused, true);
    assert.equal(current.calls.length, calls); assert.equal(current.writes.length, writes); assert.equal(current.posts, 1);
  });
  await test("pending has unknown cost and no prematurely frozen accounting", async () => {
    current.postState = "pending";
    const result = await run(args()); assert.equal(result.status, "pending");
    assert.equal(current.objects.has(accountingKey), false); assert.equal(current.objects.has(candidateKey), false);
    assert.equal(current.objects.has(provenanceKey), false);
    assert.ok(!("executionAccounting" in result), "pending cannot masquerade as a zero-cost final allocation");
    const verified = verifyYuE2ExecutionAccounting({ request, expectedPolicy: policy, ...evidence("pending") });
    assert.equal(verified.allocatedCostUsdMicros, null); assert.equal(verified.elapsedNs, null);
    assert.equal(verified.providerBilledCostUsdMicros, null);
  });
  await test("read-only review verifies retained native bytes offline and rejects false duration quality", async () => {
    assert.equal(await review(reviewScope), null);
    await run(args());
    current.offline = true;
    const before = [current.calls.length, current.writes.length, current.authorizations];
    const result = await review(reviewScope);
    assert.ok(result);
    assert.equal(result.candidateSha256, yue2Sha256(current.objects.get(candidateKey)!));
    assert.equal(result.quality.status, "blocked");
    assert.equal(result.quality.requestedDurationSec, 60);
    assert.equal(result.quality.actualDurationSec, 0.1);
    assert.equal(result.quality.durationMatches, false);
    assert.equal(result.quality.productionApproved, false);
    assert.deepEqual(result.quality.signal.reviewReasons, ["digital_silence"]);
    assert.equal(result.quality.signal.frames, 4800);
    assert.equal(result.quality.signal.longestQuietWindowRunSec, 0.1);
    assert.ok(result.quality.unresolved.includes("channel_personality_fit"));
    assert.deepEqual(result.request.acceptedArrangement.reviewContext, request.acceptedArrangement.reviewContext);
    assert.deepEqual([current.calls.length, current.writes.length, current.authorizations], before);
  });
  await test("duration-correct stereo cancellation blocks retained review without repair or worker calls", async () => {
    current.audio = wav(60 * 48000);
    for (let frame = 0; frame < 60 * 48000; frame++) {
      const sample = 0.2 * Math.sin(2 * Math.PI * 1000 * frame / 48000);
      current.audio.writeFloatLE(sample, 44 + frame * 8);
      current.audio.writeFloatLE(-sample, 48 + frame * 8);
    }
    await run(args()); current.offline = true;
    const before = [current.calls.length, current.writes.length, current.authorizations];
    const result = await review(reviewScope);
    assert.ok(result);
    assert.equal(result.quality.durationMatches, true);
    assert.equal(result.quality.status, "blocked");
    assert.deepEqual(result.quality.signal.reviewReasons, ["mono_cancellation_requires_review"]);
    assert.equal(result.quality.signal.monoFoldDown.rmsAmplitude, 0);
    assert.equal(result.quality.productionApproved, false);
    assert.deepEqual([current.calls.length, current.writes.length, current.authorizations], before);
  });
  await test("read-only review refuses unsafe scope before storage and never follows foreign candidate keys", async () => {
    await rejected(review({ ...reviewScope, runId: "../other-run" }));
    assert.equal(current.reads.length, 0);
    await run(args()); current.offline = true;
    const candidate = saved(candidateKey);
    current.objects.set(candidateKey, Buffer.from(canonicalJson({ ...candidate,
      audioKey: "owner/foreign/runs/private/audio.wav" })));
    const before = current.reads.length;
    await rejected(review(reviewScope));
    assert.deepEqual(current.reads.slice(before), [candidateKey]);
  });
  await test("read-only review rejects missing, swapped or corrupt provenance without recovery writes", async () => {
    for (const key of [bindingKey, markerKey, provenanceKey, accountingKey]) {
      current = fixture(); await run(args()); current.offline = true;
      const before = [current.calls.length, current.writes.length];
      const bytes = current.objects.get(key)!;
      current.objects.delete(key);
      await rejected(review(reviewScope));
      current.objects.set(key, Buffer.from(`${bytes.toString()} `));
      await rejected(review(reviewScope));
      assert.deepEqual([current.calls.length, current.writes.length], before);
    }
  });
  await test("read-only review verifies actual audio and scope even when worker claims completion", async () => {
    await run(args()); current.offline = true;
    await rejected(review({ ...reviewScope, channelId: "another-channel" }));
    const candidate = saved(candidateKey);
    const audioKey = String(candidate.audioKey);
    const bytes = Buffer.from(current.objects.get(audioKey)!);
    bytes[bytes.length - 1] ^= 1;
    current.objects.set(audioKey, bytes);
    await rejected(review(reviewScope));
  });
  await test("a genuinely new process recovers pending work using GET only", async () => {
    current.postState = "pending"; assert.equal((await run(args())).status, "pending");
    const dir = mkdtempSync(join(tmpdir(), "yue2-supervised-recovery-"));
    try {
      const snapshot = join(dir, "storage.json");
      writeFileSync(snapshot, JSON.stringify({ objects: [...current.objects].map(([key, bytes]) => [key, bytes.toString("base64")]), remote: "completed" }));
      const output = execFileSync(process.execPath, ["--import", "tsx", join(process.cwd(),
        "src/lib/__tests__/yue2SupervisedDurableEvaluation.test.ts"), "--recover-fixture", snapshot], {
        cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: dir, NODE_ENV: "test" }, encoding: "utf8", timeout: 30000,
      });
      const child = JSON.parse(output) as { result: { status: string; candidate: RecordValue }; calls: string[]; posts: number };
      assert.equal(child.result.status, "completed"); assert.equal(child.result.candidate.version, "studio-yue2-durable-candidate/v2");
      assert.equal(child.posts, 0); assert.ok(child.calls.length > 0 && child.calls.every((call) => call.startsWith("GET ")));
      assert.ok(child.calls.some((call) => call.endsWith("/accounting"))); assert.equal(current.posts, 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  await test("verified failure and timeout costs persist independently and replay offline as held", async () => {
    for (const remote of ["failed", "timed_out"] as const) {
      current = fixture(); current.postState = remote;
      const result = await run(args()); assert.equal(result.status, "held");
      if (result.status !== "held") throw new Error("expected review hold");
      assert.equal(result.reason, "supervised_execution_requires_review");
      assertReference(result.executionAccounting, remote, remote === "timed_out" ? 61001 : 1001);
      assert.equal(current.objects.has(candidateKey), false); assert.equal(current.objects.has(provenanceKey), false);
      assert.equal(current.calls.some((call) => call.endsWith("/artifacts/audio-native.wav")), false);
      const before = [current.calls.length, current.writes.length];
      current.offline = true;
      const cached = await run(args({ recoverOnly: true }));
      assert.equal(cached.status, "held"); assert.equal(cached.reused, true);
      assert.deepEqual([current.calls.length, current.writes.length], before); assert.equal(current.posts, 1);
    }
  });
  await test("tampered cached accounting, candidate reference, and missing accounting reject offline", async () => {
    for (const mode of ["accounting-bytes", "cost", "reference", "missing", "missing-marker"]) {
      current = fixture(); assert.equal((await run(args())).status, "completed");
      if (mode === "missing") current.objects.delete(accountingKey);
      else if (mode === "missing-marker") current.objects.delete(markerKey);
      else if (mode === "reference") {
        const candidate = saved(candidateKey);
        record(candidate.executionAccounting).sha256 = "f".repeat(64);
        current.objects.set(candidateKey, Buffer.from(canonicalJson(candidate)));
      } else {
        const retained = saved(accountingKey);
        const accounting = record(record(retained.accountingResponse).accounting);
        if (mode === "accounting-bytes") accounting.payload_json += " ";
        else {
          const payload = record(JSON.parse(String(accounting.payload_json)));
          payload.allocated_cost_usd_micros = 1;
          Object.assign(accounting, seal(payload));
        }
        current.objects.set(accountingKey, Buffer.from(canonicalJson(retained)));
      }
      current.offline = true;
      await rejected(run(args({ recoverOnly: true })));
      assert.equal(current.posts, 1);
    }
  });
  await test("completed native audio cannot publish without valid matching accounting", async () => {
    for (const mode of ["missing", "wrong-cost", "different-terminal"]) {
      current = fixture();
      current.mutateEvidence = (bundle, sequence) => {
        if (mode === "different-terminal" && sequence >= 2) {
          const core = bundle.accountingResponse.receipt_payloads;
          const terminal = seal({ ...decode(core.terminal!), finished_at: "2026-09-20T00:00:03Z" });
          core.terminal = terminal; bundle.statusResponse.receipt_payloads.terminal = terminal;
          bundle.statusResponse.receipt = decode(terminal);
          bundle.accountingResponse.outcome = seal({ ...decode(bundle.accountingResponse.outcome!), terminal_sha256: terminal.sha256 });
          bundle.accountingResponse.accounting = seal({ ...decode(bundle.accountingResponse.accounting!),
            outcome_sha256: bundle.accountingResponse.outcome.sha256 });
        } else if (mode === "missing") bundle.accountingResponse.accounting = null;
        else if (mode === "wrong-cost") bundle.accountingResponse.accounting = seal({ ...decode(bundle.accountingResponse.accounting!), allocated_cost_usd_micros: 1 });
      };
      await rejected(run(args()));
      assert.equal(current.posts, 1); assert.equal(current.objects.has(candidateKey), false);
      if (mode === "different-terminal") assert.ok(current.objects.has(accountingKey), "verified but differently bound cost evidence is retained");
    }
  });
  await test("lost candidate write retains accounting and cached recovery finalizes without network", async () => {
    current.putFault = (key) => { if (key === candidateKey) throw new Error("explicit fixture write failure"); };
    await rejected(run(args()));
    assert.ok(current.objects.has(accountingKey)); assert.ok(current.objects.has(provenanceKey));
    const retained = Buffer.from(current.objects.get(accountingKey)!);
    current.putFault = undefined; current.offline = true;
    assert.equal((await run(args({ recoverOnly: true }))).status, "completed");
    assert.deepEqual(current.objects.get(accountingKey), retained); assert.equal(current.posts, 1);
  });
  await test("conditional accounting collision accepts identical terminal chain with earlier status snapshot", async () => {
    let proposedSha: string | undefined;
    current.putFault = (key, bytes) => {
      if (key !== accountingKey) return;
      proposedSha = yue2Sha256(bytes);
      const competing = record(JSON.parse(Buffer.from(bytes).toString()));
      const earlierStatus = record(competing.statusResponse);
      earlierStatus.state = "running"; earlierStatus.receipt = null;
      delete record(earlierStatus.receipt_payloads).terminal;
      current.objects.set(key, Buffer.from(canonicalJson(competing)));
    };
    const result = await run(args()); assert.equal(result.status, "completed");
    if (result.status !== "completed") throw new Error("expected completion");
    assert.notEqual(yue2Sha256(current.objects.get(accountingKey)!), proposedSha,
      "first immutable winner, not the locally proposed status snapshot, supplies candidate identity");
    assert.equal(record(saved(accountingKey).statusResponse).state, "running");
    assertReference(record(result.candidate).executionAccounting);
    assert.equal(current.posts, 1);
  });
  await test("concurrent recovery callers converge on one accounting winner despite different status snapshots", async () => {
    current.postState = "pending"; assert.equal((await run(args())).status, "pending");
    current.remote = "completed"; current.responseCount = 0;
    current.mutateEvidence = (bundle, sequence) => {
      // The first two reads are completion snapshots; subsequent status reads are accounting recovery.
      if (sequence >= 3) bundle.statusResponse.progress = { phase: `accounting-snapshot-${sequence}`, receipt: "terminal.json" };
    };
    const results = await Promise.all([run(args({ recoverOnly: true })), run(args({ recoverOnly: true }))]);
    for (const result of results) {
      assert.equal(result.status, "completed");
      if (result.status !== "completed") throw new Error("expected completion");
      assertReference(record(result.candidate).executionAccounting);
    }
    assert.equal(current.writes.filter((key) => key === accountingKey).length, 2,
      "both independent callers must actually contest the conditional accounting write");
    assert.equal(current.posts, 1);
  });
  await test("conditional accounting collision rejects a different internally valid terminal chain", async () => {
    current.putFault = (key, bytes) => {
      if (key !== accountingKey) return;
      const competing = record(JSON.parse(Buffer.from(bytes).toString()));
      const status = record(competing.statusResponse), accounting = record(competing.accountingResponse);
      const core = record(accounting.receipt_payloads);
      const terminal = seal({ ...decode(core.terminal as Receipt), finished_at: "2026-09-20T00:00:04Z" });
      core.terminal = terminal; record(status.receipt_payloads).terminal = terminal; status.receipt = decode(terminal);
      const outcome = seal({ ...decode(accounting.outcome as Receipt), terminal_sha256: terminal.sha256 });
      accounting.outcome = outcome;
      accounting.accounting = seal({ ...decode(accounting.accounting as Receipt), outcome_sha256: outcome.sha256 });
      assert.equal(verifyYuE2ExecutionAccounting({ request, expectedPolicy: policy,
        statusResponse: status, accountingResponse: accounting }).status, "measured_allocation_estimate");
      current.objects.set(key, Buffer.from(canonicalJson(competing)));
    };
    await rejected(run(args()));
    assert.equal(current.objects.has(candidateKey), false); assert.equal(current.posts, 1);
    const retained = Buffer.from(current.objects.get(accountingKey)!);
    current.putFault = undefined;
    await rejected(run(args({ recoverOnly: true })));
    assert.deepEqual(current.objects.get(accountingKey), retained, "different winning evidence is never overwritten");
    assert.equal(current.posts, 1);
  });
  await test("audio download error retains execution cost before GET-only recovery", async () => {
    current.audioFailure = true;
    await rejected(run(args()));
    assert.ok(current.objects.has(accountingKey));
    assert.equal(current.objects.has(candidateKey), false); assert.equal(current.objects.has(provenanceKey), false);
    const retained = Buffer.from(current.objects.get(accountingKey)!);
    const stored = saved(accountingKey);
    const verified = verifyYuE2ExecutionAccounting({ request, expectedPolicy: policy,
      statusResponse: stored.statusResponse, accountingResponse: stored.accountingResponse });
    assert.equal(verified.allocatedCostUsdMicros, 1001); assert.equal(verified.providerBilledCostUsdMicros, null);
    const before = current.calls.length;
    current.audioFailure = false;
    assert.equal((await run(args({ recoverOnly: true }))).status, "completed");
    assert.ok(current.calls.slice(before).every((call) => call.startsWith("GET ")));
    assert.deepEqual(current.objects.get(accountingKey), retained); assert.equal(current.posts, 1);
  });
  await test("missing accounting may GET-recover only the exact cached candidate evidence identity", async () => {
    for (const changedSnapshot of [false, true]) {
      current = fixture(); assert.equal((await run(args())).status, "completed");
      const retained = Buffer.from(current.objects.get(accountingKey)!);
      const candidate = Buffer.from(current.objects.get(candidateKey)!);
      current.objects.delete(accountingKey);
      if (changedSnapshot) current.mutateEvidence = (bundle) => {
        bundle.statusResponse.progress = { phase: "different-valid-progress", receipt: "terminal.json" };
      };
      const before = current.calls.length;
      if (changedSnapshot) await rejected(run(args({ recoverOnly: true })));
      else {
        assert.equal((await run(args({ recoverOnly: true }))).status, "completed");
        assert.deepEqual(current.objects.get(accountingKey), retained);
      }
      assert.ok(current.calls.slice(before).some((call) => call.endsWith("/accounting")));
      assert.ok(current.calls.slice(before).every((call) => call.startsWith("GET ")));
      assert.deepEqual(current.objects.get(candidateKey), candidate, "cached candidate cannot be republished against a new receipt SHA");
      assert.equal(current.posts, 1);
    }
  });
  console.log(`PASS ${passed} supervised durable integration contracts`);
}

void (process.argv[2] === "--recover-fixture" ? recoverChild(process.argv[3]!) : main())
  .finally(() => { loader._load = originalLoad; globalThis.fetch = originalFetch; }).catch((error: unknown) => {
  console.error(error); process.exitCode = 1;
});
