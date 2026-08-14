import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GET, POST } from "./route";

const INTERNAL_TOKEN = "studio-test-service-token-that-is-long-enough";

function authorizedRequest(url: string, method: "GET" | "POST", body?: unknown): Request {
  return new Request(url, {
    method,
    headers: {
      authorization: `Bearer ${INTERNAL_TOKEN}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function main() {
  const originalToken = process.env.STUDIO_INTERNAL_API_TOKEN;
  const originalFetch = globalThis.fetch;
  process.env.STUDIO_INTERNAL_API_TOKEN = INTERNAL_TOKEN;

  try {
    let remoteCalls = 0;
    globalThis.fetch = (async () => {
      remoteCalls += 1;
      throw new Error("example-clip route must not call a provider or Trigger");
    }) as typeof fetch;

    const post = await POST(authorizedRequest(
      "https://studio.test/api/analyze-clip",
      "POST",
      { url: "https://www.youtube.com/watch?v=example" },
    ));
    assert.equal(post.status, 503);
    assert.equal(post.headers.get("cache-control"), "no-store");
    const unavailable = await post.json();
    assert.deepEqual(unavailable, {
      ok: false,
      available: false,
      status: "UNAVAILABLE",
      code: "NO_GEMINI_EXAMPLE_CLIP_ANALYSIS",
      analysisPerformed: false,
      error: "Example-video analysis is unavailable because the former Gemini-backed analyzer is disabled by the no-Gemini runtime policy.",
      remediation: "Describe the channel for a deterministic local format recommendation, or select a format manually.",
    });
    assert.equal(remoteCalls, 0);

    const legacyPoll = await GET(authorizedRequest(
      "https://studio.test/api/analyze-clip?id=legacy-run-id",
      "GET",
    ));
    assert.equal(legacyPoll.status, 503);
    assert.deepEqual(await legacyPoll.json(), unavailable);
    assert.equal(remoteCalls, 0);

    const missingUrl = await POST(authorizedRequest(
      "https://studio.test/api/analyze-clip",
      "POST",
      { url: "   " },
    ));
    assert.equal(missingUrl.status, 400);

    const missingId = await GET(authorizedRequest("https://studio.test/api/analyze-clip", "GET"));
    assert.equal(missingId.status, 400);

    const unauthorized = await POST(new Request("https://studio.test/api/analyze-clip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://www.youtube.com/watch?v=example" }),
    }));
    assert.equal(unauthorized.status, 401);
    assert.equal(remoteCalls, 0);

    const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /@trigger\.dev\/sdk|tasks\.trigger|runs\.retrieve|bootstrapSecrets/);
    assert.match(source, /@\/lib\/exampleClipAnalysisUnavailable/);
    assert.match(source, /exampleClipAnalysisUnavailable\(\)/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("STUDIO_INTERNAL_API_TOKEN", originalToken);
  }

  console.log("No-Gemini example-clip route tests passed");
}

void main();
