import assert from "node:assert/strict";
import test from "node:test";
import {
  schedule, listReleaseChecks, recordReleaseObservations, claimDue, complete, fail,
} from "../../../convex/runArtifactRetentions";
import {
  RUN_ARTIFACT_RETENTION_MS, RUN_ARTIFACT_RELEASE_CHECK_MS,
} from "@/lib/runArtifactRetention";

type Row = Record<string, unknown> & { _id: string; _creationTime: number };
type Filter = { field: string; op: "eq" | "lte"; value: unknown };

class MemoryQuery {
  filters: Filter[] = [];
  constructor(readonly db: MemoryDb, readonly table: string) {}
  withIndex(_name: string, build: (range: {
    eq: (field: string, value: unknown) => unknown;
    lte: (field: string, value: unknown) => unknown;
  }) => unknown): this {
    const range = {
      eq: (field: string, value: unknown) => { this.filters.push({ field, op: "eq", value }); return range; },
      lte: (field: string, value: unknown) => { this.filters.push({ field, op: "lte", value }); return range; },
    };
    build(range);
    return this;
  }
  async take(limit: number): Promise<Row[]> {
    return this.db.rows(this.table).filter((row) => this.filters.every(({ field, op, value }) =>
      op === "eq" ? row[field] === value : row[field] === undefined ||
        (typeof row[field] === "number" && typeof value === "number" && row[field] <= value),
    )).sort((a, b) => Number(a.nextReleaseCheckAt ?? 0) - Number(b.nextReleaseCheckAt ?? 0) ||
      a._creationTime - b._creationTime).slice(0, limit);
  }
  async unique(): Promise<Row | null> {
    const rows = await this.take(2);
    if (rows.length > 1) throw new Error("ambiguous row");
    return rows[0] ?? null;
  }
}

class MemoryDb {
  counter = 0;
  tables = new Map<string, Map<string, Row>>();
  rows(table: string): Row[] { return [...(this.tables.get(table)?.values() ?? [])]; }
  seed(table: string, id: string, data: Record<string, unknown>): Row {
    const row = { ...data, _id: id, _creationTime: ++this.counter };
    const rows = this.tables.get(table) ?? new Map<string, Row>();
    rows.set(id, row); this.tables.set(table, rows); return row;
  }
  async insert(table: string, data: Record<string, unknown>): Promise<string> {
    return this.seed(table, `${table}-${this.counter + 1}`, data)._id;
  }
  async get(id: string): Promise<Row | null> {
    for (const rows of this.tables.values()) if (rows.has(id)) return rows.get(id)!;
    return null;
  }
  normalizeId(table: string, id: string): string | null { return this.tables.get(table)?.has(id) ? id : null; }
  async patch(id: string, patch: Record<string, unknown>): Promise<void> {
    const row = await this.get(id); if (!row) throw new Error("missing row"); Object.assign(row, patch);
  }
  query(table: string): MemoryQuery { return new MemoryQuery(this, table); }
}

const ownerId = "owner-retention";
const uploadedAt = Date.parse("2026-09-01T00:00:00Z");
const videoId = "abcdefghijk";
const ytChannelId = "UC-channel";
const keyPrefix = `owner/${ownerId}/channel/a/`;
const certificateKey = `${keyPrefix}runs/run-a/release.json`;

