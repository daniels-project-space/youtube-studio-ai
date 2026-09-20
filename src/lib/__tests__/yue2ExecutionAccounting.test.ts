import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { canonicalJson } from "@/lib/canonicalJson";
import { createChannelMusicProgram } from "@/engine/channelMusicProgram";
import { createYuE2EvaluationRequest, YUE2_MANIFEST, YUE2_QUALIFICATION } from "@/lib/yue2Evaluation";
import {
  validateYuE2ExecutionPolicy, verifyYuE2ExecutionPolicy, verifyYuE2ExecutionAccounting,
  type YuE2ExecutionPolicy,
} from "@/lib/yue2ExecutionAccounting";

const contract = "yue2-execution-supervision/v1";
const basis = "supervised_dispatch_wall_time";
const policy: YuE2ExecutionPolicy = {
  schema_version: 1, provider: "openrelay", allocation_basis: basis, rate_source: "operator_configured",
  rate_reference: "Explicit CPU fixture rate, not a provider bill", runtime_id: "cpu-fixture",
  hourly_rate_usd_micros: 3_600_001, max_execution_seconds: 60, termination_grace_seconds: 5,
  reserved_allocation_usd_micros: 65_001,
};
const request = createYuE2EvaluationRequest({
  program: createChannelMusicProgram({ channelId: "cpu-fixture", channelIdentityFingerprint: "a".repeat(64),
    family: "music_loop", contentLaneKey: "fixture", topic: "Synthetic accounting fixture",
    genre: "ambient", instrumentation: ["piano"] }),
  style: "Explicit CPU accounting fixture, no inference", seed: 42, personalCreatorAcknowledged: true,
});
type Seal = { sha256: string; payload_json: string };
type Payload = Record<string, unknown>;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const seal = (payload: unknown): Seal => {
  const payload_json = `${canonicalJson(payload)}\n`;
  return { payload_json, sha256: sha(payload_json) };
};
const unpack = (receipt: Seal): Payload => JSON.parse(receipt.payload_json) as Payload;
const clone = <T>(value: T): T => structuredClone(value);
const cost = (rate: number, ns: number) => Number((BigInt(rate) * BigInt(ns) + BigInt(3_600_000_000_000) - BigInt(1)) / BigInt(3_600_000_000_000));
function policyReceipt(p = policy): Seal {
  return seal({ contract, policy: p, policy_sha256: seal(p).sha256,
    maximum_allocation_usd_micros: cost(p.hourly_rate_usd_micros, (p.max_execution_seconds + p.termination_grace_seconds) * 1e9),
    accounting_basis: basis, provider_billed_cost_usd_micros: null,
    descendant_policy: "linux-seccomp-threads-only-pdeathsig-sigkill" });
}

// Python's real canonical encoding, with integral floats retained inside nested timing evidence.
const pythonTerminalSeal = (payload: unknown): Seal => JSON.parse(execFileSync("python3", ["-c", `
import hashlib,json,sys
p=json.load(sys.stdin)
p['result']['timing']['load']['seconds']=1.0
s=json.dumps(p,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\\n'
print(json.dumps({'payload_json':s,'sha256':hashlib.sha256(s.encode()).hexdigest()}))
`], { input: JSON.stringify(payload), encoding: "utf8" })) as Seal;

