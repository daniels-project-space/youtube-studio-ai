/**
 * METACRAFT — the metadata engine (the third golden candidate, banana-shaped):
 * video identity in → linted, evidence-grounded, judge-gated upload package out.
 *
 * Architecture is CONCURRENT and titles-first (one Pro call writes 7 TITLES,
 * not 7 full packages — the description is written once, for the winner):
 *
 *   ┌ autocomplete (real queries)        ┐ parallel
 *   └ REAL competitor titles (YT API)    ┘
 *        → 7 framed title candidates (Pro, small+fast)
 *        → deterministic lint (claims grounding, truncation, setup-prefix ban)
 *        ┌ feed judge (clickScore + directness ≥7) ┐ parallel
 *        └ pinned comment (comment seeding)        ┘
 *        → ONE description+tags for the winner (THE QUOTE opens it)
 *
 * Title doctrine: SHORT and DIRECT (40-70 chars) — the point itself, never a
 * setup for the point; no scene-setting prefixes or two-part colon
 * constructions (a short established format prefix like "Mission log:" is
 * fine); every number and name grounded in the fact-checked script.
 *
 * Deps: GEMINI_API_KEY (vault "gemini"); YOUTUBE_DATA_API_KEY (vault
 * "youtube") unlocks live competitor research when the niche databank is empty.
 */
import { geminiJson, geminiJsonPro, hasGeminiKey } from "@/lib/gemini";
import { resolveVoiceDoctrine } from "@/engine/golden";

export function hasMetacraft(): boolean {
  return hasGeminiKey();
}

