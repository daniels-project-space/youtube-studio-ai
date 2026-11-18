import assert from "node:assert/strict";
import { createChannel, updateChannel } from "../../../convex/channels";

type Handler = (ctx: unknown, args: unknown) => Promise<unknown>;
const create = (createChannel as unknown as { _handler: Handler })._handler;
const update = (updateChannel as unknown as { _handler: Handler })._handler;

async function main() {
  let writes = 0;
  const ctx = {
    auth: { getUserIdentity: async () => ({ role: "owner", owner_id: "owner", subject: "owner" }) },
    db: {
      normalizeId: (_table: string, id: string) => id,
      get: async () => ({ ownerId: "owner" }),
      patch: async () => { writes++; },
      insert: async () => { writes++; },
    },
  };
  for (const budget of [-1, 10001, NaN, Infinity]) {
    await assert.rejects(() => create(ctx, { ownerId: "owner", budget }), /budget must be between/);
    await assert.rejects(() => update(ctx, { channelId: "channel", budget }), /budget must be between/);
  }
  await assert.rejects(() => update(ctx, { channelId: "channel", budget: 5, expectedBudget: 3 }), /budget changed/);
  await assert.rejects(() => update(ctx, { channelId: "channel", budget: 5 }), /previously observed budget/);
  await assert.rejects(() => update(ctx, { channelId: "channel", expectedBudget: null }), /budget changed/);
  assert.equal(writes, 0, "invalid budgets must never reach a write");
  console.log("Channel creation and update reject invalid budgets before writing");
}
void main();
