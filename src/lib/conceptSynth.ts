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

const HEX = /^#[0-9a-fA-F]{6}$/;
const CADENCES = new Set(["daily", "weekly", "biweekly", "monthly"]);
const MIN_TOPIC_POOL_SIZE = 6;
const MAX_TOPIC_POOL_SIZE = 10;
const CALLBACK_WORDS = new Intl.Segmenter(undefined, { granularity: "word" });
const GENERIC_CALLBACK_CTA = /\b(?:subscribe|follow|like|comment|ring the bell)\b/i;

interface ConceptContract {
  palette: string[];
  topicPool: string[];
  requiredCallbacks: string[];
  archetypeKey?: string;
  issues: string[];
}

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

function isValidCallback(value: string): boolean {
  const wordCount = Array.from(CALLBACK_WORDS.segment(value)).filter((part) => part.isWordLike).length;
  return wordCount >= 2 && wordCount <= 5 && !GENERIC_CALLBACK_CTA.test(value);
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

function inspectConceptContract(
  raw: Partial<ChannelConcept> & { palette?: unknown; topicPool?: unknown; requiredCallbacks?: unknown },
): ConceptContract {
  const palette = asStringArray(raw.palette, 5).filter((color) => HEX.test(color));
  const topicPool = asStringArray(raw.topicPool, MAX_TOPIC_POOL_SIZE);
  const requiredCallbacks = asStringArray(raw.requiredCallbacks, 4, 60).filter(isValidCallback);
  const archetypeKey = ARCHETYPE_KEYS.includes(raw.archetypeKey ?? "") ? raw.archetypeKey : undefined;
  const issues: string[] = [];
  if (palette.length < 3) issues.push(`palette must contain at least 3 valid unique hex colors (got ${palette.length})`);
  if (topicPool.length < MIN_TOPIC_POOL_SIZE) {
    issues.push(`topicPool must contain at least ${MIN_TOPIC_POOL_SIZE} unique concrete video topic ideas (got ${topicPool.length})`);
  }
  if (requiredCallbacks.length < 2) {
    issues.push(
      `requiredCallbacks must contain 2-4 unique 2-5 word identity motifs and no generic calls to action ` +
      `(got ${requiredCallbacks.length} usable)`,
    );
  }
  if (!archetypeKey) issues.push("archetypeKey must be an allowed archetypeKey from the original list");
  return { palette, topicPool, requiredCallbacks, archetypeKey, issues };
}

export async function synthChannelConcept(
  seed: string,
  nicheContext: string | undefined,
  log: Logger = () => {},
): Promise<ChannelConcept> {
  if (!hasCreativeTextKey()) {
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
  "persona": string (1-2 sentences describing the channel's voice/vibe),
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

  let raw: Partial<ChannelConcept> & { palette?: unknown; topicPool?: unknown; bannedWords?: unknown };
  try {
    raw = await creativeTextJson({ prompt, system, tier: "pro", maxTokens: 1500, temperature: 0.7 });
  } catch (e) {
    log(`conceptSynth: LLM failed (${e instanceof Error ? e.message : e}) — fallback`);
    return fallbackConcept(seed);
  }

  let contract = inspectConceptContract(raw);
  if (contract.issues.length) {
    log(`conceptSynth: incomplete concept contract (${contract.issues.length} issue(s)) — requesting one repair`);
    raw = await creativeTextJson({
      prompt: `${prompt}\n\nREPAIR these contract violations in the full JSON response: ${contract.issues.join("; ")}.`,
      system,
      tier: "pro",
      maxTokens: 1500,
      temperature: 0.7,
    });
    contract = inspectConceptContract(raw);
    if (contract.issues.length) {
      const archetypeIssue = contract.issues.find((issue) => issue.startsWith("archetypeKey"));
      if (archetypeIssue) throw new Error(`conceptSynth: invalid archetypeKey after repair (${contract.issues.join("; ")})`);
      throw new Error(`conceptSynth: output contract failed after repair (${contract.issues.join("; ")})`);
    }
  }

  const fb = fallbackConcept(seed);
  const archetypeKey = contract.archetypeKey!;
  const cadence =
    typeof raw.cadence === "string" && CADENCES.has(raw.cadence) ? raw.cadence : fb.cadence;

  const concept: ChannelConcept = {
    name: (typeof raw.name === "string" && raw.name.trim()) || fb.name,
    niche: (typeof raw.niche === "string" && raw.niche.trim().toLowerCase()) || fb.niche,
    persona: (typeof raw.persona === "string" && raw.persona.trim()) || fb.persona,
    styleGrammar:
      (typeof raw.styleGrammar === "string" && raw.styleGrammar.trim()) || fb.styleGrammar,
    palette: contract.palette,
    topicPool: contract.topicPool,
    bannedWords: asStringArray(raw.bannedWords, 6),
    requiredCallbacks: contract.requiredCallbacks,
    cadence,
    archetypeKey,
    voiceId: getArchetype(archetypeKey).defaultVoiceId,
  };
  log("conceptSynth: concept ready", { name: concept.name, archetype: archetypeKey });
  return concept;
}
