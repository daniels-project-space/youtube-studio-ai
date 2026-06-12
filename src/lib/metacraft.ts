/**
 * METACRAFT — the metadata engine (the third golden candidate, banana-shaped):
 * video identity in → linted, evidence-grounded, judge-gated upload package out.
 *
 * The chain one craftMetadata() call runs:
 *   1. EVIDENCE — live YouTube autocomplete for the topic's seed phrase (what
 *      people ACTUALLY type), the niche's real top titles with view counts,
 *      the channel's DNA title formula, and the video's own cold open + loop
 *      + QUOTE (title, thumbnail and first 15s are ONE promise unit).
 *   2. CANDIDATES — latest Gemini Pro writes 7 titles across distinct frames
 *      (specific-number, curiosity-gap, contrarian, mechanism, stakes,
 *      search-intent with a real query verbatim, carrying-image) + structured
 *      descriptions (THE QUOTE as the hook line) + tags.
 *   3. LINT (deterministic) — length window, mobile truncation (the payoff
 *      number inside the first ~50 chars), CLAIMS GROUNDING (every number and
 *      proper noun in the title must exist in the script — which hookcraft
 *      already fact-checked, so grounded = verified, transitively), filler
 *      starts, hype blacklist (register-aware), channel name, lofi leak.
 *   4. JUDGE — would it win the click in THIS niche's real feed while keeping
 *      the title-promise contract? clickScore ≥ 7 gates; winner + runner-up
 *      (titleAlternate, stored for CTR-swap learning). One retry, loud fail.
 *   5. PINNED COMMENT — a comment-seeding question for the upload block.
 *
 * Deps: GEMINI_API_KEY only.
 */
import { geminiJson, geminiJsonPro, hasGeminiKey } from "@/lib/gemini";
import { resolveVoiceDoctrine } from "@/engine/golden";

export function hasMetacraft(): boolean {
  return hasGeminiKey();
}

const LOFI_LEAK = /\b(lo-?fi|study (beats|music)|beats to (relax|study)|chillhop)\b/i;
const FILLER_START = /^(the (story|history|tale) of|what happened (to|when)|a (look|deep dive) (at|into)|let's talk about|everything you need to know)/i;
const HYPE = /\b(you won'?t believe|gone wrong|shocking truth|insane|jaw[- ]?dropping|mind[- ]?blowing)\b/i;
const TITLE_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "in", "on", "to", "for", "with", "from", "by", "at", "into",
  "how", "why", "what", "when", "who", "this", "that", "is", "are", "was", "were", "it", "its", "his", "her",
  "their", "your", "you", "we", "they", "not", "no", "never", "every", "all", "one", "day", "days", "real",
  "true", "inside", "behind", "before", "after", "explained", "documentary", "history", "story", "full",
]);

/** Live YouTube autocomplete — the real query strings people type. */
export async function youtubeSuggest(seed: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(seed)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return [];
    const j = (await res.json()) as [string, string[]];
    return Array.isArray(j?.[1]) ? j[1].slice(0, 8) : [];
  } catch {
    return [];
  }
}

/** Spoken-word variants of a number token so titles ground against narration
 * that SPEAKS its numbers ("37" ↔ "thirty-seven", "476" ↔ "four seventy-six"). */
function numberVariants(tok: string): string[] {
  const n = Number(tok.replace(/[,.]/g, ""));
  if (!Number.isFinite(n)) return [tok];
  const ones = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const small = (x: number): string =>
    x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? `-${ones[x % 10]}` : ""}`;
  const v = new Set<string>([tok, String(n), n.toLocaleString("en-US")]);
  if (n >= 0 && n < 100) v.add(small(n));
  if (n >= 100 && n < 1000) {
    v.add(`${ones[Math.floor(n / 100)]} hundred${n % 100 ? ` ${small(n % 100)}` : ""}`);
    if (n % 100) v.add(`${ones[Math.floor(n / 100)]} ${small(n % 100)}`); // "four seventy-six"
  }
  if (n >= 1000 && n < 10000) {
    const h = Math.floor(n / 100) % 10 === 0 ? null : `${small(Math.floor(n / 100))} ${small(n % 100) || "hundred"}`;
    if (h) v.add(h); // "fifteen eighteen"
    v.add(`${small(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${small(n % 1000)}` : ""}`);
  }
  return [...v];
}

export interface TitleLint {
  pass: boolean;
  issues: string[];
}

/**
 * Deterministic title lint — the measurable gates, enforced instead of asked
 * for. `grounding` is the haystack the title's claims must exist in (script +
 * topic + cold open); it was fact-checked upstream, so grounded = verified.
 */
