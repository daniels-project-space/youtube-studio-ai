import assert from "node:assert/strict";
import { bootstrapSecrets } from "../bootstrap";

async function main() {
  process.env.YOUTUBE_AUTOMATION_PRIVATE = "1";
  process.env.R2_ACCOUNT_ID = "a".repeat(32);
  process.env.R2_BUCKET = "youtube-automation";
  process.env.YTA_R2_BROKER_URL = "http://127.0.0.1:39404/v1/credentials";
  process.env.YTA_R2_BROKER_TOKEN = "t".repeat(40);
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return Response.json({ accessKeyId: "temporary", secretAccessKey: "temporary", sessionToken: "temporary", expiresAt: Date.now() + 600_000 });
  };
  await bootstrapSecrets(() => {}, { services: [], required: ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] });
  assert.equal(requests, 1);
  assert.equal(process.env.R2_ACCESS_KEY_ID, undefined);
  assert.equal(process.env.R2_SECRET_ACCESS_KEY, undefined);
  await assert.rejects(bootstrapSecrets(() => {}, { services: [], required: ["MISSING_REQUIRED_FIXTURE"] }), /MISSING_REQUIRED_FIXTURE/);
  process.env.R2_ACCESS_KEY_ID = "broad-fixture";
  await assert.rejects(bootstrapSecrets(() => {}, { services: [], required: ["R2_ACCESS_KEY_ID"] }), /scoped R2 broker/);
  console.log("Private bootstrap admits verified scoped R2 credentials without exposing the parent key");
}
void main();
