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
 * deliberately scoped to immutable, QA-passed thumbnail promotion: a reviewed
 * batch may enter the candidate ledger and a completed candidate may move to
 * its already-bound YouTube video without a repeated OAuth/session ceremony.
 * Paid generation, deletion and every unrelated action still require an
 * authenticated operator.
 */
export const AUTOMATIC_THUMBNAIL_POLICY_ACTOR_PREFIX =
  "owner-policy:thumbnail-auto-apply:" as const;

export function studioActionActorIsAllowed(
  action: StudioAction,
  actor: string,
): boolean {
  return actor.startsWith("authenticated-operator:") || (
    [
      "thumbnail-ernie-batch-apply",
      "thumbnail-ernie-batch-import",
      "youtube-thumbnail-replacement",
    ].includes(action) &&
    actor.startsWith(AUTOMATIC_THUMBNAIL_POLICY_ACTOR_PREFIX) &&
    actor.length > AUTOMATIC_THUMBNAIL_POLICY_ACTOR_PREFIX.length
  );
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
