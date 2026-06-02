/**
 * Narration TTS — Fish Audio (ported from autostudio/pipelines/tts.py). Maps a
 * channel voice key / niche to a Fish Audio reference voice, synthesizes mp3,
 * and returns the bytes. Pure helper; the `narration_tts` block wraps it.
 */

// Verified Fish Audio reference voices (from autostudio VOICE_MAP).
const VOICE_MAP: Record<string, string> = {
  sleepless_historian: "beb44e5fac1e4b33a15dfcdcc2a9421d", // deep authoritative male
  psychological: "c8c398f58ea74012969c3d9e51dd086c", // deep, serious, measured male
};

const NICHE_VOICES: Record<string, string> = {
  stoicism: "psychological",
  psychology: "psychological",
  history: "psychological",
  philosophy: "psychological",
};

export function hasFishKey(): boolean {
  return Boolean(process.env.FISH_AUDIO_API_KEY);
}

/**
 * Resolve a Fish Audio reference_id from a channel voice key, a niche, or a raw
 * 32-hex reference id (passed through). Defaults to sleepless_historian.
 */
export function resolveVoiceId(voiceId?: string, niche?: string): string {
  if (voiceId && VOICE_MAP[voiceId]) return VOICE_MAP[voiceId];
  if (voiceId && /^[0-9a-f]{32}$/i.test(voiceId)) return voiceId; // raw ref id
  const key = (niche && NICHE_VOICES[niche.toLowerCase()]) || "sleepless_historian";
  return VOICE_MAP[key] ?? VOICE_MAP["sleepless_historian"];
}

export class TtsError extends Error {}

export async function synthNarration(args: {
  text: string;
  voiceId?: string;
  niche?: string;
}): Promise<Uint8Array> {
  const key = process.env.FISH_AUDIO_API_KEY;
  if (!key) throw new TtsError("FISH_AUDIO_API_KEY is not configured");
  const reference_id = resolveVoiceId(args.voiceId, args.niche);

  const res = await fetch("https://api.fish.audio/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      text: args.text,
      format: "mp3",
      mp3_bitrate: 128,
      reference_id,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new TtsError(`Fish Audio TTS HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length < 1000) throw new TtsError("Fish Audio returned empty/tiny audio");
  return bytes;
}
