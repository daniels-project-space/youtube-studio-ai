import assert from "node:assert/strict";
import { localAutomationWorkerConfig } from "../localAutomationWorkerConfig";

assert.equal(localAutomationWorkerConfig({}), null);
assert.throws(() => localAutomationWorkerConfig({ TRIGGER_API_URL: "http://127.0.0.1:39400" }));
const valid = { YOUTUBE_AUTOMATION_TRIGGER_LOCAL: "1", TRIGGER_PROJECT_REF: "proj_local_fixture",
  TRIGGER_API_URL: "http://127.0.0.1:39400", YTA_WORKER_CONVEX_URL: "http://172.28.0.1:39402",
  STUDIO_CONVEX_JWT_PRIVATE_KEY: "fixture", STUDIO_CONVEX_ISSUER: "http://127.0.0.1:39340",
  STUDIO_CONVEX_AUDIENCE: "youtube-automation-vps", STUDIO_OWNER_ID: "owner_fixture" };
assert.deepEqual(localAutomationWorkerConfig(valid), { project: "proj_local_fixture", convexUrl: "http://172.28.0.1:39402" });
for (const invalid of [
  { ...valid, TRIGGER_PROJECT_REF: "" },
  { ...valid, TRIGGER_API_URL: "https://api.trigger.dev" },
  { ...valid, YTA_WORKER_CONVEX_URL: "https://example.convex.cloud" },
  { ...valid, YTA_WORKER_CONVEX_URL: "http://203.0.113.20:39402" },
  { ...valid, YTA_WORKER_CONVEX_URL: "http://user:password@172.28.0.1:39402" },
  { ...valid, STUDIO_CONVEX_AUDIENCE: "" },
  { ...valid, STUDIO_OWNER_ID: "" },
  { ...valid, STUDIO_CONVEX_ISSUER: "https://old-studio.example" },
]) assert.throws(() => localAutomationWorkerConfig(invalid));
console.log("local Automation worker project, endpoint and identity boundary: passed");
