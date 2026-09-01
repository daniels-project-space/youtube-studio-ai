import { api } from "../../convex/_generated/api";

import type {
  StudioReusableMediaClaimRequest,
  StudioReusableMediaEntry,
  StudioReusableMediaInventoryItem,
  StudioReusableMediaPlan,
  StudioReusableMediaUsageReceipt,
} from "@/engine/studioReusableMedia";

type QueryClient = { query(reference: unknown, args: unknown): Promise<unknown> };
type MutationClient = { mutation(reference: unknown, args: unknown): Promise<unknown> };

// Narrow bridge until the canonical Convex deployment regenerates the checked
// API surface. These calls are service-authenticated; no browser can claim an
// episode ordinal, inject media bytes, or forge post-release usage.
const reusableMediaApi = (api as unknown as {
  readonly studioReusableMedia: {
    readonly listInventory: never;
    readonly claimEpisodeAndResolve: never;
    readonly recordEntry: never;
    readonly recordUsage: never;
  };
}).studioReusableMedia;

export async function listStudioReusableMediaInventory(input: {
  readonly client: QueryClient;
  readonly ownerId: string;
}): Promise<readonly StudioReusableMediaInventoryItem[]> {
  return await input.client.query(reusableMediaApi.listInventory, {
    ownerId: input.ownerId,
  } as never) as readonly StudioReusableMediaInventoryItem[];
}

export async function claimStudioReusableMediaForRun(input: {
  readonly client: MutationClient;
  readonly request: StudioReusableMediaClaimRequest;
}): Promise<StudioReusableMediaPlan> {
  return await input.client.mutation(reusableMediaApi.claimEpisodeAndResolve, {
    ownerId: input.request.ownerId,
    channelId: input.request.channelId,
    runId: input.request.runId,
    request: input.request,
  } as never) as StudioReusableMediaPlan;
}

export async function recordStudioReusableMediaEntry(input: {
  readonly client: MutationClient;
  readonly ownerId: string;
  readonly entry: StudioReusableMediaEntry;
}): Promise<void> {
  await input.client.mutation(reusableMediaApi.recordEntry, {
    ownerId: input.ownerId,
    entry: input.entry,
  } as never);
}

export async function recordStudioReusableMediaUsage(input: {
  readonly client: MutationClient;
  readonly ownerId: string;
  readonly channelId: string;
  readonly runId: string;
  readonly usage: StudioReusableMediaUsageReceipt;
}): Promise<void> {
  await input.client.mutation(reusableMediaApi.recordUsage, {
    ownerId: input.ownerId,
    channelId: input.channelId,
    runId: input.runId,
    usage: input.usage,
  } as never);
}
