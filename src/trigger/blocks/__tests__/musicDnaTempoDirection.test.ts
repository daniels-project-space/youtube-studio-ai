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
const defaultMeditationCue = musicDnaTempoDirection({ role: "meditation_bed" });
assert.equal(defaultMeditationCue, "");
const meditationPrompt = musicProviderPromptForProgram(meditation, defaultMeditationCue);
assert.match(meditationPrompt, /Tempo 48-64 BPM/u);
assert.doesNotMatch(meditationPrompt, /70-88 BPM/u);

const authoredTempo = musicDnaTempoDirection({ role: "meditation_bed", bpmRange: [72, 80] });
assert.equal(authoredTempo, "72-80 BPM");
const authoredMeditation = createChannelMusicProgram({
  channelId: "authored-meditation-tempo-test",
  channelIdentityFingerprint: "c".repeat(64),
  family: "meditation",
  contentLaneKey: "ambient_guided",
  topic: "A paced breathing practice",
  role: "meditation_bed",
  providerPreference: "mureka",
  bpmRange: [72, 80],
});
const authoredMeditationPrompt = musicProviderPromptForProgram(authoredMeditation, authoredTempo);
assert.match(authoredMeditationPrompt, /Tempo 72-80 BPM/u);
assert.doesNotMatch(authoredMeditationPrompt, /70-88 BPM/u);
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
const sleepPrompt = musicProviderPromptForProgram(sleep, musicDnaTempoDirection({
  role: "sleep_sound_bed", bpmRange: [72, 80],
}));
assert.match(sleepPrompt, /Beatless, no pulse or tempo/u);
assert.doesNotMatch(sleepPrompt, /\d+-\d+ BPM/u);
console.log("music DNA tempo direction contracts passed");