function fixture(p = policy, elapsed = 1_000_000_001) {
  const job = seal(request.job);
  const config = seal({ schema_version: 1, manifest: YUE2_MANIFEST, cache_dir: "/cpu-fixture-cache",
    device: "cuda:0", local_files_only: true, candidate_count: 1,
    exports: ["official_pcm24_flac", "native_float32_wav", "native_float32_npy"] });
  const accepted = seal({ schema_version: 1, accepted_at: "2026-09-20T00:00:00Z",
    job: unpack(job), config: unpack(config), job_sha256: job.sha256, config_sha256: config.sha256 });
  const started = seal({ schema_version: 1, job_id: request.job.job_id, attempt: 1,
    started_at: "2026-09-20T00:00:00Z", pid: 2, job_sha256: job.sha256, config_sha256: config.sha256,
    environment: { backend: "explicit_fake_cpu_only" } });
  const terminal = pythonTerminalSeal({ schema_version: 1, job_id: request.job.job_id, attempt: 1,
    finished_at: "2026-09-20T00:00:01Z", status: "completed", started_sha256: started.sha256,
    result: { status: "complete", truncated: { abc: false, semantic: false }, sample_rate: 48000, channels: 2,
      frames: 48000, audio_seconds: 1, official_identity: "b".repeat(64), timing: { load: { seconds: 1 } },
      native_audio: "audio-native.wav", official_result: "song/result.json" },
    error: null, qualification: YUE2_QUALIFICATION,
    artifacts: { "audio-native.wav": { sha256: "c".repeat(64), bytes: 384044 } } });
  const sealedPolicy = policyReceipt(p);
  const start = seal({ contract, job_id: request.job.job_id, started_at: "2026-09-20T00:00:00Z",
    supervisor_pid: 1, job_sha256: job.sha256, config_sha256: config.sha256, policy_sha256: seal(p).sha256 });
  const outcome = seal({ contract, start_sha256: start.sha256, finished_at: "2026-09-20T00:00:01Z",
    status: "completed", terminal_sha256: terminal.sha256, child_exitcode: 0,
    termination_verified: true, child_timed_out: false, slot_releasable: true, error: null });
  const accounting = seal({ contract, status: "measured_allocation_estimate", policy_sha256: seal(p).sha256,
    outcome_sha256: outcome.sha256, elapsed_ns: elapsed, allocated_cost_usd_micros: cost(p.hourly_rate_usd_micros, elapsed),
    accounting_basis: basis, provider_billed_cost_usd_micros: null, rate_source: "operator_configured",
    rental_idle_excluded: true, hard_vm_bill_cap: false, budget_exceeded: false,
    execution_deadline_exceeded: elapsed > p.max_execution_seconds * 1e9, execution_limit_scope: "child_process_only",
    measurement_boundary: "dispatch_start_through_runner_receipt_and_artifact_readback" });
  const receipt_payloads: { accepted: Seal; job: Seal; config: Seal; started?: Seal; terminal?: Seal } = {
    accepted, job, config, started, terminal,
  };
  const accountingResponse = {
    contract: "yue2-execution-accounting/v1", job_id: request.job.job_id,
    admission: seal({ schema_version: 1, accepted_sha256: accepted.sha256, policy_sha256: seal(p).sha256, policy: p }),
    policy: sealedPolicy, start: start as Seal | null, outcome: outcome as Seal | null,
    accounting: accounting as Seal | null, receipt_payloads,
  };
  const statusResponse = {
    contract: "yue2-evaluation-worker/v1", job_id: request.job.job_id, state: "completed", job: request.job,
    job_sha256: job.sha256, config_sha256: config.sha256, accepted_sha256: accepted.sha256,
    qualification: YUE2_QUALIFICATION, progress: { phase: "terminal", receipt: "terminal.json" },
    receipt: unpack(terminal) as Payload | null,
    receipt_payloads: { job, config, started, terminal } as { job: Seal; config: Seal; started?: Seal; terminal?: Seal },
    error: null, artifacts: {},
  };
  return { request, expectedPolicy: p, statusResponse, accountingResponse };
}
type Fixture = ReturnType<typeof fixture>;
function mutate(receipt: Seal, patch: Payload): Seal { return seal({ ...unpack(receipt), ...patch }); }
function outcomePatch(f: Fixture, patch: Payload) {
  const wire = f.accountingResponse;
  wire.outcome = mutate(wire.outcome!, patch);
  wire.accounting = mutate(wire.accounting!, { outcome_sha256: wire.outcome.sha256 });
}
function terminalPatch(f: Fixture, patch: Payload) {
  const core = f.accountingResponse.receipt_payloads;
  core.terminal = mutate(core.terminal!, patch);
  f.statusResponse.receipt_payloads.terminal = core.terminal;
  f.statusResponse.receipt = unpack(core.terminal);
  outcomePatch(f, { terminal_sha256: core.terminal.sha256 });
}

