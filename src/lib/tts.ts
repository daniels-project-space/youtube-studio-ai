/** Shared managed/open narration seam. Every provider returns MP3 bytes and
 * must preserve at-most-once paid submission semantics. */
import { spreadDefault } from "@/lib/identitySpread";
import {
  synthQwenNarration,
  type QwenTtsReceipt,
} from "@/lib/qwenTts";

export type TtsProvider = "fish" | "elevenlabs" | "qwen3";

export function normalizeTtsProvider(value: unknown): TtsProvider {
  const provider = typeof value === "string" ? value.trim().toLowerCase() : "fish";
  if (provider === "fish" || provider === "elevenlabs" || provider === "qwen3") return provider;
  throw new TtsError(`Unsupported narration TTS provider: ${provider || "missing"}`);
}

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
/**
 * English voices an unmapped niche may be spread across.
 *
 * VOICE_MAP also holds a German and a Spanish reference, and spreading an
 * English channel onto either would be far worse than converging — a wrong
 * language is not a stylistic difference. So the pool is only the voices that
 * can narrate English.
 */
const ENGLISH_FALLBACK_VOICE_KEYS = ["sleepless_historian", "psychological", "voice_dl"] as const;

export function resolveVoiceId(voiceId?: string, niche?: string): string {
  if (voiceId && VOICE_MAP[voiceId]) return VOICE_MAP[voiceId];
  if (voiceId && /^[0-9a-f]{32}$/i.test(voiceId)) return voiceId; // raw ref id
  // A deliberate niche mapping always wins — those are chosen, not inferred.
  const mapped = niche ? NICHE_VOICES[niche.toLowerCase()] : undefined;
  if (mapped) return VOICE_MAP[mapped] ?? VOICE_MAP["sleepless_historian"];
  // Otherwise spread across a RANGE by stable identity rather than collapsing
  // onto one point. NICHE_VOICES covers four niches and maps all four to the
  // same voice, so before this every unmapped channel — which is most of them —
  // received the identical narrator. Seeded on the niche so a channel's voice
  // is stable across runs, and so two channels in the same niche still share a
  // register, which is intended; two channels in DIFFERENT niches no longer do.
  const key = spreadDefault(String(niche ?? "").toLowerCase(), ENGLISH_FALLBACK_VOICE_KEYS);
  return VOICE_MAP[key] ?? VOICE_MAP["sleepless_historian"];
}

/** Provider-local retries are already exhausted (or the response was billable),
 * so the engine must never multiply a TTS purchase with a block-level retry. */
export class TtsError extends Error {
  readonly retryable = false;

  constructor(
    message: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "TtsError";
  }
}

/** Strip ElevenLabs-style [audio tags] — Fish/captions would expose them. */
export function stripAudioTags(text: string): string {
  return text.replace(/\[[^\]\n]{1,40}\]/g, " ").replace(/\s{2,}/g, " ").trim();
}

/**
 * Prosody continuity across CHUNKED synthesis — without it every request is
 * an independent "take" and v3 re-interprets emotion from scratch, producing
 * a jarring voice change at every joint. previous_text/next_text condition
 * the delivery on the surrounding script (parallel-safe); previousRequestIds
 * chain actual audio context (sequential callers only, ElevenLabs keeps ids
 * usable for ~2h, max 3 per request).
 */
export interface TtsStitch {
  previousText?: string;
  nextText?: string;
  previousRequestIds?: string[];
}

/** eleven_v3 doesn't support request stitching yet (verified live) — see above. */
const V3_STITCH = process.env.ELEVENLABS_V3_STITCH === "1";

// A single sentence/line synthesis should complete well below this ceiling.
// Without a local bound, a post-submit hung socket can outlive the Trigger task
// and turn its whole-task crash retry into a duplicate paid TTS purchase.  The
// catch paths below deliberately classify an abort as an ambiguous, terminal
// outcome rather than trying the POST again.
const TTS_SUBMISSION_TIMEOUT_MS = 120_000;

/**
 * ElevenLabs v3 — the expressive voice tier. PERFORMS inline bracketed audio
 * tags ([pause], [sighs], [whispers], [chuckles]…) instead of reading them;
 * the script writer emits them only when the channel runs this provider.
 */
