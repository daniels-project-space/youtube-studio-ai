/**
 * quiz_year — the MIXED-CATEGORY quiz engine for the `quizyear` family.
 *
 * The block id, catalog entry, lane and archetype binding are unchanged from
 * the original guess-the-year build (commit df1a257) so nothing downstream had
 * to be rewired; what changed is that one video's rounds are now drawn from a
 * MIX of fact categories rather than a single one. Real trivia channels mix
 * question types inside one video — two year questions, two capitals, a
 * currency, a general-knowledge round — so the mix lives inside the format
 * instead of spawning a module per category.
 *
 * SELF-CONTAINED, structural twin of whiteboard_scribe / motion_comic /
 * lore_short: it sources its own facts, writes its own on-screen questions and
 * renders its own finished video, so it REPLACES the script → narration →
 * footage → assemble chain rather than sitting inside one. It emits the final
 * `videoKey` directly.
 *
 * WHY THIS FORMAT IS BUILDABLE WHEN THE OTHER THREE QUIZ FORMATS ARE NOT
 * The 2026-08 audits closed trivia (no compliantly-licensed dataset exists),
 * flag-guess (Paris Convention Art. 6ter + no genuine CC0 flag artwork) and
 * music-guess (no clearable audio). This format avoids all three because it
 * needs NO third-party media: the inputs are Wikidata's CC0 statements and, for
 * the general-knowledge category, a Wikipedia lookup used purely as a
 * VERIFICATION substrate whose prose is never rendered. Nothing is scraped, no
 * artwork or audio is reused, and the typography is rendered locally.
 *
 * THE COST SHAPE — AND WHY IT IS STILL TINY
 * Facts are free. The render is free (local Remotion + headless Chromium).
 * There is no image, video, TTS, music or upscale provider on this path. The
 * only spend is bounded text: one phrasing call per Wikidata-sourced round, ONE
 * proposal call for the whole general-knowledge batch, and one critic call per
 * critique iteration. Adding categories does not multiply per-round cost —
 * every round still costs at most one phrasing call, and the general-knowledge
 * rounds cost less than that because they arrive pre-phrased.
 *
 * THE INVARIANT THIS BLOCK EXISTS TO PROTECT
 * The answer is NEVER model-generated, in ANY category. Wikidata categories
 * read it from a statement; the general-knowledge category accepts it only
 * after an independently fetched real document is shown to state it (and to not
 * state any of the wrong options). The phrasing model's response schema has no
 * answer field, `questionTextDefects` rejects any phrasing that leaks the
 * answer, and `assertQuizAnswerIntegrity` / `assertGeneralKnowledgeIntegrity`
 * re-check every round immediately before render props are built — on every
 * checkpoint replay, not just on the first pass. The critique loop grades
 * QUESTION WORDING only and can never touch an answer.
 */
import { join } from "node:path";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { COST_PATCH_KEY, type Block, type StageContext } from "@/engine/types";
import { makeRunTempDir } from "@/lib/files";
import { putObject, putObjectFromFile, getObjectBytes } from "@/lib/storage";
import {
  channelCritiqueBrief,
  produceAndCritique,
  type ChannelCritiqueContext,
} from "@/engine/critiqueLoop";
import { laneQualityPolicy } from "@/engine/contentLane";
import {
  assertAnswerIntegrity,
  assertOptionIntegrity,
  buildYearOptions,
  deterministicQuestionText,
  fetchQuizYearFacts,
  phraseQuizYearQuestion,
  QUIZ_YEAR_TOPIC_KEYS,
  type QuizYearTopicKey,
} from "@/lib/quizYearFacts";
import {
  assertQuizAnswerIntegrity,
  assertQuizOptionIntegrity,
  buildQuizOptions,
  containsPhrase,
  deterministicCategoryQuestion,
  fetchCategoryFacts,
  phraseQuizQuestion,
  questionTextDefects,
  QUIZ_CATEGORIES,
  QUIZ_CATEGORY_KEYS,
  seededRandom,
  type QuizCategoryFact,
  type QuizCategoryKey,
  type QuizDecoyCandidate,
} from "@/lib/quizFacts";
import {
  assertCertifiedQuizTopicPlan,
  assertCertifiedQuizTopicSafety,
} from "@/trigger/blocks/quizPlanningBlocks";
import { renderQuizYear, type QuizYearRound } from "@/lib/quizYearRender";
import { muxLoopedMusicBed } from "@/lib/ffmpeg";
import type { TimedOnScreenTextCue } from "@/lib/onScreenTextProof";

