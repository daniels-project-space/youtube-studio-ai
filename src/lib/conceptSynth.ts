/**
 * Channel-concept synthesis. Turns a one-line seed (+ optional niche research)
 * into a complete, normalized channel package through the pinned creative-text
 * route. Output is validated and defaulted so the builder never persists a
 * malformed channel.
 */
import { creativeTextJson, hasCreativeTextKey } from "@/lib/creativeText";
import { ARCHETYPE_KEYS, getArchetype } from "@/engine/archetypes";

export interface ChannelConcept {
  name: string;
  niche: string;
  persona: string;
  styleGrammar: string;
  palette: string[];
  topicPool: string[];
  bannedWords: string[];
  /** Short, exact identity phrases that the planned slate must revisit. */
  requiredCallbacks: string[];
  cadence: string;
  archetypeKey: string;
  voiceId?: string;
}

type Logger = (msg: string, extra?: Record<string, unknown>) => void;

export interface ChannelConceptSynthesisOptions {
  requireChannelSpecificVoice?: boolean;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const CADENCES = new Set(["daily", "weekly", "biweekly", "monthly"]);
const VOICE_PROFILE_FIELDS = [
  ["editorialLens", "Editorial lens"],
  ["audienceRelationship", "Audience relationship"],
  ["delivery", "Delivery"],
  ["boundaries", "Editorial boundaries"],
] as const;

function asStringArray(v: unknown, max: number, maxChars = 160): string[] {
  if (!Array.isArray(v)) return [];
  const values = v
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim().replace(/\s+/g, " ").slice(0, maxChars))
    .filter(Boolean);
  return values.filter((value, index) => (
    values.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index
  )).slice(0, max);
}

function composeVoiceProfile(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("conceptSynth: voiceProfile must define four channel-specific dimensions");
  }
  const profile = value as Record<string, unknown>;
  const sections = VOICE_PROFILE_FIELDS.map(([key, label]) => {
    const text = typeof profile[key] === "string"
      ? profile[key].trim().replace(/\s+/gu, " ")
      : "";
    if (text.length < 24 || text.length > 240) {
      throw new Error(`conceptSynth: voiceProfile.${key} must contain 24-240 characters`);
    }
    return `${label}: ${text}`;
  });
  const distinct = new Set(sections.map((section) => section.slice(section.indexOf(":") + 1).toLocaleLowerCase("en-US")));
  if (distinct.size !== sections.length) {
    throw new Error("conceptSynth: voiceProfile dimensions must be distinct");
  }
  return sections.join(". ");
}

/** Deterministic fallback so the builder works even without an LLM key. */
function fallbackConcept(seed: string): ChannelConcept {
  const name = seed.trim().replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60) || "New Channel";
  return {
    name,
    niche: seed.trim().toLowerCase(),
    persona: `An automated channel about ${seed.trim()}.`,
    styleGrammar: `clean, cohesive visuals for ${seed.trim()}`,
    palette: ["#0a0a1a", "#2ee6ff", "#ff2e88", "#ffb86c"],
    topicPool: [seed.trim()],
    bannedWords: [],
    requiredCallbacks: [],
    cadence: "weekly",
    archetypeKey: "lofi-ambient",
  };
}

