import assert from "node:assert/strict";

import { searchWeb } from "@/lib/webSearch";

async function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) saved[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function testSuccessfulMapping(): Promise<void> {
  await withEnv(
    { SEARXNG_ENDPOINT: "http://127.0.0.1:8080", SEARXNG_API_TOKEN: "test-token" },
    async () => {
      const originalFetch = global.fetch;
      const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
      try {
        global.fetch = async (input, init) => {
          requests.push({ input, init });
          return new Response(
            JSON.stringify({
              results: [
                { title: "A", url: "https://a.example", content: "snippet a" },
                { title: "B", url: "https://b.example", content: "snippet b" },
                { title: "C", url: "https://c.example", content: "snippet c" },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        };
        const results = await searchWeb("dahmer", { limit: 2 });
        assert.equal(results.length, 2, "must respect opts.limit");
        assert.deepEqual(results[0], { title: "A", url: "https://a.example", snippet: "snippet a" });
        assert.deepEqual(results[1], { title: "B", url: "https://b.example", snippet: "snippet b" });
        assert.equal(requests.length, 1);
        assert.ok(String(requests[0]?.input).includes("/search?q=dahmer&format=json"));
        const headers = requests[0]?.init?.headers as Record<string, string>;
        assert.equal(headers.Authorization, "Bearer test-token");
      } finally {
        global.fetch = originalFetch;
      }
    },
  );
  console.log("webSearch: successful mapping + limit — passed");
}

async function testNon200Throws(): Promise<void> {
  await withEnv(
    { SEARXNG_ENDPOINT: "http://127.0.0.1:8080", SEARXNG_API_TOKEN: "test-token" },
    async () => {
      const originalFetch = global.fetch;
      try {
        global.fetch = async () => new Response("nope", { status: 500 });
        await assert.rejects(() => searchWeb("query"), /HTTP 500/);
      } finally {
        global.fetch = originalFetch;
      }
    },
  );
  console.log("webSearch: non-200 response throws — passed");
}

async function testMalformedBodyThrows(): Promise<void> {
  await withEnv(
    { SEARXNG_ENDPOINT: "http://127.0.0.1:8080", SEARXNG_API_TOKEN: "test-token" },
    async () => {
      const originalFetch = global.fetch;
      try {
        global.fetch = async () =>
          new Response(JSON.stringify({ results: "not-an-array" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        await assert.rejects(() => searchWeb("query"), /missing a results array/);
      } finally {
        global.fetch = originalFetch;
      }
    },
  );
  console.log("webSearch: malformed results body throws — passed");
}

async function testMissingEnvThrowsBeforeFetch(): Promise<void> {
  await withEnv({ SEARXNG_ENDPOINT: undefined, SEARXNG_API_TOKEN: undefined }, async () => {
    const originalFetch = global.fetch;
    let called = false;
    try {
      global.fetch = async () => {
        called = true;
        return new Response("{}", { status: 200 });
      };
      await assert.rejects(() => searchWeb("query"), /SEARXNG_ENDPOINT is not set/);
      assert.equal(called, false, "fetch must never be invoked when env is missing");
    } finally {
      global.fetch = originalFetch;
    }
  });

  await withEnv(
    { SEARXNG_ENDPOINT: "http://127.0.0.1:8080", SEARXNG_API_TOKEN: undefined },
    async () => {
      const originalFetch = global.fetch;
      let called = false;
      try {
        global.fetch = async () => {
          called = true;
          return new Response("{}", { status: 200 });
        };
        await assert.rejects(() => searchWeb("query"), /SEARXNG_API_TOKEN is not set/);
        assert.equal(called, false, "fetch must never be invoked when token is missing");
      } finally {
        global.fetch = originalFetch;
      }
    },
  );
  console.log("webSearch: missing env vars throw before fetch — passed");
}

async function testTimeoutThrows(): Promise<void> {
  await withEnv(
    { SEARXNG_ENDPOINT: "http://127.0.0.1:8080", SEARXNG_API_TOKEN: "test-token" },
    async () => {
      const originalFetch = global.fetch;
      try {
        global.fetch = (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              reject(err);
            });
          });
        await assert.rejects(() => searchWeb("query", { timeoutMs: 30 }), /timed out after 30ms/);
      } finally {
        global.fetch = originalFetch;
      }
    },
  );
  console.log("webSearch: timeout throws — passed");
}

async function main(): Promise<void> {
  await testSuccessfulMapping();
  await testNon200Throws();
  await testMalformedBodyThrows();
  await testMissingEnvThrowsBeforeFetch();
  await testTimeoutThrows();
  console.log("webSearch tests passed");
}

void main();
