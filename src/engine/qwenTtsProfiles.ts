/** Browser-safe Qwen3-TTS CustomVoice profiles shared by UI and server code. */
export const QWEN3_TTS_SPEAKERS = [
  "Vivian",
  "Serena",
  "Uncle_Fu",
  "Dylan",
  "Eric",
  "Ryan",
  "Aiden",
  "Ono_Anna",
  "Sohee",
] as const;

export type Qwen3TtsSpeaker = (typeof QWEN3_TTS_SPEAKERS)[number];
