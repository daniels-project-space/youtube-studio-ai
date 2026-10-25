import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gateColdOpen, judgeNarrationTake, narrationPhysics, renderNarration } from "@/lib/voicecraft";

async function main(): Promise<void> {
  const source = await readFile(new URL("../voicecraft.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /@\/lib\/gemini|geminiAudioJson|hasGeminiKey/);

  const physics = narrationPhysics("documentary");
  const verdict = await judgeNarrationTake({
    mp3: new Uint8Array(48_000),
    physics,
    text: "This is a measured, production narration sample for the local evidence path.",
  });
  assert.equal(verdict.pass, false, "the legacy byte-only helper must never claim an unmeasured performance passes");
  assert.match(verdict.why, /human audition plus local FFmpeg narration evidence/);

  await assert.rejects(
    gateColdOpen({
      text: "This call must fail before purchasing an obsolete remote audio judge.",
      elevenVoiceId: "voice-test",
      physics,
    }),
    /legacy cold-open audio judging is disabled/,
  );

  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ELEVENLABS_API_KEY;
  const requests: Record<string, unknown>[] = [];
  process.env.ELEVENLABS_API_KEY = "offline-regression-only";
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.elevenlabs.io/v1/text-to-speech/voice-test?output_format=mp3_44100_128");
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(new Uint8Array(48_000), { status: 200 });
  };
  try {
    for (const seed of [0, 42, undefined]) {
      await renderNarration({
        text: "[calm] A measured channel voice.",
        elevenVoiceId: "voice-test",
        physics,
        seed,
      });
    }
    assert.deepEqual(requests.map((request) => request.seed), [0, 42, 4242],
      "an explicit zero seed must preserve the channel's chosen stylistic draw");
    for (const request of requests) {
      assert.equal(request.text, "[calm] A measured channel voice.");
      assert.equal((request.voice_settings as Record<string, unknown>).stability, physics.stability);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = originalKey;
  }

  console.log("voicecraft no-Gemini tests passed");
}

void main();
