/**
 * TOPICRAFT — the topic-intel engine (golden candidate #4, banana-shaped):
 * channel identity in → an evidence-cited, judged PORTFOLIO of topic BETS out.
 *
 * Doctrine: a topic is not an idea — it is a BET that must already be
 * packageable. Every candidate ships as a complete promise unit (topic +
 * angle + provisional title + thumbnail moment + hook promise) and must CITE
 * the real-world signal it rides. No vibes-only topics survive the lint.
 *
 * The chain one craftTopics() call runs:
 *   ┌ outlier bank (Convex-cached breakout scans; live fallback) ┐
 *   ├ Reddit audience discussions this week (free)               │ parallel
 *   └ YouTube autocomplete fan-out (free, unmetered)             ┘
 *   → ONE Pro call writes count+4 BETS across portfolio types
 *     (hero = breakout-rider / hub = core-audience / help = search-evergreen),
 *     gap-mining the competitor feed (keyword / format / audience gaps)
 *   → deterministic lint: evidence citation REQUIRED and fuzzy-verified
 *     against the supplied signals, banned words, stale years, token-overlap
 *     dedupe vs done+planned, provisional title through metacraft's lintTitle
 *   → semantic dedupe (Gemini embeddings vs the avoid list + intra-slate)
 *   → ONE judge call gates demand/freshness/fit/packageability ≥ 7
 *   → winners + the judged bench (warm start for the next plan)
 *   One feedback retry, then loud failure. Two LLM calls per slate — the old
 *   topic_select loop spent up to six per single topic, with its subjective
 *   gate silently dead (it scored via an Anthropic key with no credits).
 *
 * Deps: GEMINI_API_KEY only (vault "gemini"). Outliers/competitors ride
 * youtubeData access when present and degrade LOUDLY to the cached bank.
 *
 *   import { craftTopics, loadOutlierBank, hasTopicraft } from "@/lib/topicraft";
 *   const { bets, bench, evidence } = await craftTopics({ channelName, niche,
 *     persona, topicPool, count, avoid, outliers, competitorTitles, log });
 *   // bets[i]: topic · angle · betType · provisionalTitle · thumbnailMoment ·
 *   //          hookPromise · evidence ("outlier: …") · scores
 */
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { geminiJson, geminiJsonPro, hasGeminiKey } from "@/lib/gemini";
import { youtubeSuggest, lintTitle } from "@/lib/metacraft";
import { fetchNicheOutliers, type OutlierVideo } from "@/lib/outliers";
import { fetchRedditTrends, type TrendSignal } from "@/lib/trends";
import { embedText, cosine } from "@/lib/embeddings";
import { resolveVoiceDoctrine } from "@/engine/golden";

export function hasTopicraft(): boolean {
  return hasGeminiKey();
}

export type BetType = "hero" | "hub" | "help";

export interface TopicBet {
  topic: string;
  angle: string;
  betType: BetType;
  /** Judge-linted 40-70 char title — the packageability proof + a metacraft warm start. */
  provisionalTitle: string;
  /** One-sentence scene that enacts the topic — the banana brief's seed. */
  thumbnailMoment: string;
  /** The one-line promise the cold open must confirm — hookcraft's seed. */
  hookPromise: string;
  /** REQUIRED citation: "<tag>: <signal>", tag ∈ outlier|search|reddit|competitor-gap|perf|identity. */
  evidence: string;
  scores?: { demand: number; freshness: number; fit: number; packageability: number };
}

export interface TopicEvidence {
  outliers: OutlierVideo[];
  trends: TrendSignal[];
  suggests: string[];
  competitors: { title: string; views: number }[];
}

export interface CraftTopicsArgs {
  channelName?: string;
  niche?: string;
  persona?: string;
  styleGrammar?: string;
  topicPool?: string[];
  bannedWords?: string[];
  count: number;
  /** Everything already done or planned (raw topic strings). */
  avoid?: string[];
  /** Analytics-ledger context (loadPerformanceContext output). */
  perfContext?: string;
  /** Pre-fetched competitor top titles (databank) — no live fetch happens here. */
  competitorTitles?: { title: string; views: number }[];
  /** Pre-fetched outlier scan (loadOutlierBank) — omit to live-fetch best-effort. */
  outliers?: OutlierVideo[];
  /** High-CTR niche power words (databank) — flavor for provisional titles. */
  powerWords?: string[];
  log?: (m: string, x?: Record<string, unknown>) => void;
}

