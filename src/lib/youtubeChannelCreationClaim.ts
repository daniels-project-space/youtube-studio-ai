export const YOUTUBE_CREATION_CLAIM_LEASE_MS = 25 * 60 * 1_000;

export type YoutubeCreationClaimStatus =
  | "claimed"
  | "provider_started"
  | "ambiguous"
  | "recovery"
  | "pre_provider_failed"
  | "created";

export interface YoutubeCreationBinding {
  ownerId: string;
  channelId: string;
  requestKey: string;
  name: string;
  requestedHandle: string;
  receiptFingerprint: string;
}

export interface YoutubeCreationClaimSnapshot extends YoutubeCreationBinding {
  status: YoutubeCreationClaimStatus;
  workerId: string;
  claimExpiresAt: number;
  providerAttemptId?: string;
  ytChannelId?: string;
}

export type YoutubeExactIdentityInventoryState = "absent" | "present" | "ambiguous";

/**
 * Immutable browser observation taken before the irreversible create boundary.
 * It is redundantly bound to the signed request so a receipt cannot be moved to
 * another owner, app channel, provider identity, or approval.
 */
export interface YoutubePreProviderInventoryProof extends YoutubeCreationBinding {
  version: "youtube-pre-provider-inventory/v1";
  inventoryFingerprint: string;
  candidateCount: number;
  observedYtChannelIds: string[];
  exactIdentityState: YoutubeExactIdentityInventoryState;
  observedAt: number;
}

export type YoutubeCreationClaimAction =
  | "create"
  | "recover"
  | "reuse"
  | "wait"
  | "new_intent_required";

export type YoutubeCreationRecoveryAdmission = "recover" | "reuse" | "wait";

const REQUEST_KEY = /^[A-Za-z0-9:_-]{16,200}$/;
const RECEIPT_FINGERPRINT = /^[a-f0-9]{64}$/;
const HANDLE = /^[A-Za-z0-9._-]{3,30}$/;
const YOUTUBE_CHANNEL_ID = /^UC[A-Za-z0-9_-]{20,}$/;

function clean(value: string): string {
  return value.trim();
}

export function normalizeYoutubeChannelName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function normalizeYoutubeHandle(value: string): string {
  return value.normalize("NFKC").trim().replace(/^@/, "").toLowerCase();
}

/** Deterministic handle preview shared by the approval UI and provider task. */
export function suggestYoutubeHandle(name: string): string {
  const base = normalizeYoutubeChannelName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 28);
  return base.length >= 3 ? base : `${base}channel`.slice(0, 28);
}

export function assertYoutubeCreationBinding(binding: YoutubeCreationBinding): void {
  if (!clean(binding.ownerId)) throw new Error("YouTube creation ownerId is required");
  if (!clean(binding.channelId)) throw new Error("YouTube creation channelId is required");
  if (!REQUEST_KEY.test(binding.requestKey)) {
    throw new Error("YouTube creation requestKey is invalid");
  }
  const name = normalizeYoutubeChannelName(binding.name);
  if (!name || name.length > 100) throw new Error("YouTube channel name is invalid");
  if (!HANDLE.test(normalizeYoutubeHandle(binding.requestedHandle))) {
    throw new Error("YouTube channel handle is invalid");
  }
  if (!RECEIPT_FINGERPRINT.test(binding.receiptFingerprint)) {
    throw new Error("YouTube creation receipt fingerprint is invalid");
  }
}

export function assertYoutubePreProviderInventoryProof(
  proof: YoutubePreProviderInventoryProof,
  requested: YoutubeCreationBinding,
): void {
  assertYoutubeCreationClaimBinding(proof, requested);
  if (proof.version !== "youtube-pre-provider-inventory/v1") {
    throw new Error("YouTube pre-provider inventory version is invalid");
  }
  if (!RECEIPT_FINGERPRINT.test(proof.inventoryFingerprint)) {
    throw new Error("YouTube pre-provider inventory fingerprint is invalid");
  }
  if (
    !Number.isInteger(proof.candidateCount) ||
    proof.candidateCount < 0 ||
    proof.candidateCount > 500
  ) {
    throw new Error("YouTube pre-provider inventory candidate count is invalid");
  }
  if (!Number.isFinite(proof.observedAt) || proof.observedAt <= 0) {
    throw new Error("YouTube pre-provider inventory timestamp is invalid");
  }
  if (!Array.isArray(proof.observedYtChannelIds) || proof.observedYtChannelIds.length > 500) {
    throw new Error("YouTube pre-provider inventory channel ids are invalid");
  }
  if (proof.observedYtChannelIds.length > proof.candidateCount) {
    throw new Error("YouTube pre-provider inventory counts are inconsistent");
  }
  for (const ytChannelId of proof.observedYtChannelIds) assertYoutubeChannelId(ytChannelId);
  if (new Set(proof.observedYtChannelIds).size !== proof.observedYtChannelIds.length) {
    throw new Error("YouTube pre-provider inventory channel ids are not unique");
  }
  if (
    proof.exactIdentityState !== "absent" &&
    proof.exactIdentityState !== "present" &&
    proof.exactIdentityState !== "ambiguous"
  ) {
    throw new Error("YouTube pre-provider exact-identity state is invalid");
  }
  if (
    (proof.exactIdentityState === "present" && proof.candidateCount < 1) ||
    (proof.exactIdentityState === "ambiguous" && proof.candidateCount < 2)
  ) {
    throw new Error("YouTube pre-provider exact-identity evidence is inconsistent");
  }
}

