import { narrationPhysicsFor, type NarrationPhysics } from "@/engine/golden";
import {
  QWEN3_TTS_SPEAKER_PROFILES,
  QWEN3_TTS_SPEAKERS,
  type QwenTtsLanguage,
  type QwenTtsSpeaker,
} from "@/lib/qwenTts";
import { listAccountVoices, type AccountVoice } from "@/lib/voicecraft";

export interface ProviderVoiceCandidate {
  voiceId: string;
  name: string;
  category: string;
  labels: Record<string, string>;
  description?: string;
}

export interface DeterministicVoiceCast {
  provider: "elevenlabs" | "qwen3";
  voiceId: string;
  name: string;
  character: string;
  /** A metadata-fit score, never represented as a listened/audition score. */
  selectionScore: number;
  why: string;
  shortlisted: Array<{ name: string; score: number; reasons: string[] }>;
  physics: NarrationPhysics & { archetype?: string };
}

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

function includes(value: unknown, expected: string | undefined): boolean {
  const wanted = normalized(expected);
  return !wanted || normalized(value).includes(wanted);
}

function ageCompatible(expected: string | undefined, actual: string | undefined): boolean {
  const wanted = normalized(expected);
  const heard = normalized(actual);
  if (!wanted || wanted === "any" || !heard) return true;
  if (heard.includes(wanted)) return true;
  const rank: Record<string, number> = {
    young: 1,
    adult: 2,
    "middle aged": 3,
    mature: 4,
    old: 5,
  };
  return rank[wanted] !== undefined && rank[heard] !== undefined && Math.abs(rank[wanted] - rank[heard]) <= 1;
}

function candidateRecord(voice: AccountVoice): ProviderVoiceCandidate {
  return {
    voiceId: voice.voiceId,
    name: voice.name,
    category: voice.category,
    labels: voice.labels,
    ...(voice.description ? { description: voice.description } : {}),
  };
}

/**
 * Pure deterministic selection from provider-declared voice metadata. This is
 * deliberately a *pre-cast*: it cannot certify performance or delivery. A
 * measured cold-open and the final narration QA must still pass before use.
 */
