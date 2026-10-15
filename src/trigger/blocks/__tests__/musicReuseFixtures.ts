import { groupMusicSoundProfileFingerprint } from "@/lib/groupMusicProfile";
import { createMusicReuseReceipt } from "@/lib/musicReuseReceipt";

export const musicReuseTestStyleDNA = {
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

export function musicReuseTestReceipt(input: {
  ownerId: string;
  baseRunId: string;
  baseChannelId: string;
  siblingChannelId: string;
  musicKey: string;
  family: string;
  contentLaneKey: string;
  provider: "mureka" | "suno" | "minimax_music3";
}) {
  const soundProfileFingerprint = groupMusicSoundProfileFingerprint({
    ...input,
    styleDNA: musicReuseTestStyleDNA,
  });
  if (!soundProfileFingerprint) throw new Error("fixture sound profile must be valid");
  return createMusicReuseReceipt({
    ...input,
    audioSha256: "a".repeat(64),
    audioByteLength: 1_000,
    soundProfileFingerprint,
    baseMusicKey: `owner/${input.ownerId}/runs/${input.baseRunId}/audio/music.mp3`,
    providerEvidence: {
      program: { key: `owner/${input.ownerId}/group/fixture/bundle/${input.baseRunId}/music-evidence/program.json`, sha256: "c".repeat(64) },
      source: { key: `owner/${input.ownerId}/group/fixture/bundle/${input.baseRunId}/music-evidence/source.json`, sha256: "d".repeat(64) },
      quality: { key: `owner/${input.ownerId}/group/fixture/bundle/${input.baseRunId}/music-evidence/quality.json`, sha256: "e".repeat(64) },
      auditionWav: { key: `owner/${input.ownerId}/group/fixture/bundle/${input.baseRunId}/music-evidence/audition.wav`, sha256: "f".repeat(64) },
    },
  });
}