export function assertYoutubeCreationCompletionWasAbsent(
  proof: YoutubePreProviderInventoryProof | undefined,
  requested: YoutubeCreationBinding,
  ytChannelId: string,
): void {
  assertYoutubeChannelId(ytChannelId);
  if (!proof) throw new Error("YouTube creation has no durable pre-provider inventory proof");
  assertYoutubePreProviderInventoryProof(proof, requested);
  if (proof.exactIdentityState !== "absent") {
    throw new Error("YouTube recovery matched an identity that existed before provider start");
  }
  if (proof.observedYtChannelIds.includes(ytChannelId)) {
    throw new Error("YouTube recovery channel id existed in the pre-provider inventory");
  }
}

export function assertYoutubePreProviderInventoryAllowsProviderStart(
  proof: YoutubePreProviderInventoryProof | undefined,
  requested: YoutubeCreationBinding,
): asserts proof is YoutubePreProviderInventoryProof {
  if (!proof) throw new Error("YouTube creation has no durable pre-provider inventory proof");
  assertYoutubePreProviderInventoryProof(proof, requested);
  if (proof.exactIdentityState !== "absent") {
    throw new Error("the exact YouTube identity existed before provider start");
  }
}

export function assertYoutubeChannelIdUniqueBinding(args: {
  channelId: string;
  claimChannelIds: readonly string[];
  projectedChannelIds: readonly string[];
}): void {
  const conflict = [...args.claimChannelIds, ...args.projectedChannelIds]
    .some((candidate) => candidate !== args.channelId);
  if (conflict) {
    throw new Error("YouTube channel id is already bound to another app channel");
  }
}

export function assertYoutubeCreationClaimBinding(
  existing: YoutubeCreationBinding,
  requested: YoutubeCreationBinding,
): void {
  assertYoutubeCreationBinding(requested);
  if (
    existing.ownerId !== requested.ownerId ||
    existing.channelId !== requested.channelId ||
    existing.requestKey !== requested.requestKey ||
    normalizeYoutubeChannelName(existing.name) !==
      normalizeYoutubeChannelName(requested.name) ||
    normalizeYoutubeHandle(existing.requestedHandle) !==
      normalizeYoutubeHandle(requested.requestedHandle) ||
    existing.receiptFingerprint !== requested.receiptFingerprint
  ) {
    throw new Error("YouTube creation request has an immutable binding conflict");
  }
}

/**
 * The only decision point allowed to admit the irreversible provider click.
 * Once provider_started is durable, every later attempt is recovery-only.
 */
export function decideYoutubeCreationClaimAction(args: {
  existing: YoutubeCreationClaimSnapshot | null;
  requested: YoutubeCreationBinding;
  workerId: string;
  now: number;
}): YoutubeCreationClaimAction {
  assertYoutubeCreationBinding(args.requested);
  if (!clean(args.workerId)) throw new Error("YouTube creation workerId is required");
  if (!args.existing) return "create";
  assertYoutubeCreationClaimBinding(args.existing, args.requested);
  if (args.existing.status === "created") {
    if (!args.existing.ytChannelId || !YOUTUBE_CHANNEL_ID.test(args.existing.ytChannelId)) {
      throw new Error("YouTube creation receipt is missing its exact channel id");
    }
    return "reuse";
  }
  if (args.existing.status === "pre_provider_failed") return "new_intent_required";
  if (args.existing.status === "ambiguous") return "recover";
  if (
    args.existing.status === "provider_started" ||
    args.existing.status === "recovery"
  ) {
    return decideYoutubeCreationRecoveryAdmission({
      existing: args.existing,
      workerId: args.workerId,
      now: args.now,
    });
  }
  if (
    args.existing.workerId === args.workerId ||
    args.existing.claimExpiresAt <= args.now
  ) {
    return "create";
  }
  return "wait";
}

/**
 * Atomic recovery ownership policy shared by the preflight decision and the
 * Convex takeover mutation. A second Trigger run may observe provider_started
 * while the original browser is still creating the channel; it must not steal
 * that live lease and invalidate the original worker's completion receipt.
 */
