import assert from "node:assert/strict";
import test from "node:test";
import { getRunMediaPresentation, getVideoDetail, listVideos } from "../../../convex/videos";
import { listForRun } from "../../../convex/assets";
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
import {
  FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  createFinalMasterReleaseCertificate,
  createFinalMasterReleaseCertificateReference,
  finalMasterReleaseCertificateKey,
  visualReviewReleaseReceiptKey,
} from "../finalMasterReleaseCertificate";

type Row = Record<string, unknown> & { _id: string; _creationTime: number };
const ownerId = "owner-test";
const channelId = "channel-test";
const sourceRunId = "source-run";
const currentKey = "owner/owner-test/channel/test/runs/replacement/thumbnail.jpg";
const videoKey = "owner/owner-test/channel/test/runs/source-run/final.mp4";
const oldKey = "owner/owner-test/channel/test/runs/source-run/thumbnail.jpg";
type RunMediaPresentation = {
  assets: RunMediaAsset[];
  currentThumbnail: Omit<RunCurrentThumbnail, "title">;
};
type IndexedRead = { table: string; index: string; filters: Array<[string, unknown]>; rows: number };

function fixture(music = false) {
  const reads: IndexedRead[] = [];
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
      let index = "";
      const matches = () => (rows[table] ?? []).filter((r) => filters.every(([field, value]) => r[field] === value))
        .sort((a, b) => (a._creationTime - b._creationTime) * (direction === "desc" ? -1 : 1));
      const read = (first = false) => {
        const result = first ? matches().slice(0, 1) : matches();
        reads.push({ table, index, filters: [...filters], rows: result.length });
        return result;
      };
      const query = {
        withIndex(name: string, build: (range: { eq(field: string, value: unknown): unknown }) => unknown) {
          index = name;
          const range = { eq(field: string, value: unknown) { filters.push([field, value]); return range; } };
          build(range); return query;
        },
        order(value: string) { direction = value; return query; },
        async collect() { return read(); },
        async first() { return read(true)[0] ?? null; },
        async *[Symbol.asyncIterator]() { yield* read(); },
      };
      return query;
    },
  };
  const context = { db, auth: { getUserIdentity: async () => ({ role: "viewer", owner_id: ownerId, subject: `viewer:${ownerId}` }) } };
  const invoke = async <T>(definition: unknown, args: unknown): Promise<T> =>
    (definition as { _handler(ctx: unknown, args: unknown): Promise<T> })._handler(context, args);
  const detail = () => invoke<RunCurrentThumbnail>(getVideoDetail, { runId: sourceRunId });
  const media = () => invoke<RunMediaPresentation>(getRunMediaPresentation, { runId: sourceRunId });
  const oldAssets = () => invoke<RunMediaAsset[]>(listForRun, { runId: sourceRunId });
  const library = () => invoke<Array<RunCurrentThumbnail & { _id: string }>>(listVideos, { ownerId, limit: 10 });
  const originalAssets = () => rows.assets.filter((a) => a.runId === sourceRunId) as RunMediaAsset[];
  return { rows, reads, detail, media, oldAssets, library, originalAssets };
}

function thumbnailFields(detail: RunCurrentThumbnail) {
  return {
    thumbnailKey: detail.thumbnailKey,
    ...(detail.thumbnailPresentation ? { thumbnailPresentation: detail.thumbnailPresentation } : {}),
    videoKey: detail.videoKey,
  };
}

