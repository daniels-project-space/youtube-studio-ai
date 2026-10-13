import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { deriveRenderEngineProjectCapability } from "../renderEngineProjectCapability";
import { RENDER_ENGINE_STUDIO_PROJECT_NAME } from "../renderEngineStudioProject";

const secret = "fixture-management-project-secret-".padEnd(64, "x");
const expected = createHmac("sha256", secret)
  .update(`render-management-v1:${RENDER_ENGINE_STUDIO_PROJECT_NAME}`)
  .digest("hex");

assert.equal(deriveRenderEngineProjectCapability(secret, RENDER_ENGINE_STUDIO_PROJECT_NAME), expected);
assert.notEqual(deriveRenderEngineProjectCapability(secret, "another-project"), expected);
assert.throws(() => deriveRenderEngineProjectCapability("short", RENDER_ENGINE_STUDIO_PROJECT_NAME), /secret is invalid/);
assert.throws(() => deriveRenderEngineProjectCapability(secret, "../other-project"), /project name is invalid/);
console.log("Render Engine project capability: scoped derivation and input guards passed");
