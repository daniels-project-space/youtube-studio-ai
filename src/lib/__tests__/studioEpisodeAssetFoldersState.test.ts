import assert from "node:assert/strict";

import {
  create,
  ensureEpisodeAssetFolderAssignment,
  listForOwner,
  move,
  remove,
  rename,
} from "../../../convex/studioEpisodeAssetFolders";

type Stored = Record<string, unknown> & { readonly _id: string };
const OWNER = "owner-episode-folders";
const OTHER_OWNER = "owner-other";
const CHANNEL = "channel-folders";
const OTHER_CHANNEL = "channel-other";
const ASSET = "a".repeat(64);

function identity(role: "owner" | "service", ownerId = OWNER) {
  return {
    subject: role === "owner" ? ownerId : `service:${ownerId}`,
    issuer: "https://youtube-studio-ai.local",
    tokenIdentifier: `test|${role}|${ownerId}`,
    role,
    owner_id: ownerId,
  };
}

function createMemoryState() {
  const tables = new Map<string, Stored[]>();
  const documents = new Map<string, Stored>([
    [CHANNEL, { _id: CHANNEL, ownerId: OWNER }],
    [OTHER_CHANNEL, { _id: OTHER_CHANNEL, ownerId: OTHER_OWNER }],
  ]);
  let next = 0;
  const rows = (table: string) => {
    const existing = tables.get(table);
    if (existing) return existing;
    const created: Stored[] = [];
    tables.set(table, created);
    return created;
  };
  const db = {
    get: async (id: string) => documents.get(String(id)) ?? [...tables.values()].flat().find((row) => row._id === String(id)) ?? null,
    normalizeId: (_table: string, value: string) => value,
    query: (table: string) => ({
      withIndex: (_index: string, select: (query: { eq: (field: string, value: unknown) => unknown }) => unknown) => {
        const predicates: Array<readonly [string, unknown]> = [];
        const query = {
          eq(field: string, value: unknown) {
            predicates.push([field, value]);
            return query;
          },
        };
        select(query);
        const matches = () => rows(table).filter((row) => predicates.every(([field, value]) => row[field] === value));
        return {
          unique: async () => {
            const found = matches();
            if (found.length > 1) throw new Error("test database unique index collision");
            return found[0] ?? null;
          },
          collect: async () => matches(),
        };
      },
    }),
    insert: async (table: string, value: Record<string, unknown>) => {
      const id = `${table}:${++next}`;
      rows(table).push({ ...value, _id: id });
      return id;
    },
    patch: async (id: string, value: Record<string, unknown>) => {
      const row = [...tables.values()].flat().find((candidate) => candidate._id === String(id));
      if (!row) throw new Error("missing row");
      Object.assign(row, value);
    },
    delete: async (id: string) => {
      for (const table of tables.values()) {
        const index = table.findIndex((row) => row._id === String(id));
        if (index >= 0) {
          table.splice(index, 1);
          return;
        }
      }
    },
  };
  return {
    rows,
    context(role: "owner" | "service", ownerId = OWNER) {
      return { auth: { getUserIdentity: async () => identity(role, ownerId) }, db };
    },
  };
}

async function invoke<T>(definition: unknown, context: unknown, args: unknown): Promise<T> {
  return await (definition as { _handler: (handlerContext: unknown, handlerArgs: unknown) => Promise<T> })._handler(context, args);
}

async function main() {
  const state = createMemoryState();
  const owner = state.context("owner");
  const service = state.context("service");

  await assert.rejects(
    () => invoke(create, owner, { ownerId: OWNER, channelId: CHANNEL, name: "History" }),
    /requires the bound studio service identity/i,
  );
  const firstId = await invoke<string>(create, service, { ownerId: OWNER, channelId: CHANNEL, name: "History" });
  await assert.rejects(
    () => invoke(create, service, { ownerId: OWNER, channelId: CHANNEL, name: "history" }),
    /already exists/i,
  );
  const secondId = await invoke<string>(create, service, { ownerId: OWNER, channelId: CHANNEL, name: "Sound beds" });
  const folderContext = { db: state.context("service").db } as unknown as Parameters<typeof ensureEpisodeAssetFolderAssignment>[0];
  const autoId = await ensureEpisodeAssetFolderAssignment(folderContext, {
    ownerId: OWNER,
    channelId: CHANNEL,
    assetFingerprint: ASSET,
  });
  assert.notEqual(autoId, firstId, "future automation uses its own default folder, not an arbitrary operator folder");
  assert.equal(await ensureEpisodeAssetFolderAssignment(folderContext, {
    ownerId: OWNER,
    channelId: CHANNEL,
    assetFingerprint: ASSET,
  }), autoId, "default assignment is idempotent");

  const listed = await invoke<{ folders: Array<{ _id: string; name: string }>; assignments: Array<{ folderId: string }> }>(listForOwner, service, { ownerId: OWNER });
  assert.equal(listed.folders.length, 3);
  assert.equal(listed.assignments.length, 1);

  await assert.rejects(
    () => invoke(move, service, { ownerId: OWNER, channelId: CHANNEL, assetFingerprint: ASSET, folderId: secondId }),
    /episode asset is not owned by this channel/i,
    "a folder cannot move an asset that is not present in the persisted media table",
  );
  state.rows("studioReusableMediaAssets").push({
    _id: "media:1",
    ownerId: OWNER,
    channelId: CHANNEL,
    fingerprint: ASSET,
  });
  const moved = await invoke<{ folderId: string }>(move, service, { ownerId: OWNER, channelId: CHANNEL, assetFingerprint: ASSET, folderId: secondId });
  assert.equal(moved.folderId, secondId);
  assert.equal((await invoke<{ assignments: Array<{ folderId: string }> }>(listForOwner, service, { ownerId: OWNER })).assignments[0]?.folderId, secondId);

  const renamed = await invoke<{ name: string }>(rename, service, { ownerId: OWNER, folderId: secondId, name: "Audio beds" });
  assert.equal(renamed.name, "Audio beds");
  const unfiled = await invoke<{ folderId: null }>(move, service, { ownerId: OWNER, channelId: CHANNEL, assetFingerprint: ASSET });
  assert.equal(unfiled.folderId, null);
  assert.equal((await invoke<{ assignments: unknown[] }>(listForOwner, service, { ownerId: OWNER })).assignments.length, 0);

  const removed = await invoke<{ removedAssignments: number }>(remove, service, { ownerId: OWNER, folderId: secondId });
  assert.equal(removed.removedAssignments, 0);
  await assert.rejects(
    () => invoke(create, state.context("service", OTHER_OWNER), { ownerId: OTHER_OWNER, channelId: CHANNEL, name: "Private" }),
    /access denied|not owned/i,
  );
  assert.equal(state.rows("studioEpisodeAssetFolders").some((row) => row._id === firstId), true);
  console.log("STUDIO EPISODE ASSET FOLDER STATE TESTS PASS");
}

void main();
