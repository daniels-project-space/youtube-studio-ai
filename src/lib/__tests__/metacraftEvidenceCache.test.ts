import assert from "node:assert/strict";
import {
  clearMetacraftEvidenceCache,
  fetchCompetitorTitles,
  youtubeSuggest,
} from "@/lib/metacraft";

const originalFetch = globalThis.fetch;
const calls: string[] = [];
process.env.YOUTUBE_DATA_API_KEY = "metacraft-evidence-cache-test";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function main(): Promise<void> {
  clearMetacraftEvidenceCache();
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("https://suggestqueries.google.com/")) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return response(["history", ["history secrets", "history explained"]]);
    }
    if (url.includes("/search?")) {
      return response({ items: [{ id: { videoId: "one" } }, { id: { videoId: "two" } }] });
    }
    if (url.includes("/videos?")) {
      return response({
        items: [
          { id: "one", snippet: { title: "History Title One" }, statistics: { viewCount: "200" } },
          { id: "two", snippet: { title: "History Title Two" }, statistics: { viewCount: "100" } },
        ],
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const [first, joined] = await Promise.all([
    youtubeSuggest(" History   "),
    youtubeSuggest("history"),
  ]);
  assert.deepEqual(first, ["history secrets", "history explained"]);
  assert.deepEqual(joined, first);
  assert.equal(
    calls.filter((url) => url.startsWith("https://suggestqueries.google.com/")).length,
    1,
    "concurrent equivalent autocomplete seeds must share one request",
  );

  first.push("caller mutation must not poison the cache");
  assert.deepEqual(await youtubeSuggest("HISTORY"), ["history secrets", "history explained"]);
  assert.equal(
    calls.filter((url) => url.startsWith("https://suggestqueries.google.com/")).length,
    1,
    "a fresh equivalent autocomplete call must hit the short-lived cache",
  );

  const [competitors, competitorJoin] = await Promise.all([
    fetchCompetitorTitles(" World   History "),
    fetchCompetitorTitles("world history"),
  ]);
  assert.deepEqual(competitors, [
    { title: "History Title One", views: 200 },
    { title: "History Title Two", views: 100 },
  ]);
  assert.deepEqual(competitorJoin, competitors);
  assert.equal(
    calls.filter((url) => url.includes("www.googleapis.com/youtube/v3/search?")).length,
    1,
    "concurrent equivalent competitor seeds must share one search request",
  );
  competitors[0].title = "caller mutation must not poison the cache";
  assert.equal((await fetchCompetitorTitles("WORLD HISTORY"))[0]?.title, "History Title One");
  assert.equal(
    calls.filter((url) => url.includes("www.googleapis.com/youtube/v3/search?")).length,
    1,
    "cached competitor research must be reusable without another YouTube call",
  );

  clearMetacraftEvidenceCache();
  let failed = true;
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    if (failed) {
      failed = false;
      return response({ error: "temporary" }, 503);
    }
    return response(["history", ["retry succeeds"]]);
  };
  assert.deepEqual(await youtubeSuggest("retryable seed"), []);
  assert.deepEqual(await youtubeSuggest("retryable seed"), ["retry succeeds"]);
  assert.equal(
    calls.filter((url) => url.includes("retryable%20seed")).length,
    2,
    "failed evidence must not be cached and must remain retryable",
  );

  globalThis.fetch = originalFetch;
  delete process.env.YOUTUBE_DATA_API_KEY;
  console.log("METACRAFT EVIDENCE CACHE PASS");
}

main().catch((error) => {
  globalThis.fetch = originalFetch;
  delete process.env.YOUTUBE_DATA_API_KEY;
  console.error(error);
  process.exit(1);
});
