import assert from "node:assert/strict";
import { localR2Credentials } from "../localR2Credentials";
import { getR2Client } from "../storage";

async function main() {
  const env = { YTA_R2_BROKER_URL: "http://127.0.0.1:39404/v1/credentials", YTA_R2_BROKER_TOKEN: "t".repeat(40) };
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), env.YTA_R2_BROKER_URL);
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${env.YTA_R2_BROKER_TOKEN}`);
    return Response.json({ accessKeyId: "key", secretAccessKey: "secret", sessionToken: "session", expiresAt: Date.now() + 600_000 });
  };
  const value = await localR2Credentials(env, fetcher);
  assert.equal(value.sessionToken, "session");
  assert.ok(value.expiration.getTime() > Date.now());
  await assert.rejects(localR2Credentials({ ...env, YTA_R2_BROKER_URL: "https://example.com/v1/credentials" }, fetcher), /invalid/);
  await assert.rejects(localR2Credentials({ ...env, YTA_R2_BROKER_URL: "http://127.0.0.1:39404/other" }, fetcher), /invalid/);
  await assert.rejects(localR2Credentials({ ...env, YTA_R2_BROKER_TOKEN: "short" }, fetcher), /not configured/);
  assert.equal(calls, 1);
  await assert.rejects(localR2Credentials(env, async () => Response.json({ accessKeyId: "missing" })), /invalid/);
  process.env.YOUTUBE_AUTOMATION_PRIVATE = "1";
  process.env.R2_ACCOUNT_ID = "a".repeat(32);
  process.env.R2_ACCESS_KEY_ID = "broad-fixture";
  process.env.R2_SECRET_ACCESS_KEY = "broad-fixture";
  delete process.env.YTA_R2_BROKER_TOKEN;
  await assert.rejects(getR2Client().config.credentials(), /broker is not configured/);
  console.log("local R2 client accepts only a valid private broker and temporary credentials");
}
void main();
