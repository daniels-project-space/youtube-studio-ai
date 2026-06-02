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
}

export interface LoopResult<T> {
  value: T;
  critique: Critique;
  iterations: number;
  accepted: boolean;
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

  for (let iter = 1; iter <= maxIters; iter++) {
    const value = await o.produce(priorIssues, iter);
    const critique = await o.critique(value, iter);
    history.push(critique);
    log(
      `${label}: iter ${iter}/${maxIters} score=${critique.score.toFixed(2)} pass=${critique.pass}`,
      { issues: critique.issues.slice(0, 4) },
    );

    if (!best || critique.score > best.critique.score) best = { value, critique };

    const accepted = critique.pass && critique.score >= threshold;
    if (accepted) {
      return { value, critique, iterations: iter, accepted: true, history };
    }
    priorIssues = critique.issues;
  }

  // None cleared the bar — return the best attempt; caller decides.
  const b = best!;
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