function fixture() {
  const db = new MemoryDb();
  db.seed("channels", "channel-a", { ownerId, slug: "a" });
  db.seed("runs", "run-a", {
    ownerId, channelId: "channel-a", youtubeVideoId: videoId,
    releaseEvidenceStatus: "release_evidence_recorded", releaseEvidenceCertificateKey: certificateKey,
  });
  db.seed("youtubeAuth", "connector-a", { ownerId, channelId: "channel-a", ytChannelId, tokenVersion: 4 });
  const ctx = { db, auth: { getUserIdentity: async () => ({
    role: "service", owner_id: ownerId, subject: "service:youtube-studio-ai",
  }) } };
  const invoke = async <T = Row>(definition: unknown, args: unknown): Promise<T> =>
    (definition as { _handler: (ctx: unknown, args: unknown) => Promise<T> })._handler(ctx, args);
  const scheduleArgs = { ownerId, channelId: "channel-a", runId: "run-a", keyPrefix,
    certificateKey, additionalCertificateKeys: [], keepNames: ["final.mp4"],
    uploadedAt, releaseMode: "private_draft" };
  const observe = (retentionId: string, observedAt: number, patch: Record<string, unknown> = {}) => invoke(recordReleaseObservations, {
    ownerId, observedAt, observations: [{ retentionId, connectorId: "connector-a", connectorVersion: 4,
      observation: { videoId, channelId: ytChannelId, privacyStatus: "public", uploadStatus: "processed",
        publishedAt: new Date(uploadedAt + 86_400_000).toISOString(), ...patch } }],
  });
  const claim = (now: number) => invoke<Row | null>(claimDue, { ownerId, now, leaseToken: "a".repeat(64) });
  return { db, ctx, invoke, scheduleArgs, observe, claim };
}

test("private→public transition waits actual release plus fourteen days and rechecks before deletion", async () => {
  const f = fixture();
  const row = await f.invoke(schedule, f.scheduleArgs);
  assert.equal(row.status, "awaiting_release");
  const actualRelease = uploadedAt + 86_400_000;
  await f.observe(row._id, actualRelease + 60_000);
  assert.equal(row.status, "pending");
  assert.equal(row.releaseAt, actualRelease);
  assert.equal(row.retainUntil, actualRelease + RUN_ARTIFACT_RETENTION_MS);
  assert.equal(await f.claim(actualRelease + RUN_ARTIFACT_RETENTION_MS - 1), null);
  const due = actualRelease + RUN_ARTIFACT_RETENTION_MS;
  assert.equal(await f.claim(due), null, "two-week-old provider evidence is stale");
  await f.observe(row._id, due);
  const claimed = await f.claim(due);
  assert.ok(claimed);
  assert.equal(claimed.status, "processing");
  assert.equal(await f.claim(due), null, "a second worker cannot claim the same cleanup");
  await assert.rejects(f.invoke(complete, { ownerId, retentionId: row._id, leaseToken: "b".repeat(64),
    completedAt: due, removedObjects: 1, retainedObjectCount: 1, retainedReleaseEvidence: [] }), /lease/);
  await f.invoke(complete, { ownerId, retentionId: row._id, leaseToken: "a".repeat(64),
    completedAt: due, removedObjects: 1, retainedObjectCount: 1, retainedReleaseEvidence: [certificateKey] });
  assert.equal(row.status, "completed");
});

test("missed schedules and failed processing preserve artifacts without consuming cleanup attempts", async () => {
  for (const patch of [
    { privacyStatus: "private" }, { privacyStatus: "unlisted" },
    { uploadStatus: "failed" }, { uploadStatus: "rejected" },
  ]) {
    const f = fixture();
    const requested = uploadedAt + 3_600_000;
    const row = await f.invoke(schedule, { ...f.scheduleArgs, releaseMode: "scheduled", scheduledPublishAt: requested });
    const late = requested + RUN_ARTIFACT_RETENTION_MS + 86_400_000;
    await f.observe(row._id, late, patch);
    assert.equal(row.status, "awaiting_release");
    assert.equal(row.retainUntil, undefined);
    assert.equal(row.attempts, 0);
    assert.equal(await f.claim(late), null);
    const actual = late + 86_400_000;
    await f.observe(row._id, actual + 1_000, { publishedAt: new Date(actual).toISOString() });
    assert.equal(row.retainUntil, actual + RUN_ARTIFACT_RETENTION_MS);
    assert.equal(await f.claim(actual + 1_000), null);
  }
});

