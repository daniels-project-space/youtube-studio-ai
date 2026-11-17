import assert from "node:assert/strict";
import { localR2Credentials } from "../localR2Credentials";
import { getBucket, getR2Client } from "../storage";

async function main() {
  const env = { YTS_R2_BROKER_URL: "http://127.0.0.1:39405/v1/credentials", YTS_R2_BROKER_TOKEN: "t".repeat(40) };
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), env.YTS_R2_BROKER_URL);
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${env.YTS_R2_BROKER_TOKEN}`);
    return Response.json({ accessKeyId: "key", secretAccessKey: "secret", sessionToken: "session", expiresAt: Date.now() + 600_000 });
  };
  const value = await localR2Credentials(env, fetcher);
  assert.equal(value.sessionToken, "session");
  assert.ok(value.expiration.getTime() > Date.now());
  await assert.rejects(localR2Credentials({ ...env, YTS_R2_BROKER_URL: "https://example.com/v1/credentials" }, fetcher), /invalid/);
  await assert.rejects(localR2Credentials({ ...env, YTS_R2_BROKER_URL: "http://127.0.0.1:39405/other" }, fetcher), /invalid/);
  await assert.rejects(localR2Credentials({ ...env, YTS_R2_BROKER_TOKEN: "short" }, fetcher), /not configured/);
  assert.equal(calls, 1);
  await assert.rejects(localR2Credentials(env, async () => Response.json({ accessKeyId: "missing" })), /invalid/);
  process.env.YOUTUBE_STUDIO_WORKSHOP_PRIVATE = "1";
  process.env.R2_BUCKET = "youtube-studio-ai-private";
  assert.equal(getBucket(), "youtube-studio-ai-private");
  assert.throws(() => getBucket("youtube-automation"), /own bucket/);
  process.env.R2_ACCOUNT_ID = "a".repeat(32);
  process.env.R2_ACCESS_KEY_ID = "broad-fixture";
  process.env.R2_SECRET_ACCESS_KEY = "broad-fixture";
  delete process.env.YTS_R2_BROKER_TOKEN;
  await assert.rejects(getR2Client().config.credentials(), /broker is not configured/);
  console.log("local R2 client accepts only a valid private broker and temporary credentials");
}
void main();
