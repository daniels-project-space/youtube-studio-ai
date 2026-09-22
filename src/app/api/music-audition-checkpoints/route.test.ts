import assert from "node:assert/strict";
import Module from "node:module";
import { createOperatorSessionToken } from "@/lib/operatorSession";

const env = { ...process.env };
process.env.STUDIO_OWNER_ID = "review-owner";
process.env.STUDIO_SESSION_SECRET = Buffer.alloc(32, 9).toString("base64");
process.env.STUDIO_INTERNAL_API_TOKEN = "fixture-service-token";
process.env.NEXT_PUBLIC_CONVEX_URL = "https://review-fixture.convex.cloud";
let queries = 0, mutations = 0;
let unavailable = false;
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (id, ...args) {
  if (id.endsWith("/studioConvexHttpClient")) return { StudioConvexHttpClient: class {
    async query() {
      queries++;
      if (unavailable) throw new Error("private object key credential request-id");
      return null;
    }
    async mutation() {
      mutations++;
      if (unavailable) throw new Error("private object key credential request-id");
      return { rejected: true };
    }
  } };
  return originalLoad.call(this, id, ...args);
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET, POST } = require("./route") as typeof import("./route");

async function check(response: Response, status: number) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.doesNotMatch(JSON.stringify(body), /private object|credential|request-id/);
  return body;
}

async function main() {
  const token = await createOperatorSessionToken();
  const get = (id: string, auth = "service") => new Request(
    `https://studio.invalid/api/music-audition-checkpoints?runId=${encodeURIComponent(id)}`,
    { headers: auth === "service" ? { authorization: "Bearer fixture-service-token" }
      : auth === "owner" ? { cookie: `studio_session=${token}` } : {} },
  );
  await check(await GET(get("review-run", "none")), 401);
  for (const id of ["", "invalid.id", "../other", " ", "x".repeat(161)]) {
    await check(await GET(get(id)), 400);
  }
  assert.equal(queries, 0, "reject invalid input before database access");
  assert.deepEqual(await check(await GET(get("review-run")), 200), { ok: true, checkpoint: null });
  assert.deepEqual(await check(await GET(get("review-run", "owner")), 200), { ok: true, checkpoint: null });
  unavailable = true;
  await check(await GET(get("review-run")), 503);

  const post = (body: string, auth = "owner", origin = "https://studio.invalid") => new Request(
    "https://studio.invalid/api/music-audition-checkpoints", { method: "POST", body,
      headers: { origin, "content-type": "application/json", ...(auth === "owner"
        ? { cookie: `studio_session=${token}` } : { authorization: "Bearer fixture-service-token" }) } },
  );
  const reject = JSON.stringify({ action: "reject", checkpointId: "checkpoint" });
  await check(await POST(post(reject, "service")), 403);
  await check(await POST(post(reject, "owner", "https://foreign.invalid")), 403);
  assert.equal(mutations, 0, "service credentials and foreign origins cannot express a human decision");
  await check(await POST(post("{")), 400);
  await check(await POST(post("null")), 400);
  await check(await POST(post("[]")), 400);
  await check(await POST(post(JSON.stringify({ action: "approve", runId: "invalid.id" }))), 400);
  await check(await POST(post(JSON.stringify({ action: "unknown" }))), 400);
  await check(await POST(post(reject)), 503);
  unavailable = false;
  assert.deepEqual(await check(await POST(post(reject)), 200), { ok: true, result: { rejected: true } });
  console.log("Music audition route: private responses, sanitized errors, input admission and owner-only decisions passed");
}

main().finally(() => {
  loader._load = originalLoad;
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
}).catch(error => { console.error(error); process.exitCode = 1; });
