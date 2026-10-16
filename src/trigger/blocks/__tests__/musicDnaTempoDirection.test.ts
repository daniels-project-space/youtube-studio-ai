import assert from "node:assert/strict";
import { createChannelMusicProgram, musicProviderPromptForProgram } from "@/engine/channelMusicProgram";
import { musicDnaTempoDirection } from "../musicBlocks";

const meditation = createChannelMusicProgram({
  channelId: "meditation-tempo-test",
  channelIdentityFingerprint: "a".repeat(64),
  family: "meditation",
  contentLaneKey: "ambient_guided",
  topic: "A quiet breath practice",
  role: "meditation_bed",
  providerPreference: "mureka",
});
assert.deepEqual(meditation.identity.bpmRange, [48, 64]);
assert.equal(musicDnaTempoDirection({ role: "meditation_bed" }), "");
const meditationPrompt = musicProviderPromptForProgram(meditation);
assert.match(meditationPrompt, /Tempo 48-64 BPM/u);
assert.doesNotMatch(meditationPrompt, /70-88 BPM/u);

assert.equal(musicDnaTempoDirection({ role: "meditation_bed", bpmRange: [72, 80] }), "72-80 BPM");
assert.equal(musicDnaTempoDirection({
  role: "meditation_bed", tempoMode: "unmetered", bpmRange: [72, 80],
}), "");
assert.equal(musicDnaTempoDirection({ role: "sleep_sound_bed", bpmRange: [72, 80] }), "");

const sleep = createChannelMusicProgram({
  channelId: "sleep-tempo-test",
  channelIdentityFingerprint: "b".repeat(64),
  family: "sleep",
  contentLaneKey: "ambient_guided",
  topic: "Rain on a distant roof",
  role: "sleep_sound_bed",
  providerPreference: "mureka",
  bpmRange: [72, 80],
});
assert.equal(sleep.identity.bpmRange, null);
console.log("music DNA tempo direction contracts passed");
