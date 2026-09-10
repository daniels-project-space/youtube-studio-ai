import assert from "node:assert/strict";
import {
  clearMetacraftEvidenceCache,
  fetchCompetitorTitles,
  youtubeSuggest,
} from "@/lib/metacraft";
import { fetchNicheOutliers, clearOutlierEvidenceCache } from "@/lib/outliers";
import { fetchRedditTrends, clearTrendEvidenceCache } from "@/lib/trends";
import { createPublicEvidenceCache, normalizeEvidenceKey } from "@/lib/publicEvidenceCache";

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
  outliersA[0].title = "caller mutation";
  assert.equal((await fetchNicheOutliers("WORLD HISTORY"))[0]?.title, "History Outlier");

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
