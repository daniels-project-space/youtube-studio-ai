import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { clearYouTubeDataEvidenceCache, fetchVideoDetails, fetchVideoStats, searchVideoIds } from "../youtubeData";
import { clearTrendEvidenceCache, fetchRedditTrends } from "../trends";
import { refreshAccessTokenGrant } from "../youtube";

async function main() {
  const originalFetch = globalThis.fetch, originalTimeout = AbortSignal.timeout;
  const envKeys = ["YOUTUBE_DATA_API_KEY", "YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"] as const;
  const environment = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  let mode = "healthy", closedStalls = 0, received = 0;
  const calls: Array<{ path: string; signal: AbortSignal }> = [];
  const deadlines: number[] = [];
  const server = createServer((request, response) => {
    received++;
    const path = new URL(request.url!, "http://fixture.invalid").pathname;
    const stall = mode === "headers" || mode === "body" || (mode === "oauth" && path === "/token") ||
      (mode === "reddit" && path.includes("/r/history/"));
    if (stall) {
      response.on("close", () => { closedStalls++; });
      if (mode !== "headers") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.write('{"incomplete":');
      }
      return;
    }
    const body = path === "/token" ? { access_token: "synthetic-access", scope: "youtube.readonly", expires_in: 3600 }
      : path.endsWith("/search") ? { items: [{ id: { videoId: "video-one" } }] }
      : path.includes("/r/") ? { data: { children: [{ data: { title: "Synthetic public signal", score: 300 } }] } }
      : { items: [{ id: "video-one", snippet: { title: "Synthetic title", channelId: "channel-one" }, statistics: { viewCount: "10" } }] };
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    for (const key of envKeys) process.env[key] = `synthetic-${key}`;
    AbortSignal.timeout = (milliseconds: number) => {
      assert.ok(milliseconds === 30_000 || milliseconds === 8_000, "declared production deadline must remain explicit");
      deadlines.push(milliseconds);
      return originalTimeout(1000);
    };
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert.ok(["www.googleapis.com", "oauth2.googleapis.com", "www.reddit.com"].includes(url.hostname));
      assert.ok(init?.signal instanceof AbortSignal, "public evidence transport must carry a deadline through body consumption");
      calls.push({ path: url.pathname, signal: init.signal });
      return originalFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init);
    };
    const isAbort = (error: unknown) => error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    const waitForClose = async (expected: number) => {
      const deadline = Date.now() + 2000;
      while (closedStalls < expected && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(closedStalls, expected, "timeout must close the real stalled transport");
    };

    clearYouTubeDataEvidenceCache();
    mode = "headers";
    const searches = await Promise.allSettled([searchVideoIds({ query: "Same topic" }), searchVideoIds({ query: "same topic" })]);
    assert.ok(searches.every(result => result.status === "rejected" && isAbort(result.reason)));
    assert.equal(calls.length, 1, "concurrent callers share one bounded request, without automatic retry");
    await waitForClose(1);
    mode = "healthy";
    assert.deepEqual(await searchVideoIds({ query: "same topic" }), ["video-one"]);
    assert.deepEqual(await searchVideoIds({ query: "same topic" }), ["video-one"]);
    assert.equal(calls.length, 2, "timeout is not cached as success or left in flight; successful retry is cached");

    mode = "body";
    const details = await Promise.allSettled([fetchVideoDetails(["video-one"]), fetchVideoDetails(["video-one"])]);
    assert.ok(details.every(result => result.status === "rejected" && isAbort(result.reason)));
    assert.equal(calls.length, 3);
    await waitForClose(2);
    mode = "healthy";
    assert.equal((await fetchVideoDetails(["video-one"]))[0].title, "Synthetic title");
    assert.equal((await fetchVideoDetails(["video-one"]))[0].title, "Synthetic title");
    assert.equal(calls.length, 4);

    delete process.env.YOUTUBE_DATA_API_KEY;
    mode = "oauth";
    await assert.rejects(fetchVideoStats(["video-one"], { refreshToken: "synthetic-exact-connector", requireConnector: true }), isAbort);
    assert.equal(calls.length, 5, "failed token exchange cannot dispatch the subsequent Data request");
    assert.equal(calls.at(-1)!.path, "/token");
    await waitForClose(3);
    mode = "healthy";
    assert.equal((await fetchVideoStats(["video-one"], { refreshToken: "synthetic-exact-connector", requireConnector: true }))[0].views, 10);
    assert.equal(calls.length, 7);
    assert.equal(calls[5].signal, calls[6].signal, "OAuth and Data JSON share one deadline, not a fresh budget after refresh");
    assert.ok([...deadlines].every(value => value === 30_000));
    const cancelled = new AbortController();
    cancelled.abort();
    const beforeCancellation = received;
    await assert.rejects(refreshAccessTokenGrant("synthetic-exact-connector", { signal: cancelled.signal }), isAbort);
    assert.equal(received, beforeCancellation, "an already cancelled connector refresh cannot send a request");

    clearTrendEvidenceCache();
    mode = "reddit";
    const before = calls.length;
    const [first, coalesced] = await Promise.all([fetchRedditTrends("history"), fetchRedditTrends("History")]);
    assert.deepEqual(first, coalesced);
    assert.equal(first.length, 1, "a completed subreddit remains useful when its sibling times out");
    assert.equal(calls.length - before, 2);
    await waitForClose(4);
    mode = "healthy";
    assert.equal((await fetchRedditTrends("history")).length, 2);
    assert.equal((await fetchRedditTrends("history")).length, 2);
    assert.equal(calls.length - before, 4, "partial failure is not frozen into the shared evidence cache");
    assert.ok(deadlines.includes(8_000));
    console.log("PUBLIC EVIDENCE DEADLINES PASS: real stalled headers/body/OAuth, closed sockets, coalesced failures, cache recovery, partial Reddit signals; accelerated clocks, no external APIs");
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
    for (const key of envKeys) {
      if (environment[key] === undefined) delete process.env[key]; else process.env[key] = environment[key];
    }
    clearYouTubeDataEvidenceCache(); clearTrendEvidenceCache();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
