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
  | "youtube-thumbnail-replacement"
  | "youtube-video-retire"
  | "youtube-channel-create"
  | "channel-publish";

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
