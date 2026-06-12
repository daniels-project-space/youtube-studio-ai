/**
 * HOOKCRAFT — the hook + opening engine (the script module's path to golden,
 * same shape as the banana thumbnail engine): one rich brief → candidate cold
 * opens on the latest Gemini Pro → deterministic craft lint → LLM judge gate →
 * one feedback retry → loud failure. The hook is ALWAYS specifically about the
 * topic — generic could-open-any-video lines are structurally rejected.
 *
 * Built on 2026 retention research (PrePublish/Miraflow + the claude-youtube
 * hook skill's mechanisms): the 0-30s arc is capture (0-5s, confirm the
 * clicked promise) → explicit payoff promise by ~15s (52% vs 44% retention at
 * 1min) → stakes + open loop by 30s; the steepest drop is seconds 10-20.
 *
 * Standalone: identity in → judged cold open out. Deps: Gemini key only.
 *
 *   const open = await craftHook({ topic, channelName, niche, ... });
 *   // open.hook (≤7s), open.opening (~20-30s), open.coldOpen (both)
 */
import { geminiJson, geminiJsonPro, geminiGroundedJson, hasGeminiKey } from "@/lib/gemini";
import { resolveVoiceDoctrine } from "@/engine/golden";

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
  "hey guys",
  "hey everyone",
  "let's dive in",
  "let's talk about",
  "buckle up",
  "this is the story of",
  "today we're going to",
  "today we are going to",
  "stop scrolling",
  // Retention killers (PrePublish 2026 research: removing these alone lifts
  // first-minute retention 4-10 points): disclaimers, apologies, and
  // premature engagement asks have no place in a cold open.
  "before we get started",
  "before we begin",
  "before we start",
  "quick disclaimer",
  "sorry for",
  "like and subscribe",
  "make sure to subscribe",
  "don't forget to subscribe",
  "hit that",
  "smash that",
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
  problem_agitation:
    "Name the viewer's existing pain around THIS topic precisely, twist it one turn deeper than they've " +
    "admitted to themselves, then position the video as the way out.",
  social_proof:
    "Lead with the topic's strongest credibility marker (a real authority, study, track record, or scale " +
    "number), then pivot immediately to what it means for the viewer.",
  result_first:
    "Show the finished result or end-state of THIS topic first - the transformation, the number, the " +
    "after-photo in words - then promise the process that produced it.",
  wrong_way:
    "Open on the precise mistake most people make with THIS topic and its concrete cost, then promise the " +
    "correction.",
  flash_forward:
    "Open on the most dramatic moment from LATER in this video's own story, mid-action, then rewind: " +
    "'but hours earlier, nobody suspected...' - the viewer must watch to reach that moment again.",
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
  /** Payoff promise lands by ~15s — viewers who get it retain 52% vs 44% at 1min. */
  promise?: number;
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
  /** The exact promise/open loop this cold open creates — the script MUST pay it off. */
  loop: string;
  verdict: HookVerdict & { lint: HookLint; factCheck: "verified" | "skipped" | "unchecked" };
}

