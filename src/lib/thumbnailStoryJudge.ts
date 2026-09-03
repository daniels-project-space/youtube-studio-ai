/**
 * HYBRID STORY-INTEREST SCORING.
 *
 * `scoreThumbnailStoryInterest` is keyword-based. That was a deliberate choice —
 * it is deterministic, free, and regression-testable, which is why the whole
 * capability routing table can be verified without generating anything. But it
 * is blind by construction: a stake expressed in words outside its lexicon
 * scores as no stake at all, and a genuinely dull concept dressed in words that
 * happen to be ON the list scores as compelling.
 *
 * So this does not replace it. It runs the SAME rubric past a model and
 * reconciles the two, with three rules that keep the determinism worth having:
 *
 *  1. The deterministic verdict is a FLOOR on rejection. If the lexicon says a
 *     concept is inert, no model opinion rescues it — that path is covered by
 *     regression tests and must stay predictable.
 *  2. The model may only pull a score DOWN, never up. Its value is catching
 *     dullness the lexicon missed; letting it inflate scores would quietly
 *     disable the gate the tests are pinned to.
 *  3. A model failure is not a rejection. If the judge errors, times out, or
 *     returns nonsense, the deterministic verdict stands unchanged.
 *
 * Rule 2 is the one that matters. An LLM asked "is this interesting?" says yes
 * far too readily; used as a veto it is useful, used as a promoter it would
 * dissolve the gate entirely.
 */
import { claudeJson } from "@/lib/anthropic";
import {
  STORY_INTEREST_DOCTRINE,
  type StoryInterestVerdict,
  type SubjectClass,
} from "@/lib/thumbnailStoryInterest";

export interface JudgedStoryVerdict extends StoryInterestVerdict {
  /** Score before the model was consulted. */
  deterministicScore: number;
  /** The model's own score, when it answered. */
  judgeScore?: number;
  /** True when the model pulled the verdict down. */
  judgeLoweredScore: boolean;
}

export interface JudgeResponse {
  score?: number;
  weakness?: string;
  fix?: string;
}

/**
 * The model call, injectable so the reconciliation rules can be tested without
 * a live provider. Observed in practice: the judge does not answer every time —
 * it returned prose failing the JSON contract on the intelligence route every
 * attempt, and still misses occasionally on the creative route. That is exactly
 * why Rule 3 exists and why the deterministic scorer remains the load-bearing
 * one; a judge that answers most of the time is a useful veto, not a dependency.
 */
export type StoryJudgeCall = (prompt: string, system: string) => Promise<JudgeResponse>;

export async function judgeThumbnailStoryInterest(args: {
  deterministic: StoryInterestVerdict;
  title: string;
  heroProp?: string;
  headlineWords: readonly string[];
  subjectClass?: SubjectClass;
  log?: (message: string) => void;
  /** Overridden in tests; defaults to the pinned structured-output route. */
  askJudge?: StoryJudgeCall;
}): Promise<JudgedStoryVerdict> {
  const base: JudgedStoryVerdict = {
    ...args.deterministic,
    deterministicScore: args.deterministic.score,
    judgeLoweredScore: false,
  };

  // Rule 1: an inert verdict is already decided. Spending a model call to
  // confirm a rejection the lexicon is certain about buys nothing.
  if (args.deterministic.verdict === "inert") return base;

  const system = "You judge whether a YouTube thumbnail concept is worth clicking. Return ONLY JSON.";
  const prompt =
    `${STORY_INTEREST_DOCTRINE.join("\n")}\n\n` +
    `Video title: "${args.title}"\n` +
    `Planned hero: ${args.heroProp ?? "(none)"}\n` +
    `Planned headline: ${args.headlineWords.join(" / ") || "(none)"}\n` +
    (args.subjectClass ? `This channel's subject class: ${args.subjectClass}\n` : "") +
    `\nScore this CONCEPT 0-100 on intrinsic story interest against the doctrine above. ` +
    `Judge the SUBJECT, not the craft — assume it will be rendered beautifully. ` +
    `Be harsh: a concept that merely describes the topic, names no consequence, or leads with ` +
    `an object nobody cares about is weak no matter how well it would be executed.\n` +
    `Return STRICT JSON {"score":0-100,"weakness":"the single biggest reason a viewer would scroll past",` +
    `"fix":"one concrete art-direction change that would raise it"}.`;

  const ask: StoryJudgeCall = args.askJudge ?? ((judgePrompt, judgeSystem) => claudeJson<JudgeResponse>({
    // The "flash"/intelligence route was measured returning prose that fails
    // the JSON contract on every attempt, which made the judge a permanent
    // no-op. The creative route is the one the art director already uses for
    // structured output successfully.
    maxTokens: 400,
    tier: "pro",
    temperature: 0,
    system: judgeSystem,
    prompt: judgePrompt,
    log: args.log,
  }));

  let response: JudgeResponse;
  try {
    response = await ask(prompt, system);
  } catch (error) {
    // Rule 3: the deterministic verdict stands.
    args.log?.(
      `thumbnailStoryJudge: judge unavailable, keeping deterministic ${args.deterministic.score}/100 ` +
      `(${error instanceof Error ? error.message : String(error)})`,
    );
    return base;
  }

  const judgeScore = Number(response?.score);
  if (!Number.isFinite(judgeScore) || judgeScore < 0 || judgeScore > 100) return base;

  // Rule 2: veto only.
  if (judgeScore >= args.deterministic.score) {
    return { ...base, judgeScore };
  }

  const reasons = [...args.deterministic.reasons];
  const liftPrompts = [...args.deterministic.liftPrompts];
  if (typeof response.weakness === "string" && response.weakness.trim()) {
    reasons.push(`judge: ${response.weakness.trim().slice(0, 240)}`);
  }
  if (typeof response.fix === "string" && response.fix.trim()) {
    liftPrompts.push(response.fix.trim().slice(0, 300));
  }
  return {
    score: judgeScore,
    verdict: judgeScore >= 65 ? "compelling" : judgeScore >= 40 ? "weak" : "inert",
    reasons,
    liftPrompts,
    deterministicScore: args.deterministic.score,
    judgeScore,
    judgeLoweredScore: true,
    // The judge critiques the concept as a whole and cannot attribute the
    // weakness to one axis, so the deterministic diagnosis is preserved rather
    // than overwritten with a guess.
    weakestAxis: args.deterministic.weakestAxis,
  };
}