test("policy validates strict bounds and returns distinct submission and receipt hashes", () => {
  assert.deepEqual(validateYuE2ExecutionPolicy(policy), policy);
  const wire = policyReceipt();
  const verified = verifyYuE2ExecutionPolicy(policy, wire);
  assert.equal(verified.submissionPolicySha256, seal(policy).sha256);
  assert.equal(verified.policyReceiptSha256, wire.sha256);
  assert.notEqual(verified.submissionPolicySha256, verified.policyReceiptSha256);
  assert.equal(verified.maximumAllocationUsdMicros, 65001);
  for (const patch of [
    { hourly_rate_usd_micros: 0 }, { hourly_rate_usd_micros: 1.5 }, { hourly_rate_usd_micros: "2" },
    { hourly_rate_usd_micros: true }, { hourly_rate_usd_micros: Number.MAX_SAFE_INTEGER + 1 },
    { reserved_allocation_usd_micros: 65000 }, { max_execution_seconds: 7201 }, { termination_grace_seconds: 31 },
    { provider: "other" }, { rate_source: "provider_invoice" }, { rate_reference: " padded " },
    { rate_reference: "bad\nreference" }, { rate_reference: "x".repeat(513) }, { runtime_id: "bad/path" },
    { unknown: true }, { company_commercial_authorized: true },
  ]) assert.throws(() => validateYuE2ExecutionPolicy({ ...policy, ...patch }));
  assert.throws(() => verifyYuE2ExecutionPolicy(policy, mutate(wire, { policy_sha256: wire.sha256 })));
  assert.throws(() => verifyYuE2ExecutionPolicy({ ...policy, runtime_id: "different" }, wire));
});

test("Python exact float-bearing receipt bytes survive accounting verification", () => {
  const f = fixture();
  const raw = f.accountingResponse.receipt_payloads.terminal!;
  assert.ok(raw.payload_json.includes('"seconds":1.0'));
  assert.notEqual(seal(unpack(raw)).sha256, raw.sha256);
  const result = verifyYuE2ExecutionAccounting(f);
  assert.equal(result.status, "measured_allocation_estimate");
  assert.equal(result.allocatedCostUsdMicros, 1001);
  assert.equal(result.elapsedNs, 1_000_000_001);
  assert.equal(result.slotReleasable, true);
  assert.equal(result.providerBilledCostUsdMicros, null);
  assert.deepEqual(result.qualification, YUE2_QUALIFICATION);
  assert.equal(result.qualification.production_approved, false);
  assert.equal(result.evidence.receipt_payloads.terminal?.payload_json, raw.payload_json);
});

test("BigInt allocation is exact across ceiling and safe-integer multiplication boundaries", () => {
  for (const elapsed of [1, 999_999_999, 1_000_000_000, 1_000_000_001]) {
    const f = fixture(policy, elapsed);
    assert.equal(verifyYuE2ExecutionAccounting(f).allocatedCostUsdMicros, cost(policy.hourly_rate_usd_micros, elapsed));
  }
  const large = { ...policy, hourly_rate_usd_micros: 8_000_000_000_000_001,
    reserved_allocation_usd_micros: Number.MAX_SAFE_INTEGER };
  const f = fixture(large, 1_234_567_891);
  assert.equal(verifyYuE2ExecutionAccounting(f).allocatedCostUsdMicros, cost(large.hourly_rate_usd_micros, 1_234_567_891));
});

test("tampered bytes and every receipt-chain substitution fail closed", () => {
  const base = fixture();
  for (const key of ["admission", "policy", "start", "outcome", "accounting"] as const) {
    const f = clone(base);
    f.accountingResponse[key]!.payload_json += " ";
    assert.throws(() => verifyYuE2ExecutionAccounting(f), key);
  }
  for (const key of ["accepted", "job", "config", "started", "terminal"] as const) {
    const f = clone(base);
    f.accountingResponse.receipt_payloads[key]!.sha256 = "f".repeat(64);
    assert.throws(() => verifyYuE2ExecutionAccounting(f), key);
  }
  const changes: Array<(f: Fixture) => void> = [
    (f) => { f.accountingResponse.admission = mutate(f.accountingResponse.admission, { accepted_sha256: "f".repeat(64) }); },
    (f) => { f.accountingResponse.admission = mutate(f.accountingResponse.admission, { policy_sha256: f.accountingResponse.policy.sha256 }); },
    (f) => { f.accountingResponse.start = mutate(f.accountingResponse.start!, { job_sha256: "f".repeat(64) }); },
    (f) => { f.accountingResponse.start = mutate(f.accountingResponse.start!, { config_sha256: "f".repeat(64) }); },
    (f) => { f.accountingResponse.start = mutate(f.accountingResponse.start!, { policy_sha256: f.accountingResponse.policy.sha256 }); },
    (f) => outcomePatch(f, { start_sha256: "f".repeat(64) }),
    (f) => outcomePatch(f, { terminal_sha256: "f".repeat(64) }),
    (f) => terminalPatch(f, { attempt: 2 }),
    (f) => terminalPatch(f, { started_sha256: "f".repeat(64) }),
    (f) => { f.statusResponse.accepted_sha256 = "f".repeat(64); },
  ];
  for (const change of changes) { const f = clone(base); change(f); assert.throws(() => verifyYuE2ExecutionAccounting(f)); }
});