/** Per-channel ElevenLabs render settings (narration physics → API knobs). */
export interface ElevenSettings {
  /** v3 stability: 0.0 creative | 0.5 natural | 1.0 robust. */
  stability?: number;
  /** Style exaggeration 0..1. */
  style?: number;
  /** Stylistic draw — fixed per run for take-to-take consistency. */
  seed?: number;
  modelId?: string;
}

async function synthElevenLabs(args: {
  text: string;
  elevenVoiceId?: string;
  /** Speaking-rate multiplier — VERIFIED LIVE 2026-06-13: v3 accepts
   *  voice_settings.speed (0.7–1.2). The same knob Fish gets via prosody. */
  speed?: number;
  eleven?: ElevenSettings;
  stitch?: TtsStitch;
  /** Receives the response request-id so sequential callers can chain takes. */
  onRequestId?: (id: string) => void;
  /** Called once for a successful provider response. A tiny 2xx response is
   * counted, then fails terminal so the same speech is never repurchased. */
  onBillableCharacters?: (characters: number) => void;
}): Promise<Uint8Array> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new TtsError("ELEVENLABS_API_KEY is not configured");
  // A NARRATOR IS AN IDENTITY DECISION, SO IT MUST BE DECLARED.
  //
  // This defaulted to one hard-coded voice ("George"), which meant any channel
  // that selected ElevenLabs without naming a voice silently adopted the same
  // narrator as every other channel that did the same. That is the convergence
  // failure applied to the single most identity-defining attribute a channel
  // has — and it is silent, because a video narrated in the wrong voice renders
  // and uploads perfectly.
  //
  // The qwen3 branch of this very dispatch already refuses an unnamed speaker.
  // Two providers reached through one function should not disagree about
  // whether a missing voice is an error.
  //
  // Safe to enforce: of the six live narrated channels, exactly one uses
  // ElevenLabs and it names its voice; the other five run Fish with an explicit
  // identity.voiceId. Nothing in production relies on the default.
  const voice = args.elevenVoiceId?.trim();
  if (!voice) {
    throw new TtsError(
      "ElevenLabs narration requires an explicit elevenVoiceId — refusing to substitute a default " +
      "narrator, because every channel that omitted it would receive the same voice",
    );
  }
  const speed = Math.max(0.7, Math.min(1.2, args.speed ?? 1));
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "xi-api-key": key, "content-type": "application/json" },
          signal: AbortSignal.timeout(TTS_SUBMISSION_TIMEOUT_MS),
          body: JSON.stringify({
            text: args.text,
            model_id: args.eleven?.modelId ?? "eleven_v3",
            voice_settings: {
              stability: args.eleven?.stability ?? 0.5,
              similarity_boost: 0.8,
              ...(speed !== 1 ? { speed } : {}),
              ...(args.eleven?.style ? { style: args.eleven.style } : {}),
            },
            // Fixed seed = the same stylistic draw across chunked requests —
            // v3's main take-to-take consistency lever today.
            seed: args.eleven?.seed ?? 4242,
            // VERIFIED LIVE 2026-06-12: eleven_v3 rejects previous_text /
            // next_text ("unsupported_model"). The stitch plumbing stays
            // dormant until ElevenLabs ships v3 request stitching — flip
            // V3_STITCH then.
            ...(V3_STITCH && args.stitch?.previousText ? { previous_text: args.stitch.previousText.slice(-600) } : {}),
            ...(V3_STITCH && args.stitch?.nextText ? { next_text: args.stitch.nextText.slice(0, 600) } : {}),
            ...(V3_STITCH && args.stitch?.previousRequestIds?.length
              ? { previous_request_ids: args.stitch.previousRequestIds.slice(-3) }
              : {}),
          }),
        },
      );
    } catch (e) {
      // A transport failure after POST is ambiguous: the provider may have
      // accepted and billed the synthesis even though its response was lost.
      // Never turn that ambiguity into a second paid submission.
      throw new TtsError(
        `ElevenLabs TTS outcome is unknown after transport failure; not retrying: ${e instanceof Error ? e.message : String(e)}`,
        undefined,
        { cause: e },
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const message = `ElevenLabs TTS HTTP ${res.status}: ${body.slice(0, 200)}`;
      // 429 is an explicit admission rejection. Any other response may follow
      // accepted work, so it is terminal even when the provider reports 5xx.
      if (res.status === 429 && attempt < 2) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      throw new TtsError(message, res.status);
    }

    args.onBillableCharacters?.(args.text.length);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      throw new TtsError(
        `ElevenLabs returned a successful response but its audio could not be read; not retrying: ${e instanceof Error ? e.message : String(e)}`,
        res.status,
        { cause: e },
      );
    }
    if (bytes.length >= 1000) {
      const rid = res.headers.get("request-id");
      if (rid) args.onRequestId?.(rid);
      return bytes;
    }
    // A 2xx may already consume character quota. Retrying it would buy the
    // same speech twice, so count it above and fail terminal.
    throw new TtsError("ElevenLabs returned empty/tiny audio after a successful response", res.status);
  }
  throw new TtsError("ElevenLabs TTS retry budget exhausted", 429);
}

