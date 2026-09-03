/**
 * Producer ↔ Director critique loop — the reusable primitive behind every
 * "smart" pipeline chunk (topic, seo, thumbnail, imagery, …).
 *
 * Pattern (Reflexion): a Producer generates a candidate; a Director critiques it
 * with a structured verdict; the candidate is regenerated carrying the prior
 * critique forward, until it passes a quality bar or a hard iteration cap.
 *
 *   - `produce(priorIssues, iter)`  — make a candidate (use priorIssues to fix).
 *   - `critique(candidate, iter)`   — score it; return { score, pass, issues }.
 *
 * Design rules baked in:
 *   - DETERMINISTIC facts (lengths, dup checks, resolution) must be computed in
 *     code by the caller's `critique` and folded into `pass`/`issues` — never
 *     trust the model to count. The Director judges only subjective quality.
 *   - Hard iteration cap (default 3) prevents runaway/score-hacking loops.
 *   - Returns the BEST candidate seen (by score), even if none cleared the bar,
 *     so the caller decides whether to accept or hard-fail.
 *
 * This file has NO model/framework dependency — produce/critique are supplied by
 * the chunk. That is the hybrid seam: today they call our REST helpers
 * (geminiJson/claudeJson); a later phase can back them with Mastra agents (and a
 * Mastra workflow can wrap this loop) without changing any chunk.
 */

export interface Critique {
  /** 0..1 quality. */
  score: number;
  /** Hard accept signal (the caller's deterministic checks + Director verdict). */
  pass: boolean;
  /** Concrete, actionable issues fed back into the next produce(). */
  issues: string[];
  /**
   * A defect that must NEVER be returned, even as the best of a bad set.
   *
   * The loop previously distinguished only "accepted" from "not accepted", and
   * on exhaustion returned the highest-scoring candidate regardless. That is
   * right for a merely weak result — some thumbnail has to ship — and wrong for
   * a defect that makes the output unusable. A misspelled headline was caught
   * by the reviewer, scored well on everything else, and came back as "best".
   *
   * Fatal candidates are excluded from best-of selection entirely. If every
   * candidate is fatal the loop still returns one, because the caller owns the
   * fail-closed decision, but `accepted` is false and `fatal` is set so the
   * caller can refuse it rather than discovering the defect in production.
   */
  fatal?: boolean;
}

/**
 * PER-CHANNEL CRITIQUE GROUNDING (P1-1).
 *
 * The Director is not a generic YouTube reviewer: it judges ONE channel with a
 * stated identity and an operator-authored critic doctrine. This is the bounded
 * carrier for that grounding, shared by every model-graded loop (script,
 * narration, thumbnail, visual review) so the tuning surface is one place.
 *
 * `criticDoctrine` is `channels.identity.creativeBrief.criticDoctrine` — the
 * schema field purpose-built for exactly this and, before this wiring, read by
 * nothing in the quality loop.
 */
export interface ChannelCritiqueContext {
  channelName?: string;
  persona?: string;
  styleGrammar?: string;
  /** Operator/Showrunner-authored stance for THIS channel's critic. */
  criticDoctrine?: string;
  /** Durable content-lane key; drives lane-tuned thresholds + emphases. */
  contentLaneKey?: string;
  /** Lane-specific things the critic must actively scrutinise. */
  laneEmphasis?: readonly string[];
  /** Channel QualityBar dimension ids the operator actually cares about. */
  qualityDimensions?: readonly string[];
}

function compact(value: string | undefined, max: number): string | undefined {
  const out = value?.replace(/\s+/g, " ").trim().slice(0, max);
  return out || undefined;
}

/**
 * Render the channel grounding as a bounded prompt fragment. Returns "" when
 * there is nothing channel-specific to say, so a caller can concatenate it
 * unconditionally and a doctrine-less channel keeps its exact old prompt.
 */
