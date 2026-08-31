import { api } from "../../convex/_generated/api";

import type {
  StudioAssetInventoryItem,
  StudioAssetResolution,
  StudioAssetResolveRequest,
} from "@/engine/studioAssetLibrary";
import type {
  StudioAssetPromotionCandidate,
  StudioAssetPromotionCandidateInventoryItem,
} from "@/engine/studioAssetPromotion";

type QueryClient = {
  query(reference: unknown, args: unknown): Promise<unknown>;
};

type MutationClient = {
  mutation(reference: unknown, args: unknown): Promise<unknown>;
};

// Kept narrow until authorized Convex code generation updates the generated
// surface. This is the only intentional bridge to the new service resolver.
const studioAssetLibraryApi = (api as unknown as {
  readonly studioAssetLibrary: {
    readonly resolveForPipeline: never;
    readonly listInventory: never;
    readonly resolveApprovedImagePreview: never;
    readonly listReleaseFeedback: never;
    readonly recordReleaseUsage: never;
  };
}).studioAssetLibrary;

// Deliberately narrow until a separately authorized Convex codegen run. These
// calls remain server/Trigger-only through StudioConvexHttpClient.
const studioAssetPromotionsApi = (api as unknown as {
  readonly studioAssetPromotions: {
    readonly recordCandidate: never;
    readonly listPendingForOwner: never;
    readonly getForOwnerApproval: never;
    readonly approveCandidate: never;
  };
}).studioAssetPromotions;

/**
 * Pipeline-facing access tool. Call this before inventing/re-rendering a
 * recipe, adapter, guide, transition, or motion treatment. A no-match is not
 * an error: it is the explicit signal to create a new candidate under the
 * normal evidence and approval flow.
 */
export async function resolveStudioAssetsForPipeline(input: {
  readonly client: QueryClient;
  readonly request: StudioAssetResolveRequest;
}): Promise<StudioAssetResolution> {
  return await input.client.query(studioAssetLibraryApi.resolveForPipeline, {
    ownerId: input.request.ownerId,
    request: input.request,
  } as never) as StudioAssetResolution;
}

/** Server-side owner inventory used by the Studio UI. This is a safe metadata
 * projection; it never returns R2 locations, signed URLs, or model bytes. */
export async function listStudioAssetLibraryInventory(input: {
  readonly client: QueryClient;
  readonly ownerId: string;
}): Promise<readonly StudioAssetInventoryItem[]> {
  return await input.client.query(studioAssetLibraryApi.listInventory, {
    ownerId: input.ownerId,
  } as never) as readonly StudioAssetInventoryItem[];
}

/**
 * Resolve one approved image only inside an authenticated server route. The
 * caller must turn this short-lived internal result into a preview URL; no
 * R2 key is part of the normal browser inventory projection.
 */
export async function resolveStudioAssetApprovedImagePreview(input: {
  readonly client: QueryClient;
  readonly ownerId: string;
  readonly assetEntryFingerprint: string;
}): Promise<{
  readonly r2Key: string;
  readonly contentType: string;
  readonly contentSha256: string;
} | null> {
  return await input.client.query(studioAssetLibraryApi.resolveApprovedImagePreview, {
    ownerId: input.ownerId,
    assetEntryFingerprint: input.assetEntryFingerprint,
  } as never) as {
    readonly r2Key: string;
    readonly contentType: string;
    readonly contentSha256: string;
  } | null;
}

export type StudioAssetReleaseFeedback = {
  readonly assetEntryFingerprint: string;
  readonly sealedFinalMasters: number;
  readonly measuredVisualFinalMasters: number;
  readonly meanVisualScore: number | null;
  readonly demonstratedForEqualApprovalTieBreak: boolean;
  readonly latestObservedAt: number;
};

/** Browser-safe operator summary of immutable post-release evidence. It is
 * deliberately not a quality-approval or model-selection mutation. */
export async function listStudioAssetReleaseFeedback(input: {
  readonly client: QueryClient;
  readonly ownerId: string;
}): Promise<readonly StudioAssetReleaseFeedback[]> {
  return await input.client.query(studioAssetLibraryApi.listReleaseFeedback, {
    ownerId: input.ownerId,
  } as never) as readonly StudioAssetReleaseFeedback[];
}

/** Write a compact, certificate-bound quality observation after QA has already
 * durably reloaded its final-master evidence. This does not affect the current
 * release outcome; failed persistence can be backfilled from the certificate. */
export async function recordStudioAssetReleaseUsage(input: {
  readonly client: MutationClient;
  readonly ownerId: string;
  readonly channelId: string;
  readonly runId: string;
  readonly certificateFingerprint: string;
  readonly usage: unknown;
}): Promise<void> {
  await input.client.mutation(studioAssetLibraryApi.recordReleaseUsage, {
    ownerId: input.ownerId,
    channelId: input.channelId,
    runId: input.runId,
    certificateFingerprint: input.certificateFingerprint,
    usage: input.usage,
  } as never);
}

/**
 * Candidate capture is learning-only: it cannot influence the completed run,
 * render, or upload. The stored candidate remains unresolved until the owner
 * explicitly approves it after certificate re-verification.
 */
export async function recordStudioAssetPromotionCandidates(input: {
  readonly client: MutationClient;
  readonly ownerId: string;
  readonly candidates: readonly StudioAssetPromotionCandidate[];
}): Promise<void> {
  for (const candidate of input.candidates) {
    await input.client.mutation(studioAssetPromotionsApi.recordCandidate, {
      ownerId: input.ownerId,
      candidate,
    } as never);
  }
}

/** Browser-safe pending approval queue; it intentionally excludes prompts and R2 evidence keys. */
export async function listStudioAssetPromotionCandidates(input: {
  readonly client: QueryClient;
  readonly ownerId: string;
}): Promise<readonly StudioAssetPromotionCandidateInventoryItem[]> {
  return await input.client.query(studioAssetPromotionsApi.listPendingForOwner, {
    ownerId: input.ownerId,
  } as never) as readonly StudioAssetPromotionCandidateInventoryItem[];
}

/** Server-only approval read; the enclosing route re-validates retained release evidence before mutation. */
export async function getStudioAssetPromotionCandidateForApproval(input: {
  readonly client: QueryClient;
  readonly ownerId: string;
  readonly candidateFingerprint: string;
}): Promise<StudioAssetPromotionCandidate | null> {
  return await input.client.query(studioAssetPromotionsApi.getForOwnerApproval, {
    ownerId: input.ownerId,
    candidateFingerprint: input.candidateFingerprint,
  } as never) as StudioAssetPromotionCandidate | null;
}

/** Persist an approval only after the caller has verified the candidate's final-master certificate. */
export async function approveStudioAssetPromotionCandidateForOwner(input: {
  readonly client: MutationClient;
  readonly ownerId: string;
  readonly candidateFingerprint: string;
  readonly approvedAt: number;
}): Promise<void> {
  await input.client.mutation(studioAssetPromotionsApi.approveCandidate, {
    ownerId: input.ownerId,
    candidateFingerprint: input.candidateFingerprint,
    approvedBy: input.ownerId,
    approvedAt: input.approvedAt,
  } as never);
}
