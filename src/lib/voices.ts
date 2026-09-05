/**
 * Narration voice catalog (client-safe — no server imports). The `id` is the
 * channel voice key persisted on `identity.voiceId`; `resolveVoiceId` in
 * src/lib/tts.ts maps it to a Fish Audio reference id. Raw 32-hex ids also pass
 * through tts.ts, so a custom bookmark can be pasted directly too.
 */
export interface VoiceOption {
  id: string;
  label: string;
  lang: string;
  note?: string;
}

/**
 * The id that means "no voice declared".
 *
 * The channel editor used to default its select to "sleepless_historian" when a
 * channel had none, and its dirty-check compared against that same literal — so
 * opening a channel and saving anything at all silently WROTE that voice. Every
 * channel edited without touching the field converged on one narrator, at the
 * point of data entry rather than in the engine.
 *
 * With an explicit empty option the field can show what is true, and the
 * fallback stays where it belongs: resolveVoiceId spreads an undeclared channel
 * across the English voices by stable identity.
 */
export const AUTO_VOICE_ID = "" as const;

export const VOICES: VoiceOption[] = [
  { id: AUTO_VOICE_ID, label: "Auto", lang: "en", note: "chosen per channel — not shared with other channels" },
  { id: "sleepless_historian", label: "Sleepless Historian", lang: "en", note: "deep, authoritative male" },
  { id: "psychological", label: "Psychological", lang: "en", note: "deep, serious, measured male" },
  { id: "voice_dl", label: "Voice DL", lang: "en", note: "bookmarked (DL)" },
  { id: "voice_de_stoic", label: "Stoische Gewohnheiten", lang: "de", note: "German — stoic narration" },
  { id: "voice_es_locutor", label: "Voz de locutor K", lang: "es", note: "Spanish — deep authoritative" },
];


