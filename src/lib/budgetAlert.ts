/**
 * Ship-stage "budget alert" gate (GOLDEN_MODULES catalog, key "ship":
 * `gates: ["PRIVATE-first safety", "budget alert"]`).
 *
 * `channels.budget` (convex/schema.ts) is a per-run USD ceiling, not a
 * cumulative channel spend cap — see runner.ts / runPipeline.ts, which
 * already throw HARD when `result.costTotal` exceeds it (a "frozen
 * per-video budget", per the log line in runPipeline.ts). Enforcement is
 * therefore not this module's job.
 *
 * This module is purely ADVISORY: it decides whether a run that finished
 * (successfully, under its ceiling) came in close enough to that ceiling
 * that Telegram should carry a budget alert — the "how" text in the
 * catalog entry: "Telegram carries budget alerts and completion
 * notifications." Kept as a pure predicate (no fetch/telegram import) so
 * it is trivially unit-testable; the caller (runPipeline.ts) is
 * responsible for actually sending the message.
 */

export interface BudgetAlertInput {
  /** Actual spend for the run that just finished. */
  costUsd: number;
  /** The channel's frozen per-run USD ceiling (`channels.budget`). */
  budgetUsd: number;
  /**
   * Fraction of the budget that triggers an advisory alert. Conservative
   * default: 0.8 (80%) — high enough to avoid noise on ordinary runs, low
   * enough to warn before the NEXT run risks tripping the hard ceiling.
   */
  thresholdRatio?: number;
}

export interface BudgetAlertResult {
  shouldAlert: boolean;
  /** Spend as a percentage of budget, rounded to the nearest integer. */
  percentUsed: number;
  /** Human-readable Telegram message body (only meaningful when shouldAlert). */
  message: string;
}

const DEFAULT_THRESHOLD_RATIO = 0.8;

/**
 * Evaluate whether a finished run's spend warrants a budget alert.
 *
 * Returns `null` when the channel has no budget ceiling configured
 * (`budgetUsd <= 0`) — there is nothing meaningful to alert against.
 */
export function evaluateBudgetAlert(
  input: BudgetAlertInput,
): BudgetAlertResult | null {
  const { costUsd, budgetUsd } = input;
  const thresholdRatio = input.thresholdRatio ?? DEFAULT_THRESHOLD_RATIO;

  if (!(budgetUsd > 0)) return null;

  const percentUsed = Math.round((costUsd / budgetUsd) * 100);
  const shouldAlert = costUsd >= budgetUsd * thresholdRatio;

  if (!shouldAlert) {
    return { shouldAlert: false, percentUsed, message: "" };
  }

  const verb = costUsd > budgetUsd + Number.EPSILON ? "exceeded" : "near";
  const message =
    `run cost $${costUsd.toFixed(2)} is ${percentUsed}% of the ` +
    `$${budgetUsd.toFixed(2)} per-run budget (${verb} ceiling)`;

  return { shouldAlert: true, percentUsed, message };
}
