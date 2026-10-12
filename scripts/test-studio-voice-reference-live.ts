import assert from "node:assert/strict";
import { StudioRenderEngineClient, STUDIO_ENGINE_PROJECT } from "../src/lib/studioRenderEngineClient";

let phase = "authority";
async function main() {
  if (process.argv[2] !== "--live" || process.argv.length !== 3) throw new Error("Explicit --live storage qualification required");
  const puts: number[] = [];
  const client = new StudioRenderEngineClient(process.env.RENDER_MANAGEMENT_API_KEY ?? "", async (url, init) => {
    const response = await fetch(url, init);
    if (init?.method === "PUT") puts.push(response.status);
    return response;
  });
  phase = "public-guidance";
  const integration = await client.integration() as { endpoints: Record<string, string> };
  assert.equal(integration.endpoints.voiceReferenceUpload, `/api/v1/projects/${STUDIO_ENGINE_PROJECT}/voice-reference-uploads`);
  assert.equal(integration.endpoints.voiceReferenceVerify, `/api/v1/projects/${STUDIO_ENGINE_PROJECT}/voice-reference-uploads/verify`);
  // Owned synthetic signal qualifies storage only. It is never registered as
  // a channel voice, submitted to a model or described as real speech.
  const audio = Buffer.alloc(44 + 44100 * 2 * 2);
  audio.write("RIFF", 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write("WAVE", 8);
  audio.write("fmt ", 12); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(44100, 24); audio.writeUInt32LE(88200, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write("data", 36); audio.writeUInt32LE(audio.length - 44, 40);
  for (let frame = 0; frame < 88200; frame++) audio.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * frame / 44100) * 8000), 44 + frame * 2);
  const options = { consentConfirmed: true as const, authorize: async () => undefined };
  phase = "owned-storage-roundtrip";
  const first = await client.importVoiceReference(audio, options);
  phase = "immutable-reuse";
  const reused = await client.importVoiceReference(audio, options);
  assert.equal(reused.sha256, first.sha256); assert.equal(reused.key, first.key);
  assert.equal(puts.length, 2); assert.equal(puts[1], 412);
  assert.equal(reused.frames, 88200);
  console.log(JSON.stringify({ passed: true, qualification: "synthetic-storage-only", receipt: reused,
    putStatuses: puts, modelCalls: 0, gpuAllocations: 0, voiceQualityAccepted: false, channelVoiceRegistered: false }));
}
main().catch(error => {
  console.error(JSON.stringify({ passed: false, phase, status: (error as { status?: unknown })?.status ?? null }));
  process.exitCode = 1;
});