test("legacy due schedules cannot delete until re-observed, and errors invalidate earlier proof", async () => {
  const f = fixture();
  const row = await f.invoke(schedule, f.scheduleArgs);
  const due = uploadedAt + 86_400_000 + RUN_ARTIFACT_RETENTION_MS;
  await f.db.patch(row._id, { status: "pending", releaseAt: uploadedAt, retainUntil: uploadedAt + RUN_ARTIFACT_RETENTION_MS,
    nextReleaseCheckAt: undefined });
  assert.equal(await f.claim(due), null);
  const checks = await f.invoke<Row[]>(listReleaseChecks, { ownerId, now: due });
  assert.equal(checks[0].retentionId, row._id);
  await f.observe(row._id, due);
  await f.invoke(recordReleaseObservations, { ownerId, observedAt: due + 1,
    observations: [{ retentionId: row._id, error: "YouTube HTTP 503", observation: null }] });
  assert.equal(row.releaseObservationAt, undefined);
  assert.equal(await f.claim(due + 2), null);
  assert.equal(row.nextReleaseCheckAt, due + 1 + RUN_ARTIFACT_RELEASE_CHECK_MS);
});

test("changed video identity, token version, owner or channel cannot authorize cleanup", async () => {
  for (const patch of [{ videoId: "other-video" }, { channelId: "UC-other" }]) {
    const f = fixture(); const row = await f.invoke(schedule, f.scheduleArgs);
    await f.observe(row._id, uploadedAt + RUN_ARTIFACT_RETENTION_MS * 2, patch);
    assert.equal(row.status, "awaiting_release");
  }
  const f = fixture(); const row = await f.invoke(schedule, f.scheduleArgs);
  await f.db.patch("connector-a", { tokenVersion: 5 });
  await f.observe(row._id, uploadedAt + RUN_ARTIFACT_RETENTION_MS * 2);
  assert.equal(row.status, "awaiting_release");
  await f.db.patch("connector-a", { tokenVersion: 4 });
  const due = uploadedAt + RUN_ARTIFACT_RETENTION_MS * 2 + 1;
  await f.observe(row._id, due);
  await f.db.patch("run-a", { youtubeVideoId: "other-video" });
  assert.equal(await f.claim(due), null, "run reassignment after observation is rejected");
  const ownerContext = { ...f.ctx, auth: { getUserIdentity: async () => ({
    role: "owner", owner_id: ownerId, subject: ownerId,
  }) } };
  await assert.rejects((recordReleaseObservations as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
  })._handler(ownerContext, { ownerId, observedAt: due, observations: [] }), /service identity/);
});

test("expired or failed cleanup leases require a new provider observation", async () => {
  const f = fixture(); const row = await f.invoke(schedule, f.scheduleArgs);
  const due = uploadedAt + RUN_ARTIFACT_RETENTION_MS * 2;
  await f.observe(row._id, due);
  await f.claim(due);
  const expired = Number(row.leaseExpiresAt) + 1;
  assert.equal(await f.claim(expired), null);
  await f.observe(row._id, expired);
  assert.ok(await f.claim(expired));
  await f.invoke(fail, { ownerId, retentionId: row._id, leaseToken: "a".repeat(64), failedAt: expired, error: "R2 unavailable" });
  assert.equal(row.attempts, 2);
  assert.equal(row.releaseObservationAt, undefined);
  assert.equal(await f.claim(expired), null);
});

test("old private drafts are deferred fairly and do not monopolize the bounded observer", async () => {
  const f = fixture(); const first = await f.invoke(schedule, f.scheduleArgs);
  for (let index = 0; index < 20; index++) f.db.seed("runArtifactRetentions", `ret-extra-${index}`, {
    ...first, _id: undefined, nextReleaseCheckAt: undefined,
  });
  const firstPage = await f.invoke<Row[]>(listReleaseChecks, { ownerId, now: uploadedAt });
  assert.equal(firstPage.length, 16);
  await f.invoke(recordReleaseObservations, { ownerId, observedAt: uploadedAt,
    observations: firstPage.map((row) => ({ retentionId: row.retentionId, observation: null })) });
  const nextPage = await f.invoke<Row[]>(listReleaseChecks, { ownerId, now: uploadedAt });
  assert.ok(nextPage.length > 0);
  assert.ok(nextPage.every((row) => !firstPage.some((earlier) => earlier.retentionId === row.retentionId)));
});
