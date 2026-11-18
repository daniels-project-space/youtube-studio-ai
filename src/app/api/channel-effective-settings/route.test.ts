import assert from "node:assert/strict";
import Module from "node:module";

const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const original = loader._load;
let owner = "owner-a";
let invalid = false;
let voice = false;
let durationPipeline: Array<{ block: string; params: Record<string, unknown> }> | undefined;
class AuthError extends Error { status = 401; }
class Client {
  async query() {
    if (durationPipeline) return { ownerId: owner, pipeline: durationPipeline };
    if (voice) return { ownerId: owner, pipeline: [{ block: "narration_tts", params: { ttsProvider: "fish" } }], moduleConfig: { narration_tts: { ttsProvider: "qwen3", qwenSpeaker: "Ryan" } } };
    return { ownerId: owner, pipeline: [{ block: "quote_overlays", params: { maxQuotes: 2 } }], moduleConfig: { quote_overlays: { maxQuotes: invalid ? 500 : 5 } } };
  }
}
loader._load = function(name, ...args) {
  if (name === "@/lib/operatorSession") return { StudioAuthError: AuthError, requireStudioActor: async () => ({ ownerId: "owner-a" }) };
  if (name === "@/lib/studioConvexHttpClient") return { StudioConvexHttpClient: Client };
  return original.call(this, name, ...args);
};
async function main() {
  process.env.NEXT_PUBLIC_CONVEX_URL = "http://127.0.0.1:39320";
  const { GET } = await import("./route");
  const request = () => new Request("http://localhost/api/channel-effective-settings?channelId=channel-a");
  const result = await GET(request());
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.equal((await result.json()).maxQuotes, 5);
  voice = true;
  assert.equal((await (await GET(request())).json()).voiceConfigured, true, "voice setup uses the validated effective override");
  voice = false;
  durationPipeline = [{ block: "assemble", params: { durationSec: 7200 } }];
  const assembly = await (await GET(request())).json();
  assert.equal(assembly.targetSeconds, 7200, "music-loop assembly duration is shown");
  assert.equal(assembly.durationSource, "assembly");
  const { designPipeline } = await import("@/engine/designer");
  const designed = designPipeline({ family: "music_loop", lengthMinutes: 120 });
  durationPipeline = designed.pipeline as typeof durationPipeline;
  const plannedResponse = await GET(request());
  assert.equal(plannedResponse.status, 200);
  assert.equal((await plannedResponse.json()).targetSeconds, designed.episodeLengthSeconds, "selected duration survives planning and the effective settings API");
  durationPipeline = [{ block: "script_gen", params: { maxSeconds: 1200 } }];
  const script = await (await GET(request())).json();
  assert.equal(script.targetSeconds, 1200, "narrated script maximum is shown");
  assert.equal(script.durationSource, "script_maximum");
  durationPipeline = [
    { block: "script_gen", params: { maxSeconds: 1200 } },
    { block: "assemble", params: { durationSec: 7200 } },
  ];
  assert.equal((await (await GET(request())).json()).targetSeconds, 7200, "final assembly takes precedence");
  durationPipeline[1].params.durationSec = "invalid";
  const invalidDuration = await (await GET(request())).json();
  assert.equal(invalidDuration.targetSeconds, null, "invalid assembly duration is not replaced with a misleading script target");
  assert.equal(invalidDuration.durationSource, "assembly");
  durationPipeline = undefined;
  owner = "other-owner";
  assert.equal((await GET(request())).status, 404);
  owner = "owner-a"; invalid = true;
  assert.equal((await GET(request())).status, 422);
  console.log("Effective settings honor overrides, owner scope, and invalid configuration");
}
main().finally(() => { loader._load = original; }).catch(error => { console.error(error); process.exitCode = 1; });
