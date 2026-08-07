export type StudioAction =
  | "channel-inception-execute"
  | "channel-inception-probe"
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
