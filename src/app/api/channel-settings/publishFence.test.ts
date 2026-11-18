import assert from "node:assert/strict";
import Module from "node:module";
import { channelPipelineWriteFence } from "@/lib/channelPipelineWriteFence";

const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const original = loader._load;
const base = { ownerId: "owner-a", pipeline: [{ block: "upload_draft", params: { publishMode: "draft" } }], moduleConfig: { narration_tts: { qwenSpeaker: "Ryan" } } };
let current = structuredClone(base), policyWrites: string[] = [], changedDuringPolicy = false, pipelineWrites = 0;
class AuthError extends Error { status = 403; }
class Client {
  async query() { return structuredClone(current); }
  async mutation(_reference: unknown, args: { pipeline: typeof base.pipeline; expectedPipelineFence: string }) {
    if (args.expectedPipelineFence !== channelPipelineWriteFence(current)) throw new Error("channel pipeline or its configuration changed during preparation; review and retry");
    current.pipeline = structuredClone(args.pipeline); pipelineWrites++; return { forked: false };
  }
}
loader._load = function(name, ...args) {
  if (name === "@/lib/operatorSession") return { StudioAuthError: AuthError, requireStudioActor: async () => ({ ownerId: "owner-a", authKind: "test" }) };
  if (name === "@/lib/studioConvexHttpClient") return { StudioConvexHttpClient: Client };
  if (name === "@/lib/vault") return { hydrateEnv: async () => {} };
  if (name === "@/lib/channelPublishPolicy") return {
    channelPublishConfiguration: () => ({ actions: ["youtube_public"] }),
    getChannelPublishPolicy: async () => ({ status: "active", allowedActions: ["youtube_public"] }),
    replaceChannelPublishPolicy: async (input: { allowedActions: string[] }) => {
      policyWrites.push(input.allowedActions.join(","));
      if (changedDuringPolicy && policyWrites.length === 1) current.moduleConfig.narration_tts.qwenSpeaker = "Serena";
      return { status: "active", allowedActions: input.allowedActions };
    },
  };
  return original.call(this, name, ...args);
};
async function main() {
  process.env.NEXT_PUBLIC_CONVEX_URL = "http://127.0.0.1:39320";
  const { POST } = await import("./route");
  const request = () => new Request("http://localhost/api/channel-settings", { method: "POST", body: JSON.stringify({ action: "publish_mode", channelId: "channel-a", mode: "draft" }) });
  changedDuringPolicy = true;
  const conflict = await POST(request());
  assert.equal(conflict.status, 409);
  assert.match((await conflict.json()).error, /changed while the publishing update was prepared/);
  assert.equal(pipelineWrites, 0, "a stale pipeline must not overwrite concurrent settings");
  assert.deepEqual(policyWrites, [""], "the public capability remains revoked after a conflict");
  current = structuredClone(base); policyWrites = []; changedDuringPolicy = false;
  assert.equal((await POST(request())).status, 200);
  assert.equal(pipelineWrites, 1);
  assert.deepEqual(policyWrites, ["", ""]);
  current = { ...structuredClone(base), pipeline: [] }; policyWrites = []; pipelineWrites = 0;
  const missing = await POST(request());
  assert.equal(missing.status, 409);
  assert.match((await missing.json()).error, /no upload_draft module/);
  assert.equal(pipelineWrites, 0);
  assert.deepEqual(policyWrites, [], "a missing upload module must not alter publishing policy");
  console.log("Publishing mode changes fence the pipeline and fail closed on concurrent edits");
}
main().finally(() => { loader._load = original; }).catch(error => { console.error(error); process.exitCode = 1; });