function convex(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

async function recordAsset(
  ctx: StageContext,
  kind: string,
  r2Key: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await convex().mutation(api.assets.recordAsset, {
      ownerId: ctx.ownerId,
      channelId: ctx.channelId as Id<"channels">,
      runId: ctx.runId as Id<"runs">,
      kind,
      r2Key,
      meta,
    });
  } catch (e) {
    ctx.log(`recordAsset(${kind}) failed (non-fatal): ${e instanceof Error ? e.message : e}`);
  }
}

const QUIZ_QUESTIONS_CHECKPOINT_VERSION = "quiz-mixed-rounds/v1";

/** Seconds a viewer gets to guess, and how long the reveal holds. */
export const QUIZ_DEFAULT_COUNTDOWN_SECONDS = 6;
export const QUIZ_DEFAULT_REVEAL_SECONDS = 4;
/** Round-count bounds. Floor keeps a watchable video; ceiling caps LLM calls. */
export const QUIZ_MIN_ROUNDS = 3;
export const QUIZ_MAX_ROUNDS = 15;

/**
 * Every category a round can be drawn from. `guess_year` is the original build,
 * kept as one option among several rather than promoted to the whole format.
 */
export type QuizRoundCategory = "guess_year" | QuizCategoryKey | "general_knowledge";

export const QUIZ_ROUND_CATEGORIES: readonly QuizRoundCategory[] = [
  "guess_year",
  ...QUIZ_CATEGORY_KEYS,
  "general_knowledge",
];

/**
 * The certified autonomous route has no model-backed general-knowledge
 * candidate step. Keep its default set explicit rather than starting from the
 * legacy full set and discovering the unsupported category only at render
 * time.
 */
export const QUIZ_CERTIFIED_NO_GEMINI_CATEGORIES: readonly Exclude<QuizRoundCategory, "general_knowledge">[] = [
  "guess_year",
  ...QUIZ_CATEGORY_KEYS,
];

/** On-screen eyebrow per category, so a mixed video signals the switch. */
export const CATEGORY_PROMPTS: Readonly<Record<QuizRoundCategory, string>> = {
  guess_year: "WHAT YEAR?",
  capital_city: "WHICH CAPITAL?",
  country_currency: "WHICH CURRENCY?",
  element_symbol: "WHICH SYMBOL?",
  element_atomic_number: "WHICH ATOMIC NUMBER?",
  general_knowledge: "GENERAL KNOWLEDGE",
};

/**
 * The default mix. Deliberately NOT an even split across everything available:
 * guess-the-year and capitals are the two categories with the deepest verified
 * pools (thousands of dated entities; 189 clean countries), so they anchor the
 * video, while the narrower pools (118 elements) and the lossiest one (general
 * knowledge, where most candidates are rejected by verification) appear once or
 * twice. Weights are relative, not counts.
 */
export const DEFAULT_CATEGORY_MIX: Readonly<Record<QuizRoundCategory, number>> = {
  guess_year: 3,
  capital_city: 3,
  country_currency: 2,
  element_symbol: 1,
  element_atomic_number: 1,
  general_knowledge: 2,
};

/**
 * How many rounds fit a requested runtime. Kept in lockstep with
 * quizYearCostCeiling() in src/engine/moduleContracts.ts.
 */
export function quizRoundCount(targetSeconds: number, countdown: number, reveal: number): number {
  const per = Math.max(1, countdown + reveal);
  if (!Number.isFinite(targetSeconds) || targetSeconds <= 0) return 8;
  return Math.max(QUIZ_MIN_ROUNDS, Math.min(QUIZ_MAX_ROUNDS, Math.round(targetSeconds / per)));
}

/** Resolve the requested year topic, defaulting to a broadly safe one. */
export function resolveTopic(raw: unknown): QuizYearTopicKey {
  const key = String(raw ?? "").trim() as QuizYearTopicKey;
  return QUIZ_YEAR_TOPIC_KEYS.includes(key) ? key : "science_discovery";
}

/** Parse the `categories` param (array or comma-separated string). */
export function resolveCategories(raw: unknown): QuizRoundCategory[] {
  const parts = Array.isArray(raw)
    ? raw.map((v) => String(v).trim())
    : String(raw ?? "")
        .split(",")
        .map((v) => v.trim());
  const picked = parts.filter((p): p is QuizRoundCategory =>
    (QUIZ_ROUND_CATEGORIES as readonly string[]).includes(p),
  );
  return picked.length ? [...new Set(picked)] : [...QUIZ_ROUND_CATEGORIES];
}