export function lintTitle(
  title: string,
  o: { grounding?: string; channelName?: string; isMusicNiche?: boolean; allowHype?: boolean } = {},
): TitleLint {
  const issues: string[] = [];
  const t = title.trim();
  if (!t) return { pass: false, issues: ["empty title"] };
  if (t.length > 100) issues.push(`${t.length} chars > 100 (YouTube hard limit)`);
  if (t.length < 30) issues.push(`${t.length} chars — too short (aim 55-90)`);
  if (FILLER_START.test(t)) issues.push("filler start — front-load the payoff, not throat-clearing");
  if (!o.allowHype && HYPE.test(t)) issues.push("hype blacklist phrase breaks the register");
  if (!o.isMusicNiche && LOFI_LEAK.test(t)) issues.push("off-niche lofi/study framing");
  if (o.channelName && o.channelName !== "this channel" && t.toLowerCase().includes(o.channelName.toLowerCase()))
    issues.push("contains the channel name");

  // Mobile truncation: browse shows ~50 chars — a payoff number buried past
  // that is a payoff the scroller never sees.
  const firstDigit = t.search(/\d/);
  if (firstDigit > 50) issues.push(`payoff number starts at char ${firstDigit} (must land inside the first ~50)`);

  if (o.grounding) {
    const hay = o.grounding.toLowerCase();
    // Numbers: every digit token must exist in the grounding (as digits or words).
    for (const tok of t.match(/\d[\d,.]*/g) ?? []) {
      if (!numberVariants(tok).some((v) => hay.includes(v.toLowerCase())))
        issues.push(`ungrounded number "${tok}" — not in the script`);
    }
    // Proper nouns must exist in the grounding. Title-Cased titles capitalize
    // EVERY word, so there the check narrows to capitalized runs of ≥2 words
    // (real names like "Romulus Augustulus") — single Title-Case words are
    // styling, not claims.
    const words = t.split(/\s+/).map((w) => w.replace(/[^A-Za-z'-]/g, ""));
    const significant = words.slice(1).filter((w) => w.length >= 4);
    const isTitleCase = significant.length >= 3 && significant.filter((w) => /^[A-Z]/.test(w)).length / significant.length > 0.6;
    const check = (name: string) => {
      if (!hay.includes(name.toLowerCase())) issues.push(`ungrounded name "${name}" — not in the script`);
    };
    if (isTitleCase) {
      // Title-Case capitalizes everything, so a "run" mixes names with styling
      // ("Roman Empire Actually Fell"). A run passes when ANY of its words
      // exists in the grounding — only fully-alien runs are hallucinated names.
      for (const run of t.match(/\b[A-Z][a-z'-]{3,}(?:\s+[A-Z][a-z'-]{2,})+\b/g) ?? []) {
        const ws = run.split(/\s+/).filter((w) => !TITLE_STOPWORDS.has(w.toLowerCase()));
        if (ws.length && !ws.some((w) => hay.includes(w.toLowerCase())))
          issues.push(`ungrounded name "${run}" — not in the script`);
      }
    } else {
      for (let i = 1; i < words.length; i++) {
        const w = words[i];
        if (w.length >= 4 && /^[A-Z]/.test(w) && !TITLE_STOPWORDS.has(w.toLowerCase())) check(w);
      }
    }
  }
  return { pass: issues.length === 0, issues };
}

export interface MetaCraftArgs {
  topic: string;
  channelName?: string;
  niche?: string;
  persona?: string;
  language?: string;
  /** Grounding + promise contract: the video's own content. */
  scriptExcerpt?: string;
  coldOpen?: string;
  hookLoop?: string;
  /** THE QUOTE (Script.closingLine) — becomes the description's hook line. */
  quote?: string;
  competitorTitles?: { title: string; views: number }[];
  powerWords?: string[];
  titleFormula?: string;
  descriptionStructure?: string;
  perfContext?: string;
  isMusicNiche?: boolean;
  log?: (m: string) => void;
}

export interface CraftedMetadata {
  title: string;
  description: string;
  tags: string[];
  /** Runner-up title — stored for the CTR-swap learning loop. */
  titleAlternate: string;
  /** Comment-seeding question for the upload block to pin. */
  pinnedComment: string;
  frame: string;
  clickScore: number;
  /** The real autocomplete queries used as evidence. */
  suggests: string[];
}

const FRAMES =
  "(1) specific_number, (2) curiosity_gap, (3) contrarian, (4) mechanism (how/why it actually works), " +
  "(5) stakes_warning, (6) search_intent — MUST contain one of the real search queries below VERBATIM, " +
  "(7) carrying_image — built on the episode's central image/metaphor from the cold open";

export async function craftMetadata(a: MetaCraftArgs): Promise<CraftedMetadata> {
  if (!hasGeminiKey()) throw new Error("metacraft: GEMINI_API_KEY missing — cannot craft real metadata");
  const doctrine = resolveVoiceDoctrine(a.niche);
  const allowHype = doctrine?.voice === "chaos-commentator";
  const seed = a.topic.split(/[—:-]/)[0].trim().split(/\s+/).slice(0, 5).join(" ").toLowerCase();
  const suggests = await youtubeSuggest(seed);
  a.log?.(`metacraft: autocomplete "${seed}" → ${suggests.length ? suggests.slice(0, 5).join(" | ") : "(none)"}`);
  // The full verified surface of the video: topic + cold open + loop + quote
  // + script excerpt (the loop/quote carry claims too — "five-stage playbook").
  const grounding = `${a.topic}\n${a.coldOpen ?? ""}\n${a.hookLoop ?? ""}\n${a.quote ?? ""}\n${a.scriptExcerpt ?? ""}`;
  const lang =
    a.language && a.language !== "en" ? `\nWrite title/description/tags in ${a.language} (keep proper names).` : "";

  let fixNote = "";
  let lastIssues: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let gen: { candidates?: { frame?: string; title?: string; description?: string; tagsCsv?: string }[] };
    try {
      gen = await geminiJsonPro<typeof gen>({
      prompt: [
        `Write SEVEN complete YouTube metadata candidates for a video about "${a.topic}" on "${a.channelName ?? "this channel"}" — one per frame: ${FRAMES}.`,
        `NICHE: ${a.niche ?? "general"} | PERSONA: ${a.persona ?? "n/a"}`,
        doctrine ? `VOICE ARCHETYPE "${doctrine.voice}": titles must sound like this channel — ${doctrine.tone.slice(0, 200)}` : "",
        a.coldOpen
          ? `THE COLD OPEN (the first thing a clicking viewer hears — title, thumbnail and this are ONE promise unit; ` +
            `the title must state the promise it confirms):\n"${a.coldOpen.slice(0, 500)}"`
          : "",
        a.hookLoop ? `The episode's promise: "${a.hookLoop}"` : "",
        a.quote ? `THE QUOTE (the episode's takeaway line — use it as the description's opening hook line): "${a.quote}"` : "",
        suggests.length
          ? `REAL SEARCH QUERIES people type (YouTube autocomplete — ground keyword phrasing in these):\n- ${suggests.join("\n- ")}`
          : "",
        a.competitorTitles?.length
          ? `THE FEED to beat (real top performers):\n${a.competitorTitles
              .slice(0, 10)
              .map((c) => `${(c.views / 1e6).toFixed(1)}M — "${c.title}"`)
              .join("\n")}`
          : "",
        a.titleFormula ? `CHANNEL TITLE FORMULA (Style DNA — obey its shape): ${a.titleFormula}` : "",
        a.powerWords?.length ? `POWER WORDS: ${a.powerWords.slice(0, 12).join(", ")}` : "",
        a.perfContext ?? "",
        `TITLE RULES: 55-90 chars; the payoff (its number/key claim) inside the FIRST 50 chars (mobile truncation); ` +
          `front-load the primary keyword; ONE honest promise — every number and name in the title MUST appear in ` +
          `the cold open/script (they were fact-checked there); no channel name; no filler starts ("The story of…"); ` +
          `${allowHype ? "" : "no hype-bait phrases; "}use "you" where natural.`,
        `DESCRIPTION RULES: ${a.descriptionStructure ? `follow the channel structure: ${a.descriptionStructure}. ` : ""}` +
          `(1) open with THE QUOTE${a.quote ? "" : " (or the strongest hook line)"} + 1-2 punchy lines with the primary ` +
          `keyword in the VERY FIRST sentence; (2) ONE ≤60-word value paragraph; (3) "Subscribe for more:" CTA line; ` +
          `(4) "Keywords: " line with 14-20 comma-separated phrases (lean on the real search queries); (5) a line of ` +
          `8-12 #hashtags. Never paste the script.`,
        `TAGS: 25-30 comma-separated, include the real search queries and the entities THIS video actually mentions.${lang}`,
        fixNote,
        `Return STRICT JSON {"candidates":[{"frame":string,"title":string,"description":string,"tagsCsv":string}]}.`,
      ].filter(Boolean).join("\n\n"),
      maxTokens: 13000,
      temperature: 0.85,
      log: a.log,
      });
    } catch (e) {
      // A malformed-JSON generation consumes an attempt, never crashes the engine.
      lastIssues = [`generator returned invalid JSON (${e instanceof Error ? e.message.slice(0, 80) : e})`];
      a.log?.(`metacraft: attempt ${attempt + 1} gen failed (${lastIssues[0]}) -> ${attempt === 0 ? "retrying" : "FAILING LOUD"}`);
      fixNote = `THE PREVIOUS ATTEMPT RETURNED INVALID JSON — return STRICT, valid JSON only.`;
      continue;
    }

    const candidates = (gen.candidates ?? [])
      .map((c) => ({
        frame: String(c.frame ?? "unknown"),
        title: String(c.title ?? "").trim(),
        description: String(c.description ?? "").trim(),
        tags: String(c.tagsCsv ?? "").split(",").map((t) => t.trim()).filter(Boolean),
      }))
      .filter((c) => c.title && c.description.length >= 40 && c.tags.length >= 5)
      .map((c) => ({ ...c, lint: lintTitle(c.title, { grounding, channelName: a.channelName, isMusicNiche: a.isMusicNiche, allowHype }) }));
    const survivors = candidates.filter((c) => c.lint.pass);
    lastIssues = candidates.flatMap((c) => c.lint.issues);
    a.log?.(`metacraft: ${candidates.length} candidates, ${survivors.length} pass lint${survivors.length ? "" : ` (${lastIssues.slice(0, 3).join("; ")})`}`);

    if (survivors.length >= 1) {
      let best = 0;
      let runner = 1;
      let score = 8;
      try {
        const j = await geminiJson<{ rankings?: { idx?: number; clickScore?: number }[]; winner?: number; runnerUp?: number }>({
          prompt: [
            `You are a YouTube CTR strategist judging a real feed. Topic: "${a.topic}".`,
            a.competitorTitles?.length
              ? `THE FEED (real views):\n${a.competitorTitles.slice(0, 10).map((c) => `${(c.views / 1e6).toFixed(1)}M — "${c.title}"`).join("\n")}`
              : "",
            a.coldOpen ? `THE COLD OPEN the title must promise-match:\n"${a.coldOpen.slice(0, 400)}"` : "",
            `CANDIDATES:\n${survivors.map((c, i) => `${i}. [${c.frame}] ${c.title}`).join("\n")}`,
            `Score each 1-10: would it WIN the click in this feed while staying honest, on-register, and keeping ` +
              `the title-promise contract (a title the cold open doesn't confirm bleeds retention)? ` +
              `Return STRICT JSON {"rankings":[{"idx":n,"clickScore":n}],"winner":n,"runnerUp":n}.`,
          ].filter(Boolean).join("\n\n"),
          maxTokens: 1200,
          temperature: 0.2,
        });
        best = typeof j.winner === "number" && j.winner >= 0 && j.winner < survivors.length ? j.winner : 0;
        runner =
          typeof j.runnerUp === "number" && j.runnerUp >= 0 && j.runnerUp < survivors.length && j.runnerUp !== best
            ? j.runnerUp
            : (best + 1) % survivors.length;
        score = (j.rankings ?? []).find((r) => r.idx === best)?.clickScore ?? 8;
      } catch (e) {
        a.log?.(`metacraft: judge unreachable (${e instanceof Error ? e.message : e}) — lint-only pass`);
      }

      if (score >= 7) {
        const w = survivors[best];
        // Comment-seeding question — early comments are a real ranking signal.
        let pinnedComment = "";
        try {
          const p = await geminiJson<{ comment?: string }>({
            prompt:
              `Write ONE pinned comment (≤200 chars) for the video "${w.title}"${a.niche ? ` (${a.niche})` : ""}: a ` +
              `SPECIFIC, genuinely curious question that seeds discussion about the video's core tension — never ` +
              `generic ("what do you think?"), never engagement-bait. ${a.hookLoop ? `The video's promise: "${a.hookLoop}". ` : ""}` +
              `Return STRICT JSON {"comment":string}.`,
            maxTokens: 300,
            temperature: 0.8,
          });
          pinnedComment = (p.comment ?? "").trim();
        } catch { /* optional artifact */ }
        a.log?.(`metacraft: [${w.frame}] wins (click ${score}/10) — "${w.title.slice(0, 70)}"`);
        return {
          title: w.title,
          description: w.description,
          tags: w.tags,
          titleAlternate: survivors.length > 1 ? survivors[runner]?.title ?? "" : "",
          pinnedComment,
          frame: w.frame,
          clickScore: score,
          suggests,
        };
      }
      lastIssues.push(`judge clickScore ${score} < 7`);
    }
    fixNote = `THE PREVIOUS ATTEMPT WAS REJECTED. Fix every one of these: ${[...new Set(lastIssues)].slice(0, 6).join("; ")}.`;
    a.log?.(`metacraft: attempt ${attempt + 1} rejected -> ${attempt === 0 ? "retrying with fix" : "FAILING LOUD"}`);
  }
  throw new Error(`metacraft: both attempts failed the gate (${[...new Set(lastIssues)].slice(0, 4).join("; ")})`);
}
