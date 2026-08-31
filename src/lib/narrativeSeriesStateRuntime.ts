import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * Narrow no-codegen bridge for the newly added Convex module. Keeping the cast
 * here prevents callers from treating Trigger input as trusted contract data;
 * every consumer still reloads the owner-scoped immutable row server-side.
 */
export const narrativeSeriesStateApi = (api as unknown as {
  readonly narrativeSeriesState: {
    readonly getSeriesPlan: never;
    readonly getAcceptedCharacterLoRA: never;
    readonly listAcceptedCharacterLoRAsForOwner: never;
    readonly recordSeriesPlan: never;
    readonly recordEpisodeReceipt: never;
  };
}).narrativeSeriesState;

type QueryMutationClient = {
  query(reference: never, args: never): Promise<unknown>;
  mutation(reference: never, args: never): Promise<unknown>;
};

export interface NarrativeSeriesPlanRecord {
  readonly _id: unknown;
  readonly ownerId: unknown;
  readonly channelId: unknown;
  readonly fingerprint: unknown;
  readonly plan: unknown;
}

export interface AcceptedCharacterLoRARecord {
  readonly _id: unknown;
  readonly ownerId: unknown;
  readonly channelId: unknown;
  readonly entry: unknown;
}

/** Deliberately browser-safe inventory shape; no adapter path or bytes. */
export interface AcceptedCharacterLoRAInventoryItem {
  readonly registryIdentity: string;
  readonly characterId: string;
  readonly characterSpecFingerprint: string;
  readonly datasetFingerprint: string;
  readonly provider: string;
  readonly adapterFlavor: string;
  readonly runtimeProfileFingerprint: string;
  readonly acceptedAt: number;
}

export async function getNarrativeSeriesPlanRecord(input: {
  readonly client: QueryMutationClient;
  readonly ownerId: string;
  readonly channelId: Id<"channels">;
  readonly fingerprint: string;
}): Promise<NarrativeSeriesPlanRecord | null> {
  return await input.client.query(narrativeSeriesStateApi.getSeriesPlan, {
    ownerId: input.ownerId,
    channelId: input.channelId,
    fingerprint: input.fingerprint,
  } as never) as NarrativeSeriesPlanRecord | null;
}

/**
 * Trigger-only persistence bridge for an already-validated immutable horizon.
 * The Convex mutation repeats owner/channel/contract validation; callers never
 * get a way to write arbitrary browser-supplied state through this helper.
 */
export async function recordNarrativeSeriesPlan(input: {
  readonly client: QueryMutationClient;
  readonly ownerId: string;
  readonly channelId: Id<"channels">;
  readonly plan: unknown;
}): Promise<void> {
  await input.client.mutation(narrativeSeriesStateApi.recordSeriesPlan, {
    ownerId: input.ownerId,
    channelId: input.channelId,
    plan: input.plan,
  } as never);
}

export async function getAcceptedCharacterLoRARecord(input: {
  readonly client: QueryMutationClient;
  readonly ownerId: string;
  readonly channelId: Id<"channels">;
  readonly characterId: string;
  readonly characterSpecFingerprint: string;
}): Promise<AcceptedCharacterLoRARecord | null> {
  return await input.client.query(narrativeSeriesStateApi.getAcceptedCharacterLoRA, {
    ownerId: input.ownerId,
    channelId: input.channelId,
    characterId: input.characterId,
    characterSpecFingerprint: input.characterSpecFingerprint,
  } as never) as AcceptedCharacterLoRARecord | null;
}

/** Server-only companion to the Studio Assets inventory. */
export async function listAcceptedCharacterLoRAInventory(input: {
  readonly client: QueryMutationClient;
  readonly ownerId: string;
}): Promise<readonly AcceptedCharacterLoRAInventoryItem[]> {
  return await input.client.query(narrativeSeriesStateApi.listAcceptedCharacterLoRAsForOwner, {
    ownerId: input.ownerId,
  } as never) as readonly AcceptedCharacterLoRAInventoryItem[];
}

export async function recordNarrativeEpisodeReceipt(input: {
  readonly client: QueryMutationClient;
  readonly ownerId: string;
  readonly channelId: Id<"channels">;
  readonly runId: Id<"runs">;
  readonly seriesPlanFingerprint: string;
  readonly episodeBinding: unknown;
  readonly shotControl: unknown;
}): Promise<void> {
  await input.client.mutation(narrativeSeriesStateApi.recordEpisodeReceipt, {
    ownerId: input.ownerId,
    channelId: input.channelId,
    runId: input.runId,
    seriesPlanFingerprint: input.seriesPlanFingerprint,
    episodeBinding: input.episodeBinding,
    shotControl: input.shotControl,
  } as never);
}
