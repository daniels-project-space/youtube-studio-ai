import assert from "node:assert/strict";

import { setLock } from "../../../convex/ownerModuleLocks";
import { LOCKABLE_MODULES } from "@/lib/ownerLockRegistry";
import { ownerModuleUnlockConfirmation } from "@/lib/ownerModuleLockContract";

const candidateModuleKey = LOCKABLE_MODULES.find((module) => module.paths.length > 0)?.id;
assert.ok(candidateModuleKey, "the catalog must contain a source-enforced module");
const moduleKey: string = candidateModuleKey;

type Row = {
  _id: string;
  ownerId: string;
  moduleKey: string;
  locked: boolean;
  lockedAt: number;
  lockedBy: string;
};

async function invoke(context: unknown, args: unknown): Promise<unknown> {
  return await (setLock as unknown as {
    _handler: (ctx: unknown, input: unknown) => Promise<unknown>;
  })._handler(context, args);
}

async function main() {
  const rows: Row[] = [];
  const ownerContext = {
    auth: {
      getUserIdentity: async () => ({
        role: "owner",
        owner_id: "owner_daniel",
        subject: "owner_daniel",
      }),
    },
    db: {
      query: () => ({
        withIndex: (_name: string, range: (q: unknown) => unknown) => {
          const selection: { ownerId?: string; moduleKey?: string } = {};
          const q = {
            eq(key: "ownerId" | "moduleKey", value: string) {
              selection[key] = value;
              return q;
            },
          };
          range(q);
          return {
            first: async () => rows.find((row) =>
              row.ownerId === selection.ownerId && row.moduleKey === selection.moduleKey,
            ) ?? null,
          };
        },
      }),
      insert: async (_table: string, value: Omit<Row, "_id">) => {
        rows.push({ ...value, _id: `lock:${rows.length + 1}` });
      },
      patch: async (id: string, value: Partial<Row>) => {
        const row = rows.find((item) => item._id === id);
        assert.ok(row);
        Object.assign(row, value);
      },
    },
  };

  await assert.rejects(
    invoke(ownerContext, { ownerId: "owner_daniel", moduleKey: "fictional_module", locked: true }),
    /not a lockable module/,
  );
  assert.equal(rows.length, 0, "unknown keys cannot become unenforced fake locks");

  await invoke(ownerContext, { ownerId: "owner_daniel", moduleKey, locked: true });
  assert.equal(rows.length, 1);
  const original = { ...rows[0]! };
  await invoke(ownerContext, { ownerId: "owner_daniel", moduleKey, locked: true });
  assert.deepEqual(rows[0], original, "re-locking preserves the original provenance");

  await assert.rejects(
    invoke(ownerContext, { ownerId: "owner_daniel", moduleKey, locked: false }),
    /requires confirmation/,
  );
  await assert.rejects(
    invoke(ownerContext, {
      ownerId: "owner_daniel",
      moduleKey,
      locked: false,
      confirmation: ownerModuleUnlockConfirmation("different_module"),
    }),
    /requires confirmation/,
  );
  assert.equal(rows[0]?.locked, true, "failed unlock attempts leave protection in place");

  const serviceContext = {
    ...ownerContext,
    auth: {
      getUserIdentity: async () => ({
        role: "service",
        owner_id: "owner_daniel",
        subject: "worker",
      }),
    },
  };
  await assert.rejects(
    invoke(serviceContext, {
      ownerId: "owner_daniel",
      moduleKey,
      locked: false,
      confirmation: ownerModuleUnlockConfirmation(moduleKey),
    }),
    /interactive studio owner identity/,
  );

  await invoke(ownerContext, {
    ownerId: "owner_daniel",
    moduleKey,
    locked: false,
    confirmation: ownerModuleUnlockConfirmation(moduleKey),
  });
  assert.equal(rows[0]?.locked, false);

  const before = rows.length;
  await invoke(ownerContext, {
    ownerId: "owner_daniel",
    moduleKey: "retired_module",
    locked: false,
    confirmation: ownerModuleUnlockConfirmation("retired_module"),
  });
  assert.equal(rows.length, before, "unlocking an absent retired key creates no fake row");
}

main().then(() => console.log("OWNER MODULE LOCK PASS — catalog, provenance, typed unlock, service denial"));