/**
 * The automatic QuizYear planner intentionally emits no category parameter.
 * Its safe default therefore lives here, beside the legacy parser, rather
 * than relying on a renderer-time rejection of general_knowledge.
 */
export function resolveCertifiedNoGeminiCategories(raw: unknown): QuizRoundCategory[] {
  const absent = raw === undefined || raw === null ||
    (typeof raw === "string" && !raw.trim()) ||
    (Array.isArray(raw) && raw.length === 0);
  if (absent) return [...QUIZ_CERTIFIED_NO_GEMINI_CATEGORIES];
  const categories = resolveCategories(raw);
  if (categories.includes("general_knowledge")) {
    throw new Error(
      "quiz: certified no-Gemini mode does not allow general_knowledge; choose only the deterministic Wikidata-backed category set",
    );
  }
  return categories;
}

/**
 * Allocate `rounds` across the enabled categories by weight, then INTERLEAVE so
 * the categories alternate instead of arriving in blocks. A viewer should feel
 * a mixed quiz, not four capitals followed by four years.
 *
 * Deterministic: same inputs → same plan, which matters because the question set
 * is frozen into a content-addressed checkpoint that a healer replay must
 * reproduce exactly.
 */
export function planRoundCategories(
  rounds: number,
  enabled: readonly QuizRoundCategory[],
): QuizRoundCategory[] {
  const list = enabled.length ? enabled : [...QUIZ_ROUND_CATEGORIES];
  const totalWeight = list.reduce((sum, c) => sum + (DEFAULT_CATEGORY_MIX[c] ?? 1), 0);
  const quota = new Map<QuizRoundCategory, number>();
  let assigned = 0;
  for (const c of list) {
    const share = Math.floor((rounds * (DEFAULT_CATEGORY_MIX[c] ?? 1)) / totalWeight);
    quota.set(c, share);
    assigned += share;
  }
  // Hand out the remainder in weight order so rounding never loses a round.
  const byWeight = [...list].sort(
    (a, b) => (DEFAULT_CATEGORY_MIX[b] ?? 1) - (DEFAULT_CATEGORY_MIX[a] ?? 1),
  );
  for (let i = 0; assigned < rounds; i++, assigned++) {
    const c = byWeight[i % byWeight.length];
    quota.set(c, (quota.get(c) ?? 0) + 1);
  }
  // Round-robin drain = interleaved order.
  const plan: QuizRoundCategory[] = [];
  const remaining = new Map(quota);
  while (plan.length < rounds) {
    let placed = false;
    for (const c of byWeight) {
      const left = remaining.get(c) ?? 0;
      if (left > 0) {
        plan.push(c);
        remaining.set(c, left - 1);
        placed = true;
        if (plan.length >= rounds) break;
      }
    }
    if (!placed) break;
  }
  return plan;
}

/**
 * One fully-resolved round. This is the unified shape every category collapses
 * to before phrasing, critique, integrity assertion and render — so a new
 * category cannot introduce a new code path through any of those stages.
 */
export interface PlannedRound {
  category: QuizRoundCategory;
  categoryPrompt: string;
  /** QID for Wikidata categories, article title for general knowledge. */
  subjectId: string;
  subject: string;
  subtext?: string;
  questionText: string;
  answerLabel: string;
  answerNumber?: number;
  sourceUrl: string;
  options: { label: string; isCorrect: boolean; provenance: string }[];
  phrasedByModel: boolean;
}

