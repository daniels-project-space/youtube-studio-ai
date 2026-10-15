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
  });
}
