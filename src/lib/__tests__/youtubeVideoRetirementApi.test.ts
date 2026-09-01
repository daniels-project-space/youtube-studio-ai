import assert from "node:assert/strict";

import { deleteVideo, getVideoIdentity } from "@/lib/youtube";

async function main() {
  const originalFetch = globalThis.fetch;
  try {
  const requests: Array<{ url: string; method: string; authorization: string | null }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push({
      url,
      method,
      authorization: new Headers(init?.headers).get("authorization"),
    });
    if (method === "DELETE") return new Response(null, { status: 204 });
    return Response.json({
      items: [{
        id: "video-1",
        snippet: { channelId: "channel-1", title: "Legacy upload" },
        status: { privacyStatus: "private" },
      }],
    });
  }) as typeof fetch;

  assert.deepEqual(await getVideoIdentity("access-token", "video-1"), {
    id: "video-1",
    channelId: "channel-1",
    title: "Legacy upload",
    privacyStatus: "private",
  });
  assert.equal(await deleteVideo("access-token", "video-1"), "deleted");
  assert.match(requests[0].url, /videos\?part=snippet%2Cstatus&id=video-1$/);
  assert.equal(requests[0].authorization, "Bearer access-token");
  assert.equal(requests[1].method, "DELETE");

  globalThis.fetch = (async () => new Response(null, { status: 404 })) as typeof fetch;
  assert.equal(
    await deleteVideo("access-token", "video-1"),
    "already_absent",
    "provider 404 reconciles a prior deletion instead of repeating it",
  );

  globalThis.fetch = (async () => Response.json({ items: [] })) as typeof fetch;
  assert.equal(await getVideoIdentity("access-token", "video-1"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main().then(() => {
  console.log("YouTube video retirement API adapter tests passed");
});