/** Channel doctrine + lane grounding for this block's critique. */
function quizCritiqueChannel(ctx: StageContext): ChannelCritiqueContext {
  const lane = ctx.store["contentLane"];
  const laneKey =
    typeof (lane as { key?: unknown } | null)?.key === "string"
      ? String((lane as { key?: unknown }).key)
      : undefined;
  const text = (key: string): string | undefined => {
    const value = ctx.store[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  return {
    ...(text("channelName") ? { channelName: text("channelName")! } : {}),
    ...(text("persona") ? { persona: text("persona")! } : {}),
    ...(text("styleGrammar") ? { styleGrammar: text("styleGrammar")! } : {}),
    ...(text("criticDoctrine") ? { criticDoctrine: text("criticDoctrine")! } : {}),
    ...(laneKey ? { contentLaneKey: laneKey } : {}),
    laneEmphasis: laneQualityPolicy(lane).emphasis,
  };
}

/**
 * Deterministic defects in a whole round SET — what the critique loop is allowed
 * to react to. Note what is absent: nothing here can change an answer.
 */
export function quizSetDefects(rounds: readonly PlannedRound[]): string[] {
  const defects: string[] = [];
  if (!rounds.length) return ["no rounds"];
  const seenSubject = new Set<string>();
  const seenAnswer = new Set<string>();
  for (const r of rounds) {
    const text = r.questionText.trim();
    if (!text) defects.push(`${r.subjectId}: empty question text`);
    if (!text.includes("?")) defects.push(`${r.subjectId}: not phrased as a question`);
    if (text.length > 160) defects.push(`${r.subjectId}: question too long for a quiz card`);
    // The one universal spoiler rule: the prompt may never contain the answer.
    //
    // WORD BOUNDARIES, not `String.includes`. A raw substring test reads the
    // answer inside ordinary words and throws on legitimate rounds: measured on
    // real element rows, "What is the chemical symbol for indium?" contains
    // "In", "…for iodine?" contains "I", "…for nobelium?" contains "No",
    // "…for barium?" contains "Ba", "…for astatine?" contains "At". This gate
    // THROWS (see the block's final integrity check) and the repair path falls
    // back to the same deterministic template, which trips it again — so the
    // substring form made every such round an unrecoverable video failure.
    // `containsPhrase` is what questionTextDefects already uses; this call site
    // simply had not been switched over.
    if (r.answerLabel && containsPhrase(text, r.answerLabel)) {
      defects.push(`${r.subjectId}: question spoils the answer`);
    }
    if (seenSubject.has(r.subjectId)) defects.push(`duplicate subject ${r.subjectId}`);
    seenSubject.add(r.subjectId);
    seenAnswer.add(`${r.category}:${r.answerLabel}`);
    const correct = r.options.filter((o) => o.isCorrect);
    if (correct.length !== 1) defects.push(`${r.subjectId}: ${correct.length} correct options`);
  }
  // A set whose answers are all identical is a bad quiz even when every
  // individual answer is correct.
  if (rounds.length >= 3 && seenAnswer.size < 2) defects.push("every answer is the same");
  return defects;
}

/**
 * Grade the question WORDING (never the answers). Returns null when the grader
 * is unavailable so the caller accepts rather than failing the run on a
 * transient LLM outage.
 */
async function gradeQuizQuestions(): Promise<{ score: number; pass: boolean; issues: string[] } | null> {
  // Generic model critique is removed from QuizYear. Its question templates and
  // deterministic spoiler/integrity checks are the production quality gate.
  return null;
}

/* ------------------------------------------------------------------ *
 * Per-category sourcing → PlannedRound
 * ------------------------------------------------------------------ */

interface SourceArgs {
  ctx: StageContext;
  want: number;
  brief: string;
  allowSensitiveTopics: boolean;
  minNotability: number;
}

/** The original guess-the-year path, now one category among several. */
async function sourceYearRounds(args: SourceArgs & { topic: QuizYearTopicKey }): Promise<PlannedRound[]> {
  const { ctx } = args;
  const sourced = await fetchQuizYearFacts({
    topic: args.topic,
    count: args.want,
    minNotability: args.minNotability,
    allowSensitiveTopics: args.allowSensitiveTopics,
    log: (m) => ctx.log(m),
    retries: 4,
    timeoutMs: 45_000,
  });
  const out: PlannedRound[] = [];
  for (const fact of sourced.facts.slice(0, args.want)) {
    const q = await phraseQuizYearQuestion({
      fact,
      critiqueBrief: args.brief,
      log: (m) => ctx.log(m),
      askModel: undefined,
    });
    // Re-assert before the fact leaves this function, exactly as the original
    // build did — a drifted year must never reach the shared round pipeline.
    assertAnswerIntegrity(q, fact);
    const options = buildYearOptions(fact);
    assertOptionIntegrity(options, fact);
    out.push({
      category: "guess_year",
      categoryPrompt: CATEGORY_PROMPTS.guess_year,
      subjectId: fact.wikidataQid,
      subject: fact.eventLabel,
      subtext: fact.eventDescription,
      questionText: q.questionText,
      answerLabel: String(fact.year),
      answerNumber: fact.year,
      sourceUrl: fact.sourceUrl,
      options: options.map((o) => ({
        label: String(o.year),
        isCorrect: o.isCorrect,
        provenance: o.provenance,
      })),
      phrasedByModel: q.phrasedByModel,
    });
  }
  return out;
}

/** Any of the generalised Wikidata property categories. */
async function sourceCategoryRounds(
  args: SourceArgs & { category: QuizCategoryKey },
): Promise<PlannedRound[]> {
  const { ctx } = args;
  const sourced = await fetchCategoryFacts({
    category: args.category,
    count: args.want,
    minNotability: args.minNotability,
    allowSensitiveTopics: args.allowSensitiveTopics,
    log: (m) => ctx.log(m),
    retries: 4,
    timeoutMs: 45_000,
  });
  const out: PlannedRound[] = [];
  for (const fact of sourced.facts) {
    if (out.length >= args.want) break;
    const round = await plannedRoundForFact(fact, sourced.decoyPool, args);
    if (round) out.push(round);
  }
  return out;
}

async function plannedRoundForFact(
  fact: QuizCategoryFact,
  pool: readonly QuizDecoyCandidate[],
  args: SourceArgs,
): Promise<PlannedRound | null> {
  const { ctx } = args;
  let options;
  try {
    options = buildQuizOptions(fact, { pool });
    assertQuizOptionIntegrity(options, fact);
  } catch (e) {
    // A thin or too-confusable decoy pool drops the ROUND, never invents one.
    ctx.log(`quiz: skipping ${fact.subjectQid} — ${e instanceof Error ? e.message : e}`);
    return null;
  }
  const q = await phraseQuizQuestion({
    fact,
    critiqueBrief: args.brief,
    log: (m) => ctx.log(m),
    askModel: undefined,
  });
  assertQuizAnswerIntegrity(q, fact);
  return {
    category: fact.categoryKey,
    categoryPrompt: CATEGORY_PROMPTS[fact.categoryKey],
    subjectId: fact.subjectQid,
    subject: fact.subjectLabel,
    subtext: fact.subjectDescription,
    questionText: q.questionText,
    answerLabel: fact.answerLabel,
    ...(fact.answerNumber !== undefined ? { answerNumber: fact.answerNumber } : {}),
    sourceUrl: fact.sourceUrl,
    options: options.map((o) => ({ label: o.label, isCorrect: o.isCorrect, provenance: o.provenance })),
    phrasedByModel: q.phrasedByModel,
  };
}

/**
 * The citation-grounded category. ONE proposal call covers the whole batch;
 * verification is free network I/O, and over-proposing is how the lossy
 * verification stage is absorbed without extra model spend.
 */
async function sourceGeneralKnowledgeRounds(args: SourceArgs): Promise<PlannedRound[]> {
  // Candidate proposal was Gemini-backed. The certified route stays inside the
  // curated CC0 Wikidata topic registry, so this category is unavailable.
  args.ctx.log("quiz: general_knowledge is unavailable in the certified deterministic route");
  return [];
}

/**
 * Source every enabled category, then lay the rounds out in the interleaved
 * order `planRoundCategories` asked for. A category that under-delivers (a thin
 * decoy pool, a rejected general-knowledge batch) yields its slots to the
 * others rather than failing the run — the video is still a mixed quiz, just
 * weighted differently.
 */
async function buildRounds(args: {
  ctx: StageContext;
  rounds: number;
  categories: QuizRoundCategory[];
  topic: QuizYearTopicKey;
  brief: string;
  allowSensitiveTopics: boolean;
  minNotability: number;
}): Promise<PlannedRound[]> {
  const plan = planRoundCategories(args.rounds, args.categories);
  const wanted = new Map<QuizRoundCategory, number>();
  for (const c of plan) wanted.set(c, (wanted.get(c) ?? 0) + 1);
  args.ctx.log(
    `quiz: round plan ${plan.join(" → ")} (${[...wanted].map(([c, n]) => `${c}×${n}`).join(", ")})`,
  );

  const shared: SourceArgs = {
    ctx: args.ctx,
    want: 0,
    brief: args.brief,
    allowSensitiveTopics: args.allowSensitiveTopics,
    minNotability: args.minNotability,
  };
  const bucket = new Map<QuizRoundCategory, PlannedRound[]>();
  for (const [category, want] of wanted) {
    try {
      const produced =
        category === "guess_year"
          ? await sourceYearRounds({ ...shared, want, topic: args.topic })
          : category === "general_knowledge"
            ? await sourceGeneralKnowledgeRounds({ ...shared, want })
            : await sourceCategoryRounds({ ...shared, want, category });
      bucket.set(category, produced);
      if (produced.length < want) {
        args.ctx.log(`quiz: ${category} produced ${produced.length}/${want} rounds`);
      }
    } catch (e) {
      // One category failing must not lose the video.
      args.ctx.log(`quiz: category ${category} failed (${e instanceof Error ? e.message : e}) — continuing`);
      bucket.set(category, []);
    }
  }

  const out: PlannedRound[] = [];
  const leftovers: PlannedRound[] = [];
  for (const category of plan) {
    const next = bucket.get(category)?.shift();
    if (next) out.push(next);
  }
  for (const list of bucket.values()) leftovers.push(...list);
  // Backfill any slots a category could not fill, keeping the interleave.
  for (const extra of leftovers) {
    if (out.length >= args.rounds) break;
    out.push(extra);
  }
  return out.slice(0, args.rounds);
}

/**
 * Author the round set, critique the WORDING, and freeze the accepted set into a
 * content-addressed R2 checkpoint. The key is derived from the plan inputs, so a
 * healer replay re-reads the settled rounds instead of re-buying the LLM calls.
 */
async function authorRounds(args: {
  ctx: StageContext;
  rounds: number;
  categories: QuizRoundCategory[];
  topic: QuizYearTopicKey;
  channel: ChannelCritiqueContext;
  allowSensitiveTopics: boolean;
  minNotability: number;
}): Promise<PlannedRound[]> {
  const { ctx } = args;
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        v: QUIZ_QUESTIONS_CHECKPOINT_VERSION,
        rounds: args.rounds,
        categories: [...args.categories].sort(),
        topic: args.topic,
        notability: args.minNotability,
        channel: args.channel.criticDoctrine ?? "",
        lane: args.channel.contentLaneKey ?? "",
      }),
    )
    .digest("hex")
    .slice(0, 16);
  const checkpointKey = `${ctx.keyPrefix.replace(/\/$/, "")}/checkpoints/quiz-rounds/${fingerprint}.json`;

  try {
    const cached = await getObjectBytes(checkpointKey);
    if (cached) {
      const parsed = JSON.parse(Buffer.from(cached).toString("utf8")) as {
        version?: string;
        rounds?: PlannedRound[];
      };
      if (parsed.version === QUIZ_QUESTIONS_CHECKPOINT_VERSION && parsed.rounds?.length) {
        // Re-verify rather than trusting the checkpoint blindly: a stored round
        // set still has to satisfy every deterministic invariant.
        const defects = quizSetDefects(parsed.rounds);
        if (!defects.length) {
          ctx.log(`quiz: reused round checkpoint ${fingerprint} (${parsed.rounds.length} rounds, $0)`);
          return parsed.rounds;
        }
        ctx.log(`quiz: checkpoint ${fingerprint} failed re-verification (${defects.join("; ")}) — re-authoring`);
      }
    }
  } catch {
    /* cold checkpoint → author fresh */
  }

  const loop = await produceAndCritique<PlannedRound[]>({
    label: "quiz:rounds",
    channel: args.channel,
    maxIters: 2,
    threshold: 0.75,
    log: (m, extra) => ctx.log(extra ? `${m} ${JSON.stringify(extra)}` : m),
    produce: async (priorIssues) => {
      const brief =
        channelCritiqueBrief(args.channel) +
        (priorIssues.length
          ? `\nFIX THESE ISSUES FROM THE LAST PASS:\n${priorIssues.map((i) => `- ${i}`).join("\n")}\n`
          : "");
      return buildRounds({
        ctx,
        rounds: args.rounds,
        categories: args.categories,
        topic: args.topic,
        brief,
        allowSensitiveTopics: args.allowSensitiveTopics,
        minNotability: args.minNotability,
      });
    },
    critique: async (rounds) => {
      const hard = quizSetDefects(rounds);
      if (hard.length) return { score: 0.2, pass: false, issues: hard.slice(0, 8) };
      const graded = await gradeQuizQuestions();
      if (!graded) return { score: 1, pass: true, issues: [] };
      return { score: graded.score, pass: graded.pass, issues: graded.issues };
    },
  });

  // Deterministic defects are NEVER shipped: fall back to template text for any
  // round the loop could not clean up. Wikidata rounds have a deterministic
  // template; general-knowledge rounds do not (their question came from the
  // verified candidate), so a defective one is dropped instead.
  const repaired: PlannedRound[] = [];
  for (const r of loop.value) {
    // Same word-boundary rule as quizSetDefects — these two must agree, or the
    // "repair" writes text that the final gate then rejects.
    if (!r.questionText.trim() || containsPhrase(r.questionText, r.answerLabel)) {
      if (r.category === "general_knowledge") {
        ctx.log(`quiz: dropped unrepairable general-knowledge round (${r.subjectId})`);
        continue;
      }
      repaired.push({
        ...r,
        questionText:
          r.category === "guess_year"
            ? `In what year did this happen: ${r.subject}?`
            : QUIZ_CATEGORIES[r.category as QuizCategoryKey].ask(r.subject),
        phrasedByModel: false,
      });
      continue;
    }
    repaired.push(r);
  }

  await putObject(
    checkpointKey,
    Buffer.from(JSON.stringify({ version: QUIZ_QUESTIONS_CHECKPOINT_VERSION, rounds: repaired })),
    { contentType: "application/json" },
  );
  return repaired;
}

