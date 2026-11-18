import assert from "node:assert/strict";
import Module from "node:module";
import { readFileSync } from "node:fs";

const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const original = loader._load;
const calls: string[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  return new Response(JSON.stringify({ id: "synthetic-task" }), {
    status: 200, headers: { "content-type": "application/json", "x-trigger-jwt": "synthetic-token" },
  });
}) as typeof fetch;
class StudioAuthError extends Error { status = 403; }
class Client {
  async query() { return [{ _id: "channel-a" }]; }
}
loader._load = function(name, ...args) {
  if (name === "@/lib/operatorSession") return { authorizeStudioRoute: async () => null, requireStudioActor: async () => ({ ownerId: "owner-a" }), StudioAuthError };
  if (name === "@/lib/studioConvexHttpClient") return { StudioConvexHttpClient: Client };
  if (name === "@/lib/planWeekBulk") return { buildPlanWeekBulkOrder: () => ({ ownerId: "owner-a", requestKey: "request-a", fingerprint: "a".repeat(64), channels: [{ channelId: "channel-a" }], count: 1, totalItems: 1, reservedCostUsd: 1 }) };
  return original.call(this, name, ...args);
};

async function main() {
  process.env.TRIGGER_SECRET_KEY = "synthetic-key";
  process.env.NEXT_PUBLIC_CONVEX_URL = "http://127.0.0.1:39320";
  const plan = await import("./plan-week/route");
  const bulk = await import("./plan-week/bulk/route");
  const research = await import("./research/route");
  const build = await import("./build-channel/route");
  const request = (body: unknown) => new Request("http://localhost/test", { method: "POST", body: JSON.stringify(body) });
  const run = async () => [
    await plan.POST(request({ channelId: "channel-a" })),
    await bulk.POST(request({ channelIds: ["channel-a"], count: 1, requestKey: "request-a" })),
    await research.POST(request({ niche: "fixture" })),
  ];
  process.env.YOUTUBE_AUTOMATION_PRIVATE = "1";
  for (const url of [undefined, "https://api.trigger.dev", "http://example.com:8030"]) {
    if (url === undefined) delete process.env.TRIGGER_API_URL;
    else process.env.TRIGGER_API_URL = url;
    for (const response of await run()) {
      assert.equal(response.status, 503);
      assert.equal((await response.json()).inactive, true);
    }
    const channel = await build.POST(request({ design: {} }));
    assert.equal(channel.status, 503);
    assert.equal((await channel.json()).inactive, true);
    assert.equal(calls.length, 0, "invalid private targets must not dispatch");
  }
  process.env.TRIGGER_API_URL = "http://127.0.0.1:8030";
  for (const response of await run()) assert.ok(response.ok);
  assert.equal(calls.length, 3);
  for (const call of calls) assert.equal(new URL(call).origin, "http://127.0.0.1:8030");
  assert.match(calls[0]!, /plan-week-ahead/);
  assert.match(calls[1]!, /plan-week-bulk/);
  assert.match(calls[2]!, /refresh-niche-research/);
  calls.length = 0;
  delete process.env.YOUTUBE_AUTOMATION_PRIVATE;
  process.env.TRIGGER_API_URL = "https://api.trigger.dev";
  for (const response of await run()) assert.ok(response.ok);
  for (const call of calls) assert.equal(new URL(call).origin, "https://api.trigger.dev", "cloud mode must retain SDK defaults");
  calls.length = 0;
  delete process.env.TRIGGER_SECRET_KEY;
  for (const response of await run()) {
    assert.equal(response.status, 503);
    assert.equal((await response.json()).inactive, true);
  }
  assert.equal(calls.length, 0, "missing credentials must remain visibly unavailable");
  const buildSource = readFileSync("src/app/api/build-channel/route.ts", "utf8");
  assert.match(buildSource, /tasks\.trigger\([\s\S]*?"design-channel"[\s\S]*?\{ idempotencyKey \},\s*requestOptions/);
  console.log("Private Trigger route boundary blocks invalid targets and pins local dispatch; cloud defaults preserved");
}
main().finally(() => { loader._load = original; globalThis.fetch = originalFetch; }).catch(error => { console.error(error); process.exitCode = 1; });