export interface CraftedTopics {
  bets: TopicBet[];
  /** Lint+judge survivors beyond `count` — a warm start for the next plan. */
  bench: TopicBet[];
  evidence: TopicEvidence;
}

/* ------------------------------ helpers -------------------------------- */

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "of", "in", "on", "to", "for", "with", "from", "by", "at", "into",
  "how", "why", "what", "when", "who", "this", "that", "is", "are", "was", "were", "it", "its", "his", "her",
  "their", "your", "you", "we", "they", "not", "all", "one", "about", "real", "true", "story", "history",
]);

export function normTopic(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function tokenSet(s: string): Set<string> {
  return new Set(normTopic(s).split(" ").filter((w) => w.length > 2 && !STOP.has(w)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Distinctive (≥4-char, non-stopword) tokens shared between two strings. */
function sharedTokens(cited: string, source: string): number {
  const src = source.toLowerCase();
  let n = 0;
  for (const w of tokenSet(cited)) if (w.length >= 4 && src.includes(w)) n++;
  return n;
}

/** Autocomplete seeds: the niche + the strongest topic-pool phrases. */
function suggestSeeds(a: CraftTopicsArgs): string[] {
  const seeds: string[] = [];
  if (a.niche?.trim()) seeds.push(a.niche.trim().toLowerCase());
  for (const t of (a.topicPool ?? []).slice(0, 3)) {
    const cleaned = [...tokenSet(t)].slice(0, 4).join(" ");
    if (cleaned.length > 3) seeds.push(cleaned);
  }
  return [...new Set(seeds)].slice(0, 4);
}

/* ------------------------------ evidence ------------------------------- */

/** Gather all live demand signals concurrently (each best-effort, loudly logged). */
export async function gatherEvidence(
  a: CraftTopicsArgs,
  log: (m: string, x?: Record<string, unknown>) => void,
): Promise<TopicEvidence> {
  const t0 = Date.now();
  const seeds = suggestSeeds(a);
  const outlierQuery = [a.niche ?? "", ...(a.topicPool ?? []).slice(0, 2)].filter(Boolean).join(" ");
  const [outliers, trends, suggestsNested] = await Promise.all([
    a.outliers
      ? Promise.resolve(a.outliers)
      : outlierQuery
        ? fetchNicheOutliers(outlierQuery, { log, maxResults: 25, minDurationSec: 120 }).catch(() => [] as OutlierVideo[])
        : Promise.resolve([] as OutlierVideo[]),
    a.niche ? fetchRedditTrends(a.niche, (m) => log(m)).catch(() => [] as TrendSignal[]) : Promise.resolve([] as TrendSignal[]),
    Promise.all(seeds.map((s) => youtubeSuggest(s).catch(() => [] as string[]))),
  ]);
  const suggests = [...new Set(suggestsNested.flat().map((s) => s.trim()).filter(Boolean))].slice(0, 16);
  const competitors = (a.competitorTitles ?? []).slice(0, 12);
  log(
    `topicraft: evidence in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${outliers.length} outliers, ` +
      `${trends.length} reddit, ${suggests.length} queries, ${competitors.length} competitor titles`,
  );
  return { outliers: outliers.slice(0, 12), trends: trends.slice(0, 10), suggests, competitors };
}

/* -------------------------------- lint --------------------------------- */

export interface BetLint {
  pass: boolean;
  issues: string[];
}

const EVIDENCE_TAG = /^(outlier|search|reddit|competitor-gap|perf|identity):\s*(.{4,})$/i;

/**
 * Deterministic bet lint — the measurable gates, enforced instead of asked
 * for. The citation check verifies the bet's evidence against the ACTUAL
 * supplied signals, so a hallucinated "outlier" that matches nothing dies here.
 */
export function lintBet(
  bet: TopicBet,
  o: {
    evidence: TopicEvidence;
    perfContext?: string;
    identityGiven: boolean;
    bannedWords: string[];
    avoidNorm: Set<string>;
    avoidTokens: Set<string>[];
    keptTokens: Set<string>[];
    channelName?: string;
    allowHype?: boolean;
  },
): BetLint {
  const issues: string[] = [];
  const topic = bet.topic?.trim() ?? "";
  if (topic.length < 12 || tokenSet(topic).size < 2) issues.push(`"${topic}" is a category, not a specific topic`);
  if (!bet.angle?.trim()) issues.push("missing angle");
  if (!bet.hookPromise?.trim()) issues.push("missing hookPromise");
  if ((bet.thumbnailMoment?.trim().split(/\s+/).length ?? 0) < 6) {
    issues.push("thumbnailMoment is not a real scene (hero subject + story detail, one sentence)");
  }

  // Banned words across every user-visible field.
  const visible = `${topic} ${bet.provisionalTitle} ${bet.angle}`.toLowerCase();
  for (const w of o.bannedWords) {
    if (w && visible.includes(w.toLowerCase())) issues.push(`contains banned term "${w}"`);
  }

  // Stale CONTENT years ("best ETFs 2024") — subject-matter years (1597) pass.
  const thisYear = new Date().getFullYear();
  for (const y of `${topic} ${bet.provisionalTitle}`.match(/\b(19|20)\d{2}\b/g) ?? []) {
    const yr = Number(y);
    if (yr >= thisYear - 2 && yr < thisYear) issues.push(`stale year ${yr} — use ${thisYear} or none`);
  }

  // EVIDENCE CITATION — required, tagged, and verified against real signals.
  const m = (bet.evidence ?? "").trim().match(EVIDENCE_TAG);
  if (!m) {
    issues.push(`evidence must be "<tag>: <signal>" with tag ∈ outlier|search|reddit|competitor-gap|perf|identity`);
  } else {
    const tag = m[1].toLowerCase();
    const cited = m[2];
    const corpus: Record<string, string> = {
      outlier: o.evidence.outliers.map((v) => `${v.title} ${v.channelTitle}`).join("\n"),
      search: o.evidence.suggests.join("\n"),
      reddit: o.evidence.trends.map((t) => t.title).join("\n"),
      "competitor-gap": o.evidence.competitors.map((c) => c.title).join("\n"),
    };
    if (tag in corpus) {
      if (!corpus[tag]) issues.push(`cites ${tag} evidence but no ${tag} signals were supplied`);
      else if (sharedTokens(cited, corpus[tag]) < 1) issues.push(`${tag} citation "${cited.slice(0, 60)}" matches none of the supplied ${tag} signals`);
    } else if (tag === "perf" && !o.perfContext) {
      issues.push("cites perf evidence but no performance context was supplied");
    } else if (tag === "identity" && !o.identityGiven) {
      issues.push("cites identity evidence but no topic pool / persona was supplied");
    }
  }

  // Dedupe vs done+planned (exact + token overlap; embeddings run after lint).
  const tok = tokenSet(topic);
  if (o.avoidNorm.has(normTopic(topic))) issues.push(`duplicates an already-used topic`);
  else if (o.avoidTokens.some((t) => jaccard(tok, t) >= 0.55)) issues.push(`near-duplicate of an already-used topic`);
  if (o.keptTokens.some((t) => jaccard(tok, t) >= 0.6)) issues.push(`duplicates another bet in this slate`);

  // The packageability floor: the provisional title through the SAME lint the
  // golden metadata engine enforces — grounded against the bet's own evidence.
  const title = bet.provisionalTitle?.trim() ?? "";
  if (!title) issues.push("missing provisionalTitle");
  else {
    const grounding = [
      topic, bet.angle, bet.hookPromise, bet.evidence,
      o.evidence.outliers.map((v) => v.title).join("\n"),
      o.evidence.suggests.join("\n"),
      o.evidence.trends.map((t) => t.title).join("\n"),
      o.evidence.competitors.map((c) => c.title).join("\n"),
    ].join("\n");
    const lt = lintTitle(title, { grounding, channelName: o.channelName, allowHype: o.allowHype });
    if (!lt.pass) issues.push(...lt.issues.map((i) => `title: ${i}`));
  }

  return { pass: issues.length === 0, issues };
}

/* --------------------------- semantic dedupe ---------------------------- */

/**
 * Embedding-level dedupe: drops bets semantically equal to an avoid entry
 * (≥0.88) or to an earlier kept bet (≥0.92). Best-effort but LOUD — if the
 * embed API dies the token-overlap lint already ran, and we say so.
 */
async function semanticDedupe(
  bets: TopicBet[],
  avoid: string[],
  log: (m: string) => void,
): Promise<TopicBet[]> {
  if (bets.length === 0) return bets;
  const sample = avoid.slice(-40);
  try {
    const [betVecs, avoidVecs] = await Promise.all([
      Promise.all(bets.map((b) => embedText(b.topic))),
      Promise.all(sample.map((t) => embedText(t))),
    ]);
    const kept: TopicBet[] = [];
    const keptVecs: number[][] = [];
    for (let i = 0; i < bets.length; i++) {
      const vsAvoid = avoidVecs.length ? Math.max(...avoidVecs.map((v) => cosine(betVecs[i], v))) : 0;
      if (vsAvoid >= 0.88) {
        log(`topicraft: semantic dup vs history (${vsAvoid.toFixed(2)}) — dropped "${bets[i].topic.slice(0, 60)}"`);
        continue;
      }
      const vsSlate = keptVecs.length ? Math.max(...keptVecs.map((v) => cosine(betVecs[i], v))) : 0;
      if (vsSlate >= 0.92) {
        log(`topicraft: semantic dup in slate (${vsSlate.toFixed(2)}) — dropped "${bets[i].topic.slice(0, 60)}"`);
        continue;
      }
      kept.push(bets[i]);
      keptVecs.push(betVecs[i]);
    }
    return kept;
  } catch (e) {
    log(`topicraft: semantic dedupe UNAVAILABLE (${e instanceof Error ? e.message.slice(0, 100) : e}) — token-overlap lint only`);
    return bets;
  }
}

/* ------------------------------- engine -------------------------------- */

export async function craftTopics(a: CraftTopicsArgs): Promise<CraftedTopics> {
  if (!hasGeminiKey()) throw new Error("topicraft: GEMINI_API_KEY missing — cannot craft real topics");
  const log = a.log ?? (() => {});
  const t0 = Date.now();
  const count = Math.max(1, a.count);
  const want = count + 4;
  const doctrine = resolveVoiceDoctrine(a.niche);
  const allowHype = doctrine?.voice === "chaos-commentator";

  const evidence = await gatherEvidence(a, log);
  const hasLive = evidence.outliers.length + evidence.trends.length + evidence.suggests.length + evidence.competitors.length > 0;
  if (!hasLive) log("topicraft: NO live evidence reachable — running identity-grounded (demand will judge low)");

  const avoidRaw = [...new Set((a.avoid ?? []).map((s) => s.trim()).filter(Boolean))];
  const bannedWords = (a.bannedWords ?? []).filter(Boolean);
  const identityGiven = Boolean(a.topicPool?.length || a.persona);

  const today = new Date();
  const dateAnchor =
    `Today's date is ${today.toISOString().slice(0, 10)} (year ${today.getFullYear()}). ` +
    `If a topic references a content year, use ${today.getFullYear()} or none — NEVER a past year.`;

  const evidenceClauses = [
    evidence.outliers.length
      ? `OUTLIER VIDEOS (massively overperforming their channel's size — the strongest "wanted RIGHT NOW" signal; steal the ANGLE, never the title):\n` +
        evidence.outliers.map((v) => `- "${v.title}" — ${v.score.toFixed(0)}x its channel size (${v.channelTitle})`).join("\n")
      : "",
    evidence.trends.length
      ? `LIVE AUDIENCE DISCUSSIONS this week (Reddit — what the niche cares about BEFORE YouTube saturates it; mine questions/anxieties, never copy):\n` +
        evidence.trends.map((t) => `- [r/${t.subreddit}, ${t.score.toLocaleString()} upvotes] ${t.title}`).join("\n")
      : "",
    evidence.suggests.length
      ? `REAL SEARCH QUERIES people type (autocomplete — proven search demand):\n` +
        evidence.suggests.map((s) => `- ${s}`).join("\n")
      : "",
    evidence.competitors.length
      ? `COMPETITOR TOP TITLES (study these for GAPS — keyword gaps no one answers, format gaps nobody uses, audience segments nobody serves. The best bets ride PROVEN demand from an UNSERVED angle):\n` +
        evidence.competitors.map((c) => `- ${c.views >= 1e6 ? `${(c.views / 1e6).toFixed(1)}M` : `${Math.round(c.views / 1e3)}k`} — "${c.title}"`).join("\n")
      : "",
  ].filter(Boolean);

  // Gated winners ACCUMULATE across attempts: a harsh judge on attempt one
  // (thin evidence days) triggers a second slate for the remainder instead of
  // shipping a shortfall.
  const won: TopicBet[] = [];
  let fixNote = "";
  let lastIssues: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const avoidAll = [...avoidRaw, ...won.map((w) => w.topic)];
    const avoidNorm = new Set(avoidAll.map(normTopic));
    const avoidTokens = avoidAll.map(tokenSet);
    let gen: { bets?: Partial<TopicBet>[] };
    try {
      gen = await geminiJsonPro<typeof gen>({
        prompt: [
          dateAnchor,
          `You are the topic STRATEGIST for the YouTube channel "${a.channelName ?? "this channel"}" placing ${want} content BETS.`,
          `CHANNEL IDENTITY (hard guardrail — every bet MUST fit):\n` +
            `- niche: ${a.niche || "n/a"} | persona: ${a.persona || "n/a"}${a.styleGrammar ? ` | style: ${a.styleGrammar}` : ""}` +
            (doctrine ? `\n- voice archetype "${doctrine.voice}": every bet must sound like a video THIS channel would make` : "") +
            (a.topicPool?.length ? `\n- example on-brand topics: ${a.topicPool.slice(0, 12).join("; ")}` : "") +
            (bannedWords.length ? `\n- NEVER use: ${bannedWords.join(", ")}` : ""),
          `PORTFOLIO DOCTRINE — the ${want} bets must MIX three types:\n` +
            `- "hero": rides a cited breakout signal (outlier/reddit) for browse reach\n` +
            `- "hub": serves the core audience deeper inside the channel's identity\n` +
            `- "help": answers a REAL cited search query — evergreen search traffic\n` +
            `Include at least one "help"${evidence.outliers.length || evidence.trends.length ? ` and at least one "hero"` : ""}; no more than half the slate may share a type.`,
          avoidAll.length ? `ALREADY DONE OR PLANNED — never repeat or trivially rephrase:\n${avoidAll.slice(-60).join(" | ")}` : "",
          a.perfContext ?? "",
          evidenceClauses.length
            ? `EVIDENCE — the ONLY allowed sources for demand claims:\n\n${evidenceClauses.join("\n\n")}`
            : `NO live evidence is available right now — ground every bet in the channel identity (tag "identity:") and keep claims modest.`,
          `EACH BET is a complete promise unit:\n` +
            `- topic: a specific video topic (never a broad category)\n` +
            `- angle: one line — the unique take that earns the click\n` +
            `- betType: "hero" | "hub" | "help"\n` +
            `- provisionalTitle: 40-70 chars, the POINT ITSELF — no setup-colon constructions, no filler starts, ` +
            `payoff inside the first 50 chars; every number and name must come from the evidence or the topic itself` +
            (allowHype ? "" : "; no hype-bait") +
            (a.powerWords?.length ? `; power words that work here: ${a.powerWords.slice(0, 10).join(", ")}` : "") + `\n` +
            `- thumbnailMoment: ONE sentence — hero subject + background + one story-carrying detail that literally enacts the topic\n` +
            `- hookPromise: the one-line promise the cold open will confirm in the first 15 seconds\n` +
            `- evidence: REQUIRED citation "<tag>: <the specific signal>" with tag ∈ outlier|search|reddit|competitor-gap|perf|identity — quote the actual line/query you are riding`,
          fixNote,
          `Return STRICT JSON {"bets":[{"topic":string,"angle":string,"betType":string,"provisionalTitle":string,"thumbnailMoment":string,"hookPromise":string,"evidence":string}]}.`,
        ].filter(Boolean).join("\n\n"),
        maxTokens: 7000 + 220 * want,
        temperature: 0.85,
        log: (m) => log(m),
      });
    } catch (e) {
      lastIssues = [`generator returned invalid JSON (${e instanceof Error ? e.message.slice(0, 80) : e})`];
      log(`topicraft: attempt ${attempt + 1} gen failed (${lastIssues[0]}) -> ${attempt === 0 ? "retrying" : "FAILING LOUD"}`);
      fixNote = "THE PREVIOUS ATTEMPT RETURNED INVALID JSON — return STRICT, valid JSON only.";
      continue;
    }

    const candidates = (gen.bets ?? [])
      .map((b) => ({
        topic: String(b.topic ?? "").trim(),
        angle: String(b.angle ?? "").trim(),
        betType: (["hero", "hub", "help"].includes(String(b.betType)) ? b.betType : "hub") as BetType,
        provisionalTitle: String(b.provisionalTitle ?? "").trim(),
        thumbnailMoment: String(b.thumbnailMoment ?? "").trim(),
        hookPromise: String(b.hookPromise ?? "").trim(),
        evidence: String(b.evidence ?? "").trim(),
      }))
      .filter((b) => b.topic);

    const keptTokens: Set<string>[] = [];
    const linted = candidates.map((c) => {
      const lint = lintBet(c, {
        evidence, perfContext: a.perfContext, identityGiven, bannedWords,
        avoidNorm, avoidTokens, keptTokens, channelName: a.channelName, allowHype,
      });
      if (lint.pass) keptTokens.push(tokenSet(c.topic));
      return { ...c, lint };
    });
    let survivors = linted.filter((c) => c.lint.pass).map(({ lint: _lint, ...bet }) => bet as TopicBet);
    lastIssues = linted.flatMap((c) => c.lint.issues);
    log(`topicraft: ${candidates.length} bets, ${survivors.length} pass lint (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

    survivors = await semanticDedupe(survivors, avoidAll, (m) => log(m));

    if (survivors.length > 0) {
      let gated: TopicBet[] = [];
      try {
        const j = await geminiJson<{ rankings?: { idx?: number; demand?: number; freshness?: number; fit?: number; packageability?: number }[] }>({
          prompt: [
            `You are a YouTube growth strategist auditing topic BETS for "${a.channelName ?? "this channel"}" (${a.niche ?? "general"}).`,
            evidenceClauses.length ? `THE EVIDENCE the bets claim to ride:\n\n${evidenceClauses.join("\n\n").slice(0, 4000)}` : "",
            avoidAll.length ? `ALREADY DONE (freshness check):\n${avoidAll.slice(-40).join(" | ")}` : "",
            `BETS:\n${survivors.map((b, i) => `${i}. [${b.betType}] ${b.topic} — title "${b.provisionalTitle}" — evidence: ${b.evidence}`).join("\n")}`,
            `Score each 1-10 on ALL FOUR: demand (does its CITED evidence really prove people want this NOW), ` +
              `freshness (vs the done list — punish near-repeats), fit (identity + voice archetype), ` +
              `packageability (do title + thumbnail moment + hook promise form ONE click-winning promise unit). ` +
              `Be harsh — 7 means genuinely strong.`,
            `Return STRICT JSON {"rankings":[{"idx":n,"demand":n,"freshness":n,"fit":n,"packageability":n}]}.`,
          ].filter(Boolean).join("\n\n"),
          maxTokens: 1500,
          temperature: 0.2,
        });
        const ranked = (j.rankings ?? [])
          .filter((r): r is Required<typeof r> =>
            typeof r.idx === "number" && r.idx >= 0 && r.idx < survivors.length &&
            (r.demand ?? 0) >= 7 && (r.freshness ?? 0) >= 7 && (r.fit ?? 0) >= 7 && (r.packageability ?? 0) >= 7,
          )
          .sort((x, y) => y.demand + y.freshness + y.fit + y.packageability - (x.demand + x.freshness + x.fit + x.packageability));
        gated = ranked.map((r) => ({
          ...survivors[r.idx],
          scores: { demand: r.demand, freshness: r.freshness, fit: r.fit, packageability: r.packageability },
        }));
      } catch (e) {
        log(`topicraft: judge unreachable (${e instanceof Error ? e.message : e}) — lint-only pass`);
        gated = survivors;
      }

      // Accumulate gated wins (unique by normalized topic) across attempts.
      for (const g of gated) {
        if (!won.some((w) => normTopic(w.topic) === normTopic(g.topic))) won.push(g);
      }
      if (won.length >= count) {
        const bets = won.slice(0, count);
        const bench = won.slice(count);
        log(
          `topicraft: ${bets.length} bets + ${bench.length} bench in ${((Date.now() - t0) / 1000).toFixed(1)}s — ` +
            bets.map((b) => `[${b.betType}${b.scores ? ` ${b.scores.demand}/${b.scores.fit}` : ""}] "${b.topic.slice(0, 50)}"`).join(" · "),
        );
        return { bets, bench, evidence };
      }
      if (gated.length === 0) lastIssues.push("no bet gated demand/freshness/fit/packageability ≥7");
      fixNote =
        `THE JUDGE GATED ONLY ${won.length} BET(S) SO FAR. Write ${count - won.length + 4} NEW bets that ride the ` +
        `STRONGEST evidence lines harder${lastIssues.length ? `, and fix: ${[...new Set(lastIssues)].slice(0, 6).join("; ")}` : ""}.`;
      log(`topicraft: ${won.length}/${count} gated after slate ${attempt + 1} -> ${attempt === 0 ? "second slate for the remainder" : "FAILING over to partial"}`);
      continue;
    }
    fixNote = `THE PREVIOUS ATTEMPT WAS REJECTED. Fix every one of these: ${[...new Set(lastIssues)].slice(0, 6).join("; ")}.`;
    log(`topicraft: attempt ${attempt + 1} produced no lint survivors -> ${attempt === 0 ? "retrying with fix" : "FAILING LOUD"}`);
  }
  if (won.length > 0) {
    log(`topicraft: SHORTFALL — ${won.length}/${count} bets gated after two slates (shipping what passed)`);
    return { bets: won.slice(0, count), bench: won.slice(count), evidence };
  }
  throw new Error(`topicraft: both attempts failed the gate (${[...new Set(lastIssues)].slice(0, 4).join("; ")})`);
}

/* ----------------------------- outlier bank ----------------------------- */

/**
 * Quota-immune outlier reads: serve the Convex-cached scan when fresh (≤7d),
 * else live-fetch and persist. A dead YouTube quota degrades LOUDLY to the
 * stale bank instead of silently returning nothing (the old failure mode).
 */
export async function loadOutlierBank(o: {
  convex: ConvexHttpClient;
  ownerId: string;
  niche: string;
  query: string;
  maxAgeDays?: number;
  log?: (m: string) => void;
}): Promise<OutlierVideo[]> {
  const log = o.log ?? (() => {});
  const maxAgeMs = (o.maxAgeDays ?? 7) * 86_400_000;
  type Bank = { fetchedAt: number; outliers: OutlierVideo[] } | null;
  let bank: Bank = null;
  try {
    bank = (await o.convex.query(api.outlierBank.getBank, { ownerId: o.ownerId, niche: o.niche })) as Bank;
  } catch (e) {
    log(`topicraft: outlier bank read failed (${e instanceof Error ? e.message.slice(0, 80) : e})`);
  }
  const ageMs = bank ? Date.now() - bank.fetchedAt : Infinity;
  if (bank && bank.outliers.length && ageMs < maxAgeMs) {
    log(`topicraft: outlier bank hit — ${bank.outliers.length} (${(ageMs / 3_600_000).toFixed(0)}h old)`);
    return bank.outliers;
  }
  const live = await fetchNicheOutliers(o.query, { log, maxResults: 25, minDurationSec: 120 }).catch(() => [] as OutlierVideo[]);
  if (live.length) {
    try {
      await o.convex.mutation(api.outlierBank.upsertBank, { ownerId: o.ownerId, niche: o.niche, outliers: live });
      log(`topicraft: outlier bank refreshed — ${live.length}`);
    } catch (e) {
      log(`topicraft: outlier bank write failed (${e instanceof Error ? e.message.slice(0, 80) : e})`);
    }
    return live;
  }
  if (bank?.outliers.length) {
    log(`topicraft: LIVE outliers empty (quota dead?) — serving STALE bank (${(ageMs / 86_400_000).toFixed(0)}d old, ${bank.outliers.length})`);
    return bank.outliers;
  }
  return [];
}
