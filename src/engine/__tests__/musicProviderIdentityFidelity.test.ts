import assert from "node:assert/strict";
import { createChannelMusicProgram, musicProviderPromptForProgram } from "../channelMusicProgram";

const instrumentation = [
  "felt piano with unhurried decaying notes",
  "bowed double bass",
  "muted nylon guitar",
  "breathy bass clarinet",
];
const textures = ["close natural room", "soft tape warmth", "distant rain" ];
const moodArc = "Begin with a cool, restrained question carried by the piano and let the bass answer patiently; only near the end resolve into warmer harmony without increasing loudness.";
const program = createChannelMusicProgram({
  channelId: "quiet-records", channelIdentityFingerprint: "a".repeat(64),
  family: "narrated_stock", contentLaneKey: "narrated_stock",
  topic: "The ledger that changed a quiet town",
  providerPreference: "mureka", genre: "intimate chamber documentary score",
  instrumentation, textures, moodArc, bpmRange: [58, 66],
});

for (const strict of [false, true]) {
  const prompt = musicProviderPromptForProgram(program, "Keep the narrator intelligible.", "", 900, strict);
  for (const cue of [program.topic, program.identity.genre, moodArc, ...instrumentation, ...textures]) {
    assert.ok(prompt.includes(cue), `provider must receive the entire approved cue: ${cue}`);
  }
  assert.ok(prompt.length <= 900);
  assert.match(prompt, /Tempo 58-66 BPM/);
  assert.match(prompt, /Instrumental, no vocals or lyrics/);
}

assert.throws(() => musicProviderPromptForProgram(program, "", "", 160),
  /sealed music identity exceeds the provider prompt limit/,
  "a shorter provider limit must not silently delete the channel's musical identity");
console.log("MUSIC PROVIDER IDENTITY PASS - complete palette and emotional resolution survive the provider handoff");
