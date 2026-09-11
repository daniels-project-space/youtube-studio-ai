export type StudioAction =
  | "channel-inception-execute"
  | "channel-inception-probe"
  /** Owner intent recorded before the dispatcher derives a sealed private benchmark. */
  | "route-qualification-benchmark-request"
  /** Full private master/QA run that may earn a route-release receipt, never upload. */
  | "route-qualification-benchmark"
  | "thumbnail-refresh-candidate"
  /** Batch-imported, QA-passed ERNIE thumbnail candidate; source/YouTube remain untouched. */
  | "thumbnail-ernie-batch-import"
  /** One owner-confirmed, SHA-pinned ERNIE batch; every video still gets its own durable replacement plan. */
  | "thumbnail-ernie-batch-apply"
  | "youtube-thumbnail-replacement"
  | "youtube-video-retire"
  | "youtube-channel-create"
  | "channel-publish";

/**
 * The single non-interactive approval actor admitted by the Studio. It is
 * deliberately scoped to the thumbnail lane: a Library request may allocate
 * one separately bound, cost-capped candidate, a reviewed batch may enter the
 * candidate ledger, and a completed candidate may move to its already-bound
 * YouTube video without a repeated OAuth/session ceremony. Source, byte,
 * channel, connector and QA checks remain independent of this actor. Paid
 * deletion and every unrelated action still require an authenticated operator.
 */
export const AUTOMATIC_THUMBNAIL_POLICY_ACTOR_PREFIX =
  "owner-policy:thumbnail-auto-apply:" as const;

export function studioActionActorIsAllowed(
  action: StudioAction,
  actor: string,
): boolean {
  return actor.startsWith("authenticated-operator:") || (
    [
      "thumbnail-refresh-candidate",
      "thumbnail-ernie-batch-apply",
      "thumbnail-ernie-batch-import",
      "youtube-thumbnail-replacement",
    ].includes(action) &&
    actor.startsWith(AUTOMATIC_THUMBNAIL_POLICY_ACTOR_PREFIX) &&
    actor.length > AUTOMATIC_THUMBNAIL_POLICY_ACTOR_PREFIX.length
  );
}

/**
 * Validate the declarative automatic-thumbnail policy claim at a service-only
 * database boundary. This is intentionally not a substitute for a human HMAC
 * approval: callers must already hold Studio service identity, and the target
 * mutation must independently validate immutable artifact/source bindings.
 */
export function automaticThumbnailPolicyClaimIsValid(
  value: unknown,
  expected: {
    action: Extract<StudioAction,
      "thumbnail-ernie-batch-apply" |
      "thumbnail-ernie-batch-import" |
      "youtube-thumbnail-replacement">;
    ownerId: string;
    subject: string;
    now: number;
    maximumCostUsd?: number;
  },
): value is StudioActionApprovalReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Partial<StudioActionApprovalReceipt>;
  return receipt.version === "studio-action-approval/v1" &&
    receipt.action === expected.action &&
    receipt.ownerId === expected.ownerId &&
    receipt.subject === expected.subject &&
    receipt.actor === `${AUTOMATIC_THUMBNAIL_POLICY_ACTOR_PREFIX}${expected.ownerId}` &&
    typeof receipt.evidence === "string" && Boolean(receipt.evidence.trim()) &&
    typeof receipt.issuedAt === "number" && Number.isFinite(receipt.issuedAt) &&
    receipt.issuedAt <= expected.now + STUDIO_ACTION_APPROVAL_MAX_CLOCK_SKEW_MS &&
    typeof receipt.expiresAt === "number" && Number.isFinite(receipt.expiresAt) &&
    receipt.expiresAt >= expected.now &&
    receipt.expiresAt >= receipt.issuedAt &&
    receipt.expiresAt - receipt.issuedAt <= STUDIO_ACTION_APPROVAL_MAX_TTL_MS &&
    (expected.maximumCostUsd === undefined || (
      typeof receipt.maxCostUsd === "number" &&
      Number.isFinite(receipt.maxCostUsd) &&
      receipt.maxCostUsd > 0 &&
      receipt.maxCostUsd <= expected.maximumCostUsd
    )) &&
    typeof receipt.signature === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(receipt.signature);
}

export interface StudioActionApprovalReceipt {
  version: "studio-action-approval/v1";
  action: StudioAction;
  ownerId: string;
  subject: string;
  actor: string;
  evidence: string;
  issuedAt: number;
  expiresAt: number;
  maxCostUsd?: number;
  signature: string;
}
import {
  STUDIO_ACTION_APPROVAL_MAX_CLOCK_SKEW_MS,
  STUDIO_ACTION_APPROVAL_MAX_TTL_MS,
} from "@/lib/studioActionApprovalCanonical";
