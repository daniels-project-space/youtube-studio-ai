/**
 * quiz_year — the GUESS-THE-YEAR visual engine for the `quizyear` family.
 *
 * SELF-CONTAINED, structural twin of whiteboard_scribe / motion_comic /
 * lore_short: it sources its own facts, writes its own on-screen questions and
 * renders its own finished video, so it REPLACES the script → narration →
 * footage → assemble chain rather than sitting inside one. It emits the final
 * `videoKey` directly.
 *
 * WHY THIS ONE IS BUILDABLE WHEN THE OTHER THREE QUIZ FORMATS ARE NOT
 * The 2026-08 audits closed trivia (no compliantly-licensed dataset exists),
 * flag-guess (Paris Convention Art. 6ter + no genuine CC0 flag artwork) and
 * music-guess (no clearable audio). This format avoids all three because it
 * needs NO third-party media at all: the only external input is Wikidata's
 * structured statements, which are CC0 1.0 — a real public-domain dedication
 * with no attribution or ShareAlike obligation. Nothing is scraped, no artwork
 * or audio is reused, and the typography is rendered locally by Remotion.
 *
 * THE COST SHAPE — AND WHY IT IS SO SMALL
 * There is exactly ONE optional paid call in this whole block: a text-only
 * phrasing pass per round (`gemini-2.5-flash`, a couple of hundred tokens).
 * Facts are free (Wikidata), the render is free (local Remotion + headless
 * Chromium), and there is no image, video, TTS or music provider on the path.
 * If the phrasing model is unavailable the block still produces a complete,
 * correct video from deterministic question templates.
 *
 * THE INVARIANT THIS BLOCK EXISTS TO PROTECT
 * The answer year is NEVER model-generated. `fetchQuizYearFacts` reads it from
 * a Wikidata time value; the phrasing model's response schema has no year
 * field; `questionTextDefects` rejects any phrasing containing a four-digit
 * number; and `assertAnswerIntegrity` re-checks QID + year immediately before
 * the render props are built, throwing rather than degrading. The critique loop
 * grades the QUESTION WORDING only and can never touch the answer.
 */
import { join } from "node:path";
import { createHash } from "node:crypto";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { COST_PATCH_KEY, type Block, type StageContext } from "@/engine/types";
import { makeRunTempDir } from "@/lib/files";
import { putObject, putObjectFromFile, getObjectBytes } from "@/lib/storage";
import { geminiJson, hasGeminiKey } from "@/lib/gemini";
import {
  channelCritiqueBrief,
  produceAndCritique,
  type ChannelCritiqueContext,
} from "@/engine/critiqueLoop";
import { laneQualityPolicy } from "@/engine/contentLane";
import { PRICE } from "@/engine/pricing";
import {
  assertAnswerIntegrity,
  assertOptionIntegrity,
  buildYearOptions,
  deterministicQuestionText,
  fetchQuizYearFacts,
  phraseQuizYearQuestion,
  questionTextDefects,
  QUIZ_YEAR_TOPIC_KEYS,
  type QuizYearFact,
  type QuizYearQuestion,
  type QuizYearTopicKey,
} from "@/lib/quizYearFacts";
import { renderQuizYear, type QuizYearRound } from "@/lib/quizYearRender";

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

const QUIZ_QUESTIONS_CHECKPOINT_VERSION = "quiz-year-questions/v1";

/** Seconds a viewer gets to guess, and how long the reveal holds. */
export const QUIZ_DEFAULT_COUNTDOWN_SECONDS = 6;
export const QUIZ_DEFAULT_REVEAL_SECONDS = 4;
/** Round-count bounds. Floor keeps a watchable video; ceiling caps LLM calls. */
export const QUIZ_MIN_ROUNDS = 3;
export const QUIZ_MAX_ROUNDS = 15;

/**
 * How many rounds fit a requested runtime. Kept in lockstep with
 * quizYearCostCeiling() in src/engine/moduleContracts.ts.
 */