const LOFI_LEAK = /\b(lo-?fi|study (beats|music)|beats to (relax|study)|chillhop)\b/i;
const FILLER_START = /^(the (story|history|tale) of|what happened (to|when)|a (look|deep dive) (at|into)|let's talk about|everything you need to know)/i;
const HYPE = /\b(you won'?t believe|gone wrong|shocking truth|insane|jaw[- ]?dropping|mind[- ]?blowing)\b/i;
// "Ash falls like black snow: …" / "60 Paparazzi Got A Text: …" — a ≥4-word
// pre-colon fragment is scene-setting, not the point. (Short format prefixes
// like "Mission log:" pass.)
const SETUP_COLON = /^(\S+\s+){3,}\S*\s*:\s/;
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

/**
 * REAL competitors: live YouTube search for the topic, sorted by views — the
 * actual titles this video must beat in the feed. Loud no-op without the key.
 */
export async function fetchCompetitorTitles(
  seed: string,
  log?: (m: string) => void,
): Promise<{ title: string; views: number }[]> {
  const key = process.env.YOUTUBE_DATA_API_KEY;
  if (!key) {
    log?.("metacraft: no YOUTUBE_DATA_API_KEY — skipping live competitor research");
    return [];
  }
  try {
    const sr = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=15&q=${encodeURIComponent(seed)}&key=${key}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!sr.ok) throw new Error(`search HTTP ${sr.status}`);
    const sj = (await sr.json()) as { items?: { id?: { videoId?: string } }[] };
    const ids = (sj.items ?? []).map((i) => i.id?.videoId).filter(Boolean).join(",");
    if (!ids) return [];
    const vr = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${ids}&key=${key}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!vr.ok) throw new Error(`videos HTTP ${vr.status}`);
    const vj = (await vr.json()) as { items?: { snippet?: { title?: string }; statistics?: { viewCount?: string } }[] };
    return (vj.items ?? [])
      .map((v) => ({ title: v.snippet?.title ?? "", views: Number(v.statistics?.viewCount ?? 0) }))
      .filter((v) => v.title)
      .sort((x, y) => y.views - x.views)
      .slice(0, 10);
  } catch (e) {
    log?.(`metacraft: competitor research failed (${e instanceof Error ? e.message : e}) — continuing without`);
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
 * for. `grounding` is the haystack the title's claims must exist in (topic +
 * cold open + loop + quote + script); it was fact-checked upstream, so
 * grounded = verified, transitively.
 */
export function lintTitle(
  title: string,
  o: { grounding?: string; channelName?: string; isMusicNiche?: boolean; allowHype?: boolean } = {},
): TitleLint {
  const issues: string[] = [];
  const t = title.trim();
  if (!t) return { pass: false, issues: ["empty title"] };
  if (t.length > 85) issues.push(`${t.length} chars > 85 — shorter and more to the point (aim 40-70)`);
  if (t.length < 25) issues.push(`${t.length} chars — too short (aim 40-70)`);
  if (FILLER_START.test(t)) issues.push("filler start — front-load the payoff, not throat-clearing");
  if (SETUP_COLON.test(t)) issues.push("scene-setting setup before a colon — state the point directly");
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
    // EVERY word, so there the check narrows to capitalized runs of ≥2 words —
    // and a run passes when ANY of its non-stopword words exists (only fully-
    // alien runs are hallucinated names).
    const words = t.split(/\s+/).map((w) => w.replace(/[^A-Za-z'-]/g, ""));
    const significant = words.slice(1).filter((w) => w.length >= 4);
    const isTitleCase = significant.length >= 3 && significant.filter((w) => /^[A-Z]/.test(w)).length / significant.length > 0.6;
    if (isTitleCase) {
      for (const run of t.match(/\b[A-Z][a-z'-]{3,}(?:\s+[A-Z][a-z'-]{2,})+\b/g) ?? []) {
        const ws = run.split(/\s+/).filter((w) => !TITLE_STOPWORDS.has(w.toLowerCase()));
        if (ws.length && !ws.some((w) => hay.includes(w.toLowerCase())))
          issues.push(`ungrounded name "${run}" — not in the script`);
      }
    } else {
      for (let i = 1; i < words.length; i++) {
        const w = words[i];
        if (w.length >= 4 && /^[A-Z]/.test(w) && !TITLE_STOPWORDS.has(w.toLowerCase()) && !hay.includes(w.toLowerCase()))
          issues.push(`ungrounded name "${w}" — not in the script`);
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
  /** Real top titles (niche databank). Omitted → metacraft researches live. */
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
  /** The real competitor titles judged against. */
  feed: { title: string; views: number }[];
}

const FRAMES =
  "(1) specific_number, (2) curiosity_gap, (3) contrarian, (4) mechanism (how/why it actually works), " +
  "(5) stakes_warning, (6) search_intent — MUST contain one of the real search queries below VERBATIM, " +
  "(7) direct_verdict — the episode's conclusion stated flat as the title";

export async function craftMetadata(a: MetaCraftArgs): Promise<CraftedMetadata> {
  if (!hasGeminiKey()) throw new Error("metacraft: GEMINI_API_KEY missing — cannot craft real metadata");
  const t0 = Date.now();
  const doctrine = resolveVoiceDoctrine(a.niche);
  const allowHype = doctrine?.voice === "chaos-commentator";
  const seed = a.topic.split(/[—:-]/)[0].trim().split(/\s+/).slice(0, 5).join(" ").toLowerCase();

  // EVIDENCE — concurrently: real queries + real competitors.
  const [suggests, fetched] = await Promise.all([
    youtubeSuggest(seed),
    a.competitorTitles?.length ? Promise.resolve<{ title: string; views: number }[]>([]) : fetchCompetitorTitles(seed, a.log),
  ]);
  const feed = (a.competitorTitles?.length ? a.competitorTitles : fetched).slice(0, 10);
  const feedAvgLen = feed.length ? Math.round(feed.reduce((n, f) => n + f.title.length, 0) / feed.length) : 0;
  a.log?.(
    `metacraft: evidence in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${suggests.length} queries, ` +
    `${feed.length} real competitor titles${feedAvgLen ? ` (avg ${feedAvgLen} chars)` : ""}`,
  );
  const grounding = `${a.topic}\n${a.coldOpen ?? ""}\n${a.hookLoop ?? ""}\n${a.quote ?? ""}\n${a.scriptExcerpt ?? ""}`;
  const lang =
    a.language && a.language !== "en" ? `\nWrite title/description/tags in ${a.language} (keep proper names).` : "";
  const feedClause = feed.length
    ? `THE REAL FEED this title must beat (live YouTube, sorted by views — study what actually wins here: ` +
      `their length, framing, and phrasing${feedAvgLen ? `; they average ${feedAvgLen} chars` : ""}):\n` +
      feed.map((c) => `${c.views >= 1e6 ? `${(c.views / 1e6).toFixed(1)}M` : `${Math.round(c.views / 1e3)}k`} — "${c.title}"`).join("\n")
    : "";

  // Pinned comment doesn't depend on the winning title — craft it in parallel
  // with the judging pass (it seeds discussion about the episode's tension).
  const pinnedPromise = geminiJson<{ comment?: string }>({
    prompt:
      `Write ONE pinned comment (≤200 chars) for a video about "${a.topic}"${a.niche ? ` (${a.niche})` : ""}: a ` +
      `SPECIFIC, genuinely curious question that seeds discussion about the video's core tension — never generic ` +
      `("what do you think?"), never engagement-bait. ${a.hookLoop ? `The video's promise: "${a.hookLoop}". ` : ""}` +
      `Return STRICT JSON {"comment":string}.`,
    maxTokens: 300,
    temperature: 0.8,
  }).then((p) => (p.comment ?? "").trim()).catch(() => "");

  let fixNote = "";
  let lastIssues: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    // TITLES ONLY — small output, fast even with Pro thinking.
    let gen: { candidates?: { frame?: string; title?: string }[] };
    try {
      gen = await geminiJsonPro<typeof gen>({
        prompt: [
          `Write SEVEN YouTube TITLE candidates for a video about "${a.topic}" on "${a.channelName ?? "this channel"}" — one per frame: ${FRAMES}.`,
          `NICHE: ${a.niche ?? "general"} | PERSONA: ${a.persona ?? "n/a"}`,
          doctrine ? `VOICE ARCHETYPE "${doctrine.voice}": titles must sound like this channel.` : "",
          a.coldOpen
            ? `THE COLD OPEN (title, thumbnail and this are ONE promise unit — the title states the promise it confirms):\n"${a.coldOpen.slice(0, 450)}"`
            : "",
          a.hookLoop ? `The episode's promise: "${a.hookLoop}"` : "",
          suggests.length ? `REAL SEARCH QUERIES people type:\n- ${suggests.join("\n- ")}` : "",
          feedClause,
          a.titleFormula ? `CHANNEL TITLE FORMULA (Style DNA — obey its shape): ${a.titleFormula}` : "",
          a.powerWords?.length ? `POWER WORDS: ${a.powerWords.slice(0, 12).join(", ")}` : "",
          a.perfContext ?? "",
          `TITLE RULES — SHORT and DIRECT: 40-70 characters. The title is the POINT ITSELF, never a setup for ` +
            `the point — no scene-setting fragments, no atmospheric prefixes, no two-part colon constructions ` +
            `(a short established format prefix like "Mission log:" is fine). Front-load the primary keyword and ` +
            `any payoff number inside the first 50 chars. ONE honest claim — every number and name MUST appear ` +
            `in the cold open/script (they were fact-checked there). No channel name, no filler starts` +
            `${allowHype ? "" : ", no hype-bait"}.${lang}`,
          fixNote,
          `Return STRICT JSON {"candidates":[{"frame":string,"title":string}]}.`,
        ].filter(Boolean).join("\n\n"),
        maxTokens: 7000,
        temperature: 0.85,
        log: a.log,
      });
    } catch (e) {
      lastIssues = [`generator returned invalid JSON (${e instanceof Error ? e.message.slice(0, 80) : e})`];
      a.log?.(`metacraft: attempt ${attempt + 1} gen failed (${lastIssues[0]}) -> ${attempt === 0 ? "retrying" : "FAILING LOUD"}`);
      fixNote = `THE PREVIOUS ATTEMPT RETURNED INVALID JSON — return STRICT, valid JSON only.`;
      continue;
    }

    const candidates = (gen.candidates ?? [])
      .map((c) => ({ frame: String(c.frame ?? "unknown"), title: String(c.title ?? "").trim() }))
      .filter((c) => c.title)
      .map((c) => ({ ...c, lint: lintTitle(c.title, { grounding, channelName: a.channelName, isMusicNiche: a.isMusicNiche, allowHype }) }));
    const survivors = candidates.filter((c) => c.lint.pass);
    lastIssues = candidates.flatMap((c) => c.lint.issues);
    a.log?.(`metacraft: ${candidates.length} titles, ${survivors.length} pass lint (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

    if (survivors.length >= 1) {
      let best = 0;
      let runner = -1;
      let score = 8;
      try {
        const j = await geminiJson<{ rankings?: { idx?: number; clickScore?: number; direct?: number }[]; winner?: number; runnerUp?: number }>({
          prompt: [
            `You are a YouTube CTR strategist judging a real feed. Topic: "${a.topic}".`,
            feedClause,
            a.coldOpen ? `THE COLD OPEN the title must promise-match:\n"${a.coldOpen.slice(0, 350)}"` : "",
            `CANDIDATES:\n${survivors.map((c, i) => `${i}. [${c.frame}] ${c.title}`).join("\n")}`,
            `Score each 1-10 on BOTH: clickScore (would it win the click in this feed while staying honest, ` +
              `on-register, and promise-matched) AND direct (is it the point itself — short, no setup, no ` +
              `atmosphere; penalize two-part constructions and anything a scroller must decode)? ` +
              `Return STRICT JSON {"rankings":[{"idx":n,"clickScore":n,"direct":n}],"winner":n,"runnerUp":n}.`,
          ].filter(Boolean).join("\n\n"),
          maxTokens: 1200,
          temperature: 0.2,
        });
        const ranked = (j.rankings ?? []).filter(
          (r) => typeof r.idx === "number" && r.idx >= 0 && r.idx < survivors.length && (r.clickScore ?? 0) >= 7 && (r.direct ?? 10) >= 7,
        );
        ranked.sort((x, y) => (y.clickScore ?? 0) + (y.direct ?? 0) - ((x.clickScore ?? 0) + (x.direct ?? 0)));
        if (ranked.length) {
          best = ranked[0].idx!;
          runner = ranked[1]?.idx ?? -1;
          score = ranked[0].clickScore ?? 8;
        } else {
          lastIssues.push("no candidate gated clickScore+direct ≥7");
          fixNote = `THE PREVIOUS ATTEMPT WAS REJECTED. Fix every one of these: ${[...new Set(lastIssues)].slice(0, 6).join("; ")}.`;
          a.log?.(`metacraft: attempt ${attempt + 1} rejected by judge -> ${attempt === 0 ? "retrying with fix" : "FAILING LOUD"}`);
          continue;
        }
      } catch (e) {
        a.log?.(`metacraft: judge unreachable (${e instanceof Error ? e.message : e}) — lint-only pass`);
      }

      const w = survivors[best];
      // ONE description+tags, written FOR the winner (parallel work already done).
      const pkg = await geminiJsonPro<{ description?: string; tagsCsv?: string }>({
        prompt: [
          `Write the YouTube description + tags for this video.`,
          `TITLE: "${w.title}" | Channel: "${a.channelName ?? ""}" | Niche: ${a.niche ?? "general"}`,
          a.quote ? `THE QUOTE (open the description with it): "${a.quote}"` : "",
          a.coldOpen ? `COLD OPEN (the description must promise the same video):\n"${a.coldOpen.slice(0, 400)}"` : "",
          suggests.length ? `REAL SEARCH QUERIES (lean keyword phrasing on these):\n- ${suggests.join("\n- ")}` : "",
          `DESCRIPTION: ${a.descriptionStructure ? `follow the channel structure: ${a.descriptionStructure}. ` : ""}` +
            `(1) THE QUOTE${a.quote ? "" : " (or the strongest hook line)"} + 1-2 punchy lines, primary keyword in the ` +
            `VERY FIRST sentence; (2) ONE ≤60-word value paragraph; (3) a "Subscribe for more:" CTA line WITHOUT ` +
            `inventing any URL; (4) "Keywords: " line with 14-20 comma-separated phrases; (5) one line of 8-12 ` +
            `#hashtags. Never paste the script.`,
          `TAGS: 25-30 comma-separated, the real search queries + entities THIS video mentions.${lang}`,
          `Return STRICT JSON {"description":string,"tagsCsv":string}.`,
        ].filter(Boolean).join("\n\n"),
        maxTokens: 7000,
        temperature: 0.8,
        log: a.log,
      });
      const description = String(pkg.description ?? "").trim();
      const tags = String(pkg.tagsCsv ?? "").split(",").map((t) => t.trim()).filter(Boolean);
      if (!description || tags.length < 5) throw new Error("metacraft: winner package came back empty");
      const pinnedComment = await pinnedPromise;
      a.log?.(`metacraft: [${w.frame}] wins (click ${score}/10) in ${((Date.now() - t0) / 1000).toFixed(1)}s — "${w.title}"`);
      return {
        title: w.title,
        description,
        tags,
        titleAlternate: runner >= 0 ? survivors[runner]?.title ?? "" : "",
        pinnedComment,
        frame: w.frame,
        clickScore: score,
        suggests,
        feed,
      };
    }
    fixNote = `THE PREVIOUS ATTEMPT WAS REJECTED. Fix every one of these: ${[...new Set(lastIssues)].slice(0, 6).join("; ")}.`;
    a.log?.(`metacraft: attempt ${attempt + 1} rejected -> ${attempt === 0 ? "retrying with fix" : "FAILING LOUD"}`);
  }
  throw new Error(`metacraft: both attempts failed the gate (${[...new Set(lastIssues)].slice(0, 4).join("; ")})`);
}
