import assert from "node:assert/strict";
import test, { mock } from "node:test";
import {
  schedule, listReleaseChecks, listFinalCopyChecks, recordReleaseObservations, claimDue, authorizeDeletion, complete, fail,
} from "../../../convex/runArtifactRetentions";
import { candidate as finalCandidate, begin as beginFinalCopy,
  authorizeWrite as authorizeFinalCopyWrite, finish as finishFinalCopy } from "../../../convex/releasedFinalMasters";
import { releasedFinalVideoKey, FINAL_VIDEO_RETENTION_MS } from "@/lib/r2AssetRetention";
import {
  RUN_ARTIFACT_RETENTION_MS, RUN_ARTIFACT_RELEASE_CHECK_MS,
  RUN_ARTIFACT_RELEASE_OBSERVATION_MAX_AGE_MS, runArtifactCleanupBinding,
} from "@/lib/runArtifactRetention";

type Row = Record<string, unknown> & { _id: string; _creationTime: number };
type Filter = { field: string; op: "eq" | "lte" | "gte"; value: unknown };

class MemoryQuery {
  filters: Filter[] = [];
  constructor(readonly db: MemoryDb, readonly table: string) {}
  withIndex(_name: string, build: (range: {
    eq: (field: string, value: unknown) => unknown;
    lte: (field: string, value: unknown) => unknown;
    gte: (field: string, value: unknown) => unknown;
  }) => unknown): this {
    const range = {
      eq: (field: string, value: unknown) => { this.filters.push({ field, op: "eq", value }); return range; },
      lte: (field: string, value: unknown) => { this.filters.push({ field, op: "lte", value }); return range; },
      gte: (field: string, value: unknown) => { this.filters.push({ field, op: "gte", value }); return range; },
    };
    build(range);
    return this;
  }
  async take(limit: number): Promise<Row[]> {
    return this.db.rows(this.table).filter((row) => this.filters.every(({ field, op, value }) =>
      op === "eq" ? row[field] === value : op === "lte"
        ? row[field] === undefined ||
          (typeof row[field] === "number" && typeof value === "number" && row[field] <= value)
        : typeof row[field] === "number" && typeof value === "number" && row[field] >= value,
    )).sort((a, b) => Number(a.nextReleaseCheckAt ?? 0) - Number(b.nextReleaseCheckAt ?? 0) ||
      a._creationTime - b._creationTime).slice(0, limit);
  }
  async collect(): Promise<Row[]> { return this.take(Number.MAX_SAFE_INTEGER); }
  async unique(): Promise<Row | null> {
    const rows = await this.take(2);
    if (rows.length > 1) throw new Error("ambiguous row");
    return rows[0] ?? null;
  }
}