export function quizRoundCount(targetSeconds: number, countdown: number, reveal: number): number {
  const per = Math.max(1, countdown + reveal);
  if (!Number.isFinite(targetSeconds) || targetSeconds <= 0) return 8;
  return Math.max(QUIZ_MIN_ROUNDS, Math.min(QUIZ_MAX_ROUNDS, Math.round(targetSeconds / per)));
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

/** Resolve the requested topic, defaulting to a broadly safe one. */
export function resolveTopic(raw: unknown): QuizYearTopicKey {
  const key = String(raw ?? "").trim() as QuizYearTopicKey;
  return QUIZ_YEAR_TOPIC_KEYS.includes(key) ? key : "science_discovery";
}

/**
 * Deterministic defects in a whole question SET — what the critique loop is
 * allowed to react to. Note what is absent: nothing here can change a year.
 */
export function quizSetDefects(questions: readonly QuizYearQuestion[]): string[] {
  const defects: string[] = [];
  if (!questions.length) return ["no questions"];
  const seenQid = new Set<string>();
  const seenYear = new Set<number>();
  for (const q of questions) {
    for (const d of questionTextDefects(q.fact, q.questionText)) {
      defects.push(`${q.fact.wikidataQid}: ${d}`);
    }
    if (seenQid.has(q.fact.wikidataQid)) defects.push(`duplicate subject ${q.fact.wikidataQid}`);
    seenQid.add(q.fact.wikidataQid);
    seenYear.add(q.fact.year);
  }
  // A round of questions that all share one year is a bad quiz even when every
  // individual answer is correct.
  if (questions.length >= 3 && seenYear.size < 2) {
    defects.push("every answer is the same year");
  }
  return defects;
}

/**
 * Grade the question WORDING (never the answers). Returns null when the grader
 * is unavailable so the caller accepts rather than failing the run on a
 * transient LLM outage.
 */
async function gradeQuizQuestions(args: {
  questions: QuizYearQuestion[];
  channel: ChannelCritiqueContext;
  log: (m: string) => void;
  onCall: () => void;
}): Promise<{ score: number; pass: boolean; issues: string[] } | null> {
  if (!hasGeminiKey()) return null;
  const listing = args.questions
    .map((q, i) => `${i + 1}. ${q.questionText}  [subject: ${q.fact.eventLabel}]`)
    .join("\n");
  const prompt =
    `You are the CRITIC for a "guess the year" quiz channel. Grade ONLY the WORDING of these on-screen questions.\n\n` +
    channelCritiqueBrief(args.channel) +
    `\nQUESTIONS:\n${listing}\n\n` +
    `Judge: clarity (is it instantly understandable on screen?), engagement (does it make you want to guess?), ` +
    `and no-spoiler (does the wording give the answer away, e.g. by naming an era or a decade?).\n` +
    `DO NOT judge factual correctness and DO NOT suggest years — the answers come from a cited dataset, not from you.\n\n` +
    `Return JSON: {"score": 0..1, "pass": boolean, "issues": ["..."]}`;
  try {
    args.onCall();
    const r = await geminiJson<{ score?: unknown; pass?: unknown; issues?: unknown }>({
      prompt,
      maxTokens: 900,
      temperature: 0.2,
    });
    const score = Math.max(0, Math.min(1, Number(r?.score ?? 0)));
    return {
      score: Number.isFinite(score) ? score : 0,
      pass: r?.pass === true,
      issues: Array.isArray(r?.issues) ? r.issues.map(String).slice(0, 8) : [],
    };
  } catch (e) {
    args.log(`quiz_year: critic unavailable (${e instanceof Error ? e.message : e}) — accepting`);
    return null;
  }
}

/**
 * Phrase every question, critique the SET, and freeze the accepted set into a
 * content-addressed R2 checkpoint. The checkpoint key is derived from the facts
 * (QID+year) plus the phrasing knobs, so a healer replay with the same facts
 * re-reads the settled questions instead of re-buying the LLM calls.
 */
async function authorQuestions(args: {
  ctx: StageContext;
  facts: QuizYearFact[];
  channel: ChannelCritiqueContext;
  onModelCall: () => void;
}): Promise<QuizYearQuestion[]> {
  const { ctx, facts } = args;
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        v: QUIZ_QUESTIONS_CHECKPOINT_VERSION,
        facts: facts.map((f) => [f.wikidataQid, f.year]),
        channel: args.channel.criticDoctrine ?? "",
        lane: args.channel.contentLaneKey ?? "",
      }),
    )
    .digest("hex")
    .slice(0, 16);
  const checkpointKey = `${ctx.keyPrefix.replace(/\/$/, "")}/checkpoints/quiz-year/${fingerprint}.json`;

  try {
    const cached = await getObjectBytes(checkpointKey);
    if (cached) {
      const parsed = JSON.parse(Buffer.from(cached).toString("utf8")) as {
        version?: string;
        questions?: QuizYearQuestion[];
      };
      if (parsed.version === QUIZ_QUESTIONS_CHECKPOINT_VERSION && parsed.questions?.length) {
        // Re-verify rather than trusting the checkpoint blindly: a stored
        // question set still has to satisfy the answer-integrity invariant.
        const byQid = new Map(facts.map((f) => [f.wikidataQid, f]));
        let ok = true;
        for (const q of parsed.questions) {
          const source = byQid.get(q.fact.wikidataQid);
          if (!source) { ok = false; break; }
          try { assertAnswerIntegrity(q, source); } catch { ok = false; break; }
        }
        if (ok) {
          ctx.log(`quiz_year: reused question checkpoint ${fingerprint} (${parsed.questions.length} rounds, $0)`);
          return parsed.questions;
        }
        ctx.log(`quiz_year: checkpoint ${fingerprint} failed re-verification — re-authoring`);
      }
    }
  } catch {
    /* cold checkpoint → author fresh */
  }

  const loop = await produceAndCritique<QuizYearQuestion[]>({
    label: "quiz_year:questions",
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
      const out: QuizYearQuestion[] = [];
      for (const fact of facts) {
        const q = await phraseQuizYearQuestion({
          fact,
          critiqueBrief: brief,
          log: (m) => ctx.log(m),
          askModel: hasGeminiKey()
            ? async (prompt) => {
                args.onModelCall();
                return geminiJson<{ question?: unknown }>({ prompt, maxTokens: 220, temperature: 0.7 });
              }
            : undefined,
        });
        out.push(q);
      }
      return out;
    },
    critique: async (questions) => {
      const hard = quizSetDefects(questions);
      if (hard.length) {
        return { score: 0.2, pass: false, issues: hard.slice(0, 8) };
      }
      const graded = await gradeQuizQuestions({
        questions,
        channel: args.channel,
        log: (m) => ctx.log(m),
        onCall: args.onModelCall,
      });
      if (!graded) return { score: 1, pass: true, issues: [] };
      return { score: graded.score, pass: graded.pass, issues: graded.issues };
    },
  });

  const questions = loop.value;
  // Deterministic defects are NEVER shipped: fall back to the template text for
  // any question the loop could not clean up.
  const repaired = questions.map((q) =>
    questionTextDefects(q.fact, q.questionText).length
      ? { fact: q.fact, questionText: deterministicQuestionText(q.fact), phrasedByModel: false }
      : q,
  );

  await putObject(
    checkpointKey,
    Buffer.from(JSON.stringify({ version: QUIZ_QUESTIONS_CHECKPOINT_VERSION, questions: repaired })),
    { contentType: "application/json" },
  );
  return repaired;
}