test("viewer-facing detail and Library handlers choose the same current candidate without rewriting historical assets", async () => {
  const f = fixture();
  const original = structuredClone(f.rows.assets);
  const detail = await f.detail();
  const media = await f.media();
  const library = (await f.library()).find((r) => r._id === sourceRunId)!;
  assert.equal(detail.thumbnailKey, currentKey);
  assert.equal(detail.thumbnailKey, library.thumbnailKey);
  assert.equal(detail.thumbnailPresentation, "current_golden_candidate");
  assert.deepEqual(media.currentThumbnail, thumbnailFields(detail));
  assert.deepEqual(media.assets, f.originalAssets(), "combined response preserves every original asset and its metadata");
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

test("unproven, unfinished or wrongly bound replacements cannot override the canonical source", async () => {
  for (const mode of ["unproven", "running", "failed", "wrong-owner", "wrong-channel"] as const) {
    const f = fixture();
    if (mode === "unproven") f.rows.assets[2]!.meta = { publishable: true };
    else if (mode === "wrong-owner") f.rows.assets[2]!.ownerId = "another-owner";
    else if (mode === "wrong-channel") f.rows.assets[2]!.channelId = "another-channel";
    else f.rows.runs[1]!.status = mode;
    const detail = await f.detail();
    assert.equal(detail.thumbnailKey, oldKey);
    assert.deepEqual((await f.media()).currentThumbnail, thumbnailFields(detail));
    assert.equal((await f.library())[0]?.thumbnailKey, oldKey);
    assert.deepEqual(partitionRunThumbnailAssets(f.originalAssets(), detail).historicalThumbnails, [], "the selected retained image is not duplicated as history");
  }
});

test("Lo-Fi pending selects the real master frame and never the old generic thumbnail", async () => {
  const f = fixture(true);
  const detail = await f.detail();
  assert.equal(detail.thumbnailKey, null);
  assert.equal(detail.thumbnailPresentation, "lofi_frame_pending");
  assert.deepEqual((await f.media()).currentThumbnail, thumbnailFields(detail));
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
  assert.deepEqual((await f.media()).currentThumbnail, thumbnailFields(detail));
  assert.equal((await f.library())[0]?.thumbnailKey, currentKey);
  assert.deepEqual(runCurrentThumbnailSource(detail), { assetKey: currentKey });
});

test("the viewer detail query still enforces run ownership", async () => {
  const f = fixture();
  f.rows.runs[0]!.ownerId = "another-owner";
  await assert.rejects(f.detail(), /Studio resource access denied/);
  await assert.rejects(f.media(), /Studio resource access denied/);
  assert.equal(f.reads.length, 0, "denied viewer never reaches media/thumbnail indexed reads");
});

test("missing runs are denied equally and retained runs with no media have truthful empty projections", async () => {
  const missing = fixture();
  missing.rows.runs = missing.rows.runs.filter((run) => run._id !== sourceRunId);
  await assert.rejects(missing.detail(), /Studio resource not found/);
  await assert.rejects(missing.media(), /Studio resource not found/);
  assert.equal(missing.reads.length, 0);
  for (const music of [false, true]) {
    const empty = fixture(music);
    empty.rows.assets = [];
    empty.rows.runs = empty.rows.runs.slice(0, 1);
    const detail = await empty.detail();
    const media = await empty.media();
    assert.deepEqual(media.assets, []);
    assert.deepEqual(media.currentThumbnail, thumbnailFields(detail));
    assert.equal(media.currentThumbnail.thumbnailKey, null);
    assert.equal(media.currentThumbnail.videoKey, null);
  }
});

function sealMaster(f: ReturnType<typeof fixture>) {
  const prefix = "owner/owner-test/channel/test/";
  const sealedKey = `${prefix}runs/${sourceRunId}/sealed-final.mp4`;
  const manifestKey = `${prefix}runs/${sourceRunId}/visual-review/review/manifest.json`;
  const frames = [{ r2Key: `${prefix}runs/${sourceRunId}/visual-review/review/frame.jpg`, contentSha256: "d".repeat(64), byteLength: 100 }];
  const certificate = createFinalMasterReleaseCertificate({
    version: FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
    finalMaster: { r2Key: sealedKey, sha256: "a".repeat(64), byteLength: 2048, durationSec: 30 },
    visualReview: {
      evidenceManifestKey: manifestKey, evidenceFrameKeys: frames.map((frame) => frame.r2Key), evidenceFrameArtifacts: frames,
      receiptKey: visualReviewReleaseReceiptKey(prefix, sourceRunId, "c".repeat(64)),
      reviewFingerprint: "review", reviewReceiptVersion: "visual-review-receipt/v1",
      reviewReceiptFingerprint: "b".repeat(64), releaseReceiptFingerprint: "c".repeat(64),
    },
  });
  const certificateKey = finalMasterReleaseCertificateKey(prefix, sourceRunId, certificate.certificateFingerprint);
  const reference = createFinalMasterReleaseCertificateReference({ keyPrefix: prefix, runId: sourceRunId, certificateKey, certificate });
  f.rows.runs[0]!.releaseEvidenceStatus = "release_evidence_recorded";
  const qa = {
    _id: "qa", _creationTime: 4, runId: sourceRunId, block: "qa_visual", status: "ok",
    outputs: {
      qaPassed: true, finalMasterSha256: "a".repeat(64), reviewEvidence: { manifestKey, frames },
      reviewResult: { verdict: "pass", reviewReceiptVersion: "visual-review-receipt/v1", reviewReceiptFingerprint: "b".repeat(64) },
      reviewFingerprint: "review", reviewReceiptVersion: "visual-review-receipt/v1", reviewReceiptFingerprint: "b".repeat(64),
      finalMasterReleaseCertificateKey: certificateKey,
    },
  };
  f.rows.runStages.push(qa);
  f.rows.runArtifacts = [
    { key: "videoKey", type: "R2ObjectKey", producerModule: "timeline_assemble", persistence: "reference", payload: sealedKey },
    { key: "finalMasterReleaseCertificate", type: "FinalMasterReleaseCertificate", producerModule: "qa_visual", persistence: "summary" },
    { key: "finalMasterReleaseCertificateReference", type: "FinalMasterReleaseCertificateReference", producerModule: "qa_visual", persistence: "reference", payload: reference },
    { key: "finalMasterReleaseCertificateKey", type: "R2ObjectKey", producerModule: "qa_visual", persistence: "reference", payload: certificateKey },
  ].map((artifact, i) => ({ ...artifact, _id: `artifact-${i}`, _creationTime: i, runId: sourceRunId }));
  return { sealedKey, qa };
}

test("combined media retains the sealed master contract, including absent asset rows and corrupt certificates", async () => {
  const f = fixture();
  const { sealedKey, qa } = sealMaster(f);
  f.rows.assets.push({ _id: "sealed-video", _creationTime: 4, ownerId, channelId, runId: sourceRunId,
    kind: "video", r2Key: sealedKey, meta: { title: "Sealed title", fullMetadata: { preserved: true } } });
  const original = structuredClone(f.rows.assets);
  for (const withAsset of [true, false]) {
    if (!withAsset) f.rows.assets = f.rows.assets.filter((asset) => asset._id !== "sealed-video");
    f.reads.length = 0;
    const media = await f.media();
    assert.equal(media.currentThumbnail.videoKey, sealedKey, "certificate master wins even when registry video is missing");
    assert.deepEqual(media.assets, f.originalAssets());
    assert.equal(f.reads.length, 5, "sealed media adds exactly the existing QA/artifact lineage reads");
    assert.deepEqual(media.currentThumbnail, thumbnailFields(await f.detail()));
    assert.equal((await f.library()).find((row) => row._id === sourceRunId)?.videoKey, sealedKey);
  }
  assert.deepEqual(f.rows.assets, original.filter((asset) => asset._id !== "sealed-video"));
  qa.outputs.finalMasterSha256 = "f".repeat(64);
  const broken = await f.media();
  assert.equal(broken.currentThumbnail.videoKey, videoKey, "a stored green status cannot bypass failed certificate validation");
  assert.deepEqual(broken.currentThumbnail, thumbnailFields(await f.detail()));
  assert.equal((await f.library()).find((row) => row._id === sourceRunId)?.videoKey, videoKey);
});

test("LoFi verifies candidate frame provenance against the sealed master, never a different retained video", async () => {
  const f = fixture(true);
  const { sealedKey } = sealMaster(f);
  for (const sourceVideoKey of [videoKey, sealedKey]) {
    f.rows.assets[2]!.meta = { thumbnailCurrentCandidateEvidence: createLofiThumbnailCurrentCandidateEvidence({
      ownerId, channelId, runId: "replacement", r2Key: currentKey,
      artifactSha256: "a".repeat(64), providerRequestSha256: "b".repeat(64), providerResponseSha256: "c".repeat(64),
      sourceVideoKey, sourceFrameSha256: "d".repeat(64), sourceFrameTimeSec: 15, sourceWidth: 3840, sourceHeight: 2160,
    }) };
    const media = await f.media();
    assert.equal(media.currentThumbnail.videoKey, sealedKey);
    assert.equal(media.currentThumbnail.thumbnailKey, sourceVideoKey === sealedKey ? currentKey : null);
    assert.equal(media.currentThumbnail.thumbnailPresentation, sourceVideoKey === sealedKey ? "lofi_rendered_frame" : "lofi_frame_pending");
    assert.deepEqual(media.currentThumbnail, thumbnailFields(await f.detail()));
    assert.equal((await f.library()).find((row) => row._id === sourceRunId)?.thumbnailKey, media.currentThumbnail.thumbnailKey);
  }
});

test("combined viewer response removes duplicate asset reads and all script/SEO-only probes and fields", async () => {
  const f = fixture();
  const narration = "A source-bound narration sentence. ".repeat(4000);
  f.rows.runStages[0]!.outputs = { title: "Taxes decoded", description: "Description ".repeat(200),
    tags: ["taxes"], pinnedComment: "A useful question", titleAlternate: "Tax rules", estimatedViews: 100, estimatedViewsSource: "fixture" };
  f.rows.runStages.push({ _id: "script", _creationTime: 1, runId: sourceRunId, block: "motion_comic", outputs: { narrationText: narration } });
  const old = { assets: await f.oldAssets(), detail: await f.detail() };
  const oldReads = f.reads.length;
  assert.equal(oldReads, 8, "old two-subscription path reads assets twice and probes three script routes plus metadata");
  assert.equal((old.detail as unknown as { script: string }).script, narration, "the on-demand Lightbox retains its full response");
  f.reads.length = 0;
  const combined = await f.media();
  assert.equal(f.reads.length, 3);
  assert.equal(f.reads.filter((read) => read.table === "assets" && read.filters.some(([key, value]) => key === "runId" && value === sourceRunId)).length, 1);
  assert.ok(f.reads.every((read) => read.table !== "runStages"), "thumbnail presentation cannot fetch metadata or narration stages");
  assert.deepEqual(Object.keys(combined).sort(), ["assets", "currentThumbnail"]);
  assert.deepEqual(Object.keys(combined.currentThumbnail).sort(), ["thumbnailKey", "thumbnailPresentation", "videoKey"]);
  assert.deepEqual(combined.assets, old.assets);
  assert.deepEqual(combined.currentThumbnail, thumbnailFields(old.detail));
  const oldChars = JSON.stringify(old).length;
  const newChars = JSON.stringify(combined).length;
  assert.ok(newChars < oldChars / 20, "full narration/SEO must not cross the thumbnail subscription boundary");
  console.log(JSON.stringify({ runMediaQueryComparison: { oldIndexedQueries: oldReads, combinedIndexedQueries: f.reads.length,
    oldResponseChars: oldChars, combinedResponseChars: newChars, fixture: "synthetic long-script fixture, not a live invoice" } }));
});
