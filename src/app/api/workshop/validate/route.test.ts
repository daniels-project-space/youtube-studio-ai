import assert from "node:assert/strict";
import { createOperatorSessionToken, STUDIO_SESSION_COOKIE } from "@/lib/operatorSession";
import { designPipeline } from "@/engine/designer";
import { POST } from "./route";

async function main() {
  process.env.STUDIO_SESSION_SECRET = "5a".repeat(32);
  process.env.STUDIO_OWNER_ID = "workshop-validation-fixture";
  process.env.YOUTUBE_STUDIO_WORKSHOP_PRIVATE = "1";
  process.env.YTS_LOCAL_WEB_ORIGIN = "http://127.0.0.1:39462";
  const session = await createOperatorSessionToken();
  const pipeline = designPipeline({ family: "narrated_stock", nicheKey: "history", lengthMinutes: 5, publishMode: "draft" }).pipeline;
  const request = (body: unknown, cookie?: string, origin = "http://127.0.0.1:39462") => new Request("http://127.0.0.1:39462/api/workshop/validate", {
    method: "POST", headers: { "content-type": "application/json", origin, host: "127.0.0.1:39462", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  });
  const cookie = `${STUDIO_SESSION_COOKIE}=${session}`;
  const valid = { family: "narrated_stock", entries: pipeline };
  assert.equal((await POST(request(valid))).status, 401);
  assert.equal((await POST(request(valid, cookie, "http://foreign.invalid"))).status, 403);
  const accepted = await POST(request(valid, cookie));
  const body = await accepted.json();
  assert.equal(body.ok, true);
  assert.equal(body.result.modules.length, pipeline.length);
  const rejected = await (await POST(request({ family: "narrated_stock", entries: [{ block: "not_a_module" }] }, cookie))).json();
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /unknown block/);
  assert.equal((await POST(request({ family: "narrated_stock", entries: [], extra: true }, cookie))).status, 400);
  console.log("Workshop validation route: authenticated valid and invalid checks, anonymous and cross-origin rejection passed");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