export const quizYear: Block = {
  id: "quiz_year",
  consumes: [],
  produces: ["videoKey", "videoLocalPath", "videoDurationSec", "quizRounds"],
  paid: true,
  run: async (ctx) => {
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
    const topic = resolveTopic(ctx.params["topic"] ?? ctx.store["quizTopic"]);
    ctx.log(`quiz_year: topic=${topic}, ${rounds} rounds (${countdown}s guess + ${reveal}s reveal)`);

    // 1) FACTS — free, CC0, deterministic. No LLM involved in the answers.
    const sourced = await fetchQuizYearFacts({
      topic,
      count: rounds,
      minNotability: Math.max(0, Number(ctx.params["minNotability"] ?? 30)),
      allowSensitiveTopics: ctx.params["allowSensitiveTopics"] === true,
      log: (m) => ctx.log(m),
      retries: 4,
      timeoutMs: 45_000,
    });
    if (sourced.facts.length < QUIZ_MIN_ROUNDS) {
      throw new Error(
        `quiz_year: only ${sourced.facts.length} clean facts for topic ${topic} ` +
          `(need ≥ ${QUIZ_MIN_ROUNDS}); rejected ${JSON.stringify(sourced.rejected)}`,
      );
    }
    const facts = sourced.facts.slice(0, rounds);

    // 2) QUESTION WORDING — the only paid step, text-only, critique-looped and
    //    checkpointed. Cannot alter any answer.
    let modelCalls = 0;
    const questions = await authorQuestions({
      ctx,
      facts,
      channel: quizCritiqueChannel(ctx),
      onModelCall: () => { modelCalls += 1; },
    });

    // 3) FINAL INTEGRITY ASSERTION — throws if a year or subject ever drifted
    //    from the sourced fact. This is the last gate before pixels.
    const byQid = new Map(facts.map((f) => [f.wikidataQid, f]));
    for (const q of questions) {
      const source = byQid.get(q.fact.wikidataQid);
      if (!source) throw new Error(`quiz_year: question references unsourced subject ${q.fact.wikidataQid}`);
      assertAnswerIntegrity(q, source);
    }

    // 4) MULTIPLE-CHOICE OPTIONS — one sourced truth + three generated decoys.
    //    The decoys are UI-only: they are never cited, never recorded as facts
    //    and never written into the asset's provenance. assertOptionIntegrity
    //    proves exactly one option carries `provenance: "wikidata-sourced"` and
    //    that its year equals the Wikidata year, so a decoy cannot become the
    //    answer. Option order is seeded from the QID, so a healer replay
    //    reproduces the same grid rather than a differently-shuffled one.
    const palette = Array.isArray(ctx.store["palette"])
      ? (ctx.store["palette"] as unknown[]).map(String)
      : [];
    const quizRounds: QuizYearRound[] = questions.map((q) => {
      const options = buildYearOptions(q.fact);
      assertOptionIntegrity(options, q.fact);
      return {
        questionText: q.questionText,
        // Only `year` + `isCorrect` cross the render boundary; `provenance`
        // stays server-side so the composition has no way to mistake a decoy
        // for a citable value.
        options: options.map((o) => ({ year: o.year, isCorrect: o.isCorrect })),
        subject: q.fact.eventLabel,
        subtext: q.fact.eventDescription,
        sourceUrl: q.fact.sourceUrl,
        countdownSeconds: countdown,
        revealSeconds: reveal,
      };
    });

    const runDir = await makeRunTempDir(ctx.runId, "quiz_year");
    const outPath = join(runDir, "quiz-year.mp4");
    await renderQuizYear({
      rounds: quizRounds,
      palette,
      title: String(ctx.store["channelName"] ?? ""),
      outPath,
      log: (m) => ctx.log(m),
    });

    const prefix = `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/quiz-year`;
    const videoKey = `${prefix}/quiz-year.mp4`;
    await putObjectFromFile(videoKey, outPath, { contentType: "video/mp4" });
    const videoDurationSec = quizRounds.length * (countdown + reveal);

    await recordAsset(ctx, "video", videoKey, {
      durationSec: videoDurationSec,
      engine: "quiz_year",
      topic,
      rounds: quizRounds.length,
      // Provenance travels with the asset: every answer is checkable.
      sources: questions.map((q) => ({ qid: q.fact.wikidataQid, year: q.fact.year, url: q.fact.sourceUrl })),
      license: "CC0-1.0 (Wikidata)",
    });

    // Text-only spend. There is no image/video/TTS provider on this path.
    const costUsd = modelCalls * PRICE.boundedTextPassUsd;
    ctx.log(
      `quiz_year ✓ → ${videoKey} (${videoDurationSec}s, ${quizRounds.length} rounds, ` +
        `${modelCalls} text calls, $${costUsd.toFixed(4)})`,
    );

    return {
      videoKey,
      videoLocalPath: outPath,
      videoDurationSec,
      quizRounds,
      [COST_PATCH_KEY]: costUsd,
    };
  },
};

export const quizYearBlocks: Block[] = [quizYear];
