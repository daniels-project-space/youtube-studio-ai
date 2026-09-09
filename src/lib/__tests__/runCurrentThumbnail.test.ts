import assert from "node:assert/strict";
import test from "node:test";
import { getVideoDetail, listVideos } from "../../../convex/videos";
import {
  partitionRunThumbnailAssets,
  runCurrentThumbnailSource,
  type RunCurrentThumbnail,
  type RunMediaAsset,
} from "../runMediaWorkbench";
import {
  createLofiThumbnailCurrentCandidateEvidence,
  createThumbnailCurrentCandidateEvidence,
} from "../thumbnailRefreshInventory";

type Row = Record<string, unknown> & { _id: string; _creationTime: number };
const ownerId = "owner-test";
const channelId = "channel-test";
const sourceRunId = "source-run";
const currentKey = "owner/owner-test/channel/test/runs/replacement/thumbnail.jpg";
const videoKey = "owner/owner-test/channel/test/runs/source-run/final.mp4";
const oldKey = "owner/owner-test/channel/test/runs/source-run/thumbnail.jpg";

function fixture(music = false) {
  const rows: Record<string, Row[]> = {
    channels: [{ _id: channelId, _creationTime: 1, ownerId, name: "Test channel", slug: "test", family: music ? "music_loop" : "whiteboard" }],
    runs: [
      { _id: sourceRunId, _creationTime: 1, ownerId, channelId, status: "ok" },
      { _id: "replacement", _creationTime: 2, ownerId, channelId, status: "ok", finishedAt: 2, thumbnailRefreshSourceRunId: sourceRunId },
    ],
    assets: [
      { _id: "video", _creationTime: 1, ownerId, channelId, runId: sourceRunId, kind: "video", r2Key: videoKey },
      { _id: "old-thumbnail", _creationTime: 2, ownerId, channelId, runId: sourceRunId, kind: "thumbnail", r2Key: oldKey },
      { _id: "new-thumbnail", _creationTime: 3, ownerId, channelId, runId: "replacement", kind: "thumbnail", r2Key: currentKey,
        meta: { thumbnailCurrentCandidateEvidence: createThumbnailCurrentCandidateEvidence({
          ownerId, channelId, runId: "replacement", r2Key: currentKey,
          artifactSha256: "a".repeat(64), providerRequestSha256: "b".repeat(64), providerResponseSha256: "c".repeat(64),
        }) } },
    ],
    runStages: [{ _id: "metadata", _creationTime: 1, runId: sourceRunId, block: "metadata", outputs: { title: "Taxes decoded" } }],
    runArtifacts: [],
  };
  const db = {
    async get(id: string) { return Object.values(rows).flat().find((r) => r._id === id) ?? null; },
    normalizeId(table: string, id: string) { return rows[table]?.some((r) => r._id === id) ? id : null; },
    query(table: string) {
      const filters: Array<[string, unknown]> = [];
      let direction = "asc";
      const matches = () => (rows[table] ?? []).filter((r) => filters.every(([field, value]) => r[field] === value))
        .sort((a, b) => (a._creationTime - b._creationTime) * (direction === "desc" ? -1 : 1));
      const query = {
        withIndex(_name: string, build: (range: { eq(field: string, value: unknown): unknown }) => unknown) {
          const range = { eq(field: string, value: unknown) { filters.push([field, value]); return range; } };
          build(range); return query;
        },
        order(value: string) { direction = value; return query; },
        async collect() { return matches(); },
        async first() { return matches()[0] ?? null; },
        async *[Symbol.asyncIterator]() { yield* matches(); },
      };
      return query;
    },
  };
  const context = { db, auth: { getUserIdentity: async () => ({ role: "viewer", owner_id: ownerId, subject: `viewer:${ownerId}` }) } };
  const invoke = async <T>(definition: unknown, args: unknown): Promise<T> =>
    (definition as { _handler(ctx: unknown, args: unknown): Promise<T> })._handler(context, args);
  const detail = () => invoke<RunCurrentThumbnail>(getVideoDetail, { runId: sourceRunId });
  const library = () => invoke<Array<RunCurrentThumbnail & { _id: string }>>(listVideos, { ownerId, limit: 10 });
  const originalAssets = () => rows.assets.filter((a) => a.runId === sourceRunId) as RunMediaAsset[];
  return { rows, detail, library, originalAssets };
}

