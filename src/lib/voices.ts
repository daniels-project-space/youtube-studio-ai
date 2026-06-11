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

export const VOICES: VoiceOption[] = [
  { id: "sleepless_historian", label: "Sleepless Historian", lang: "en", note: "deep, authoritative male" },
  { id: "psychological", label: "Psychological", lang: "en", note: "deep, serious, measured male" },
  { id: "voice_dl", label: "Voice DL", lang: "en", note: "bookmarked (DL)" },
  { id: "voice_de_stoic", label: "Stoische Gewohnheiten", lang: "de", note: "German — stoic narration" },
  { id: "voice_es_locutor", label: "Voz de locutor K", lang: "es", note: "Spanish — deep authoritative" },
];

/** Default narration voice per language (used by language siblings). */
export const VOICE_BY_LANG: Record<string, string> = {
  en: "sleepless_historian",
  de: "voice_de_stoic",
  es: "voice_es_locutor",
};

export function voiceLabel(id?: string): string {
  if (!id) return "—";
  return VOICES.find((v) => v.id === id)?.label ?? id;
}
