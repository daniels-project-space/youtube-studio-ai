import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { PipelineEntry } from "@/engine/types";
import {
  channelModuleLockFor,
  channelModuleUnlockConfirmation,
  createChannelModuleLock,
  firstLockedModulePipelineChange,
  isChannelModuleLocked,
} from "@/lib/channelModuleLock";
import {
  lockModule,
  listModuleLockAudits,
  setModuleConfig,
  unlockModule,
  updateChannel,
  updatePipelineIfCurrent,
} from "../../../convex/channels";

const initialPipeline: PipelineEntry[] = [
  { block: "metadata", params: { tags: ["history"], titleCase: "sentence" } },
  { block: "thumbnail_gen", params: { pattern: "hero-left" } },
];

const metadataLock = createChannelModuleLock({
  blockId: "metadata",
  pipeline: initialPipeline,
  moduleConfig: { metadata: { preset: "search-first", titleLength: 54 } },
  lockedAt: 1_700_000_000_000,
  lockedBy: "owner_daniel",
});

assert.equal(metadataLock.version, "channel-module-lock/v1");
assert.equal(isChannelModuleLocked({ metadata: metadataLock }, "metadata"), true);
assert.equal(channelModuleLockFor({ metadata: metadataLock }, "metadata")?.lockedBy, "owner_daniel");
assert.equal(
  firstLockedModulePipelineChange({
    moduleLocks: { metadata: metadataLock },
    currentPipeline: initialPipeline,
    nextPipeline: [
      { block: "metadata", params: { titleCase: "sentence", tags: ["history"] } },
      { block: "thumbnail_gen", params: { pattern: "hero-center" } },
    ],
  }),
  null,
  "unrelated modules remain editable when a single module is locked",
);
assert.equal(
  firstLockedModulePipelineChange({
    moduleLocks: { metadata: metadataLock },
    currentPipeline: initialPipeline,
    nextPipeline: [
      { block: "metadata", params: { tags: ["history", "rome"], titleCase: "sentence" } },
      initialPipeline[1]!,
    ],
  }),
  "metadata",
  "a locked pipeline entry may neither change its params nor disappear",
);
assert.equal(
  isChannelModuleLocked({ metadata: { corrupt: true } }, "metadata"),
  true,
  "malformed stored metadata fails closed instead of becoming an implicit unlock",
);
assert.equal(channelModuleLockFor({ metadata: { corrupt: true } }, "metadata"), null);
assert.equal(channelModuleUnlockConfirmation("metadata"), "UNLOCK MODULE metadata");

async function invoke<T>(definition: unknown, context: unknown, args: unknown): Promise<T> {
  return await (definition as {
    _handler: (handlerContext: unknown, handlerArgs: unknown) => Promise<T>;
  })._handler(context, args);
}