test("viewer-facing detail and Library handlers choose the same current candidate without rewriting historical assets", async () => {
  const f = fixture();
  const original = structuredClone(f.rows.assets);
  const detail = await f.detail();
  const library = (await f.library()).find((r) => r._id === sourceRunId)!;
  assert.equal(detail.thumbnailKey, currentKey);
  assert.equal(detail.thumbnailKey, library.thumbnailKey);
  assert.equal(detail.thumbnailPresentation, "current_golden_candidate");
  const projection = partitionRunThumbnailAssets(f.originalAssets(), detail);
  assert.deepEqual(projection.media.map((a) => a._id), ["video"]);
  assert.deepEqual(projection.historicalThumbnails.map((a) => a.r2Key), [oldKey]);
  assert.deepEqual(f.rows.assets, original, "presentation must not relabel or mutate retained artifacts");
});

test("pending hydration cannot expose the original image as the current preview", () => {
  const f = fixture();
  for (const current of [undefined, null]) {
    const projection = partitionRunThumbnailAssets(f.originalAssets(), current);
    assert.ok(projection.media.every((a) => a.kind !== "thumbnail"));
    assert.equal(projection.historicalThumbnails[0]?.r2Key, oldKey);
  }
});

test("a non-Lo-Fi missing image does not acquire a fabricated source-frame thumbnail", () => {
  assert.deepEqual(runCurrentThumbnailSource({ title: "No thumbnail", thumbnailKey: null, videoKey }), { assetKey: null });
});

test("completed unproven or running replacements cannot override the canonical source", async () => {
  for (const mode of ["unproven", "running"] as const) {
    const f = fixture();
    if (mode === "unproven") f.rows.assets[2]!.meta = { publishable: true };
    else f.rows.runs[1]!.status = "running";
    const detail = await f.detail();
    assert.equal(detail.thumbnailKey, oldKey);
    assert.equal((await f.library())[0]?.thumbnailKey, oldKey);
    assert.deepEqual(partitionRunThumbnailAssets(f.originalAssets(), detail).historicalThumbnails, [], "the selected retained image is not duplicated as history");
  }
});

test("Lo-Fi pending selects the real master frame and never the old generic thumbnail", async () => {
  const f = fixture(true);
  const detail = await f.detail();
  assert.equal(detail.thumbnailKey, null);
  assert.equal(detail.thumbnailPresentation, "lofi_frame_pending");
  assert.equal((await f.library())[0]?.thumbnailKey, null);
  assert.deepEqual(runCurrentThumbnailSource(detail), { assetKey: null, videoStillKey: videoKey });
  assert.equal(partitionRunThumbnailAssets(f.originalAssets(), detail).historicalThumbnails[0]?.r2Key, oldKey);
});

test("an exact Lo-Fi source-frame candidate hydrates identically in both handlers", async () => {
  const f = fixture(true);
  f.rows.assets[2]!.meta = { thumbnailCurrentCandidateEvidence: createLofiThumbnailCurrentCandidateEvidence({
    ownerId, channelId, runId: "replacement", r2Key: currentKey,
    artifactSha256: "a".repeat(64), providerRequestSha256: "b".repeat(64), providerResponseSha256: "c".repeat(64),
    sourceVideoKey: videoKey, sourceFrameSha256: "d".repeat(64), sourceFrameTimeSec: 15, sourceWidth: 3840, sourceHeight: 2160,
  }) };
  const detail = await f.detail();
  assert.equal(detail.thumbnailKey, currentKey);
  assert.equal(detail.thumbnailPresentation, "lofi_rendered_frame");
  assert.equal((await f.library())[0]?.thumbnailKey, currentKey);
  assert.deepEqual(runCurrentThumbnailSource(detail), { assetKey: currentKey });
});

test("the viewer detail query still enforces run ownership", async () => {
  const f = fixture();
  f.rows.runs[0]!.ownerId = "another-owner";
  await assert.rejects(f.detail(), /Studio resource access denied/);
});