export const quizYear: Block = {
  id: "quiz_year",
  // A certified run receives the matching planner and safety receipt here;
  // pipeline order alone is not a safety boundary.
  consumes: ["quizPlan", "quizSafety"],
  produces: ["videoKey", "videoLocalPath", "videoDurationSec", "quizRounds", "onScreenTextCues"],
  paid: true,
  run: async (ctx) => {
    // This is an execution guard, not a UI convention: a certified planner
    // route must be able to run in an environment where Gemini is configured
    // for other channel families without inspecting or calling it here.
    if (ctx.params["noGemini"] !== true) {
      throw new Error(
        "quiz: quiz_year is certified only in noGemini mode; use quiz_topic_plan → quiz_topic_safety → music",
      );
    }
    const noGemini = true;
    const countdown = Math.max(
      3,
      Math.min(15, Number(ctx.params["countdownSeconds"] ?? QUIZ_DEFAULT_COUNTDOWN_SECONDS)),
    );
    const reveal = Math.max(
      2,
      Math.min(10, Number(ctx.params["revealSeconds"] ?? QUIZ_DEFAULT_REVEAL_SECONDS)),
    );
    const targetSeconds = Math.max(0, Number(ctx.params["targetSeconds"] ?? 0));
    const rounds = quizRoundCount(targetSeconds, countdown, reveal);
    // Re-check the exact planner → safety handoff immediately before sourcing
    // facts. This keeps retries and rehydration from marrying an older receipt
    // to a new renderer invocation.
    const plan = assertCertifiedQuizTopicPlan(ctx.store["quizPlan"]);
    assertCertifiedQuizTopicSafety(ctx.store["quizSafety"], plan);
    const storedTopicKey = String(ctx.store["quizTopic"] ?? "").trim();
    const storedTopic = String(ctx.store["topic"] ?? "").trim();
    if (storedTopicKey !== plan.topicKey || storedTopic !== plan.topic) {
      throw new Error("quiz: planner topic fields do not match the certified safety receipt");
    }
    const topic = plan.topicKey;
    const categories = resolveCertifiedNoGeminiCategories(
      ctx.params["categories"] ?? ctx.store["quizCategories"],
    );
    const allowSensitiveTopics = false;
    const minNotability = Math.max(0, Number(ctx.params["minNotability"] ?? 40));
    const musicKey = String(ctx.store["musicKey"] ?? "").trim();
    if (noGemini && !musicKey) {
      throw new Error("quiz: certified no-Gemini mode requires an upstream original musicKey");
    }
    ctx.log(
      `quiz: ${rounds} rounds (${countdown}s guess + ${reveal}s reveal), ` +
        `categories=[${categories.join(", ")}], year topic=${topic}, noGemini=${noGemini}`,
    );

    // 1) FACTS + QUESTION WORDING. Both are deterministic and checkpointed.
    const planned = await authorRounds({
      ctx,
      rounds,
      categories,
      topic,
      channel: quizCritiqueChannel(ctx),
      allowSensitiveTopics,
      minNotability,
    });

    if (planned.length < QUIZ_MIN_ROUNDS) {
      throw new Error(
        `quiz: only ${planned.length} clean rounds across [${categories.join(", ")}] ` +
          `(need ≥ ${QUIZ_MIN_ROUNDS})`,
      );
    }

    // 2) FINAL INTEGRITY ASSERTION — the last gate before pixels. Everything
    //    here is deterministic and re-run on every checkpoint replay.
    const setDefects = quizSetDefects(planned);
    if (setDefects.length) {
      throw new Error(`quiz: round set failed final integrity check: ${setDefects.join("; ")}`);
    }
    for (const r of planned) {
      const sourced = r.options.filter(
        (o) => o.provenance === "wikidata-sourced" || o.provenance === "wikipedia-verified",
      );
      if (sourced.length !== 1 || !sourced[0].isCorrect || sourced[0].label !== r.answerLabel) {
        throw new Error(
          `quiz: ${r.subjectId} — the correct option must be the single sourced/verified one`,
        );
      }
    }

    // 3) RENDER PROPS. Only `label` + `isCorrect` cross the boundary; the
    //    `provenance` tag stays server-side so the composition has no way to
    //    mistake a decoy for a citable value.
    const palette = Array.isArray(ctx.store["palette"])
      ? (ctx.store["palette"] as unknown[]).map(String)
      : [];
    const quizRounds: QuizYearRound[] = planned.map((r) => ({
      questionText: r.questionText,
      options: r.options.map((o) => ({ label: o.label, isCorrect: o.isCorrect })),
      subject: r.subject,
      ...(r.subtext ? { subtext: r.subtext } : {}),
      sourceUrl: r.sourceUrl,
      countdownSeconds: countdown,
      revealSeconds: reveal,
      categoryPrompt: r.categoryPrompt,
    }));
    // Exact final-master legibility contract. Every question and every option
    // must remain readable during its active countdown—not merely be present
    // in the React props. The generic OCR proof consumes these timed cues in
    // qa_visual after the music mux has produced the actual release master.
    const onScreenTextCues: TimedOnScreenTextCue[] = quizRounds.map((round, index) => ({
      id: `quiz-round-${String(index + 1).padStart(2, "0")}`,
      sampleSec: index * (countdown + reveal) + Math.min(2, Math.max(0.75, countdown - 0.75)),
      expectedText: [round.questionText, ...round.options.map((option) => option.label)].join(" "),
      minTokenCoverage: 0.8,
    }));

    const runDir = await makeRunTempDir(ctx.runId, "quiz_year");
    const outPath = join(runDir, "quiz-year.mp4");
    await renderQuizYear({
      rounds: quizRounds,
      palette,
      title: String(ctx.store["channelName"] ?? ""),
      outPath,
      log: (m) => ctx.log(m),
    });

    // The Remotion composition deliberately owns a silent visual game board;
    // this reusable mux keeps the original licensed/generated instrumental
    // bed in a distinct module and creates a real audio stream for final QA.
    let finalPath = outPath;
    if (musicKey) {
      const musicPath = join(runDir, "quiz-bed.mp3");
      await writeFile(musicPath, await getObjectBytes(musicKey));
      const withMusic = join(runDir, "quiz-year-with-music.mp4");
      await muxLoopedMusicBed({
        videoPath: outPath,
        musicPath,
        outPath: withMusic,
        durationSec: quizRounds.length * (countdown + reveal),
        volume: 0.42,
        fadeOutSec: 0.8,
      });
      finalPath = withMusic;
      ctx.log("quiz: original instrumental bed muxed into final master");
    }

    const prefix = `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/quiz-year`;
    const videoKey = `${prefix}/quiz-year.mp4`;
    await putObjectFromFile(videoKey, finalPath, { contentType: "video/mp4" });
    const videoDurationSec = quizRounds.length * (countdown + reveal);

    await recordAsset(ctx, "video", videoKey, {
      durationSec: videoDurationSec,
      engine: "quiz_year",
      topic,
      categories: [...new Set(planned.map((r) => r.category))],
      rounds: quizRounds.length,
      audio: musicKey ? "original instrumental bed muxed from musicKey" : "none (legacy non-certified route)",
      // Provenance travels with the asset: every answer is checkable.
      sources: planned.map((r) => ({
        category: r.category,
        subject: r.subjectId,
        answer: r.answerLabel,
        url: r.sourceUrl,
      })),
      license: "CC0-1.0 (Wikidata)",
    });

    // This module itself makes no provider call; original music cost is owned
    // and attested by the preceding music block.
    const costUsd = 0;
    ctx.log(
      `quiz ✓ → ${videoKey} (${videoDurationSec}s, ${quizRounds.length} rounds across ` +
        `${new Set(planned.map((r) => r.category)).size} categories, deterministic wording, ` +
        `$${costUsd.toFixed(4)})`,
    );

    return {
      videoKey,
      videoLocalPath: finalPath,
      videoDurationSec,
      quizRounds,
      onScreenTextCues,
      [COST_PATCH_KEY]: costUsd,
    };
  },
};

export const quizYearBlocks: Block[] = [quizYear];

// Re-exported so the deterministic fallback stays importable by tests that
// exercise a model-outage path.
export { deterministicQuestionText, deterministicCategoryQuestion, questionTextDefects };
