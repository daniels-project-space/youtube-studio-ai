import type { StageContext } from "./types";
import { ExecutionError } from "./executionErrors";
import type { CheckpointCostReceipt } from "@/lib/checkpointCostAccounting";

export interface InlineCheckpointBinding {
  ownerId: string;
  channelId: string;
  runId: string;
  keyPrefix: string;
  moduleId: string;
  moduleVersion: string;
  inputFingerprint: string;
}
export interface InlineCheckpointContext extends Pick<StageContext, "ownerId" | "channelId" | "runId" | "keyPrefix" | "store" | "params"> {
  readonly binding: Readonly<InlineCheckpointBinding>;
  readonly priorStage?: { readonly status: string; readonly costUsd: number };
}
export interface VerifiedInlineCheckpoint {
  readonly binding: Readonly<InlineCheckpointBinding>;
  readonly kind: "fresh" | "continuable" | "restorable";
  readonly ledgerFingerprint: string | null;
  readonly receipts: readonly Readonly<CheckpointCostReceipt>[];
}

const issuedProofs = new WeakSet<object>();
const HEX = /^[a-f0-9]{64}$/;
const EPSILON_USD = 1e-9;
function hold(reason: string): never {
  throw new ExecutionError("PAID_STAGE_RECONCILIATION_REQUIRED: " + reason, {
    code: "INLINE_CHECKPOINT_ADMISSION_REQUIRED", retryable: false,
  });
}
function amount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) hold("invalid checkpoint amount");
  return value;
}
function receiptMap(values: readonly Readonly<CheckpointCostReceipt>[]): Map<string, CheckpointCostReceipt> {
  if (!Array.isArray(values) || values.length > 256) hold("invalid checkpoint receipt count");
  const result = new Map<string, CheckpointCostReceipt>();
  for (const value of values) {
    if (!value || typeof value.id !== "string" || !HEX.test(value.id) || result.has(value.id)) hold("invalid or duplicated checkpoint receipt identity");
    result.set(value.id, { id: value.id, costUsd: amount(value.costUsd) });
  }
  return result;
}
const sum = (receipts: Iterable<CheckpointCostReceipt>) => amount([...receipts].reduce((total, receipt) => total + receipt.costUsd, 0));

/** Only executable adapters call this AFTER validating their own complete ledger.
 * It prevents a serialized/config-supplied object from masquerading as a proof;
 * it does not replace the adapter's semantic validation or authorize a provider. */
export function verifiedInlineCheckpoint(
  binding: Readonly<InlineCheckpointBinding>,
  evidence: Pick<VerifiedInlineCheckpoint, "kind" | "ledgerFingerprint" | "receipts">,
): VerifiedInlineCheckpoint {
  for (const key of ["ownerId", "channelId", "runId", "keyPrefix", "moduleId", "moduleVersion"] as const) {
    if (typeof binding[key] !== "string" || !binding[key].trim()) hold("invalid checkpoint binding");
  }
  if (typeof binding.inputFingerprint !== "string" || !HEX.test(binding.inputFingerprint)) hold("invalid checkpoint input fingerprint");
  if (!["fresh", "continuable", "restorable"].includes(evidence.kind)) hold("invalid checkpoint state");
  const receipts = [...receiptMap(evidence.receipts).values()].map((receipt) => Object.freeze(receipt));
  sum(receipts);
  if (evidence.kind === "fresh" ? evidence.ledgerFingerprint !== null || receipts.length !== 0 :
    typeof evidence.ledgerFingerprint !== "string" || !HEX.test(evidence.ledgerFingerprint)) hold("invalid checkpoint ledger identity");
  const proof = Object.freeze({ binding: Object.freeze({ ...binding }), kind: evidence.kind,
    ledgerFingerprint: evidence.ledgerFingerprint, receipts: Object.freeze(receipts) });
  issuedProofs.add(proof);
  return proof;
}

/** Pure arithmetic over verified identities; equal dollars never prove credit. */
export function reconcileInlineCheckpoint(
  expected: Readonly<InlineCheckpointBinding>, proof: VerifiedInlineCheckpoint,
  prior: { status: string; costUsd: number; receipts: readonly CheckpointCostReceipt[] } | undefined,
  totalEnvelopeUsd: number,
) {
  if (!proof || !issuedProofs.has(proof)) hold("checkpoint adapter returned an unverified/serialized proof");
  for (const key of Object.keys(expected) as (keyof InlineCheckpointBinding)[]) {
    if (proof.binding[key] !== expected[key]) hold("checkpoint proof belongs to different inputs, module or run");
  }
  const envelope = amount(totalEnvelopeUsd);
  if (envelope <= 0) hold("checkpoint requires a positive, finite admitted envelope");
  const persisted = receiptMap(prior?.receipts ?? []), current = receiptMap(proof.receipts);
  const priorCost = amount(prior?.costUsd ?? 0), attributed = sum(persisted.values()), ledgerCost = sum(current.values());
  if (attributed > priorCost + EPSILON_USD) hold("checkpoint receipts exceed prior stage spend");
  if (proof.kind === "fresh" && prior && (priorCost > 0 || ["running", "failed", "ok", "superseded"].includes(prior.status))) {
    hold("prior execution has no matching checkpoint ledger");
  }
  let matched = 0;
  for (const receipt of current.values()) {
    const previous = persisted.get(receipt.id);
    if (previous && previous.costUsd !== receipt.costUsd) hold("checkpoint receipt amount changed");
    if (previous) matched += receipt.costUsd;
  }
  const discoveredCostUsd = amount(Math.max(0, ledgerCost - matched));
  if (discoveredCostUsd > EPSILON_USD && priorCost - attributed > EPSILON_USD) {
    hold("unattributed historical spend cannot be assigned to a newly discovered receipt");
  }
  if (ledgerCost > envelope + EPSILON_USD) hold("checkpoint ledger exceeds its admitted total envelope");
  const receipts = [...new Map([...persisted, ...current]).values()];
  if (receipts.length > 256) hold("checkpoint receipt union limit exceeded");
  return {
    priorCostUsd: amount(priorCost + discoveredCostUsd), discoveredCostUsd, receipts, ledgerCostUsd: ledgerCost,
    // Complete ledger replay is verified no-new-work, not a second reservation.
    reservationCreditUsd: proof.kind === "restorable" ? envelope : ledgerCost,
    needsPersistence: discoveredCostUsd > 0 || receipts.length !== persisted.size,
  };
}