async function main() {
const audits: Array<Record<string, unknown>> = [];
const lockedChannel = {
  _id: "channels:module-lock" as never,
  ownerId: "owner_daniel",
  pipeline: initialPipeline,
  moduleConfig: { metadata: { preset: "search-first" } },
  moduleLocks: { metadata: metadataLock },
};
const serviceContext = {
  auth: {
    getUserIdentity: async () => ({
      role: "service",
      subject: "trigger-thumbnail-worker",
      owner_id: "owner_daniel",
    }),
  },
  db: {
    normalizeId: () => "channels:module-lock",
    get: async () => lockedChannel,
    insert: async (_table: string, row: Record<string, unknown>) => {
      audits.push(row);
      return `audit:${audits.length}`;
    },
  },
};

const blockedConfig = await invoke<{ forked: boolean; state?: string; blockId?: string }>(
  setModuleConfig,
  serviceContext,
  { channelId: lockedChannel._id, blockId: "metadata", config: { preset: "search-first" } },
);
assert.deepEqual(blockedConfig, { forked: false, state: "module_locked", blockId: "metadata" });
assert.equal(audits.length, 1);
assert.equal(audits[0]?.event, "mutation_rejected");
assert.equal(audits[0]?.operation, "channels.setModuleConfig");

const blockedPipeline = await invoke<{ state: string; blockId?: string }>(
  updatePipelineIfCurrent,
  serviceContext,
  {
    ownerId: "owner_daniel",
    channelId: lockedChannel._id,
    expectedPipeline: initialPipeline,
    pipeline: [
      { block: "metadata", params: { tags: ["history", "rome"] } },
      initialPipeline[1]!,
    ],
  },
);
assert.deepEqual(blockedPipeline, { state: "module_locked", blockId: "metadata" });
assert.equal(audits.length, 2);
assert.equal(audits[1]?.operation, "channels.updatePipelineIfCurrent");

const blockedGenericPipeline = await invoke<{ forked: boolean; state?: string; blockId?: string }>(
  updateChannel,
  serviceContext,
  {
    channelId: lockedChannel._id,
    pipeline: [
      { block: "metadata", params: { tags: ["history", "rome"] } },
      initialPipeline[1]!,
    ],
  },
);
assert.deepEqual(blockedGenericPipeline, {
  forked: false,
  state: "module_locked",
  blockId: "metadata",
});
assert.equal(audits.length, 3);
assert.equal(audits[2]?.operation, "channels.updateChannel pipeline write");

await assert.rejects(
  invoke(lockModule, serviceContext, {
    ownerId: "owner_daniel",
    channelId: lockedChannel._id,
    blockId: "metadata",
  }),
  /interactive studio owner identity/,
  "a service identity cannot lock a module on the owner's behalf",
);

let ownerChannel: Record<string, unknown> = {
  _id: "channels:owner-module-lock" as never,
  ownerId: "owner_daniel",
  pipeline: initialPipeline,
  moduleConfig: { metadata: { preset: "search-first" } },
};
const ownerAudits: Array<Record<string, unknown>> = [];
const ownerContext = {
  auth: {
    getUserIdentity: async () => ({
      role: "owner",
      subject: "owner_daniel",
      owner_id: "owner_daniel",
    }),
  },
  db: {
    normalizeId: () => "channels:owner-module-lock",
    get: async () => ownerChannel,
    patch: async (_id: unknown, patch: Record<string, unknown>) => {
      ownerChannel = { ...ownerChannel, ...patch };
    },
    insert: async (_table: string, row: Record<string, unknown>) => {
      ownerAudits.push(row);
      return `audit:${ownerAudits.length}`;
    },
  },
};

const locked = await invoke<{
  locked: boolean;
  blockId: string;
  lockedAt: number;
  lockedBy: string;
}>(
  lockModule,
  ownerContext,
  { ownerId: "owner_daniel", channelId: ownerChannel._id, blockId: "metadata" },
);
assert.equal(locked.locked, true);
assert.equal(locked.blockId, "metadata");
assert.equal(locked.lockedBy, "owner_daniel");
assert.ok(locked.lockedAt > 0);
assert.equal(ownerAudits[0]?.event, "locked");
const unlocked = await invoke<{ locked: boolean; blockId: string }>(
  unlockModule,
  ownerContext,
  {
    ownerId: "owner_daniel",
    channelId: ownerChannel._id,
    blockId: "metadata",
    confirmation: "UNLOCK MODULE metadata",
  },
);
assert.deepEqual(unlocked, { locked: false, blockId: "metadata" });
assert.equal(ownerAudits[1]?.event, "unlocked");
assert.equal((ownerChannel.moduleLocks as Record<string, unknown> | undefined)?.metadata, undefined);

const storedAuditRows = [
  {
    _id: "channelModuleLockAudits:2",
    blockId: "metadata",
    event: "unlocked",
    createdAt: 2,
  },
  {
    _id: "channelModuleLockAudits:1",
    blockId: "metadata",
    event: "locked",
    createdAt: 1,
  },
];
const auditQueryContext = {
  auth: ownerContext.auth,
  db: {
    normalizeId: () => "channels:owner-module-lock",
    get: async () => ownerChannel,
    query: (table: string) => {
      assert.equal(table, "channelModuleLockAudits");
      return {
        withIndex: (
          index: string,
          configure: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
        ) => {
          assert.equal(index, "by_channel_created");
          configure({ eq: (field, value) => ({ field, value }) });
          return {
            order: (direction: string) => {
              assert.equal(direction, "desc");
              return { take: async (limit: number) => storedAuditRows.slice(0, limit) };
            },
          };
        },
      };
    },
  },
};
const listedAudits = await invoke<Array<{ event: string; createdAt: number }>>(
  listModuleLockAudits,
  auditQueryContext,
  { ownerId: "owner_daniel", channelId: ownerChannel._id, limit: 1 },
);
assert.deepEqual(listedAudits, [storedAuditRows[0]]);

const source = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");
assert.match(source("convex/schema.ts"), /channelModuleLockAudits: defineTable/);
assert.match(source("convex/channels.ts"), /export const lockModule = mutation/);
assert.match(source("convex/channels.ts"), /export const unlockModule = mutation/);
assert.match(source("convex/channels.ts"), /export const listModuleLockAudits = query/);
assert.match(source("convex/channels.ts"), /firstLockedModulePipelineChange/);
assert.match(source("src/components/ModuleConfigSection.tsx"), /Lock module/);
assert.match(source("src/components/ModuleConfigSection.tsx"), /channelModuleUnlockConfirmation/);
assert.match(source("src/components/ModuleConfigSection.tsx"), /Recent lock activity/);
assert.match(source("src/trigger/designChannelInception.ts"), /channel inception module configuration refused/);

console.log("CHANNEL MODULE LOCK TESTS PASS");
}

void main();