export function selectVoiceFromProviderMetadata(args: {
  voices: readonly ProviderVoiceCandidate[];
  niche?: string;
  provider?: DeterministicVoiceCast["provider"];
  requiredVoiceId?: string;
  targetLanguage?: string;
}): DeterministicVoiceCast {
  const physics = narrationPhysicsFor(args.niche);
  const spec = physics.cast;
  const provider = args.provider ?? "elevenlabs";
  const requiredVoiceId = args.requiredVoiceId?.trim();
  const targetLanguage = normalized(args.targetLanguage);
  const ranked = args.voices
    .filter((voice) => !requiredVoiceId || voice.voiceId === requiredVoiceId)
    .map((voice) => {
      const labels = Object.fromEntries(Object.entries(voice.labels).map(([key, value]) => [normalized(key), normalized(value)]));
      const gender = labels["gender"];
      const age = labels["age"];
      const accent = labels["accent"];
      const useCase = labels["use case"] ?? labels["usecase"];
      const nativeLanguage = labels["native language"] ?? labels["native_language"];
      const description = normalized(`${voice.name} ${voice.category} ${voice.description ?? ""} ${Object.values(labels).join(" ")}`);
      if (spec.gender !== "any" && gender && !includes(gender, spec.gender) && gender !== "neutral") return undefined;
      if (!ageCompatible(spec.age, age)) return undefined;
      if (spec.accent && accent && !includes(accent, spec.accent)) return undefined;
      const reasons: string[] = [];
      let score = 5.5;
      if (spec.gender === "any" || !gender || includes(gender, spec.gender) || gender === "neutral") {
        score += spec.gender === "any" || !gender ? 0.25 : 1.25;
        if (gender) reasons.push(`gender:${gender}`);
      }
      if (spec.age === "any" || !age || ageCompatible(spec.age, age)) {
        score += spec.age === "any" || !age ? 0.25 : 0.9;
        if (age) reasons.push(`age:${age}`);
      }
      if (!spec.accent || !accent || includes(accent, spec.accent)) {
        score += !spec.accent || !accent ? 0.15 : 0.65;
        if (accent) reasons.push(`accent:${accent}`);
      }
      const narrativeUseCase = /narrative|informative|educational|documentary|conversational/.test(useCase ?? "");
      if (narrativeUseCase) {
        score += 0.85;
        reasons.push(`use_case:${useCase}`);
      }
      if (/professional|cloned|premade|premium|customvoice/.test(normalized(voice.category))) {
        score += 0.4;
        reasons.push(`category:${normalized(voice.category)}`);
      }
      if (targetLanguage && nativeLanguage && includes(nativeLanguage, targetLanguage)) {
        score += 0.75;
        reasons.push(`native_language:${nativeLanguage}`);
      }
      const archetypeMatch = normalized(physics.archetype)
        .split(" ")
        .filter((token) => token.length >= 4)
        .some((token) => description.includes(token));
      if (archetypeMatch) {
        score += 0.35;
        reasons.push(`archetype:${physics.archetype}`);
      }
      return { voice, score: Number(Math.min(10, score).toFixed(2)), reasons };
    })
    .filter((entry): entry is { voice: ProviderVoiceCandidate; score: number; reasons: string[] } => Boolean(entry))
    .sort((left, right) => right.score - left.score || left.voice.name.localeCompare(right.voice.name) || left.voice.voiceId.localeCompare(right.voice.voiceId));
  const winner = ranked[0];
  if (!winner || winner.score < 7) {
    throw new Error(
      `deterministic_voice_cast: no provider-declared voice meets the metadata-fit minimum for ${physics.archetype}; ` +
      `select a compatible ${provider} voice or use an explicit human-reviewed cast`,
    );
  }
  return {
    provider,
    voiceId: winner.voice.voiceId,
    name: winner.voice.name,
    character: spec.character,
    selectionScore: winner.score,
    why: `provider metadata fit (${winner.reasons.join(", ") || "compatible account voice"}); real cold-open audio remains mandatory`,
    shortlisted: ranked.slice(0, 6).map((entry) => ({ name: entry.voice.name, score: entry.score, reasons: entry.reasons })),
    physics,
  };
}

export async function selectDeterministicElevenVoice(args: { niche?: string }): Promise<DeterministicVoiceCast> {
  return selectVoiceFromProviderMetadata({
    voices: (await listAccountVoices()).map(candidateRecord),
    niche: args.niche,
  });
}

function qwenCandidate(speaker: QwenTtsSpeaker): ProviderVoiceCandidate {
  const profile = QWEN3_TTS_SPEAKER_PROFILES[speaker];
  const description = normalized(profile.description);
  const gender = description.includes("female") ? "female" : description.includes("male") ? "male" : "neutral";
  const age = /young|youthful/.test(description) ? "young" : "";
  const accent = description.includes("american")
    ? "american"
    : description.includes("beijing")
      ? "beijing"
      : description.includes("chengdu")
        ? "chengdu"
        : "";
  return {
    voiceId: speaker,
    name: speaker.replaceAll("_", " "),
    category: "premium CustomVoice",
    labels: {
      gender,
      ...(age ? { age } : {}),
      ...(accent ? { accent } : {}),
      "native language": profile.nativeLanguage,
    },
    description: profile.description,
  };
}

/**
 * Exact Qwen CustomVoice pre-cast from the official nine-speaker catalog.
 * The provider-rendered cold open and production take still have to pass their
 * separate physical-audio gates before this selection is usable.
 */
export function selectDeterministicQwenVoice(args: {
  niche?: string;
  speaker: string;
  language: QwenTtsLanguage;
}): DeterministicVoiceCast {
  if (!(QWEN3_TTS_SPEAKERS as readonly string[]).includes(args.speaker)) {
    throw new Error(`deterministic_voice_cast: unsupported Qwen CustomVoice speaker ${args.speaker || "missing"}`);
  }
  return selectVoiceFromProviderMetadata({
    voices: QWEN3_TTS_SPEAKERS.map(qwenCandidate),
    niche: args.niche,
    provider: "qwen3",
    requiredVoiceId: args.speaker,
    targetLanguage: args.language,
  });
}