class MemoryDb {
  counter = 0;
  getCalls = new Map<string, number>();
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
    this.getCalls.set(id, (this.getCalls.get(id) ?? 0) + 1);
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

function deletionArgs(row: Row, observedAt: number) {
  return { ownerId, retentionId: row._id, leaseToken: "a".repeat(64),
    binding: runArtifactCleanupBinding(row as unknown as Parameters<typeof runArtifactCleanupBinding>[0]),
    connectorId: "connector-a", connectorVersion: 4, observedAt,
    observation: { videoId, channelId: ytChannelId, privacyStatus: "public", uploadStatus: "processed",
      publishedAt: new Date(uploadedAt + 86_400_000).toISOString() } };
}

test("real release observation reserves and finishes one certified final-copy generation", async () => {
  const f = fixture();
  const row = await f.invoke(schedule, f.scheduleArgs);
  const now = Date.now();
  const publicAt = now - 60_000;
  const sourceSha256 = "a".repeat(64);
  const sourceKey = `${keyPrefix}runs/run-a/final.mp4`;
  const copyKey = releasedFinalVideoKey(keyPrefix, "run-a", publicAt, sourceSha256);
  const identity = { ownerId, retentionId: row._id, releaseAt: publicAt,
    certificateKey, certificateFingerprint: "b".repeat(64), sourceKey, sourceSha256,
    sourceByteLength: 10_000, sourceEtag: `"${"c".repeat(32)}"`,
    sourceLastModifiedAt: now - 120_000, copyKey,
    claimId: "11111111-1111-1111-1111-111111111111" };
  assert.equal(await f.invoke(finalCandidate, { ownerId, retentionId: row._id, now }), null);
  await f.observe(row._id, now, { publishedAt: new Date(publicAt).toISOString(), privacyStatus: "private" });
  assert.equal(await f.invoke(finalCandidate, { ownerId, retentionId: row._id, now }), null);
  await f.observe(row._id, now + 1, { publishedAt: new Date(publicAt).toISOString() });
  assert.ok(await f.invoke(finalCandidate, { ownerId, retentionId: row._id, now: now + 1 }));
  assert.equal((await f.invoke<Row[]>(listFinalCopyChecks, {
    ownerId, now: now + RUN_ARTIFACT_RELEASE_CHECK_MS + 1 })).length, 1);
  assert.equal((await f.invoke(beginFinalCopy, identity) as { status: string }).status, "active");
  await assert.rejects(f.invoke(beginFinalCopy, { ...identity, sourceEtag: `"${"d".repeat(32)}"` }), /conflicts/);
  const finishedAt = Date.now();
  const finish = { ...identity, copyEtag: `"${"e".repeat(32)}"`,
    copyLastModifiedAt: finishedAt, finishedAt,
    connectorId: "connector-a", connectorVersion: 4, observedAt: now + 1,
    observation: { videoId, channelId: ytChannelId, privacyStatus: "public",
      uploadStatus: "processed", publishedAt: new Date(publicAt).toISOString() } };
  assert.equal((await f.invoke(finishFinalCopy, finish) as { status: string }).status, "finished");
  assert.equal((await f.invoke(finishFinalCopy, finish) as { status: string }).status, "finished");
  assert.equal(f.db.rows("releasedFinalMasters").length, 1);
  assert.equal(row.nextReleaseCheckAt, publicAt + 14 * 86_400_000);
  assert.equal(Number(f.db.rows("releasedFinalMasters")[0].releaseAt) + FINAL_VIDEO_RETENTION_MS,
    publicAt + FINAL_VIDEO_RETENTION_MS);
  assert.equal(await f.invoke(finalCandidate, { ownerId, retentionId: row._id, now: now + 2 }), null);
  assert.equal((await f.invoke<Row[]>(listFinalCopyChecks, {
    ownerId, now: now + RUN_ARTIFACT_RELEASE_CHECK_MS + 1 })).length, 0);
});

test("quiz final certificate source uses the same released-final ledger and rejects a changed source", async () => {
  const f = fixture();
  const row = await f.invoke(schedule, f.scheduleArgs);
  const now = Date.now();
  const publicAt = now - 30_000;
  await f.observe(row._id, now, { publishedAt: new Date(publicAt).toISOString() });
  const sourceSha256 = "f".repeat(64);
  const sourceKey = `${keyPrefix}runs/run-a/quiz-year/quiz-year-${sourceSha256}.mp4`;
  const identity = { ownerId, retentionId: row._id, releaseAt: publicAt, certificateKey,
    certificateFingerprint: "b".repeat(64), sourceKey, sourceSha256,
    sourceByteLength: 12_000, sourceEtag: `"${"c".repeat(32)}"`,
    sourceLastModifiedAt: now - 100_000,
    copyKey: releasedFinalVideoKey(keyPrefix, "run-a", publicAt, sourceSha256),
    claimId: "22222222-2222-2222-2222-222222222222" };
  assert.equal((await f.invoke(beginFinalCopy, identity) as { status: string }).status, "active");
  await assert.rejects(f.invoke(beginFinalCopy, { ...identity,
    sourceKey: `${keyPrefix}runs/run-a/quiz-year/quiz-year-other.mp4` }), /conflicts/);
  const finishedAt = Date.now();
  assert.equal((await f.invoke(finishFinalCopy, { ...identity, copyEtag: `"${"d".repeat(32)}"`,
    copyLastModifiedAt: finishedAt, finishedAt,
    connectorId: "connector-a", connectorVersion: 4, observedAt: now,
    observation: { videoId, channelId: ytChannelId, privacyStatus: "public",
      uploadStatus: "processed", publishedAt: new Date(publicAt).toISOString() } }) as { status: string }).status, "finished");
});

test("slow copy requires fresh public state before PUT and again before finishing", async () => {
  const f = fixture();
  const row = await f.invoke(schedule, f.scheduleArgs);
  const now = Date.now();
  const publicAt = now - 60_000;
  const sourceSha256 = "a".repeat(64);
  await f.observe(row._id, now, { publishedAt: new Date(publicAt).toISOString() });
  const identity = { ownerId, retentionId: row._id, releaseAt: publicAt, certificateKey,
    certificateFingerprint: "b".repeat(64), sourceKey: `${keyPrefix}runs/run-a/final.mp4`,
    sourceSha256, sourceByteLength: 10_000, sourceEtag: `"${"c".repeat(32)}"`,
    sourceLastModifiedAt: now - 120_000,
    copyKey: releasedFinalVideoKey(keyPrefix, "run-a", publicAt, sourceSha256),
    claimId: "33333333-3333-3333-3333-333333333333" };
  await f.invoke(beginFinalCopy, identity);
  const later = now + 10 * 60_000;
  let clockNow = later;
  const clock = mock.method(Date, "now", () => clockNow);
  try {
    const privateObservation = { videoId, channelId: ytChannelId, privacyStatus: "private",
      uploadStatus: "processed", publishedAt: new Date(publicAt).toISOString() };
    await f.observe(row._id, later, privateObservation);
    const proof = { ownerId, retentionId: row._id, releaseAt: publicAt,
      copyKey: identity.copyKey, claimId: identity.claimId, connectorId: "connector-a",
      connectorVersion: 4, observedAt: later, observation: privateObservation };
    await assert.rejects(f.invoke(authorizeFinalCopyWrite, proof), /fresh exact public/);
    const publicObservation = { ...privateObservation, privacyStatus: "public" };
    clockNow = later + 1;
    await f.observe(row._id, later + 1, publicObservation);
    const authorized = await f.invoke<{ expiresAt: number }>(authorizeFinalCopyWrite, {
      ...proof, observedAt: later + 1, observation: publicObservation });
    assert.ok(authorized.expiresAt > later);
    await f.db.patch("channel-a", { locked: true });
    await assert.rejects(f.invoke(finishFinalCopy, { ...identity,
      connectorId: "connector-a", connectorVersion: 4, observedAt: later + 1,
      observation: publicObservation, copyEtag: `"${"d".repeat(32)}"`,
      copyLastModifiedAt: later, finishedAt: later + 1 }), /fresh exact public/);
    await f.db.patch("channel-a", { locked: false });
    clockNow = later + 2;
    await f.observe(row._id, later + 2, privateObservation);
    await assert.rejects(f.invoke(finishFinalCopy, { ...identity,
      connectorId: "connector-a", connectorVersion: 4, observedAt: later + 2,
      observation: privateObservation, copyEtag: `"${"d".repeat(32)}"`,
      copyLastModifiedAt: later, finishedAt: later + 2 }), /fresh exact public/);
    assert.equal(f.db.rows("releasedFinalMasters")[0].status, "active");
  } finally { clock.mock.restore(); }
});

test("copy checks survive completed cleanup and accept a later public generation", async () => {
  const f = fixture();
  const row = await f.invoke(schedule, f.scheduleArgs);
  const now = Date.now();
  const oldPublicAt = now - 20 * 86_400_000;
  await f.observe(row._id, now, { publishedAt: new Date(oldPublicAt).toISOString() });
  const claimed = await f.claim(now);
  assert.ok(claimed);
  await f.invoke(complete, { ownerId, retentionId: row._id, leaseToken: "a".repeat(64),
    completedAt: now, removedObjects: 0, retainedObjectCount: 1,
    retainedReleaseEvidence: [certificateKey] });
  assert.equal(row.status, "completed");
  assert.ok(await f.invoke(finalCandidate, { ownerId, retentionId: row._id, now }),
    "an unfinished copy remains eligible after fourteen-day cleanup completes");
  const later = now + RUN_ARTIFACT_RELEASE_CHECK_MS + 1;
  const checks = await f.invoke<Row[]>(listFinalCopyChecks, { ownerId, now: later });
  assert.deepEqual(checks.map((check) => check.retentionId), [row._id]);
  const newPublicAt = later - 60_000;
  let clockNow = later;
  const clock = mock.method(Date, "now", () => clockNow);
  try {
    await f.observe(row._id, later, { publishedAt: new Date(oldPublicAt).toISOString() });
    assert.ok(await f.invoke(finalCandidate, { ownerId, retentionId: row._id, now: later }),
      "the same release retries after cleanup completion");
    clockNow = later + 1;
    await f.observe(row._id, later + 1, { publishedAt: new Date(newPublicAt).toISOString() });
    assert.equal(row.status, "completed");
    assert.equal(row.releaseAt, newPublicAt);
    assert.ok(await f.invoke(finalCandidate, { ownerId, retentionId: row._id, now: later + 1 }));
  } finally { clock.mock.restore(); }
});

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

test("claimDue reuses the channel read across candidates in one bounded claim", async () => {
  const f = fixture();
  const secondCertificateKey = `${keyPrefix}runs/run-b/release.json`;
  f.db.seed("runs", "run-b", {
    ownerId, channelId: "channel-a", youtubeVideoId: videoId,
    releaseEvidenceStatus: "release_evidence_recorded",
    releaseEvidenceCertificateKey: secondCertificateKey,
  });
  const first = await f.invoke<Row>(schedule, f.scheduleArgs);
  const second = await f.invoke<Row>(schedule, {
    ...f.scheduleArgs, runId: "run-b", certificateKey: secondCertificateKey,
  });
  const due = uploadedAt + 86_400_000 + RUN_ARTIFACT_RETENTION_MS;
  await f.observe(first._id, due);
  await f.observe(second._id, due);
  // Force the first same-channel candidate through the identity rejection
  // path so claimDue has to inspect the next candidate as well.
  await f.db.patch(first._id, { releaseVideoId: "wrong-video" });
  f.db.getCalls.clear();

  const claimed = await f.claim(due);
  assert.equal(claimed?._id, second._id);
  assert.equal(f.db.getCalls.get("channel-a"), 1);
  assert.equal(f.db.getCalls.get("run-a"), 1);
  assert.equal(f.db.getCalls.get("run-b"), 1);
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

test("a channel locked by its owner cannot enter destructive artifact cleanup", async () => {
  const f = fixture(); const row = await f.invoke(schedule, f.scheduleArgs);
  const due = uploadedAt + RUN_ARTIFACT_RETENTION_MS * 2;
  await f.observe(row._id, due);
  await f.db.patch("channel-a", { locked: true });
  assert.equal(await f.claim(due), null);
  assert.equal(row.attempts, 0, "a locked channel must not consume a cleanup attempt");
});

test("fresh post-verification authorization does not extend a lease or rewrite identical evidence", async () => {
  const f = fixture(); const row = await f.invoke(schedule, f.scheduleArgs);
  const due = uploadedAt + RUN_ARTIFACT_RETENTION_MS * 2;
  await f.observe(row._id, due); await f.claim(due);
  const leaseEnd = Number(row.leaseExpiresAt);
  // Simulate byte hashing which outlives the initial five-minute observation.
  const now = due + 10 * 60_000;
  const clock = mock.method(Date, "now", () => now);
  const writes = mock.method(f.db, "patch");
  try {
    const args = deletionArgs(row, now);
    const grant = await f.invoke<{ expiresAt: number }>(authorizeDeletion, args);
    assert.equal(grant.expiresAt, now + RUN_ARTIFACT_RELEASE_OBSERVATION_MAX_AGE_MS);
    assert.equal(row.releaseObservationAt, now);
    assert.equal(row.leaseExpiresAt, leaseEnd);
    assert.equal(row.status, "processing");
    assert.equal(writes.mock.callCount(), 1);
    assert.deepEqual(await f.invoke(authorizeDeletion, args), grant);
    assert.equal(writes.mock.callCount(), 1, "same evidence is reauthorized without another row write");
  } finally { clock.mock.restore(); writes.mock.restore(); }
});

test("destructive authorization rejects every revoked ownership/lease/identity boundary", async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["channel-a", { locked: true }], ["channel-a", { ownerId: "other" }], ["channel-a", { slug: "other" }],
    ["run-a", { ownerId: "other" }], ["run-a", { channelId: "other" }],
    ["run-a", { youtubeVideoId: "other-video" }], ["run-a", { releaseEvidenceStatus: "legacy_unverified" }],
    ["run-a", { releaseEvidenceCertificateKey: "other-key" }],
    ["connector-a", { ownerId: "other" }], ["connector-a", { channelId: "other" }],
    ["connector-a", { status: "revoked" }], ["connector-a", { tokenVersion: 5 }],
    ["connector-a", { ytChannelId: "UC-other" }],
    ["retention", { leaseExpiresAt: 0 }], ["retention", { leaseExpiresAt: uploadedAt + RUN_ARTIFACT_RETENTION_MS * 2 }],
    ["retention", { leaseExpiresAt: NaN }], ["retention", { leaseToken: "b".repeat(64) }],
    ["retention", { status: "pending" }], ["retention", { ownerId: "other" }],
    ["retention", { keyPrefix: "owner/other/channel/other/" }],
    ["retention", { keepNames: ["changed.mp4"] }], ["retention", { additionalCertificateKeys: ["new-proof"] }],
  ];
  const now = uploadedAt + RUN_ARTIFACT_RETENTION_MS * 2;
  const clock = mock.method(Date, "now", () => now);
  try {
    for (const [target, patch] of cases) {
      const f = fixture(); const row = await f.invoke(schedule, f.scheduleArgs);
      await f.observe(row._id, now); await f.claim(now);
      const args = deletionArgs(row, now);
      await f.db.patch(target === "retention" ? row._id : target, patch);
      const before = JSON.stringify(row);
      await assert.rejects(f.invoke(authorizeDeletion, args), /deletion|locked|Studio resource access denied/);
      assert.equal(JSON.stringify(row), before, "rejection must not extend or refresh the worker's authority");
    }
  } finally { clock.mock.restore(); }
});

test("authorization requires current public/processed release and rejects stale, future or shortened retention", async () => {
  const now = uploadedAt + RUN_ARTIFACT_RETENTION_MS * 2;
  const clock = mock.method(Date, "now", () => now);
  try {
    const f = fixture(); const row = await f.invoke(schedule, f.scheduleArgs);
    await f.observe(row._id, now); await f.claim(now);
    const args = deletionArgs(row, now);
    const invalid = [
      { observation: null },
      { observation: { ...args.observation, privacyStatus: "private" } },
      { observation: { ...args.observation, privacyStatus: "unlisted" } },
      { observation: { ...args.observation, uploadStatus: "failed" } },
      { observation: { ...args.observation, videoId: "other" } },
      { observation: { ...args.observation, channelId: "other" } },
      { observation: { ...args.observation, publishedAt: new Date(now - 86_400_000).toISOString() } },
      { observedAt: now - RUN_ARTIFACT_RELEASE_OBSERVATION_MAX_AGE_MS - 1 },
      { observedAt: now + 1 }, { observedAt: NaN },
    ];
    for (const change of invalid) await assert.rejects(f.invoke(authorizeDeletion, { ...args, ...change }), /deletion|timestamp/);
    const ownerContext = { ...f.ctx, auth: { getUserIdentity: async () => ({
      role: "owner", owner_id: ownerId, subject: ownerId,
    }) } };
    await assert.rejects((authorizeDeletion as unknown as {
      _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
    })._handler(ownerContext, args), /service identity/);
  } finally { clock.mock.restore(); }
});

test("missing records and non-service identities cannot authorize destructive cleanup", async () => {
  const now = uploadedAt + RUN_ARTIFACT_RETENTION_MS * 2;
  const clock = mock.method(Date, "now", () => now);
  try {
    for (const [table, id] of [["channels", "channel-a"], ["runs", "run-a"],
      ["youtubeAuth", "connector-a"], ["runArtifactRetentions", "retention"]]) {
      const f = fixture(); const row = await f.invoke(schedule, f.scheduleArgs);
      await f.observe(row._id, now); await f.claim(now);
      const args = deletionArgs(row, now);
      f.db.tables.get(table)!.delete(id === "retention" ? row._id : id);
      const writes = mock.method(f.db, "patch");
      try {
        await assert.rejects(f.invoke(authorizeDeletion, args));
        assert.equal(writes.mock.callCount(), 0, `missing ${table} must not refresh authority`);
      } finally { writes.mock.restore(); }
    }
    const f = fixture(); const row = await f.invoke(schedule, f.scheduleArgs);
    await f.observe(row._id, now); await f.claim(now);
    for (const identity of [null, { role: "viewer", owner_id: ownerId, subject: "viewer" },
      { role: "service", owner_id: "other-owner", subject: "service:youtube-studio-ai" }]) {
      await assert.rejects((authorizeDeletion as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      })._handler({ ...f.ctx, auth: { getUserIdentity: async () => identity } }, deletionArgs(row, now)));
    }
  } finally { clock.mock.restore(); }
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