test("wrong costs, unsafe integers, unknown fields, billing and qualification escalation reject", () => {
  const base = fixture();
  for (const patch of [
    { elapsed_ns: 0 }, { elapsed_ns: -1 }, { elapsed_ns: 1.5 }, { elapsed_ns: "1000000001" },
    { elapsed_ns: Number.MAX_SAFE_INTEGER + 1 }, { allocated_cost_usd_micros: 1000 },
    { allocated_cost_usd_micros: Number.MAX_SAFE_INTEGER + 1 }, { provider_billed_cost_usd_micros: 1001 },
    { hard_vm_bill_cap: true }, { rental_idle_excluded: false }, { budget_exceeded: true },
    { rate_source: "provider_invoice" }, { accounting_basis: "gpu_seconds" }, { unknown: true },
    { measurement_boundary: "inference_only" }, { outcome_sha256: "f".repeat(64) },
    { policy_sha256: base.accountingResponse.policy.sha256 },
    { execution_deadline_exceeded: true }, { execution_limit_scope: "whole_invocation" },
  ]) {
    const f = clone(base); f.accountingResponse.accounting = mutate(f.accountingResponse.accounting!, patch);
    assert.throws(() => verifyYuE2ExecutionAccounting(f));
  }
  for (const patch of [{ termination_verified: false }, { child_exitcode: null }, { child_exitcode: 1 },
    { child_exitcode: 0.5 }, { child_timed_out: true }, { slot_releasable: false }, { unknown: true }]) {
    const f = clone(base); outcomePatch(f, patch); assert.throws(() => verifyYuE2ExecutionAccounting(f));
  }
  const qualified = clone(base);
  terminalPatch(qualified, { qualification: { ...YUE2_QUALIFICATION, production_approved: true } });
  assert.throws(() => verifyYuE2ExecutionAccounting(qualified));
  const wrongRequest = clone(base);
  wrongRequest.request.job.seed++;
  assert.throws(() => verifyYuE2ExecutionAccounting(wrongRequest));
});

test("failed generation retains cost and process-exit evidence", () => {
  const f = fixture();
  terminalPatch(f, { status: "failed", result: null, error: { type: "FixtureFailure", message: "explicit synthetic failure" } });
  outcomePatch(f, { status: "failed", error: "supervision_requires_review" });
  f.statusResponse.state = "failed";
  const result = verifyYuE2ExecutionAccounting(f);
  assert.equal(result.supervisorStatus, "failed");
  assert.equal(result.allocatedCostUsdMicros, 1001);
  assert.equal(result.terminationVerified, true);
  assert.equal(result.childExitcode, 0);
  outcomePatch(f, { child_exitcode: 1 });
  assert.throws(() => verifyYuE2ExecutionAccounting(f), "releasable failure still requires a confirmed clean exit");
});

