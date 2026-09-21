import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareResumeDispatch as music } from "../../../convex/musicAuditionCheckpoints";
import { prepareResumeDispatch as factual } from "../../../convex/factualReviewCheckpoints";

const ownerId = "owner-preparation";
type Definition = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };

function fixture(role = "service", identityOwner = ownerId, includeYuE2 = false) {
  const reads: { index: string; limit: number }[] = [];
  const ctx = {
    auth: { getUserIdentity: async () => ({
      subject: role === "service" ? "service:youtube-studio-ai" : identityOwner,
      role, owner_id: identityOwner,
    }) },
    db: {
      query: (table: string) => {
        assert.ok(table === "runs" || includeYuE2 && table === "yue2Continuations");
        let index = "";
        const range = { eq: () => range, gt: () => range, lte: () => range };
        const query = {
          withIndex: (name: string, build: (r: typeof range) => unknown) => {
            index = name; build(range); return query;
          },
          take: async (limit: number) => { reads.push({ index, limit }); return []; },
        };
        return query;
      },
      patch: () => { throw new Error("empty recovery cannot write"); },
    },
  };
  return { reads, run: (definition: unknown, args: object = {}) =>
    (definition as Definition)._handler(ctx, { ownerId, now: 1000, limit: 25, ...args }) };
}

test("both idle transactions retain bounded due, legacy and pending scans without writes", async () => {
  for (const [definition, prefix] of [[music, "music_audition"], [factual, "factual_review"]] as const) {
    const f = fixture();
    assert.deepEqual(await f.run(definition), {
      recovery: { ...(definition === factual ? { checked: 0 } : {}), requeued: 0, blocked: 0 }, pending: [],
    });
    assert.deepEqual(f.reads, [
      { index: `by_owner_${prefix}_resume_queue_deadline`, limit: 25 },
      { index: `by_owner_${prefix}_resume_queue_deadline`, limit: 25 },
      { index: `by_owner_${prefix}_resume`, limit: 50 },
    ]);
  }
});

test("combined endpoints reject non-service and foreign-owner requests before reading", async () => {
  for (const definition of [music, factual]) {
    for (const [role, owner] of [["owner", ownerId], ["viewer", ownerId], ["service", "foreign-owner"]]) {
      const f = fixture(role, owner);
      await assert.rejects(f.run(definition));
      assert.deepEqual(f.reads, []);
    }
  }
});

test("invalid recovery time fails before either scan", async () => {
  for (const definition of [music, factual]) {
    for (const now of [-1, 0.5, NaN, Infinity]) {
      const f = fixture();
      await assert.rejects(f.run(definition, { now }), /invalid/);
      assert.deepEqual(f.reads, []);
    }
  }
});

test("opt-in music preparation keeps both queue scans bounded inside one idle transaction", async () => {
  const f = fixture("service", ownerId, true);
  assert.deepEqual(await f.run(music, { includeYuE2: true }), {
    recovery: { requeued: 0, blocked: 0 }, pending: [], yue2Pending: [],
  });
  assert.equal(f.reads.length, 5);
  assert.deepEqual(f.reads.slice(3), [
    { index: "by_owner_state_deadline", limit: 25 }, { index: "by_owner_state_deadline", limit: 25 },
  ]);
});
