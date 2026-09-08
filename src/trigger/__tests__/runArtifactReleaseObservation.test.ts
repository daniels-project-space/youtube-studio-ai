import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  fetchRunArtifactReleaseObservations,
  reconcileRunArtifactReleaseChecks,
  type RunArtifactObservedRelease,
  type RunArtifactReleaseCheck,
} from "@/trigger/runArtifactRetentionSweeper";

const videoId = "abcdefghijk";
const secondId = "lmnopqrstuv";
const channelId = "channel-a" as Id<"channels">;
const connectorId = "connector-a" as Id<"youtubeAuth">;
const publicVideo = {
  videoId, channelId: "UC-test", privacyStatus: "public", uploadStatus: "processed",
  publishedAt: "2026-09-01T00:00:00Z",
};

test("provider reads deduplicate up to fifty video IDs and request only release fields", async () => {
  let calls = 0;
  const videos = await fetchRunArtifactReleaseObservations({
    accessToken: "test-token", videoIds: [videoId, secondId, videoId],
    fetchImpl: async (url, init) => {
      calls++;
      const request = new URL(String(url));
      assert.equal(request.origin, "https://www.googleapis.com");
      assert.equal(request.searchParams.get("id"), `${videoId},${secondId}`);
      assert.equal(request.searchParams.get("part"), "snippet,status");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-token");
      assert.match(request.searchParams.get("fields")!, /publishedAt/);
      assert.equal(init?.method, undefined, "lookup must never issue writes");
      return Response.json({ items: [{
        id: videoId, snippet: { channelId: "UC-test", publishedAt: publicVideo.publishedAt },
        status: { privacyStatus: "public", uploadStatus: "processed" },
      }] });
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(videos.get(videoId), publicVideo);
  assert.equal(videos.get(secondId), undefined, "inaccessible videos are not fabricated");
});

test("bad or missing provider responses cannot produce release proof", async () => {
  for (const response of [
    new Response("unavailable", { status: 503 }),
    new Response("forbidden", { status: 403 }),
    Response.json({}), Response.json({ items: [{ id: "differentid" }] }),
    Response.json({ items: [{ id: videoId }, { id: videoId }] }),
  ]) {
    await assert.rejects(fetchRunArtifactReleaseObservations({
      accessToken: "test-token", videoIds: [videoId], fetchImpl: async () => response,
    }), /observation/);
  }
  await assert.rejects(fetchRunArtifactReleaseObservations({
    accessToken: "test-token", videoIds: ["../wrong"],
    fetchImpl: async () => { throw new Error("must validate before calling provider"); },
  }), /exact video IDs/);
});

test("channel grouping uses one connector read per channel and records missing/error outcomes", async () => {
  const check = (suffix: string, channel: string, video?: string): RunArtifactReleaseCheck => ({
    retentionId: `ret-${suffix}` as Id<"runArtifactRetentions">,
    runId: `run-${suffix}` as Id<"runs">,
    channelId: channel as Id<"channels">,
    ...(video ? { videoId: video } : {}),
  });
  const checks = [
    check("a", channelId, videoId), check("b", channelId, secondId),
    check("c", "channel-b", videoId), check("d", "channel-c"),
  ];
  let reads = 0;
  const records: RunArtifactObservedRelease[] = [];
  const result = await reconcileRunArtifactReleaseChecks({
    checks,
    now: () => 1_800_000_000_000,
    observeChannel: async (id, ids) => {
      reads++;
      if (id !== channelId) throw new Error("provider unavailable");
      assert.deepEqual(ids, [videoId, secondId]);
      return { connectorId, connectorVersion: 7, videos: new Map([[videoId, publicVideo]]) };
    },
    record: async (rows, observedAt) => {
      assert.equal(observedAt, 1_800_000_000_000);
      records.push(...rows);
      return { confirmed: rows.filter((row) => row.observation !== null).length,
        deferred: rows.filter((row) => row.observation === null).length };
    },
  });
  assert.equal(reads, 2, "missing video IDs do not consume provider calls");
  assert.deepEqual(result, { confirmed: 1, deferred: 3 });
  assert.equal(records[0].connectorVersion, 7);
  assert.equal(records[1].observation, null);
  assert.match(records[2].error!, /provider unavailable/);
  assert.match(records[3].error!, /no YouTube video ID/);
});

test("failed observation persistence aborts the caller before cleanup can begin", async () => {
  await assert.rejects(reconcileRunArtifactReleaseChecks({
    checks: [{ retentionId: "ret-a" as Id<"runArtifactRetentions">,
      runId: "run-a" as Id<"runs">, channelId, videoId }],
    observeChannel: async () => ({ connectorId, connectorVersion: 1, videos: new Map([[videoId, publicVideo]]) }),
    record: async () => { throw new Error("durable write unavailable"); },
  }), /durable write unavailable/);
});
