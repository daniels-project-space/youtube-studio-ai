import assert from "node:assert/strict";
import { localWorkshopWorkerConfig } from "../localWorkshopWorkerConfig";
import { assertAutomationModelAllowed, assertAutomationNarrationProviderAllowed } from "../automationModelPolicy";
import { assertAutomationNarrationPolicy } from "@/engine/automationNarrationPolicy";

const env = { YOUTUBE_STUDIO_WORKSHOP_TRIGGER_LOCAL: "1", TRIGGER_PROJECT_REF: "proj_dqyvctmalaifbqvylvfm",
  TRIGGER_API_URL: "http://127.0.0.1:39400", YTS_WORKER_CONVEX_URL: "http://172.30.240.1:39403",
  STUDIO_CONVEX_ISSUER: "http://127.0.0.1:39440", STUDIO_CONVEX_AUDIENCE: "youtube-studio-workshop-vps",
  R2_BUCKET: "youtube-studio-ai-private", R2_ACCOUNT_ID: "a".repeat(32), YTS_R2_BROKER_URL: "http://172.30.240.1:39405/v1/credentials", YTS_R2_BROKER_TOKEN: "fixture",
  STUDIO_CONVEX_JWT_PRIVATE_KEY: "fixture", STUDIO_OWNER_ID: "owner_fixture" };
assert.deepEqual(localWorkshopWorkerConfig(env), { project: env.TRIGGER_PROJECT_REF, convexUrl: env.YTS_WORKER_CONVEX_URL });
for (const [key, value] of Object.entries({ TRIGGER_PROJECT_REF: "proj_muvntlamcgghjckjvgpi", YTS_WORKER_CONVEX_URL: "http://172.30.240.1:39402", STUDIO_CONVEX_AUDIENCE: "youtube-automation-vps", TRIGGER_API_URL: "https://api.trigger.dev", R2_BUCKET: "youtube-automation", YTS_R2_BROKER_URL: "http://172.30.240.1:39404/v1/credentials" })) {
  assert.throws(() => localWorkshopWorkerConfig({ ...env, [key]: value }));
}
assert.throws(() => localWorkshopWorkerConfig({ TRIGGER_API_URL: env.TRIGGER_API_URL }));
assert.equal(localWorkshopWorkerConfig({}), null);
const privateEnv = { YOUTUBE_STUDIO_WORKSHOP_PRIVATE: "1" };
assert.throws(() => assertAutomationModelAllowed("fal-ai/nano-banana-pro", privateEnv), /disabled/);
assert.throws(() => assertAutomationNarrationProviderAllowed("elevenlabs", privateEnv), /Qwen/);
assert.throws(() => assertAutomationNarrationPolicy([{ block: "motion_comic" }], {}, privateEnv), /Qwen/);
assert.doesNotThrow(() => assertAutomationNarrationProviderAllowed("qwen3", privateEnv));
console.log("Studio worker boundaries reject Automation project/database and excluded providers");
