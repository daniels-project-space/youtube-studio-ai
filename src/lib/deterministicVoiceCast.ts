import { narrationPhysicsFor, type NarrationPhysics } from "@/engine/golden";
import { listAccountVoices, type AccountVoice } from "@/lib/voicecraft";

export interface ProviderVoiceCandidate {
  voiceId: string;
  name: string;
  category: string;
  labels: Record<string, string>;
  description?: string;
}

export interface DeterministicVoiceCast {
  provider: "elevenlabs";
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
}): DeterministicVoiceCast {
  const physics = narrationPhysicsFor(args.niche);
  const spec = physics.cast;
  const ranked = args.voices
    .map((voice) => {
      const labels = Object.fromEntries(Object.entries(voice.labels).map(([key, value]) => [normalized(key), normalized(value)]));
      const gender = labels["gender"];
      const age = labels["age"];
      const accent = labels["accent"];
      const useCase = labels["use case"] ?? labels["usecase"];
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
      if (/professional|cloned|premade/.test(normalized(voice.category))) {
        score += 0.4;
        reasons.push(`category:${normalized(voice.category)}`);
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
      "add a correctly labelled ElevenLabs voice or use an explicit human-reviewed cast",
    );
  }
  return {
    provider: "elevenlabs",
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
