import assert from "node:assert/strict";

import { claimAttemptUnderDailyCap } from "../../../convex/casefileResearchAttempts";
import { recordCasefileResearchDeferral } from "../../../convex/contentPlan";
import {
  CASEFILE_AUTO_RESEARCH_MAX_PLAN_AGE_MS,
  CASEFILE_AUTO_RESEARCH_MAX_PLAN_FAILURES,
  decideCasefileAutoResearchPlanDisposition,
} from "@/lib/casefileAutoResearchSafety";

type Row = Record<string, unknown> & { _id: string; _creationTime: number };

class MemoryQuery {
  private readonly filters: Array<{ field: string; value: unknown }> = [];

  constructor(private readonly db: MemoryDb, private readonly table: string) {}

  withIndex(_name: string, build: (range: {
    eq: (field: string, value: unknown) => unknown;
  }) => unknown): this {
    const range = {
      eq: (field: string, value: unknown) => {
        this.filters.push({ field, value });
        return range;
      },
    };
    build(range);
    return this;
  }

  async take(limit: number): Promise<Row[]> {
    return this.db.rows(this.table)
      .filter((row) => this.filters.every(({ field, value }) => row[field] === value))
      .slice(0, limit);
  }
}

class MemoryDb {
  private readonly tables = new Map<string, Map<string, Row>>();
  private counter = 0;

  rows(table: string): Row[] {
    return [...(this.tables.get(table)?.values() ?? [])];
  }

  seed(table: string, value: Record<string, unknown>, id: string): string {
    const rows = this.tables.get(table) ?? new Map<string, Row>();
    this.tables.set(table, rows);
    rows.set(id, { ...value, _id: id, _creationTime: ++this.counter });
    return id;
  }

  async get(id: string): Promise<Row | null> {
    for (const rows of this.tables.values()) {
      const row = rows.get(id);
      if (row) return row;
    }
    return null;
  }

  normalizeId(table: string, id: string): string | null {
    return this.tables.get(table)?.has(id) ? id : null;
  }

  async insert(table: string, value: Record<string, unknown>): Promise<string> {
    const id = `${table}:${++this.counter}`;
    return this.seed(table, value, id);
  }

  async patch(id: string, patch: Record<string, unknown>): Promise<void> {
    const row = await this.get(id);
    if (!row) throw new Error(`missing row ${id}`);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete row[key];
      else row[key] = value;
    }
  }

  query(table: string): MemoryQuery {
    return new MemoryQuery(this, table);
  }
}

function context(db: MemoryDb, role: "owner" | "service" = "service") {
  const ownerId = "owner-casefile-test";
  return {
    db,
    auth: {
      getUserIdentity: async () => ({
        subject: role === "service" ? "trigger-service" : ownerId,
        issuer: "https://studio.test",
        tokenIdentifier: `test|${ownerId}`,
        role,
        owner_id: ownerId,
      }),
    },
  };
}

async function invoke<T>(definition: unknown, ctx: unknown, args: unknown): Promise<T> {
  const runtime = definition as {
    _handler: (handlerContext: unknown, handlerArgs: unknown) => Promise<T>;
  };
  return runtime._handler(ctx, args);
}