export function decideYoutubeCreationRecoveryAdmission(args: {
  existing: Pick<
    YoutubeCreationClaimSnapshot,
    "status" | "workerId" | "claimExpiresAt"
  >;
  workerId: string;
  now: number;
}): YoutubeCreationRecoveryAdmission {
  if (!clean(args.workerId)) throw new Error("YouTube recovery workerId is required");
  if (!Number.isFinite(args.now)) throw new Error("YouTube recovery time is invalid");
  if (args.existing.status === "created") return "reuse";
  if (args.existing.status === "claimed" || args.existing.status === "pre_provider_failed") {
    throw new Error("YouTube creation recovery cannot precede provider start");
  }
  if (
    (args.existing.status === "provider_started" || args.existing.status === "recovery") &&
    args.existing.workerId !== args.workerId &&
    args.existing.claimExpiresAt > args.now
  ) {
    return "wait";
  }
  return "recover";
}

export function assertYoutubeChannelId(value: string): void {
  if (!YOUTUBE_CHANNEL_ID.test(value)) {
    throw new Error("YouTube creation result has an invalid channel id");
  }
}

/**
 * A channel-level provider binding is authoritative. Only the durable created
 * receipt that projected that same UC id may be replayed; pre-provider history
 * never permits a second creation intent.
 */
export function assertExistingYoutubeProviderBinding(args: {
  projectedYtChannelId?: string;
  existingClaim?: Pick<YoutubeCreationClaimSnapshot, "status" | "ytChannelId"> | null;
}): void {
  if (!args.projectedYtChannelId) return;
  if (
    args.existingClaim?.status !== "created" ||
    args.existingClaim.ytChannelId !== args.projectedYtChannelId
  ) {
    throw new Error(
      "YouTube creation channel already has a provider binding without this exact durable receipt",
    );
  }
}

export function assertYoutubeCreationCompletionOwner(args: {
  claim: Pick<
    YoutubeCreationClaimSnapshot,
    "status" | "workerId" | "providerAttemptId"
  >;
  workerId: string;
}): void {
  if (!args.workerId.trim()) throw new Error("YouTube creation completion worker is required");
  if (args.claim.status === "provider_started") {
    if (
      args.claim.workerId !== args.workerId ||
      args.claim.providerAttemptId !== args.workerId
    ) {
      throw new Error("YouTube creation completion does not own the exact provider attempt");
    }
    return;
  }
  if (args.claim.status === "ambiguous" || args.claim.status === "recovery") {
    if (args.claim.workerId !== args.workerId) {
      throw new Error("YouTube creation completion does not own the active recovery claim");
    }
    return;
  }
  throw new Error("YouTube creation completion has no active provider or recovery claim");
}

export function assertYoutubeCreationApprovalReceiptShape(
  value: unknown,
  expected: {
    ownerId: string;
    subject: string;
    actor: string;
    evidence: string;
    issuedAt: number;
    expiresAt: number;
  },
): void {
  if (!value || typeof value !== "object") {
    throw new Error("YouTube creation signed approval receipt is required");
  }
  const receipt = value as Record<string, unknown>;
  if (
    receipt.version !== "studio-action-approval/v1" ||
    receipt.action !== "youtube-channel-create" ||
    receipt.ownerId !== expected.ownerId ||
    receipt.subject !== expected.subject ||
    receipt.actor !== expected.actor ||
    receipt.evidence !== expected.evidence ||
    receipt.issuedAt !== expected.issuedAt ||
    receipt.expiresAt !== expected.expiresAt ||
    typeof receipt.signature !== "string" ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(receipt.signature)
  ) {
    throw new Error("YouTube creation approval receipt shape or binding is invalid");
  }
}

export interface YoutubeProviderIdentityObservation {
  name?: string;
  handle?: string;
  channelId?: string;
  studioChannelId?: string;
}

export function assessExactYoutubeProviderIdentity(args: {
  expectedName: string;
  expectedHandle: string;
  observed: YoutubeProviderIdentityObservation;
}): { exact: boolean; reason?: string } {
  const observedName = args.observed.name
    ? normalizeYoutubeChannelName(args.observed.name)
    : undefined;
  const observedHandle = normalizeYoutubeHandle(args.observed.handle ?? "").toLowerCase();
  if (
    observedName !== normalizeYoutubeChannelName(args.expectedName) ||
    observedHandle !== normalizeYoutubeHandle(args.expectedHandle).toLowerCase() ||
    !args.observed.channelId
  ) {
    return {
      exact: false,
      reason: "provider metadata did not prove the exact display name, handle, and channel id",
    };
  }
  try {
    assertYoutubeChannelId(args.observed.channelId);
  } catch {
    return { exact: false, reason: "provider metadata returned an invalid channel id" };
  }
  if (args.observed.studioChannelId !== args.observed.channelId) {
    return {
      exact: false,
      reason: "active Studio channel did not match the exact public provider identity",
    };
  }
  return { exact: true };
}