export async function synthChannelConcept(
  seed: string,
  nicheContext: string | undefined,
  log: Logger = () => {},
  options: ChannelConceptSynthesisOptions = {},
): Promise<ChannelConcept> {
  if (!hasCreativeTextKey()) {
    if (options.requireChannelSpecificVoice) {
      throw new Error("conceptSynth: OpenRouter is required for a production channel-specific voice profile");
    }
    log("conceptSynth: no OpenRouter key — using deterministic fallback");
    return fallbackConcept(seed);
  }

  const system =
    "You are a YouTube channel strategist. Given a seed idea, design a complete, " +
    "coherent channel identity. Reply with STRICT JSON only, no prose.";
  const prompt = [
    `Seed idea: "${seed}".`,
    `Today's date is ${new Date().toISOString().slice(0, 10)}. If a topic references a year, use the current year (or none) — never a past year.`,
    nicheContext ? `Competitor research context:\n${nicheContext}` : "",
    `Choose the best archetype for this content from: ${ARCHETYPE_KEYS.join(", ")}.`,
    "Return JSON with exactly these keys:",
    `{
  "name": string (catchy channel name, <= 40 chars),
  "niche": string (2-4 words, lowercase),
  "voiceProfile": object with four distinct, concrete strings (24-240 characters each):
    - "editorialLens": what the channel notices, how it interprets the subject, and what makes its perspective distinct
    - "audienceRelationship": who it speaks to and how it treats their intelligence, emotions, and prior knowledge
    - "delivery": sentence rhythm, diction, pacing, and recurring rhetorical moves, written as usable directions
    - "boundaries": what it refuses to sensationalize or invent, how it handles uncertainty, and what it will not sound like
    For music, sleep, meditation, or other non-narrated formats, describe non-verbal editorial identity and sound behavior; do not invent a speaking host.
    Make all four specific to this seed and niche. Avoid generic labels such as "engaging", "informative", or "calm" unless made operational.
  "styleGrammar": string (comma-separated visual style descriptors for image gen, no text/words),
  "palette": string[] (3-5 hex colors like "#0a0a1a"),
  "topicPool": string[] (6-10 concrete video topic ideas),
  "bannedWords": string[] (0-6 words to avoid),
  "requiredCallbacks": string[] (2-4 exact, distinctive 2-5 word motifs or promise phrases this channel can naturally revisit across a weekly slate; no generic calls to action),
  "cadence": one of "daily"|"weekly"|"biweekly"|"monthly",
  "archetypeKey": one of the archetypes above
}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  let raw: Partial<Omit<ChannelConcept, "persona">> & {
    palette?: unknown;
    topicPool?: unknown;
    bannedWords?: unknown;
    voiceProfile?: unknown;
  };
  try {
    raw = await creativeTextJson({ prompt, system, tier: "pro", maxTokens: 1500, temperature: 0.7 });
  } catch (e) {
    if (options.requireChannelSpecificVoice) {
      throw new Error(`conceptSynth: production channel identity generation failed: ${e instanceof Error ? e.message : e}`);
    }
    log(`conceptSynth: LLM failed (${e instanceof Error ? e.message : e}) — fallback`);
    return fallbackConcept(seed);
  }

  const fb = fallbackConcept(seed);
  const archetypeKey = ARCHETYPE_KEYS.includes(raw.archetypeKey ?? "")
    ? (raw.archetypeKey as string)
    : "lofi-ambient";
  const palette = asStringArray(raw.palette, 5).filter((c) => HEX.test(c));
  const cadence =
    typeof raw.cadence === "string" && CADENCES.has(raw.cadence) ? raw.cadence : fb.cadence;
  const persona = composeVoiceProfile(raw.voiceProfile);

  const concept: ChannelConcept = {
    name: (typeof raw.name === "string" && raw.name.trim()) || fb.name,
    niche: (typeof raw.niche === "string" && raw.niche.trim().toLowerCase()) || fb.niche,
    persona,
    styleGrammar:
      (typeof raw.styleGrammar === "string" && raw.styleGrammar.trim()) || fb.styleGrammar,
    palette: palette.length >= 2 ? palette : fb.palette,
    topicPool: asStringArray(raw.topicPool, 12).length ? asStringArray(raw.topicPool, 12) : fb.topicPool,
    bannedWords: asStringArray(raw.bannedWords, 8),
    requiredCallbacks: asStringArray(raw.requiredCallbacks, 4, 60),
    cadence,
    archetypeKey,
    voiceId: getArchetype(archetypeKey).defaultVoiceId,
  };
  log("conceptSynth: concept ready", { name: concept.name, archetype: archetypeKey });
  return concept;
}