export async function synthNarration(args: {
  text: string;
  voiceId?: string;
  niche?: string;
  /** Speaking-rate multiplier 0.5–2.0 (1.0 = the voice's native pace). */
  speed?: number;
  /** TTS engine: fish (default) | elevenlabs | qwen3 (attested open worker). */
  provider?: string;
  elevenVoiceId?: string;
  /** ElevenLabs render settings (narration physics) — ignored by Fish. */
  eleven?: ElevenSettings;
  /** ElevenLabs continuity across chunked requests (ignored by Fish). */
  stitch?: TtsStitch;
  onRequestId?: (id: string) => void;
  onBillableCharacters?: (characters: number) => void;
  qwenSpeaker?: string;
  qwenLanguage?: string;
  qwenInstruction?: string;
  qwenSeed?: number;
  qwenMaxCostUsd?: number;
  onQwenReceipt?: (receipt: QwenTtsReceipt) => void;
}): Promise<Uint8Array> {
  const provider = normalizeTtsProvider(args.provider);
  if (provider === "elevenlabs") return synthElevenLabs(args);
  if (provider === "qwen3") {
    const text = stripAudioTags(args.text);
    const audio = await synthQwenNarration({
      text,
      speaker: args.qwenSpeaker ?? args.voiceId ?? "",
      language: args.qwenLanguage,
      instruction: args.qwenInstruction,
      speed: args.speed,
      seed: args.qwenSeed,
      maxCostUsd: args.qwenMaxCostUsd ?? Math.max(0.02, text.length / 1_000),
      onReceipt: args.onQwenReceipt,
    });
    args.onBillableCharacters?.(text.length);
    return audio;
  }
  const key = process.env.FISH_AUDIO_API_KEY;
  if (!key) throw new TtsError("FISH_AUDIO_API_KEY is not configured");
  const reference_id = resolveVoiceId(args.voiceId, args.niche);
  const speed = Math.max(0.5, Math.min(2, args.speed ?? 1));
  // Defensive: a tagged script routed to Fish must never SPEAK the brackets.
  args = { ...args, text: stripAudioTags(args.text) };

  // Retry only an explicit 429 admission rejection. A transport failure or
  // any other response can be ambiguous after POST and must not buy the same
  // speech again.
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch("https://api.fish.audio/v1/tts", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
        signal: AbortSignal.timeout(TTS_SUBMISSION_TIMEOUT_MS),
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
    } catch (e) {
      throw new TtsError(
        `Fish Audio TTS outcome is unknown after transport failure; not retrying: ${e instanceof Error ? e.message : String(e)}`,
        undefined,
        { cause: e },
      );
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const message = `Fish Audio TTS HTTP ${res.status}: ${detail.slice(0, 200)}`;
      if (res.status === 429 && attempt < 2) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      throw new TtsError(message, res.status);
    }
    args.onBillableCharacters?.(args.text.length);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      throw new TtsError(
        `Fish Audio returned a successful response but its audio could not be read; not retrying: ${e instanceof Error ? e.message : String(e)}`,
        res.status,
        { cause: e },
      );
    }
    if (bytes.length < 1000) {
      // A 2xx may already consume character quota. Never repurchase it.
      throw new TtsError("Fish Audio returned empty/tiny audio after a successful response", res.status);
    }
    return bytes;
  }
  throw new TtsError("Fish Audio TTS retry budget exhausted", 429);
}
