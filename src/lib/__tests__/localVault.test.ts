import assert from "node:assert/strict";
import { getOne, hydrateEnv, listByService } from "../vault";

async function main() {
  process.env.YOUTUBE_AUTOMATION_PRIVATE = "1";
  process.env.YTA_LOCAL_VAULT_JSON = JSON.stringify({ fixture: { YTA_FIXTURE_SECRET: "local-value" } });
  process.env.VAULT_ACCESS_TOKEN = "unused-cloud-token";
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("unexpected network call"); };
  assert.deepEqual(await listByService("fixture"), { YTA_FIXTURE_SECRET: "local-value" });
  assert.equal(await getOne("fixture", "YTA_FIXTURE_SECRET"), "local-value");
  assert.deepEqual(await hydrateEnv("fixture"), ["YTA_FIXTURE_SECRET"]);
  assert.equal(process.env.YTA_FIXTURE_SECRET, "local-value");
  process.env.YTA_LOCAL_VAULT_JSON = `uri:${encodeURIComponent(JSON.stringify({ fixture: { encoded: "a'b\\c" } }))}`;
  assert.equal(await getOne("fixture", "encoded"), "a'b\\c");
  await assert.rejects(listByService("missing"), /not configured/);
  await assert.rejects(getOne("fixture", "MISSING"), /not configured/);
  process.env.YTA_LOCAL_VAULT_JSON = "not-json";
  await assert.rejects(listByService("fixture"), /malformed/);
  assert.equal(requests, 0);
  console.log("local vault reads configured secrets and never falls back to the cloud");
}
void main();
