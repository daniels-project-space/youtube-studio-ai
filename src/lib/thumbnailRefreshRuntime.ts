import { api } from "../../convex/_generated/api";

type QueryClient = {
  query(reference: unknown, args: unknown): Promise<unknown>;
};

export type ThumbnailRefreshInventoryItem = Readonly<{
  runId: string;
  channelId: string;
  channelName: string;
  channelSlug: string;
  title: string;
  createdAt: number;
  status: string;
  youtubeVideoId?: string;
  thumbnailKey?: string | null;
  thumbnailEvidenceStatus:
    | "current_golden_candidate"
    | "legacy_unverified"
    | "evidence_invalid"
    | "missing_thumbnail";
  refreshAction: "no_refresh_action" | "owner_review_required";
  evidenceReason: string;
  releaseEvidenceStatus: string;
  thumbnailReplayStatus:
    | "ready_for_thumbnail_only"
    | "ready_for_private_successor"
    | "private_successor_unavailable";
  thumbnailReplayReason: string;
  legacyCleanupAction: "keep" | "retire";
  legacyCleanupReason: string;
  legacyCleanupExplanation: string;
  retirementId?: string;
  retirementStatus?: "awaiting_approval" | "pending" | "queued" | "deleted" | "blocked";
  retirementError?: string;
  retirementReceiptFingerprint?: string;
  candidateRunId?: string;
  candidateStatus?: string;
  candidateDispatchState?: string;
  candidateDispatchLastError?: string;
  /** Terminal candidate run error, e.g. a missing provider, kept separate from outbox delivery errors. */
  candidateError?: string;
  candidateCostTotal?: number;
  candidateThumbnailKey?: string | null;
  replacementId?: string;
  replacementStatus?: "awaiting_approval" | "pending" | "queued" | "applied" | "blocked";
  replacementError?: string;
  replacementReceiptFingerprint?: string;
  replacementAppliedAt?: number;
}>;

// This is deliberately a narrow bridge until an authorized Convex codegen
// refresh adds the read-only inventory to the generated API surface.
const thumbnailRefreshApi = (api as unknown as {
  readonly thumbnailRefresh: {
    readonly listInventory: never;
    readonly createCandidateShell: never;
    readonly importErnieBatchCandidate: never;
    readonly claimCandidateApproval: never;
    readonly getCandidateDispatch: never;
    readonly listAutomaticReplacementCandidates: never;
    readonly markCandidateDispatchQueued: never;
    readonly recordCandidateDispatchFailure: never;
  };
}).thumbnailRefresh;

export const thumbnailRefreshRuntimeApi = thumbnailRefreshApi;

/**
 * Server-only owner inventory for evaluating older thumbnails. It is neither a
 * candidate generator nor an update command. Completed production-QA
 * candidates are presented by the Library and handed to the bound YouTube
 * replacement policy without a second browser confirmation.
 */
export async function listThumbnailRefreshInventory(input: {
  readonly client: QueryClient;
  readonly ownerId: string;
  readonly limit?: number;
}): Promise<readonly ThumbnailRefreshInventoryItem[]> {
  return await input.client.query(thumbnailRefreshApi.listInventory, {
    ownerId: input.ownerId,
    limit: input.limit ?? 200,
  } as never) as readonly ThumbnailRefreshInventoryItem[];
}
