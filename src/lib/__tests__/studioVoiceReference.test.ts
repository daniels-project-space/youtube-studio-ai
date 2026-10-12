import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { StudioRenderEngineClient, STUDIO_ENGINE_PROJECT, STUDIO_ENGINE_BUCKET } from "../studioRenderEngineClient";

const audio = Buffer.alloc(44 + 2 * 44100 * 2);
audio.write("RIFF", 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write("WAVE", 8);
audio.write("fmt ", 12); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(44100, 24); audio.writeUInt32LE(88200, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
audio.write("data", 36); audio.writeUInt32LE(audio.length - 44, 40);
const sha256 = createHash("sha256").update(audio).digest("hex");
const key = `projects/${STUDIO_ENGINE_PROJECT}/assets/voices/sha256/${sha256}.wav`;
const base = { bucket: STUDIO_ENGINE_BUCKET, key, sha256, bytes: audio.length, contentType: "audio/wav" };

function fixture(options: { existing?: boolean; wrongOwner?: boolean; wrongHash?: boolean } = {}) {
  let calls = 0, puts = 0;
  const client = new StudioRenderEngineClient("f".repeat(64), async (url, init) => {
    calls++;
    assert.equal(init?.redirect, "error");
    if (String(url).endsWith("/voice-reference-uploads")) {
      assert.deepEqual(JSON.parse(String(init?.body)), { sha256, bytes: audio.length, contentType: "audio/wav" });
      return Response.json({ ...base, bucket: options.wrongOwner ? "sibling-project" : STUDIO_ENGINE_BUCKET,
        url: "https://account.r2.cloudflarestorage.com/voice?signature=fixture", headers: {
          "Content-Type": "audio/wav", "Content-Length": String(audio.length), "x-amz-meta-sha256": sha256, "If-None-Match": "*" } });
    }
    if (String(url).endsWith("/voice-reference-uploads/verify")) return Response.json({ ...base,
      sha256: options.wrongHash ? "0".repeat(64) : sha256, sampleRateHz: 44100, channels: 1, bitsPerSample: 16,
      frames: 88200, durationSeconds: 2, verifiedAt: 123 });
    assert.equal(String(url), "https://account.r2.cloudflarestorage.com/voice?signature=fixture");
    assert.equal(init?.method, "PUT"); puts++;
    assert.deepEqual(Buffer.from(init!.body as Uint8Array), audio);
    assert.equal(new Headers(init?.headers).get("if-none-match"), "*");
    return new Response(null, { status: options.existing ? 412 : 200 });
  });
  return { client, counts: () => ({ calls, puts }) };
}

test("owned voice import verifies fresh and immutable existing uploads without persisting capabilities", async () => {
  for (const existing of [false, true]) {
    const f = fixture({ existing }); let authority = 0;
    const receipt = await f.client.importVoiceReference(audio, { consentConfirmed: true, authorize: async () => { authority++; } });
    assert.equal(receipt.key, key); assert.equal(receipt.frames, 88200);
    assert.ok(!("url" in receipt)); assert.equal(authority, 4);
    assert.deepEqual(f.counts(), { calls: 3, puts: 1 });
  }
});

test("invalid format, consent or execution authority refuses the import before network", async () => {
  const f = fixture(), authorize = async () => undefined;
  await assert.rejects(f.client.importVoiceReference(audio, { consentConfirmed: false as never, authorize }), /consent/);
  const stereo = Buffer.from(audio); stereo.writeUInt16LE(2, 22);
  await assert.rejects(f.client.importVoiceReference(stereo, { consentConfirmed: true, authorize }), /mono PCM16/);
  await assert.rejects(f.client.importVoiceReference(audio, { consentConfirmed: true,
    authorize: async () => { throw new Error("expired lease"); } }), /expired lease/);
  assert.deepEqual(f.counts(), { calls: 0, puts: 0 });
});

test("foreign uploads and mismatched verified bytes cannot become an owned voice reference", async () => {
  const options = { consentConfirmed: true as const, authorize: async () => undefined };
  const owner = fixture({ wrongOwner: true });
  await assert.rejects(owner.client.importVoiceReference(audio, options));
  assert.equal(owner.counts().puts, 0);
  await assert.rejects(fixture({ wrongHash: true }).client.importVoiceReference(audio, options));
});