test("timeout without terminal retains measured cost but never releases slot", () => {
  const f = fixture(policy, 61_000_000_000);
  delete f.accountingResponse.receipt_payloads.terminal;
  delete f.statusResponse.receipt_payloads.terminal;
  f.statusResponse.receipt = null; f.statusResponse.state = "ambiguous";
  outcomePatch(f, { status: "timed_out", terminal_sha256: null, child_exitcode: -9,
    child_timed_out: true, slot_releasable: false, error: "supervision_requires_review" });
  const result = verifyYuE2ExecutionAccounting(f);
  assert.equal(result.allocatedCostUsdMicros, 61001);
  assert.equal(result.childExitcode, -9);
  assert.equal(result.slotReleasable, false);
  assert.equal(result.supervisorStatus, "timed_out");
  assert.equal(result.childTimedOut, true);
  assert.equal(result.executionDeadlineExceeded, true);
  outcomePatch(f, { slot_releasable: true });
  assert.throws(() => verifyYuE2ExecutionAccounting(f));
});

test("preflight failure can retain allocation without runner started or terminal", () => {
  const f = fixture();
  delete f.accountingResponse.receipt_payloads.started; delete f.accountingResponse.receipt_payloads.terminal;
  delete f.statusResponse.receipt_payloads.started; delete f.statusResponse.receipt_payloads.terminal;
  f.statusResponse.receipt = null; f.statusResponse.state = "failed";
  outcomePatch(f, { status: "failed", terminal_sha256: null, error: "supervision_requires_review" });
  assert.equal(verifyYuE2ExecutionAccounting(f).allocatedCostUsdMicros, 1001);
});

test("overrun remains measured and cannot become a released allocation", () => {
  const f = fixture(policy, 66_000_000_000);
  f.statusResponse.state = "ambiguous";
  outcomePatch(f, { status: "overrun", slot_releasable: false, error: "supervision_requires_review" });
  f.accountingResponse.accounting = mutate(f.accountingResponse.accounting!, { budget_exceeded: true });
  const result = verifyYuE2ExecutionAccounting(f);
  assert.equal(result.allocatedCostUsdMicros, 66001);
  assert.equal(result.budgetExceeded, true);
  assert.equal(result.slotReleasable, false);
});

test("receipt-readback deadline overrun holds even when the child exited within budget", () => {
  const f = fixture(policy, 61_000_000_000);
  f.statusResponse.state = "ambiguous";
  outcomePatch(f, { status: "overrun", slot_releasable: false, error: "supervision_requires_review" });
  const result = verifyYuE2ExecutionAccounting(f);
  assert.equal(result.budgetExceeded, false);
  assert.equal(result.executionDeadlineExceeded, true);
  assert.equal(result.childTimedOut, false);
  assert.equal(result.slotReleasable, false);
  outcomePatch(f, { status: "completed", slot_releasable: true, error: null });
  assert.throws(() => verifyYuE2ExecutionAccounting(f));
});

test("missing accounting is an unknown hold, never zero or inferred completion", () => {
  const f = fixture();
  f.statusResponse.state = "ambiguous";
  f.accountingResponse.accounting = null;
  const result = verifyYuE2ExecutionAccounting(f);
  assert.equal(result.status, "unknown_hold");
  assert.equal(result.allocatedCostUsdMicros, null);
  assert.equal(result.elapsedNs, null);
  assert.equal(result.slotReleasable, false);
  assert.equal(result.terminationVerified, true);
  f.accountingResponse.outcome = null;
  assert.equal(verifyYuE2ExecutionAccounting(f).terminationVerified, false);
  f.accountingResponse.start = null;
  assert.throws(() => verifyYuE2ExecutionAccounting(f), "runner evidence without supervision start rejects");
  delete f.accountingResponse.receipt_payloads.started; delete f.accountingResponse.receipt_payloads.terminal;
  delete f.statusResponse.receipt_payloads.started; delete f.statusResponse.receipt_payloads.terminal;
  f.statusResponse.receipt = null; f.statusResponse.state = "accepted";
  assert.equal(verifyYuE2ExecutionAccounting(f).status, "unknown_hold");
});

test("earlier status snapshot may lack later receipts, but cannot contradict them", () => {
  const f = fixture();
  f.statusResponse.state = "running"; f.statusResponse.receipt = null;
  delete f.statusResponse.receipt_payloads.terminal;
  assert.equal(verifyYuE2ExecutionAccounting(f).supervisorStatus, "completed");
  f.statusResponse.receipt_payloads.started = mutate(f.statusResponse.receipt_payloads.started!, { pid: 99 });
  assert.throws(() => verifyYuE2ExecutionAccounting(f));
});
