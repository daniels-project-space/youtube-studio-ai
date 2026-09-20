import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { canonicalJson } from "@/lib/canonicalJson";
import {
  assertYuE2Manifest, validateYuE2EvaluationRequest, YUE2_QUALIFICATION,
} from "@/lib/yue2Evaluation";

const CONTRACT = "yue2-execution-supervision/v1";
const BASIS = "supervised_dispatch_wall_time";
const DENOMINATOR = BigInt(3_600_000_000_000);
const SafeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const PositiveInteger = SafeInteger.refine((value) => value > 0);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const JobId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/);
const Label = z.string().min(1).refine((value) => value === value.trim() &&
  Buffer.byteLength(value, "utf8") <= 512 && !/[\x00-\x1f]/u.test(value) &&
  Buffer.from(value, "utf8").toString("utf8") === value);
const Policy = z.object({
  schema_version: z.literal(1), provider: z.literal("openrelay"),
  allocation_basis: z.literal(BASIS), rate_source: z.literal("operator_configured"),
  rate_reference: Label, runtime_id: Label.refine((value) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)),
  hourly_rate_usd_micros: PositiveInteger,
  max_execution_seconds: z.number().int().min(1).max(7200),
  termination_grace_seconds: z.number().int().min(1).max(30),
  reserved_allocation_usd_micros: PositiveInteger,
}).strict();
export type YuE2ExecutionPolicy = z.infer<typeof Policy>;

const Sealed = z.object({ sha256: Hash, payload_json: z.string().refine((value) =>
  Buffer.byteLength(value, "utf8") <= 1024 * 1024) }).strict();
type SealedReceipt = z.infer<typeof Sealed>;
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const integerCanonical = (value: unknown) => `${canonicalJson(value)}\n`;
const allocate = (rate: number, elapsedNs: bigint) => (BigInt(rate) * elapsedNs + DENOMINATOR - BigInt(1)) / DENOMINATOR;
const maximum = (policy: YuE2ExecutionPolicy) => allocate(policy.hourly_rate_usd_micros,
  (BigInt(policy.max_execution_seconds) + BigInt(policy.termination_grace_seconds)) * BigInt(1_000_000_000));
function requireMatch(condition: boolean): asserts condition {
  if (!condition) throw new Error("YuE2 execution accounting verification failed");
}
function unseal(value: unknown): { receipt: SealedReceipt; payload: unknown } {
  const receipt = Sealed.parse(value);
  requireMatch(receipt.payload_json.endsWith("\n") && hash(receipt.payload_json) === receipt.sha256);
  return { receipt, payload: JSON.parse(receipt.payload_json) as unknown };
}

export function validateYuE2ExecutionPolicy(input: unknown): YuE2ExecutionPolicy {
  const policy = Policy.parse(input);
  requireMatch(BigInt(policy.reserved_allocation_usd_micros) >= maximum(policy));
  return policy;
}

const PolicyReceipt = z.object({
  contract: z.literal(CONTRACT), policy: Policy, policy_sha256: Hash,
  maximum_allocation_usd_micros: PositiveInteger, accounting_basis: z.literal(BASIS),
  provider_billed_cost_usd_micros: z.null(),
  descendant_policy: z.literal("linux-seccomp-threads-only-pdeathsig-sigkill"),
}).strict();
export interface YuE2VerifiedExecutionPolicy {
  policy: YuE2ExecutionPolicy;
  submissionPolicySha256: string;
  policyReceiptSha256: string;
  maximumAllocationUsdMicros: number;
}
export function verifyYuE2ExecutionPolicy(expectedPolicy: unknown, wire: unknown): YuE2VerifiedExecutionPolicy {
  const policy = validateYuE2ExecutionPolicy(expectedPolicy);
  const sealed = unseal(wire);
  const payload = PolicyReceipt.parse(sealed.payload);
  const submissionPolicySha256 = hash(integerCanonical(policy));
  requireMatch(isDeepStrictEqual(payload.policy, policy) && payload.policy_sha256 === submissionPolicySha256 &&
    BigInt(payload.maximum_allocation_usd_micros) === maximum(policy));
  // These receipts have integer-only numeric fields, unlike the runner's float-bearing receipts.
  requireMatch(sealed.receipt.payload_json === integerCanonical(payload));
  return { policy, submissionPolicySha256, policyReceiptSha256: sealed.receipt.sha256,
    maximumAllocationUsdMicros: payload.maximum_allocation_usd_micros };
}

