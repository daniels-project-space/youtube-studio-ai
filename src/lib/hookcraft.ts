/**
 * HOOKCRAFT — the hook + opening engine (the script module's path to golden,
 * same shape as the banana thumbnail engine): one rich brief → candidate cold
 * opens on the latest Gemini Pro → deterministic craft lint → LLM judge gate →
 * one feedback retry → loud failure. The hook is ALWAYS specifically about the
 * topic — generic could-open-any-video lines are structurally rejected.
 *
 * Standalone: identity in → judged cold open out. Deps: Gemini key only.
 *
 *   const open = await craftHook({ topic, channelName, niche, ... });
 *   // open.hook (≤7s), open.opening (~20-30s), open.coldOpen (both)
 */
import { geminiJson, geminiJsonPro, hasGeminiKey } from "@/lib/gemini";

export function hasHookcraft(): boolean {
  return hasGeminiKey();
}

/**
 * Openers that mark a hook as mass-produced filler — any cold open containing
 * one of these fails lint outright (case-insensitive).
 */
export const BANNED_OPENERS = [
  "what if i told you",
  "in this video",
  "in today's video",
  "have you ever wondered",
  "have you ever noticed",
  "imagine a world",
  "imagine if",
  "picture this",
  "we all know",
  "everyone thinks",
  "they say that",
  "since the dawn of time",
  "throughout history",
  "history is full of",
  "welcome back",
  "welcome to",
  "let's dive in",
  "let's talk about",
  "buckle up",
  "this is the story of",
  "today we're going to",
  "today we are going to",
  "stop scrolling",
];

/**
 * Named cold-open devices. Candidates are written across DIFFERENT devices so
 * the judge picks the strongest execution for THIS topic, not one die-roll.
 */
export const HOOK_DEVICES: Record<string, string> = {
  cold_open_scene:
    "Drop the viewer INTO the single most charged moment of THIS topic - present tense, sensory, mid-action, " +
    "a specific person in a specific place. A scene, never a summary.",
  receipt:
    "Open with the most startling VERIFIED fact, number, or date of THIS topic, stated flat and confident, " +
    "then one line on why it should have been impossible.",
  contrarian_verdict:
    "State a verdict that inverts what everyone believes about THIS topic, then stake it with one concrete " +
    "supporting detail.",
  you_stakes:
    "Address the viewer as 'you' with the topic's sharpest personal consequence or test - concrete and " +
    "uncomfortable, never vague self-help.",
  countdown:
    "Open at the moment just BEFORE the topic's disaster or turning point, with the time pressure made " +
    "explicit - the viewer arrives with the clock already running.",
  confession_quote:
    "Open on the most damning or striking REAL attributed quote/admission from the topic's central figure, " +
    "then turn it against the comfortable reading.",
  myth_snap:
    "Name the precise myth everyone repeats about THIS topic, then snap it in one short sentence.",
};

export interface HookLint {
  pass: boolean;
  firstSentenceWords: number;
  estHookSeconds: number;
  hookSentences: number;
  openingWords: number;
  bannedHits: string[];
  issues: string[];
}

const WPS = 3.1; // matches scriptGen's calibrated TTS rate

function words(t: string): number {
  return t.split(/\s+/).filter(Boolean).length;
}