export function channelCritiqueBrief(channel?: ChannelCritiqueContext): string {
  if (!channel) return "";
  const lines = [
    compact(channel.channelName, 120) ? `Channel: ${compact(channel.channelName, 120)}` : "",
    compact(channel.persona, 180) ? `Audience/persona: ${compact(channel.persona, 180)}` : "",
    compact(channel.styleGrammar, 240) ? `Style grammar: ${compact(channel.styleGrammar, 240)}` : "",
    compact(channel.contentLaneKey, 60) ? `Content lane: ${compact(channel.contentLaneKey, 60)}` : "",
    (channel.qualityDimensions ?? []).length
      ? `Operator quality priorities: ${(channel.qualityDimensions ?? []).slice(0, 8).join(", ")}`
      : "",
  ].filter(Boolean);
  const doctrine = compact(channel.criticDoctrine, 600);
  const emphasis = (channel.laneEmphasis ?? [])
    .map((item) => compact(item, 240))
    .filter((item): item is string => Boolean(item))
    .slice(0, 4);
  if (!lines.length && !doctrine && !emphasis.length) return "";
  return (
    `\nCHANNEL CRITIQUE GROUNDING — judge THIS channel, not a generic video.\n` +
    (lines.length ? `${lines.map((line) => `- ${line}`).join("\n")}\n` : "") +
    // The doctrine is the operator's own words. It outranks generic advice
    // precisely because a channel that says "punchy over polished" must not be
    // failed by a rubric that prizes polish.
    (doctrine
      ? `- CRITIC DOCTRINE (this channel's standing instruction — it OUTRANKS generic criteria where they conflict): ${doctrine}\n`
      : "") +
    (emphasis.length ? `- Scrutinise for this lane: ${emphasis.map((item) => `"${item}"`).join("; ")}\n` : "")
  );
}

export interface LoopOptions<T> {
  produce: (priorIssues: string[], iter: number) => Promise<T>;
  critique: (candidate: T, iter: number) => Promise<Critique>;
  /** Accept once score ≥ threshold AND critique.pass. Default 0.8. */
  threshold?: number;
  /** Hard cap on iterations. Default 3. */
  maxIters?: number;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
  /** Label for logs/observability. */
  label?: string;
  /**
   * Per-channel grounding. The loop itself never prompts, so this is carried
   * for observability + so every caller threads ONE object; `produce`/`critique`
   * are what actually fold `channelCritiqueBrief(channel)` into their prompts.
   */
  channel?: ChannelCritiqueContext;
}

export interface LoopResult<T> {
  value: T;
  critique: Critique;
  iterations: number;
  accepted: boolean;
  /** True when every candidate carried a defect that must not ship. */
  fatal?: boolean;
  history: Critique[];
}

export async function produceAndCritique<T>(
  o: LoopOptions<T>,
): Promise<LoopResult<T>> {
  const threshold = o.threshold ?? 0.8;
  const maxIters = Math.max(1, o.maxIters ?? 3);
  const log = o.log ?? (() => {});
  const label = o.label ?? "loop";

  const history: Critique[] = [];
  let priorIssues: string[] = [];
  let best: { value: T; critique: Critique } | null = null;

  if (o.channel?.criticDoctrine || o.channel?.contentLaneKey) {
    log(
      `${label}: channel-grounded critique (lane=${o.channel.contentLaneKey ?? "n/a"}, doctrine=${o.channel.criticDoctrine ? "yes" : "no"}, threshold=${threshold.toFixed(2)}, maxIters=${maxIters})`,
    );
  }

  let lastValue: T | undefined;
  for (let iter = 1; iter <= maxIters; iter++) {
    const value = await o.produce(priorIssues, iter);
    lastValue = value;
    const critique = await o.critique(value, iter);
    history.push(critique);
    log(
      `${label}: iter ${iter}/${maxIters} score=${critique.score.toFixed(2)} pass=${critique.pass}`,
      { issues: critique.issues.slice(0, 4) },
    );

    // A fatal candidate is never eligible as "best": returning the highest
    // score among unusable outputs is how a caught defect ships anyway.
    if (!critique.fatal && (!best || critique.score > best.critique.score)) {
      best = { value, critique };
    }
    if (critique.fatal) {
      log(`${label}: iter ${iter} carries a fatal defect and cannot be returned as best`);
    }

    const accepted = critique.pass && critique.score >= threshold;
    if (accepted) {
      return { value, critique, iterations: iter, accepted: true, history };
    }
    priorIssues = critique.issues;
  }

  // None cleared the bar. Prefer the best NON-FATAL attempt; if every candidate
  // was fatal there is nothing safe to return, so the last one comes back
  // flagged and the caller owns the fail-closed decision.
  if (!best) {
    const lastCritique = history[history.length - 1]!;
    log(`${label}: exhausted ${maxIters} iters and EVERY candidate carried a fatal defect`);
    return {
      value: lastValue as T,
      critique: lastCritique,
      iterations: maxIters,
      accepted: false,
      fatal: true,
      history,
    };
  }
  const b = best;
  log(
    `${label}: exhausted ${maxIters} iters — returning best (score=${b.critique.score.toFixed(2)})`,
  );
  return {
    value: b.value,
    critique: b.critique,
    iterations: maxIters,
    accepted: false,
    history,
  };
}