const Admission = z.object({ schema_version: z.literal(1), accepted_sha256: Hash,
  policy_sha256: Hash, policy: Policy }).strict();
const Accepted = z.object({ schema_version: z.literal(1), accepted_at: z.string().min(1),
  job: z.unknown(), config: z.unknown(), job_sha256: Hash, config_sha256: Hash }).strict();
const Config = z.object({ schema_version: z.literal(1), manifest: z.unknown(), cache_dir: z.string().min(1),
  device: z.literal("cuda:0"), local_files_only: z.literal(true), candidate_count: z.literal(1),
  exports: z.tuple([z.literal("official_pcm24_flac"), z.literal("native_float32_wav"), z.literal("native_float32_npy")]),
}).strict();
const Start = z.object({ contract: z.literal(CONTRACT), job_id: JobId, started_at: z.string().min(1),
  supervisor_pid: PositiveInteger, job_sha256: Hash, config_sha256: Hash, policy_sha256: Hash }).strict();
const Outcome = z.object({ contract: z.literal(CONTRACT), start_sha256: Hash, finished_at: z.string().min(1),
  status: z.enum(["completed", "failed", "timed_out", "overrun", "held"]), terminal_sha256: Hash.nullable(),
  child_exitcode: z.number().int().min(-64).max(255), termination_verified: z.literal(true),
  child_timed_out: z.boolean(), slot_releasable: z.boolean(), error: z.literal("supervision_requires_review").nullable(),
}).strict();
const Accounting = z.object({ contract: z.literal(CONTRACT), status: z.literal("measured_allocation_estimate"),
  policy_sha256: Hash, outcome_sha256: Hash, elapsed_ns: PositiveInteger,
  allocated_cost_usd_micros: PositiveInteger, accounting_basis: z.literal(BASIS),
  provider_billed_cost_usd_micros: z.null(), rate_source: z.literal("operator_configured"),
  rental_idle_excluded: z.literal(true), hard_vm_bill_cap: z.literal(false), budget_exceeded: z.boolean(),
  execution_deadline_exceeded: z.boolean(), execution_limit_scope: z.literal("child_process_only"),
  measurement_boundary: z.literal("dispatch_start_through_runner_receipt_and_artifact_readback"),
}).strict();
const RunnerStarted = z.object({ schema_version: z.literal(1), job_id: JobId, attempt: PositiveInteger,
  started_at: z.string().min(1), pid: PositiveInteger, job_sha256: Hash, config_sha256: Hash,
  environment: z.record(z.unknown()),
}).strict();
const Result = z.object({ status: z.literal("complete"),
  truncated: z.object({ abc: z.literal(false), semantic: z.literal(false) }).strict(),
  sample_rate: z.literal(48000), channels: z.literal(2), frames: PositiveInteger,
  audio_seconds: z.number().positive().finite(), official_identity: Hash, timing: z.record(z.unknown()),
  native_audio: z.literal("audio-native.wav"), official_result: z.literal("song/result.json"),
}).strict();
const RunnerTerminal = z.object({ schema_version: z.literal(1), job_id: JobId, attempt: PositiveInteger,
  finished_at: z.string().min(1), status: z.enum(["completed", "failed"]), started_sha256: Hash,
  result: Result.nullable(), error: z.object({ type: z.string(), message: z.string() }).strict().nullable(),
  qualification: z.unknown(), artifacts: z.record(z.object({ sha256: Hash, bytes: SafeInteger }).strict()),
}).strict();
const Wire = z.object({ contract: z.literal("yue2-execution-accounting/v1"), job_id: JobId,
  admission: Sealed, policy: Sealed, start: Sealed.nullable(), outcome: Sealed.nullable(), accounting: Sealed.nullable(),
  receipt_payloads: z.object({ accepted: Sealed, job: Sealed, config: Sealed,
    started: Sealed.optional(), terminal: Sealed.optional() }).strict(),
}).strict();
const Status = z.object({ contract: z.literal("yue2-evaluation-worker/v1"), job_id: JobId,
  state: z.enum(["accepted", "running", "completed", "failed", "ambiguous", "refused"]), job: z.unknown(),
  job_sha256: Hash, config_sha256: Hash, accepted_sha256: Hash, qualification: z.unknown(),
  progress: z.object({ phase: z.string(), receipt: z.string(), data: z.unknown().optional() }).strict(),
  receipt: z.unknown(), error: z.unknown(), artifacts: z.record(z.string()),
  receipt_payloads: z.object({ job: Sealed, config: Sealed, started: Sealed.optional(), terminal: Sealed.optional() }).strict(),
}).strict();
export interface YuE2VerifiedExecutionAccounting extends YuE2VerifiedExecutionPolicy {
  jobId: string;
  status: "unknown_hold" | "measured_allocation_estimate";
  supervisorStatus: z.infer<typeof Outcome>["status"] | null;
  elapsedNs: number | null;
  allocatedCostUsdMicros: number | null;
  providerBilledCostUsdMicros: null;
  slotReleasable: boolean;
  budgetExceeded: boolean | null;
  terminationVerified: boolean;
  childExitcode: number | null;
  childTimedOut: boolean | null;
  executionDeadlineExceeded: boolean | null;
  executionLimitScope: "child_process_only";
  qualification: typeof YUE2_QUALIFICATION;
  evidence: z.infer<typeof Wire>;
}

