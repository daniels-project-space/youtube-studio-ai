/**
 * Narration TTS — Fish Audio (ported from autostudio/pipelines/tts.py). Maps a
 * channel voice key / niche to a Fish Audio reference voice, synthesizes mp3,
 * and returns the bytes. Pure helper; the `narration_tts` block wraps it.
 */

// Verified Fish Audio reference voices (from autostudio VOICE_MAP).
const VOICE_MAP: Record<string, string> = {
  sleepless_historian: "beb44e5fac1e4b33a15dfcdcc2a9421d", // deep authoritative male
  psychological: "c8c398f58ea74012969c3d9e51dd086c", // deep, serious, measured male
  voice_dl: "1936333080804be19655c6749b2ae7b2", // "Voice DL" (en) — operator bookmark
  voice_de_stoic: "40f470ff12064bf1897215b41819147c", // German — "Stoische Gewohnheiten"
  voice_es_locutor: "3f45a7fd7a614655a61eb7027b955783", // Spanish — "voz de locutor k" (deep authoritative)
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

/** Strip ElevenLabs-style [audio tags] — Fish/captions would expose them. */
export function stripAudioTags(text: string): string {
  return text.replace(/\[[^\]\n]{1,40}\]/g, " ").replace(/\s{2,}/g, " ").trim();
}

/**
 * ElevenLabs v3 — the expressive voice tier. PERFORMS inline bracketed audio
 * tags ([pause], [sighs], [whispers], [chuckles]…) instead of reading them;
 * the script writer emits them only when the channel runs this provider.
 */
async function synthElevenLabs(args: { text: string; elevenVoiceId?: string }): Promise<Uint8Array> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new TtsError("ELEVENLABS_API_KEY is not configured");
  // Default: George — warm, documentary-grade narrator.
  const voice = args.elevenVoiceId || "JBFqnCBsd6RMkjVDRZzb";
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "xi-api-key": key, "content-type": "application/json" },
          body: JSON.stringify({
            text: args.text,
            model_id: "eleven_v3",
            voice_settings: { stability: 0.5, similarity_boost: 0.8 },
          }),
        },
      );
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length >= 1000) return bytes;
        lastErr = "ElevenLabs returned empty/tiny audio";
      } else {
        const body = await res.text().catch(() => "");
        lastErr = `ElevenLabs TTS HTTP ${res.status}: ${body.slice(0, 200)}`;
        if (res.status !== 429 && res.status < 500) throw new TtsError(lastErr);
      }
    } catch (e) {
      if (e instanceof TtsError) throw e;
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await sleep(1500 * (attempt + 1));
  }
  throw new TtsError(`ElevenLabs TTS failed after 3 attempts: ${lastErr}`);
}

export async function synthNarration(args: {
  text: string;
  voiceId?: string;
  niche?: string;
  /** Speaking-rate multiplier 0.5–2.0 (1.0 = the voice's native pace). */
  speed?: number;
  /** TTS engine: fish (default) | elevenlabs (v3 expressive, audio tags). */
  provider?: string;
  elevenVoiceId?: string;
}): Promise<Uint8Array> {
  if (args.provider === "elevenlabs") return synthElevenLabs(args);
  const key = process.env.FISH_AUDIO_API_KEY;
  if (!key) throw new TtsError("FISH_AUDIO_API_KEY is not configured");
  const reference_id = resolveVoiceId(args.voiceId, args.niche);
  const speed = Math.max(0.5, Math.min(2, args.speed ?? 1));
  // Defensive: a tagged script routed to Fish must never SPEAK the brackets.
  args = { ...args, text: stripAudioTags(args.text) };

  // Retry transient failures (429 / 5xx / network) so one blip doesn't fail a paid
  // run. 4xx (other than 429) is a real error → fail fast.
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://api.fish.audio/v1/tts", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          text: args.text,
          format: "mp3",
          mp3_bitrate: 192,
          reference_id,
          // Fish prosody control — the per-channel pacing knob ("too fast
          // narration" fix). Omitted at exactly 1.0 to keep the legacy shape.
          ...(speed !== 1 ? { prosody: { speed } } : {}),
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        lastErr = `Fish Audio TTS HTTP ${res.status}: ${detail.slice(0, 200)}`;
        if (res.status === 429 || res.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
        throw new TtsError(lastErr);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length < 1000) { lastErr = "Fish Audio returned empty/tiny audio"; await sleep(2000 * (attempt + 1)); continue; }
      return bytes;
    } catch (e) {
      if (e instanceof TtsError) throw e;
      lastErr = e instanceof Error ? e.message : String(e); // network error → retry
      await sleep(2000 * (attempt + 1));
    }
  }
  throw new TtsError(`Fish Audio TTS failed after 3 attempts: ${lastErr}`);
}
