import { api } from "../../convex/_generated/api";

type QueryClient = { query(reference: unknown, args: unknown): Promise<unknown> };
type MutationClient = { mutation(reference: unknown, args: unknown): Promise<unknown> };

/** Browser-safe folder projections. Folder IDs are opaque Convex IDs; media
 * provenance and R2 locations remain outside this contract. */
export type StudioEpisodeAssetFolder = {
  readonly _id: string;
  readonly channelId: string;
  readonly name: string;
  readonly createdAt: number;
};

export type StudioEpisodeAssetFolderAssignment = {
  readonly _id: string;
  readonly channelId: string;
  readonly folderId: string;
  readonly assetFingerprint: string;
  readonly updatedAt: number;
};

export type StudioEpisodeAssetFolderInventory = {
  readonly folders: readonly StudioEpisodeAssetFolder[];
  readonly assignments: readonly StudioEpisodeAssetFolderAssignment[];
};

export type StudioChannelFolderOption = { readonly _id: string; readonly name: string; readonly slug: string };

const foldersApi = (api as unknown as {
  readonly studioEpisodeAssetFolders: {
    readonly listForOwner: never;
    readonly create: never;
    readonly rename: never;
    readonly remove: never;
    readonly move: never;
  };
}).studioEpisodeAssetFolders;

const channelsApi = (api as unknown as {
  readonly channels: { readonly listChannels: never };
}).channels;

export async function listStudioChannelFolderOptions(input: {
  readonly client: QueryClient;
  readonly ownerId: string;
}): Promise<readonly StudioChannelFolderOption[]> {
  const rows = await input.client.query(channelsApi.listChannels, { ownerId: input.ownerId }) as readonly Record<string, unknown>[];
  return rows.map((row) => ({
    _id: String(row._id),
    name: String(row.name ?? "Unnamed channel"),
    slug: String(row.slug ?? row._id),
  }));
}

export async function listStudioEpisodeAssetFolders(input: {
  readonly client: QueryClient;
  readonly ownerId: string;
}): Promise<StudioEpisodeAssetFolderInventory> {
  return await input.client.query(foldersApi.listForOwner, { ownerId: input.ownerId }) as StudioEpisodeAssetFolderInventory;
}

export async function createStudioEpisodeAssetFolder(input: {
  readonly client: MutationClient;
  readonly ownerId: string;
  readonly channelId: string;
  readonly name: string;
}): Promise<string> {
  return await input.client.mutation(foldersApi.create, {
    ownerId: input.ownerId,
    channelId: input.channelId,
    name: input.name,
  } as never) as string;
}

export async function renameStudioEpisodeAssetFolder(input: {
  readonly client: MutationClient;
  readonly ownerId: string;
  readonly folderId: string;
  readonly name: string;
}): Promise<{ folderId: string; name: string }> {
  return await input.client.mutation(foldersApi.rename, {
    ownerId: input.ownerId,
    folderId: input.folderId,
    name: input.name,
  } as never) as { folderId: string; name: string };
}

export async function removeStudioEpisodeAssetFolder(input: {
  readonly client: MutationClient;
  readonly ownerId: string;
  readonly folderId: string;
}): Promise<{ removedAssignments: number }> {
  return await input.client.mutation(foldersApi.remove, {
    ownerId: input.ownerId,
    folderId: input.folderId,
  } as never) as { removedAssignments: number };
}

export async function moveStudioEpisodeAsset(input: {
  readonly client: MutationClient;
  readonly ownerId: string;
  readonly channelId: string;
  readonly assetFingerprint: string;
  readonly folderId?: string;
}): Promise<{ folderId: string | null }> {
  return await input.client.mutation(foldersApi.move, {
    ownerId: input.ownerId,
    channelId: input.channelId,
    assetFingerprint: input.assetFingerprint,
    ...(input.folderId ? { folderId: input.folderId } : {}),
  } as never) as { folderId: string | null };
}