export interface HookCraftArgs {
  topic: string;
  /** The video's (working) title — the cold open must confirm the clicked promise. */
  title?: string;
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

/** Channels that invent in-world facts by design skip grounding. */
function isFictionRegister(niche?: string, style?: string): boolean {
  return style === "meditation" || /fiction|sci-fi|speculative|fantasy/i.test(niche ?? "");
}

/**
 * Grounded fact-check of a cold open's checkable claims (Google-Search-
 * grounded Gemini). Specificity pressure invites confident invention — one
 * wrong number in the first sentence costs the channel its credibility, so a
 * "false" verdict on any claim rejects the candidate. "unverifiable" passes
 * with a log (soft claims and paraphrases often won't ground cleanly); a dead
 * fact-checker passes on the judge gates alone, loudly.
 */
async function factCheckColdOpen(
  c: { hook: string; opening: string },
  a: HookCraftArgs,
): Promise<{ ok: boolean; problems: string[]; status: "verified" | "unchecked" }> {
  try {
    const v = await geminiGroundedJson<{ claims?: { claim?: string; status?: string; note?: string }[] }>({
      prompt:
        `Fact-check this YouTube cold open using web search. Topic: "${a.topic}".\n\n` +
        `"${c.hook} ${c.opening}"\n\n` +
        `List every independently checkable factual claim (numbers, dates, dollar amounts, named people/events, ` +
        `attributed quotes). For each, search and mark status: "verified" (sources confirm it; minor rounding is ` +
        `fine), "false" (sources contradict it), or "unverifiable" (no sources found either way). note: <=15 words ` +
        `(the correction when false). Framing, opinion, and clearly-hypothetical lines are NOT claims. ` +
        `Return STRICT JSON {"claims":[{"claim":string,"status":string,"note":string}]}.`,
      maxTokens: 3000,
    });
    const claims = v.claims ?? [];
    const problems = claims
      .filter((x) => x.status === "false")
      .map((x) => `"${(x.claim ?? "").slice(0, 80)}" is wrong — ${x.note ?? "sources contradict it"}`);
    const unverifiable = claims.filter((x) => x.status === "unverifiable").length;
    a.log?.(
      `hookcraft: fact-check — ${claims.length} claims: ${claims.length - problems.length - unverifiable} verified, ` +
      `${problems.length} false, ${unverifiable} unverifiable`,
    );
    return { ok: problems.length === 0, problems, status: "verified" as const };
  } catch (e) {
    a.log?.(`hookcraft: fact-checker unreachable (${e instanceof Error ? e.message : e}) — passing on judge gates alone`);
    return { ok: true, problems: [], status: "unchecked" as const };
  }
}

function passes(v: HookVerdict): boolean {
  return (
    (v.punch ?? 10) >= GATE &&
    (v.specificity ?? 10) >= GATE &&
    (v.curiosity ?? 10) >= GATE &&
    (v.voiceMatch ?? 10) >= GATE &&
    (v.promise ?? 10) >= GATE &&
    v.honest !== false
  );
}

function registerClause(a: HookCraftArgs): string {
  const reg = a.narrative && (a.narrative.scriptStyle || a.narrative.hookStyle || a.narrative.delivery)
    ? `LOCKED CHANNEL REGISTER (write inside it — it outranks the archetype below): ${[
        a.narrative.scriptStyle ? `style: ${a.narrative.scriptStyle}` : "",
        a.narrative.hookStyle ? `hook style: ${a.narrative.hookStyle}` : "",
        a.narrative.delivery ? `delivery: ${a.narrative.delivery}` : "",
      ].filter(Boolean).join(" | ")}`
    : "";
  const doctrine = resolveVoiceDoctrine(a.niche);
  return [
    a.channelName ? `Channel: "${a.channelName}".` : "",
    a.niche ? `Niche: ${a.niche}.` : "",
    a.persona ? `Persona: ${a.persona}` : "",
    reg,
    doctrine
      ? `VOICE ARCHETYPE "${doctrine.voice}" — how this kind of channel must SOUND: ${doctrine.tone}\n` +
        `Cold-open doctrine for this voice: ${doctrine.hookStyle}`
      : "",
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
    const gen = await geminiJsonPro<{ candidates?: { device?: string; hook?: string; opening?: string; loop?: string }[] }>({
      prompt: [
        `You are the cold-open director. Write the spoken COLD OPEN for a YouTube video.`,
        `VIDEO TOPIC — the open must be SPECIFICALLY about this; a line that could open any video is a failure:`,
        `"${a.topic}"`,
        a.title ? `VIDEO TITLE (the promise the viewer clicked): "${a.title}"` : "",
        registerClause(a),
        a.playbookDigest ?? "",
        a.directorIdea ? `Director's hook intent (honor the idea, craft the execution): "${a.directorIdea}"` : "",
        `FIRST, silently analyze the topic: its core tension, its single most surprising VERIFIED fact, the ` +
          `viewer's pain or fascination, and the emotional stakes. Write every candidate FROM that analysis.`,
        `Write 4 candidates, EACH using a DIFFERENT device from this list (pick the 4 that best fit this topic ` +
          `and register; for search-intent topics favor problem_agitation/wrong_way/result_first, for ` +
          `browse/suggested-style topics favor curiosity, contrarian and scene devices):`,
        deviceList,
        `Per candidate, the proven 0-30s retention arc (the steepest drop is seconds 10-20 — viewers decide at ` +
          `~15s whether the video honors its promise):`,
        `- hook (seconds 0-7): 1-2 spoken sentences, FIRST sentence ≤ 20 words. Pattern-breaks AND confirms ` +
          `the viewer clicked the right video — the topic must be unmistakable immediately.`,
        `- opening (seconds 7-30): the NEXT 50-110 spoken words. By ~15 seconds total the PAYOFF must be ` +
          `explicit — the viewer knows exactly what they will get and why it is worth the runtime (videos that ` +
          `do this retain 52% vs 44% at the 1-minute mark). Then escalate with at least one more concrete ` +
          `specific (a name, number, date, place, object of THIS topic) and close on an open loop the video ` +
          `promises to pay off. No meta ("in this video", "today we"), no greeting, no channel name, no ` +
          `restating the title verbatim.`,
        `HARD RULES: concrete over abstract — name the person/place/number/year of THIS topic within the first ` +
          `3 sentences${skipConcreteness ? " (soft for meditative register)" : ""}. Short spoken sentences, average ` +
          `under 15 words. The promise must be honest — never claim what the topic can't deliver, and NEVER invent ` +
          `first-person research the channel hasn't done ("we analyzed", "I reviewed the filings") — cite real ` +
          `public facts instead. No disclaimers, no apologies, no subscribe asks. NEVER use these openers: ` +
          `${BANNED_OPENERS.join("; ")}.`,
        `Plain spoken text only — no markdown, brackets, or stage directions.${lang}`,
        fixNote,
        `Return STRICT JSON {"candidates":[{"device":string,"hook":string,"opening":string,` +
          `"loop":string (ONE sentence: the exact promise this cold open makes — what the video must pay off)}]}.`,
      ].filter(Boolean).join("\n\n"),
      maxTokens: 9000,
      temperature: 0.95,
      log: a.log,
    });

    const candidates = (gen.candidates ?? [])
      .map((c) => ({
        device: String(c.device ?? "unknown"),
        hook: String(c.hook ?? "").trim(),
        opening: String(c.opening ?? "").trim(),
        loop: String(c.loop ?? "").trim(),
      }))
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
            a.title ? `Video title (the clicked promise): "${a.title}".` : "",
            registerClause(a),
            `Score EACH candidate cold open 1-10 per dimension:`,
            `- punch: would a scroller STOP inside the first sentence?`,
            `- specificity: concrete THIS-topic detail vs generic filler that could open any video?`,
            `- curiosity: does it open a loop that DEMANDS the payoff?`,
            `- voiceMatch: does it fit the channel register AND its voice archetype (a history channel ` +
              `teaches while it narrates; a finance channel sounds like a calm teacher-advisor; a ` +
              `chaos/drama channel fires the loudest verified fact immediately)?`,
            `- promise: by ~15 seconds (the first ~45 spoken words), does the viewer know EXACTLY what they ` +
              `will get and why it is worth the runtime${a.title ? ", and that it honors the clicked title" : ""}?`,
            `- honest (boolean): no overclaim, and no fabricated first-person research ("we analyzed...")?`,
            ...survivors.map((c, i) => `CANDIDATE ${i} (${c.device}):\n${c.hook}\n${c.opening}`),
            `Return STRICT JSON {"verdicts":[{"punch":n,"specificity":n,"curiosity":n,"voiceMatch":n,"promise":n,"honest":bool,"note":"<=15 words"}],"best":n}.`,
          ].filter(Boolean).join("\n\n"),
          maxTokens: 2000,
          temperature: 0.2,
        });
        verdicts = j.verdicts ?? [];
        best = typeof j.best === "number" && j.best >= 0 && j.best < survivors.length ? j.best : 0;
      } catch (e) {
        a.log?.(`hookcraft: judge unreachable (${e instanceof Error ? e.message : e}) — lint-only pass`);
      }

      // Prefer the judge's pick if it gates; else any gating candidate. The
      // judge-gated pick must then survive the grounded fact-check — a false
      // claim rejects the candidate and the next gating one gets its turn.
      const fiction = isFictionRegister(a.niche, a.style);
      const order = [best, ...survivors.map((_, i) => i).filter((i) => i !== best)];
      const factProblems: string[] = [];
      for (const i of order) {
        const v = verdicts[i] ?? {};
        if (!passes(v)) continue;
        const c = survivors[i];
        let factCheck: "verified" | "skipped" | "unchecked" = "skipped";
        if (!fiction) {
          const fc = await factCheckColdOpen(c, a);
          if (!fc.ok) {
            factProblems.push(...fc.problems);
            a.log?.(`hookcraft: "${c.device}" rejected by fact-check (${fc.problems[0] ?? ""})`);
            continue;
          }
          factCheck = fc.status;
        }
        a.log?.(
          `hookcraft: "${c.device}" wins (punch ${v.punch ?? "?"}, specificity ${v.specificity ?? "?"}, ` +
          `curiosity ${v.curiosity ?? "?"}, promise ${v.promise ?? "?"}, facts ${factCheck})`,
        );
        return {
          hook: c.hook,
          opening: c.opening,
          coldOpen: `${c.hook}\n\n${c.opening}`,
          device: c.device,
          loop: c.loop || `pay off the promise of: ${c.hook}`,
          verdict: { ...v, lint: c.lint, factCheck },
        };
      }
      lastIssues = [...factProblems, ...verdicts.map((v) => v.note ?? "").filter(Boolean)];
    }

    fixNote =
      `THE PREVIOUS ATTEMPT WAS REJECTED. Fix every one of these and come back stronger: ` +
      `${[...new Set(lastIssues)].slice(0, 6).join("; ") || "more punch, more concrete topic detail, tighter first sentence"}.`;
    a.log?.(`hookcraft: attempt ${attempt + 1} rejected -> ${attempt === 0 ? "retrying with fix" : "FAILING LOUD"}`);
  }
  throw new Error(`hookcraft: both attempts failed the gate (${[...new Set(lastIssues)].slice(0, 4).join("; ")})`);
}