async function run(): Promise<void> {
  const ownerId = "owner-casefile-test";
  const channelId = "channels:casefile";
  const now = Date.now();

  /* Daily admission is service-only and its durable row advances atomically. */
  {
    const db = new MemoryDb();
    db.seed("channels", { ownerId, status: "active" }, channelId);
    const first = await invoke<{
      kind: "claimed" | "daily_ceiling_reached";
      attemptsToday: number;
      limit: number;
    }>(claimAttemptUnderDailyCap, context(db), {
      ownerId,
      channelId,
      day: "2026-08-21",
      limit: 1,
    });
    const second = await invoke<{
      kind: "claimed" | "daily_ceiling_reached";
      attemptsToday: number;
      limit: number;
    }>(claimAttemptUnderDailyCap, context(db), {
      ownerId,
      channelId,
      day: "2026-08-21",
      limit: 1,
    });
    assert.deepEqual(first, { kind: "claimed", attemptsToday: 1, limit: 1 });
    assert.deepEqual(second, { kind: "daily_ceiling_reached", attemptsToday: 1, limit: 1 });
    assert.equal(db.rows("casefileResearchAttempts").length, 1);
    await assert.rejects(
      invoke(claimAttemptUnderDailyCap, context(db, "owner"), {
        ownerId,
        channelId,
        day: "2026-08-22",
        limit: 1,
      }),
      /requires the bound studio service identity/,
      "owner sessions must not create pre-pipeline research spend claims",
    );
  }

  /* A permanently non-converging scheduled plan becomes manual-required. */
  {
    const db = new MemoryDb();
    const itemId = "contentPlan:bounded";
    const runId = "runs:bounded";
    db.seed("channels", { ownerId, status: "active" }, channelId);
    db.seed("runs", {
      ownerId,
      channelId,
      status: "queued",
      startedAt: now,
      costTotal: 0,
      planItemId: itemId,
    }, runId);
    db.seed("contentPlan", {
      ownerId,
      channelId,
      status: "ready",
      scheduledRunId: runId,
      scheduledClaimedAt: now,
    }, itemId);
    for (let attempt = 1; attempt < CASEFILE_AUTO_RESEARCH_MAX_PLAN_FAILURES; attempt++) {
      const result = await invoke<{ state: string; failureCount?: number }>(
        recordCasefileResearchDeferral,
        context(db),
        {
          ownerId,
          channelId,
          itemId,
          runId,
          outcome: "research_failed",
          reason: `research attempt ${attempt} found no admissible case`,
        },
      );
      assert.deepEqual(result, { state: "requeue", failureCount: attempt });
    }
    const terminal = await invoke<{ state: string; failureCount?: number; reason?: string }>(
      recordCasefileResearchDeferral,
      context(db),
      {
        ownerId,
        channelId,
        itemId,
        runId,
        outcome: "research_failed",
        reason: "research attempt permanently failed",
      },
    );
    assert.equal(terminal.state, "blocked");
    assert.equal(terminal.failureCount, CASEFILE_AUTO_RESEARCH_MAX_PLAN_FAILURES);
    assert.match(terminal.reason ?? "", /Manual Casefile review or a source packet is required/);
    assert.equal((await db.get(runId))?.status, "failed");
    assert.match(String((await db.get(itemId))?.scheduledFailure), /Manual Casefile review/);
  }

  /* Even a quota-only deferral cannot keep a stale plan queued forever.
   * `scheduledClaimedAt` intentionally models a reaper replacement; the
   * preserved first-research timestamp must still win the age calculation. */
  {
    const db = new MemoryDb();
    const itemId = "contentPlan:aged";
    const runId = "runs:aged";
    db.seed("channels", { ownerId, status: "active" }, channelId);
    db.seed("runs", {
      ownerId,
      channelId,
      status: "queued",
      startedAt: now,
      costTotal: 0,
      planItemId: itemId,
    }, runId);
    db.seed("contentPlan", {
      ownerId,
      channelId,
      status: "ready",
      scheduledRunId: runId,
      scheduledClaimedAt: now,
      casefileResearchStartedAt: now - CASEFILE_AUTO_RESEARCH_MAX_PLAN_AGE_MS,
    }, itemId);
    const result = await invoke<{ state: string; reason?: string }>(
      recordCasefileResearchDeferral,
      context(db),
      {
        ownerId,
        channelId,
        itemId,
        runId,
        outcome: "daily_ceiling_reached",
        reason: "daily research ceiling reached",
      },
    );
    assert.equal(result.state, "blocked");
    assert.match(result.reason ?? "", /exceeded its 48-hour research window/);
    assert.equal((await db.get(runId))?.status, "failed");
  }

  /* The pure decision is fail-closed when a legacy queued plan has no age anchor. */
  {
    const decision = decideCasefileAutoResearchPlanDisposition({
      outcome: "daily_ceiling_reached",
      previousFailureCount: 0,
      planClaimedAt: undefined,
      now,
    });
    assert.equal(decision.state, "manual_required");
  }
}

run()
  .then(() => console.log("casefileAutoResearchSafety test passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
