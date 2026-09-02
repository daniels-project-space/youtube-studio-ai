import assert from "node:assert/strict";

import { remove, rename } from "../../../convex/folders";

async function invoke<T>(definition: unknown, context: unknown, args: unknown): Promise<T> {
  return await (definition as {
    _handler: (handlerContext: unknown, handlerArgs: unknown) => Promise<T>;
  })._handler(context, args);
}

const folder = { _id: "channelFolders:history" as never, ownerId: "owner_daniel", name: "History" };
const lockedChannel = {
  _id: "channels:history" as never,
  ownerId: "owner_daniel",
  folder: "History",
  locked: true,
};

function folderContext() {
  const patches: Array<{ id: unknown; patch: Record<string, unknown> }> = [];
  const audits: Array<Record<string, unknown>> = [];
  const deleted: unknown[] = [];
  return {
    patches,
    audits,
    deleted,
    context: {
      auth: {
        getUserIdentity: async () => ({
          role: "owner",
          subject: "owner_daniel",
          owner_id: "owner_daniel",
        }),
      },
      db: {
        normalizeId: (_table: string, id: unknown) => id,
        get: async (id: unknown) => id === folder._id ? folder : lockedChannel,
        insert: async (_table: string, row: Record<string, unknown>) => {
          audits.push(row);
          return `audit:${audits.length}`;
        },
        patch: async (id: unknown, patch: Record<string, unknown>) => {
          patches.push({ id, patch });
        },
        delete: async (id: unknown) => {
          deleted.push(id);
        },
        query: (table: string) => {
          assert.equal(table, "channels");
          return {
            withIndex: () => ({ collect: async () => [lockedChannel] }),
          };
        },
      },
    },
  };
}

async function main() {
  const renameFixture = folderContext();
  const renameResult = await invoke<{ lockedSkipped: number }>(rename, renameFixture.context, {
    ownerId: "owner_daniel",
    folderId: folder._id,
    name: "Archive",
  });
  assert.deepEqual(renameResult, { lockedSkipped: 1 });
  assert.deepEqual(renameFixture.patches, [], "a room with a frozen member must not partially rename");
  assert.equal(renameFixture.audits[0]?.blockId, "__channel__");
  assert.equal(renameFixture.audits[0]?.event, "mutation_rejected");

  const removeFixture = folderContext();
  const removeResult = await invoke<{ lockedSkipped: number }>(remove, removeFixture.context, {
    ownerId: "owner_daniel",
    folderId: folder._id,
  });
  assert.deepEqual(removeResult, { lockedSkipped: 1 });
  assert.deepEqual(removeFixture.deleted, [], "a room with a frozen member must not be deleted");
  assert.equal(removeFixture.audits[0]?.operation, "folders.remove unfile channel");

  console.log("CHANNEL FOLDER LOCK TESTS PASS");
}

void main();
