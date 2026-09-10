import assert from "node:assert/strict";
import {
  clearMetacraftEvidenceCache,
  youtubeSuggest,
} from "@/lib/metacraft";
import { fetchNicheOutliers, clearOutlierEvidenceCache } from "@/lib/outliers";
import { fetchRedditTrends, clearTrendEvidenceCache } from "@/lib/trends";
import { createPublicEvidenceCache, normalizeEvidenceKey } from "@/lib/publicEvidenceCache";
import {
  clearYouTubeDataEvidenceCache,
  clearYouTubeDataMetrics,
  fetchVideoDetails,
  fetchVideoStats,
  fetchChannelStats,
  getYouTubeDataMetrics,
  searchVideoIds,
} from "@/lib/youtubeData";

const originalFetch = globalThis.fetch;
const originalYouTubeKey = process.env.YOUTUBE_DATA_API_KEY;
const calls: string[] = [];
process.env.YOUTUBE_DATA_API_KEY = "public-evidence-cache-test";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function main(): Promise<void> {
  assert.equal(normalizeEvidenceKey("  World   History "), "world history");
  const tiny = createPublicEvidenceCache<string>(1, 1);
  tiny.set("old", "value");
  await new Promise((resolve) => setTimeout(resolve, 3));
  assert.equal(tiny.get("old"), undefined, "expired evidence must not be served");
  tiny.set("one", "1");
  tiny.set("two", "2");
  assert.equal(tiny.get("one"), undefined, "the bounded cache must evict its oldest entry");
  assert.equal(tiny.get("two"), "2");

  clearMetacraftEvidenceCache();
  clearOutlierEvidenceCache();
  clearTrendEvidenceCache();
  clearYouTubeDataEvidenceCache();
  clearYouTubeDataMetrics();
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("https://suggestqueries.google.com/")) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return response(["history", ["history secrets"]]);
    }
    if (url.startsWith("https://www.reddit.com/")) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const subreddit = url.split("/r/")[1]?.split("/")[0] ?? "unknown";
      return response({ data: { children: [{ data: { title: `${subreddit} signal`, score: 500 } }] } });
    }
    if (url.includes("/search?")) {
      return response({ items: [{ id: { videoId: "one" } }] });
    }
    if (url.includes("/videos?")) {
      return response({
        items: [{
          id: "one",
          snippet: {
            title: "History Outlier",
            channelId: "channel-one",
            channelTitle: "History Channel",
            publishedAt: "2026-09-01T00:00:00Z",
            thumbnails: {},
          },
          statistics: { viewCount: "2000" },
          contentDetails: { duration: "PT5M" },
        }],
      });
    }
    if (url.includes("/channels?")) {
      return response({ items: [{ id: "channel-one", statistics: { subscriberCount: "100" } }] });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const [suggestA, suggestB] = await Promise.all([
    youtubeSuggest(" History "),
    youtubeSuggest("history"),
  ]);
  assert.deepEqual(suggestA, suggestB);
  assert.equal(calls.filter((url) => url.startsWith("https://suggestqueries.google.com/")).length, 1);

  const [trendsA, trendsB] = await Promise.all([
    fetchRedditTrends("History"),
    fetchRedditTrends(" history "),
  ]);
  assert.deepEqual(trendsA, trendsB);
  assert.equal(calls.filter((url) => url.startsWith("https://www.reddit.com/")).length, 2);
  trendsA[0].title = "caller mutation";
  assert.notEqual((await fetchRedditTrends("HISTORY"))[0]?.title, "caller mutation");
  assert.equal(calls.filter((url) => url.startsWith("https://www.reddit.com/")).length, 2);

  const [outliersA, outliersB] = await Promise.all([
    fetchNicheOutliers(" World   History "),
    fetchNicheOutliers("world history"),
  ]);
  assert.deepEqual(outliersA, outliersB);
  assert.equal(calls.filter((url) => url.includes("www.googleapis.com/youtube/v3/search?")).length, 1);
  assert.equal(calls.filter((url) => url.includes("www.googleapis.com/youtube/v3/videos?")).length, 1);
  assert.equal(calls.filter((url) => url.includes("www.googleapis.com/youtube/v3/channels?")).length, 1);
  const outlierSearchUrl = calls.find((url) => url.includes("www.googleapis.com/youtube/v3/search?"));
  assert.ok(outlierSearchUrl);
  assert.equal(new URL(outlierSearchUrl).searchParams.get("part"), "snippet");
  assert.equal(new URL(outlierSearchUrl).searchParams.get("fields"), "items(id/videoId)");
  outliersA[0].title = "caller mutation";
  assert.equal((await fetchNicheOutliers("WORLD HISTORY"))[0]?.title, "History Outlier");
  clearYouTubeDataEvidenceCache();
  clearYouTubeDataMetrics();

  const [sharedSearchA, sharedSearchB] = await Promise.all([
    searchVideoIds({ query: " Shared   research " }),
    searchVideoIds({ query: "shared research" }),
  ]);
  assert.deepEqual(sharedSearchA, sharedSearchB);
  assert.equal(
    calls.filter((url) => url.includes("www.googleapis.com/youtube/v3/search?")).length,
    2,
    "equivalent low-level YouTube searches must share one request across callers",
  );
  sharedSearchA.push("caller mutation");
  assert.deepEqual(await searchVideoIds({ query: "SHARED RESEARCH" }), ["one"]);

  const [sharedDetailsA, sharedDetailsB] = await Promise.all([
    fetchVideoDetails(["one"]),
    fetchVideoDetails(["one"]),
  ]);
  assert.deepEqual(sharedDetailsA, sharedDetailsB);
  assert.equal(
    calls.filter((url) => url.includes("www.googleapis.com/youtube/v3/videos?")).length,
    2,
    "equivalent low-level detail hydrations must share one request",
  );
  sharedDetailsA[0].tags.push("caller mutation");
  assert.deepEqual((await fetchVideoDetails(["one"]))[0]?.tags, []);
  const detailUrl = calls.find((url) => url.includes("www.googleapis.com/youtube/v3/videos?"));
  assert.ok(detailUrl);
  assert.equal(new URL(detailUrl).searchParams.get("part"), "snippet,contentDetails,statistics");
  assert.match(new URL(detailUrl).searchParams.get("fields") ?? "", /items\(id,snippet\(/);

  const stats = await fetchVideoStats([" one ", "one", "two"]);
  assert.equal(stats.length, 1);
  const statsUrl = calls.filter((url) => url.includes("www.googleapis.com/youtube/v3/videos?")).at(-1);
  assert.ok(statsUrl);
  assert.equal(new URL(statsUrl).searchParams.get("id"), "one,two");
  assert.equal(new URL(statsUrl).searchParams.get("fields"), "items(id,snippet(channelId),statistics(viewCount,likeCount,commentCount))");

  await fetchChannelStats([" channel-one ", "channel-one", ""]);
  const channelUrl = calls.filter((url) => url.includes("www.googleapis.com/youtube/v3/channels?")).at(-1);
  assert.ok(channelUrl);
  assert.equal(new URL(channelUrl).searchParams.get("id"), "channel-one");
  assert.equal(new URL(channelUrl).searchParams.get("fields"), "items(id,statistics(subscriberCount,viewCount,videoCount))");
  const metrics = getYouTubeDataMetrics();
  assert.deepEqual(metrics.search, { requests: 1, estimatedQuotaUnits: 1, cacheHits: 1, coalescedRequests: 1 });
  assert.deepEqual(metrics.videos, { requests: 2, estimatedQuotaUnits: 2, cacheHits: 1, coalescedRequests: 1 });
  assert.deepEqual(metrics.channels, { requests: 1, estimatedQuotaUnits: 1, cacheHits: 0, coalescedRequests: 0 });
  const metricsCopy = getYouTubeDataMetrics();
  metricsCopy.videos.requests = 999;
  assert.equal(getYouTubeDataMetrics().videos.requests, 2, "metrics snapshots must be defensive");

  clearTrendEvidenceCache();
  let redditAttempt = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (!url.startsWith("https://www.reddit.com/")) return response([]);
    redditAttempt++;
    return redditAttempt === 1 ? response({}, 503) : response({ data: { children: [{ data: { title: "retry signal", score: 500 } }] } });
  };
  const first = await fetchRedditTrends("history");
  const second = await fetchRedditTrends("history");
  assert.ok(first.length >= 0);
  assert.ok(second.length > 0, "a partial Reddit failure must remain retryable");
  assert.equal(redditAttempt, 4, "partial failure must not be cached; the second call retries both subs");

  clearOutlierEvidenceCache();
  let youtubeAttempt = 0;
  globalThis.fetch = async () => {
    youtubeAttempt++;
    return response({}, 503);
  };
  assert.deepEqual(await fetchNicheOutliers("retry history"), []);
  assert.deepEqual(await fetchNicheOutliers("retry history"), []);
  assert.equal(youtubeAttempt, 2, "failed outlier research must remain retryable");

  clearMetacraftEvidenceCache();
  let suggestAttempt = 0;
  globalThis.fetch = async () => {
    suggestAttempt++;
    return suggestAttempt === 1 ? response({}, 503) : response(["retry", ["retry succeeds"]]);
  };
  assert.deepEqual(await youtubeSuggest("retry history"), []);
  assert.deepEqual(await youtubeSuggest("retry history"), ["retry succeeds"]);
  assert.equal(suggestAttempt, 2, "failed autocomplete evidence must remain retryable");

  globalThis.fetch = originalFetch;
  if (originalYouTubeKey === undefined) delete process.env.YOUTUBE_DATA_API_KEY;
  else process.env.YOUTUBE_DATA_API_KEY = originalYouTubeKey;
  console.log("PUBLIC EVIDENCE CACHE PASS");
}

main().catch((error) => {
  globalThis.fetch = originalFetch;
  if (originalYouTubeKey === undefined) delete process.env.YOUTUBE_DATA_API_KEY;
  else process.env.YOUTUBE_DATA_API_KEY = originalYouTubeKey;
  console.error(error);
  process.exit(1);
});