function sentences(t: string): string[] {
  return t.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Deterministic craft lint — the measurable half of CRAFT_RULES, enforced
 * instead of hoped for: hook lands in ~7s, ≤2 sentences, opening is a real
 * continuation, no banned mass-produced openers, concrete detail present.
 */
export function lintHook(
  hook: string,
  opening: string,
  opts: { skipConcreteness?: boolean } = {},
): HookLint {
  const issues: string[] = [];
  const hs = sentences(hook);
  const firstSentenceWords = hs.length ? words(hs[0]) : 0;
  const estHookSeconds = Math.round((words(hook) / WPS) * 10) / 10;
  const openingWords = words(opening);

  if (!hook.trim()) issues.push("hook is empty");
  if (hs.length > 2) issues.push(`hook is ${hs.length} sentences (max 2)`);
  if (firstSentenceWords > 22) issues.push(`first sentence is ${firstSentenceWords} words (max 22 — must land in ~7s)`);
  if (estHookSeconds > 10) issues.push(`hook speaks in ~${estHookSeconds}s (max ~10s)`);
  if (openingWords < 40 || openingWords > 140) issues.push(`opening is ${openingWords} words (want 50-110)`);

  const lower = `${hook} ${opening}`.toLowerCase();
  const bannedHits = BANNED_OPENERS.filter((b) => lower.includes(b));
  if (bannedHits.length) issues.push(`banned filler opener: ${bannedHits.join(", ")}`);

  // Concreteness floor: a digit or proper nouns beyond sentence starts in the
  // first ~3 sentences. (Soft heuristic — the judge's specificity dim carries
  // the real weight; this just kills the obviously generic.)
  if (!opts.skipConcreteness) {
    const head = [hook, ...sentences(opening).slice(0, 2)].join(" ");
    const hasDigit = /\d/.test(head);
    const midCaps = (head.match(/(?<![.!?…]\s)(?<!^)\b[A-Z][a-z]{2,}/g) ?? []).length;
    if (!hasDigit && midCaps < 1) issues.push("no concrete anchor (no number, name, or place) in the first 3 sentences");
  }

  // Average spoken sentence length across the whole cold open (CRAFT_RULES <15).
  const all = [...hs, ...sentences(opening)];
  const avg = all.length ? all.reduce((n, s) => n + words(s), 0) / all.length : 0;
  if (avg > 17) issues.push(`average sentence length ${avg.toFixed(1)} words (target <15)`);

  return { pass: issues.length === 0, firstSentenceWords, estHookSeconds, hookSentences: hs.length, openingWords, bannedHits, issues };
}

export interface HookVerdict {
  punch?: number;
  specificity?: number;
  curiosity?: number;
  voiceMatch?: number;
  honest?: boolean;
  note?: string;
}

export interface CraftedHook {
  /** The ≤7s spoken hook (1-2 sentences). */
  hook: string;
  /** The ~20-30s continuation that escalates and opens the loop. */
  opening: string;
  /** hook + opening joined — the full spoken cold open. */
  coldOpen: string;
  /** Which HOOK_DEVICES key won. */
  device: string;
  verdict: HookVerdict & { lint: HookLint };
}

export interface HookCraftArgs {
  topic: string;
  channelName?: string;
  niche?: string;
  persona?: string;
  /** Style-DNA narrative register (beats generic tone). */
  narrative?: { scriptStyle?: string; hookStyle?: string; pacing?: string; delivery?: string };
  /** Archetype tone: essay | crime | shorts | meditation | generic. */
  style?: string;
  /** Script Lab playbook digest (hook rules from WATCHED top performers). */
  playbookDigest?: string;
  /** Director (crew) hook idea — honored as intent, crafted for execution. */
  directorIdea?: string;
  /** Spoken language directive (non-English channels). */
  language?: string;
  log?: (msg: string) => void;
}

const GATE = 7;

function passes(v: HookVerdict): boolean {
  return (
    (v.punch ?? 10) >= GATE &&
    (v.specificity ?? 10) >= GATE &&
    (v.curiosity ?? 10) >= GATE &&
    (v.voiceMatch ?? 10) >= GATE &&
    v.honest !== false
  );
}

function registerClause(a: HookCraftArgs): string {
  const reg = a.narrative && (a.narrative.scriptStyle || a.narrative.hookStyle || a.narrative.delivery)
    ? `LOCKED CHANNEL REGISTER (write inside it): ${[
        a.narrative.scriptStyle ? `style: ${a.narrative.scriptStyle}` : "",
        a.narrative.hookStyle ? `hook style: ${a.narrative.hookStyle}` : "",
        a.narrative.delivery ? `delivery: ${a.narrative.delivery}` : "",
      ].filter(Boolean).join(" | ")}`
    : "";
  return [
    a.channelName ? `Channel: "${a.channelName}".` : "",
    a.niche ? `Niche: ${a.niche}.` : "",
    a.persona ? `Persona: ${a.persona}` : "",
    reg,
  ].filter(Boolean).join("\n");
}

/**
 * The engine: brief → 3 device-diverse candidates (latest Gemini Pro) →
 * deterministic lint → judge gate → ONE feedback retry → judged cold open.
 * Throws when both attempts fail (callers get an honest failure, never a
 * could-open-any-video hook).
 */
export async function craftHook(a: HookCraftArgs): Promise<CraftedHook> {
  if (!hasGeminiKey()) throw new Error("hookcraft: GEMINI_API_KEY missing — cannot craft a real hook");
  const skipConcreteness = a.style === "meditation";
  const deviceList = Object.entries(HOOK_DEVICES)
    .filter(([k]) => (a.style === "meditation" ? k === "you_stakes" || k === "cold_open_scene" || k === "myth_snap" : true))
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  const lang = a.language && a.language !== "en" ? `\nWrite all spoken text in ${a.language}.` : "";

  let fixNote = "";
  let lastIssues: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const gen = await geminiJsonPro<{ candidates?: { device?: string; hook?: string; opening?: string }[] }>({
      prompt: [
        `You are the cold-open director. Write the spoken COLD OPEN for a YouTube video.`,
        `VIDEO TOPIC — the open must be SPECIFICALLY about this; a line that could open any video is a failure:`,
        `"${a.topic}"`,
        registerClause(a),
        a.playbookDigest ?? "",
        a.directorIdea ? `Director's hook intent (honor the idea, craft the execution): "${a.directorIdea}"` : "",
        `Write 3 candidates, EACH using a DIFFERENT device from this list (pick the 3 that best fit this topic and register):`,
        deviceList,
        `Per candidate:`,
        `- hook: 1-2 spoken sentences. FIRST sentence ≤ 20 words — it must land inside ~7 seconds.`,
        `- opening: the NEXT 50-110 spoken words. Escalate the hook with at least one more concrete specific ` +
          `(a name, number, date, place, object of THIS topic) and open a loop the video promises to close. ` +
          `No meta ("in this video", "today we"), no greeting, no channel name, no restating the title.`,
        `HARD RULES: concrete over abstract — name the person/place/number/year of THIS topic within the first ` +
          `3 sentences${skipConcreteness ? " (soft for meditative register)" : ""}. Short spoken sentences, average ` +
          `under 15 words. The promise must be honest — never claim what the topic can't deliver, and NEVER invent ` +
          `first-person research the channel hasn't done ("we analyzed", "I reviewed the filings") — cite real ` +
          `public facts instead. NEVER use these openers: ${BANNED_OPENERS.join("; ")}.`,
        `Plain spoken text only — no markdown, brackets, or stage directions.${lang}`,
        fixNote,
        `Return STRICT JSON {"candidates":[{"device":string,"hook":string,"opening":string}]}.`,
      ].filter(Boolean).join("\n\n"),
      maxTokens: 8000,
      temperature: 0.95,
      log: a.log,
    });

    const candidates = (gen.candidates ?? [])
      .map((c) => ({ device: String(c.device ?? "unknown"), hook: String(c.hook ?? "").trim(), opening: String(c.opening ?? "").trim() }))
      .filter((c) => c.hook && c.opening)
      .map((c) => ({ ...c, lint: lintHook(c.hook, c.opening, { skipConcreteness }) }));
    const survivors = candidates.filter((c) => c.lint.pass);
    lastIssues = candidates.flatMap((c) => c.lint.issues);
    a.log?.(`hookcraft: ${candidates.length} candidates, ${survivors.length} pass lint${survivors.length ? "" : ` (${lastIssues.slice(0, 3).join("; ")})`}`);

    if (survivors.length) {
      // Judge the lint survivors (cheap fast model; judge down = lint-only pass).
      let verdicts: HookVerdict[] = [];
      let best = 0;
      try {
        const j = await geminiJson<{ verdicts?: HookVerdict[]; best?: number }>({
          prompt: [
            `You are a brutal YouTube retention judge. Topic: "${a.topic}".`,
            registerClause(a),
            `Score EACH candidate cold open 1-10 per dimension:`,
            `- punch: would a scroller STOP inside the first sentence?`,
            `- specificity: concrete THIS-topic detail vs generic filler that could open any video?`,
            `- curiosity: does it open a loop that DEMANDS the payoff?`,
            `- voiceMatch: does it fit the channel register?`,
            `- honest (boolean): no overclaim the video can't deliver?`,
            ...survivors.map((c, i) => `CANDIDATE ${i} (${c.device}):\n${c.hook}\n${c.opening}`),
            `Return STRICT JSON {"verdicts":[{"punch":n,"specificity":n,"curiosity":n,"voiceMatch":n,"honest":bool,"note":"<=15 words"}],"best":n}.`,
          ].join("\n\n"),
          maxTokens: 1600,
          temperature: 0.2,
        });
        verdicts = j.verdicts ?? [];
        best = typeof j.best === "number" && j.best >= 0 && j.best < survivors.length ? j.best : 0;
      } catch (e) {
        a.log?.(`hookcraft: judge unreachable (${e instanceof Error ? e.message : e}) — lint-only pass`);
      }

      // Prefer the judge's pick if it gates; else any gating candidate.
      const order = [best, ...survivors.map((_, i) => i).filter((i) => i !== best)];
      for (const i of order) {
        const v = verdicts[i] ?? {};
        if (passes(v)) {
          const c = survivors[i];
          a.log?.(`hookcraft: "${c.device}" wins (punch ${v.punch ?? "?"}, specificity ${v.specificity ?? "?"}, curiosity ${v.curiosity ?? "?"})`);
          return { hook: c.hook, opening: c.opening, coldOpen: `${c.hook}\n\n${c.opening}`, device: c.device, verdict: { ...v, lint: c.lint } };
        }
      }
      lastIssues = verdicts.map((v) => v.note ?? "").filter(Boolean);
    }

    fixNote =
      `THE PREVIOUS ATTEMPT WAS REJECTED. Fix every one of these and come back stronger: ` +
      `${[...new Set(lastIssues)].slice(0, 6).join("; ") || "more punch, more concrete topic detail, tighter first sentence"}.`;
    a.log?.(`hookcraft: attempt ${attempt + 1} rejected -> ${attempt === 0 ? "retrying with fix" : "FAILING LOUD"}`);
  }
  throw new Error(`hookcraft: both attempts failed the gate (${[...new Set(lastIssues)].slice(0, 4).join("; ")})`);
}