/** Verify integrity/bindings, not provider invoicing, worker attestation, or music quality. */
export function verifyYuE2ExecutionAccounting(input: {
  request: unknown; expectedPolicy: unknown; statusResponse: unknown; accountingResponse: unknown;
}): YuE2VerifiedExecutionAccounting {
  const request = validateYuE2EvaluationRequest(input.request);
  const wire = Wire.parse(input.accountingResponse);
  const status = Status.parse(input.statusResponse);
  const verifiedPolicy = verifyYuE2ExecutionPolicy(input.expectedPolicy, wire.policy);
  requireMatch(wire.job_id === request.job.job_id);
  const admission = Admission.parse(unseal(wire.admission).payload);
  const core = wire.receipt_payloads;
  requireMatch(status.job_id === wire.job_id && isDeepStrictEqual(status.job, request.job) &&
    status.job_sha256 === core.job.sha256 && status.config_sha256 === core.config.sha256 &&
    status.accepted_sha256 === core.accepted.sha256 && isDeepStrictEqual(status.qualification, YUE2_QUALIFICATION));
  // Status is fetched first: accounting may contain later receipts, never different earlier ones.
  for (const name of ["job", "config", "started", "terminal"] as const) {
    const receipt = status.receipt_payloads[name];
    if (receipt) requireMatch(isDeepStrictEqual(unseal(receipt).receipt, core[name]));
  }
  const accepted = Accepted.parse(unseal(core.accepted).payload);
  const job = unseal(core.job).payload;
  const config = Config.parse(unseal(core.config).payload);
  assertYuE2Manifest(config.manifest);
  requireMatch(isDeepStrictEqual(job, request.job) && isDeepStrictEqual(accepted.job, job) &&
    isDeepStrictEqual(accepted.config, config) && accepted.job_sha256 === core.job.sha256 &&
    accepted.config_sha256 === core.config.sha256 && admission.accepted_sha256 === core.accepted.sha256 &&
    admission.policy_sha256 === verifiedPolicy.submissionPolicySha256 &&
    isDeepStrictEqual(admission.policy, verifiedPolicy.policy));
  const start = wire.start ? Start.parse(unseal(wire.start).payload) : null;
  if (start) requireMatch(start.job_id === request.job.job_id && start.job_sha256 === core.job.sha256 &&
    start.config_sha256 === core.config.sha256 && start.policy_sha256 === verifiedPolicy.submissionPolicySha256);
  const runnerStarted = core.started ? RunnerStarted.parse(unseal(core.started).payload) : null;
  if (runnerStarted) requireMatch(start !== null && runnerStarted.job_id === request.job.job_id &&
    runnerStarted.job_sha256 === core.job.sha256 && runnerStarted.config_sha256 === core.config.sha256);
  const terminal = core.terminal ? RunnerTerminal.parse(unseal(core.terminal).payload) : null;
  if (terminal) {
    requireMatch(runnerStarted !== null && terminal.job_id === request.job.job_id &&
      terminal.attempt === runnerStarted.attempt && terminal.started_sha256 === core.started?.sha256 &&
      isDeepStrictEqual(terminal.qualification, YUE2_QUALIFICATION));
    requireMatch(terminal.status === "completed" ? terminal.result !== null && terminal.error === null :
      terminal.result === null && terminal.error !== null);
  }
  requireMatch(isDeepStrictEqual(status.receipt, status.receipt_payloads.terminal ?
    unseal(status.receipt_payloads.terminal).payload : null));
  const outcome = wire.outcome ? Outcome.parse(unseal(wire.outcome).payload) : null;
  if (outcome) {
    requireMatch(start !== null && outcome.start_sha256 === wire.start?.sha256 &&
      outcome.terminal_sha256 === (core.terminal?.sha256 ?? null));
    if (outcome.status === "completed") requireMatch(terminal?.status === "completed" && outcome.child_exitcode === 0);
    if (outcome.status === "failed" && terminal) requireMatch(terminal.status === "failed");
    if (outcome.status === "failed" && !terminal) requireMatch(!runnerStarted);
    if (["completed", "failed"].includes(outcome.status)) requireMatch(outcome.child_exitcode === 0);
    requireMatch(outcome.error === (outcome.status === "completed" ? null : "supervision_requires_review"));
    if (["held", "overrun", "timed_out"].includes(outcome.status)) requireMatch(!outcome.slot_releasable);
  }
  if (status.state === "completed" || status.state === "failed") {
    requireMatch(outcome?.status === status.state && wire.accounting !== null);
  }
  const base = { ...verifiedPolicy, jobId: wire.job_id, providerBilledCostUsdMicros: null,
    qualification: YUE2_QUALIFICATION, executionLimitScope: "child_process_only", evidence: wire } as const;
  if (!wire.accounting) return { ...base, status: "unknown_hold", supervisorStatus: outcome?.status ?? null,
    elapsedNs: null, allocatedCostUsdMicros: null, slotReleasable: false, budgetExceeded: null,
    terminationVerified: outcome?.termination_verified ?? false, childExitcode: outcome?.child_exitcode ?? null,
    childTimedOut: outcome?.child_timed_out ?? null, executionDeadlineExceeded: null };
  const accounting = Accounting.parse(unseal(wire.accounting).payload);
  requireMatch(outcome !== null && accounting.policy_sha256 === verifiedPolicy.submissionPolicySha256 &&
    accounting.outcome_sha256 === wire.outcome?.sha256);
  const allocated = allocate(verifiedPolicy.policy.hourly_rate_usd_micros, BigInt(accounting.elapsed_ns));
  const exceeded = allocated > BigInt(verifiedPolicy.policy.reserved_allocation_usd_micros);
  const deadlineExceeded = BigInt(accounting.elapsed_ns) > BigInt(verifiedPolicy.policy.max_execution_seconds) * BigInt(1_000_000_000);
  const overrun = exceeded || (deadlineExceeded && !outcome.child_timed_out);
  requireMatch(allocated === BigInt(accounting.allocated_cost_usd_micros) && accounting.budget_exceeded === exceeded &&
    accounting.execution_deadline_exceeded === deadlineExceeded && (outcome.status === "overrun") === overrun &&
    (overrun || (outcome.child_timed_out ? deadlineExceeded && outcome.status === "timed_out" : outcome.status !== "timed_out")) &&
    outcome.slot_releasable ===
      (!exceeded && ["completed", "failed"].includes(outcome.status)));
  return { ...base, status: "measured_allocation_estimate", supervisorStatus: outcome.status,
    elapsedNs: accounting.elapsed_ns, allocatedCostUsdMicros: accounting.allocated_cost_usd_micros,
    slotReleasable: outcome.slot_releasable, budgetExceeded: exceeded,
    terminationVerified: true, childExitcode: outcome.child_exitcode, childTimedOut: outcome.child_timed_out,
    executionDeadlineExceeded: deadlineExceeded };
}
