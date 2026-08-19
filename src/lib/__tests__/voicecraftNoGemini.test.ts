import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gateColdOpen, judgeNarrationTake, narrationPhysics } from "@/lib/voicecraft";

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

  console.log("voicecraft no-Gemini tests passed");
}

void main();
