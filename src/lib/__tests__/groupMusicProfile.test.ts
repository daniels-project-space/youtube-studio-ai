import assert from "node:assert/strict";
import {
  groupMusicSoundProfileFingerprint,
  storedChannelMusicProvider,
} from "@/lib/groupMusicProfile";

const styleDNA = {
  audio: {
    genre: "warm chamber ambient",
    bpmRange: [56, 66],
    instrumentation: ["felt piano", "cello"],
    textures: ["close room", "soft bow air"],
    moodArc: "stillness opens into quiet reassurance",
    loudnessLufs: -18,
    bodyMusicVol: 0.14,
    loopable: false,
  },
};
const profile = {
  family: "narrated_stock",
  contentLaneKey: "narrated_stock",
  provider: "mureka",
  styleDNA,
};
const fingerprint = groupMusicSoundProfileFingerprint(profile);
assert.match(fingerprint ?? "", /^[a-f0-9]{64}$/u);
assert.equal(groupMusicSoundProfileFingerprint({ ...profile, styleDNA: structuredClone(styleDNA) }), fingerprint,
  "independent channels with identical authored sound DNA can share the exact sound profile");
assert.notEqual(groupMusicSoundProfileFingerprint({
  ...profile,
  styleDNA: { audio: { ...styleDNA.audio, instrumentation: ["nylon guitar"] } },
}), fingerprint, "different instrumentation must not share music");
assert.notEqual(groupMusicSoundProfileFingerprint({ ...profile, provider: "suno" }), fingerprint,
  "different provider routes must not share music");
assert.notEqual(groupMusicSoundProfileFingerprint({ ...profile, contentLaneKey: "meditation" }), fingerprint,
  "different lane contracts must not share music");
assert.equal(groupMusicSoundProfileFingerprint({ ...profile, styleDNA: undefined }), undefined,
  "missing channel sound DNA is not treated as an identity match");

assert.equal(storedChannelMusicProvider({
  pipeline: [{ block: "music", params: { provider: "suno" } }],
}), "suno");
assert.equal(storedChannelMusicProvider({
  pipeline: [{ block: "music", version: "2.0.0-provider-outputs" }],
}), undefined, "a strict module version must not receive the legacy raw reuse shortcut");
assert.equal(storedChannelMusicProvider({
  pipeline: [{ block: "music" }, { block: "music_program_plan" }],
}), undefined, "a planned provider without a deterministic stored selection is not reusable");

console.log("GROUP MUSIC PROFILE PASS: only explicit same-family/lane/provider/sound identity may reuse");
