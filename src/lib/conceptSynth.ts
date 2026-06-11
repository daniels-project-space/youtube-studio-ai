/**
 * Channel-concept synthesis. Turns a one-line seed (+ optional niche research)
 * into a complete, normalized channel package via Claude. Output is validated
 * and defaulted so the builder never persists a malformed channel.
 */
import { claudeJson, hasAnthropicKey } from "@/lib/anthropic";
import { ARCHETYPE_KEYS, getArchetype } from "@/engine/archetypes";

export interface ChannelConcept {
  name: string;
  niche: string;
  persona: string;
  styleGrammar: string;
  palette: string[];
  topicPool: string[];
  bannedWords: string[];
  cadence: string;
  archetypeKey: string;
  voiceId?: string;
}

type Logger = (msg: string, extra?: Record<string, unknown>) => void;

const HEX = /^#[0-9a-fA-F]{6}$/;
const CADENCES = new Set(["daily", "weekly", "biweekly", "monthly"]);

function asStringArray(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, max);
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
    cadence: "weekly",
    archetypeKey: "lofi-ambient",
  };
}

export async function synthChannelConcept(
  seed: string,
  nicheContext: string | undefined,
  log: Logger = () => {},
): Promise<ChannelConcept> {
  if (!hasAnthropicKey()) {
    log("conceptSynth: no Anthropic key — using deterministic fallback");
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
  "persona": string (1-2 sentences describing the channel's voice/vibe),
  "styleGrammar": string (comma-separated visual style descriptors for image gen, no text/words),
  "palette": string[] (3-5 hex colors like "#0a0a1a"),
  "topicPool": string[] (6-10 concrete video topic ideas),
  "bannedWords": string[] (0-6 words to avoid),
  "cadence": one of "daily"|"weekly"|"biweekly"|"monthly",
  "archetypeKey": one of the archetypes above
}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  let raw: Partial<ChannelConcept> & { palette?: unknown; topicPool?: unknown; bannedWords?: unknown };
  try {
    raw = await claudeJson({ prompt, system, maxTokens: 1500, temperature: 0.7 });
  } catch (e) {
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

  const concept: ChannelConcept = {
    name: (typeof raw.name === "string" && raw.name.trim()) || fb.name,
    niche: (typeof raw.niche === "string" && raw.niche.trim().toLowerCase()) || fb.niche,
    persona: (typeof raw.persona === "string" && raw.persona.trim()) || fb.persona,
    styleGrammar:
      (typeof raw.styleGrammar === "string" && raw.styleGrammar.trim()) || fb.styleGrammar,
    palette: palette.length >= 2 ? palette : fb.palette,
    topicPool: asStringArray(raw.topicPool, 12).length ? asStringArray(raw.topicPool, 12) : fb.topicPool,
    bannedWords: asStringArray(raw.bannedWords, 8),
    cadence,
    archetypeKey,
    voiceId: getArchetype(archetypeKey).defaultVoiceId,
  };
  log("conceptSynth: concept ready", { name: concept.name, archetype: archetypeKey });
  return concept;
}
