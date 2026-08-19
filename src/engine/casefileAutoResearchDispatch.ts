import type {
  CasefileCaseResearchInput,
  CasefileCaseResearchOptions,
} from "./casefileCaseResearcher";
import type { CasefileSourcePacketContentInput } from "./casefileSourceAutoVerifier";

/**
 * Wires `researchCase()` (fail-closed, zero-fabrication real-case research —
 * see `casefileCaseResearcher.ts`) into `generation-scheduler`'s per-channel
 * due cycle, as a fully additive alternative to the manual
 * `casefileEpisodeWorkflow.ts` / `/api/casefile-episodes` desk workflow.
 *
 * This module owns only the DECISION (is this channel eligible? did research
 * converge?) and the resulting SIDE EFFECTS (record the case, trigger the
 * pipeline) — it does not talk to Convex or Trigger.dev directly. Every
 * external effect is an injected dependency so this can be unit-tested with
 * plain stub functions, the same way `storySpineHookGate.test.ts` stubs a
 * minimal `StageContext` for a Block instead of standing up the real engine.
 *
 * Eligibility is strictly opt-in AND lane-gated:
 * `channel.casefileAutoResearchEnabled` must be exactly `true` AND
 * `channel.contentLaneKey` must be exactly `cinematic_ai`. A channel failing
 * either test is `ineligible` and `researchCase` must never even be called
 * for it (see `dispatchCasefileAutoResearch`'s first two branches).
 *
 * THIS MODULE IS A SPEND GATE, NOT JUST A ROUTER.
 * -----------------------------------------------
 * `researchCase()` is the only path in this system that spends real money
 * before `run-pipeline` starts, which means it is structurally outside every
 * `invocation.budgetUsd` check `runPipeline.ts` enforces. Three ceilings
 * therefore live here, all applied BEFORE the first paid call:
 *
 *   1. LANE GATE (defense in depth). `runPipeline.ts` rejects a
 *      `casefileSourcePacketInput` on any lane but cinematic_ai. The settings
 *      write is already lane-guarded, but a lane could in principle be
 *      resolved differently later — so this re-checks at dispatch time and
 *      skips cleanly rather than buying research for a run that must throw.
 *   2. PER-DISPATCH CEILING. Explicit `maxIters` + `maxCandidatesPerIter`
 *      replace the critique loop's own looser defaults.
 *   3. FLEET-WIDE DAILY CEILING. A counter across ALL enabled channels, so a
 *      handful of channels each failing to converge cannot compound into a
 *      large unnoticed daily bill.
 */

/** The only content lane `runPipeline.ts` accepts a Casefile packet on. */
export const CASEFILE_AUTO_RESEARCH_LANE_KEY = "cinematic_ai";

/**
 * PER-DISPATCH SPEND CEILING — the numbers, and why these numbers.
 *
 * One `researchCase()` iteration costs, worst case:
 *   - 1 candidate `searchWeb()` (limit 10), plus
 *   - up to MAX_CANDIDATES_PER_ITER candidates x 3 source `searchWeb()` calls
 * and every single `searchWeb()` is one live Browserbase/Stagehand browser
 * session (`src/lib/webSearch.ts`), plus one Anthropic semantic-verification
 * call per critique.
 *
 * Left at the library defaults (`produceAndCritique`'s maxIters = 3,
 * `researchCase`'s candidates-per-iter = 3) that is up to 3 x (1 + 9) = 30
 * browser sessions + 3 LLM calls per dispatch, per channel, every 6 hours.
 *
 * At 2 x 2 it is at most 2 x (1 + 6) = 14 sessions + 2 LLM calls — roughly
 * half — while still allowing exactly one steered retry, which is the minimum
 * for `researchCase`'s `steeringHint()` feedback to do anything at all
 * (a single iteration can never act on a critique). Raising either number
 * multiplies real spend; do not do it without a cost review.
 */
export const CASEFILE_AUTO_RESEARCH_MAX_ITERS = 2;
export const CASEFILE_AUTO_RESEARCH_MAX_CANDIDATES_PER_ITER = 2;

/**
 * FLEET-WIDE DAILY CEILING (default). Counted across every enabled channel,
 * not per channel, because the bill is fleet-wide. The scheduler runs every
 * 6h (4 cycles/day), so 6 comfortably covers "a couple of Casefile channels
 * genuinely attempting research most cycles" while capping the absolute
 * worst case at 6 x 14 = 84 browser sessions + 12 LLM calls a day. Dozens of
 * attempts a day is not a workload, it is a runaway loop.
 *
 * Override with `STUDIO_CASEFILE_RESEARCH_MAX_ATTEMPTS_PER_DAY`.
 */
export const CASEFILE_AUTO_RESEARCH_DEFAULT_DAILY_LIMIT = 6;

export const CASEFILE_AUTO_RESEARCH_DAILY_LIMIT_ENV =
  "STUDIO_CASEFILE_RESEARCH_MAX_ATTEMPTS_PER_DAY";

/**
 * Same shape as `parsePlanGenerationLeadMs` (the scheduler's other numeric
 * env knob): unset falls back to the conservative default, but a *malformed*
 * value throws rather than being silently ignored. A spend ceiling that was
 * meant to be tightened and was quietly discarded is the exact failure this
 * whole change exists to prevent.
 */
export function parseCasefileAutoResearchDailyLimit(raw?: string): number {
  if (!raw?.trim()) return CASEFILE_AUTO_RESEARCH_DEFAULT_DAILY_LIMIT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 200) {
    throw new Error(
      `${CASEFILE_AUTO_RESEARCH_DAILY_LIMIT_ENV} must be an integer from 0 to 200`,
    );
  }
  return value;
}

/** UTC "YYYY-MM-DD" counting bucket for the daily ceiling. */
export function casefileResearchDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export interface CasefileAutoResearchChannelInput {
  channelId: string;
  channelName: string;
  /** Free-text niche hint forwarded to `researchCase()`. */
  niche?: string;
  /** Strict opt-in signal; anything other than `true` is treated as ineligible. */
  casefileAutoResearchEnabled?: boolean;
  /**
   * The channel's RESOLVED content lane key. Required, and required to be
   * exactly `cinematic_ai` — an absent/unknown lane is treated as ineligible,
   * never as "probably fine", because the failure mode of guessing wrong is
   * paid-for research that `runPipeline.ts` then rejects.
   */
  contentLaneKey: string;
}

export interface CasefileAutoResearchDeps {
  /** Injected so tests can stub success/failure without real web search/LLM calls. */
  researchCase: (
    input: CasefileCaseResearchInput,
    opts?: CasefileCaseResearchOptions,
  ) => Promise<CasefileSourcePacketContentInput>;
  /**
   * Fleet-wide count of billable research attempts already made today (all
   * channels, not just this one). Wraps
   * `api.casefileResearchAttempts.countForDay`.
   */
  countResearchAttemptsToday: () => Promise<number>;
  /**
   * Records ONE billable attempt. Called BEFORE `researchCase()` so that
   * research which crashes part-way — having already paid for its browser
   * sessions — still counts against the ceiling. Wraps
   * `api.casefileResearchAttempts.recordAttempt`. If this throws, dispatch
   * declines to research at all: an uncountable attempt is an unbounded one.
   */
  recordResearchAttempt: (channelId: string) => Promise<void>;
  /**
   * Fleet-wide ceiling for today. `0` disables automatic research entirely,
   * which is a legitimate operator kill switch, not a misconfiguration.
   */
  maxResearchAttemptsPerDay: number;
  /**
   * Case ids already covered for this channel. This codebase's only existing
   * "topics already covered" mechanism is the generic `topicMemory` table
   * (channelId + key), reused today by `topic_select`/lofi/quiz lanes — there
   * is no Casefile-specific equivalent. The caller is expected to wrap
   * `api.topicMemory.listForChannel` here. If that lookup is unavailable,
   * returning `[]` is safe (known gap: see module doc in the wiring report;
   * it costs at most a redundant candidate search, `researchCase` still
   * fails closed on a genuinely un-sourceable repeat).
   */
  listExcludedCaseIds: (channelId: string) => Promise<string[]>;
  /** Wraps `api.topicMemory.recordTopic` (or equivalent) to remember a converged case. */
  recordCaseId: (channelId: string, caseId: string) => Promise<void>;
  /** Wraps the real `tasks.trigger("run-pipeline", ...)` call for this channel/run. */
  triggerPipeline: (args: {
    casefileSourcePacketInput: CasefileSourcePacketContentInput;
  }) => Promise<void>;
  log: (message: string) => void;
}

export type CasefileAutoResearchOutcome =
  | { outcome: "ineligible" }
  | { outcome: "researched_and_triggered"; caseId: string }
  | { outcome: "research_failed"; reason: string }
  /**
   * The fleet-wide daily ceiling was already reached. Expected/normal
   * operation of a working spend guard — never an alertable error, never a
   * reason to retry sooner.
   */
  | { outcome: "daily_ceiling_reached"; attemptsToday: number; limit: number };

/**
 * Runs the eligibility check, research call, and (on success) the
 * record-and-trigger side effects for one already-due, already-leased
 * channel. Scheduling/due-ness/leasing itself is NOT this module's
 * responsibility — the caller (`scheduler.ts`) must have already reused its
 * existing `claimNextPlanRun` admission before calling this.
 *
 * On a `researchCase()` failure (its own fail-closed design: no real case
 * converged this cycle) this returns `"research_failed"` rather than
 * throwing. That is expected, normal behavior — refusing to fabricate is the
 * point — so the caller must not alert on it, must not retry in a tight
 * loop, and must not fall back to non-Casefile content. It also must not
 * explicitly release the already-claimed run/plan slot: `claimNextPlanRun`
 * safely reattaches to a still-`queued` run on the next due cycle, so simply
 * not triggering is sufficient for a bounded, self-healing retry cadence.
 */
export async function dispatchCasefileAutoResearch(
  channel: CasefileAutoResearchChannelInput,
  deps: CasefileAutoResearchDeps,
): Promise<CasefileAutoResearchOutcome> {
  if (channel.casefileAutoResearchEnabled !== true) {
    return { outcome: "ineligible" };
  }

  // LANE GATE — defense in depth behind the settings-write guard, checked
  // before any paid call. `runPipeline.ts` throws on a
  // `casefileSourcePacketInput` outside cinematic_ai, so researching for a
  // channel that has since moved lanes would buy a guaranteed-discarded run.
  if (channel.contentLaneKey !== CASEFILE_AUTO_RESEARCH_LANE_KEY) {
    deps.log(
      `casefile auto-research: "${channel.channelName}": opted in but its content lane is ` +
        `"${channel.contentLaneKey}", not ${CASEFILE_AUTO_RESEARCH_LANE_KEY} — skipping without spending. ` +
        "Disable casefileAutoResearchEnabled on this channel.",
    );
    return { outcome: "ineligible" };
  }

  // FLEET-WIDE DAILY CEILING — checked before `researchCase()`, never after.
  const attemptsToday = await deps.countResearchAttemptsToday();
  if (attemptsToday >= deps.maxResearchAttemptsPerDay) {
    deps.log(
      `casefile auto-research: "${channel.channelName}": daily research ceiling reached ` +
        `(${attemptsToday}/${deps.maxResearchAttemptsPerDay} attempts today across all channels) — ` +
        "skipping, not an error",
    );
    return {
      outcome: "daily_ceiling_reached",
      attemptsToday,
      limit: deps.maxResearchAttemptsPerDay,
    };
  }

  // Count the attempt BEFORE spending. Research that throws part-way has
  // still paid for its browser sessions, so a started attempt must always be
  // counted; and if the counter itself cannot be written, decline rather
  // than research uncounted.
  try {
    await deps.recordResearchAttempt(channel.channelId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    deps.log(
      `casefile auto-research: "${channel.channelName}": could not record the billable research attempt, ` +
        `so research was NOT started (spend guard failing closed): ${reason}`,
    );
    return { outcome: "research_failed", reason: `attempt ledger write failed: ${reason}` };
  }

  const excludeCaseIds = await deps.listExcludedCaseIds(channel.channelId);

  let content: CasefileSourcePacketContentInput;
  try {
    content = await deps.researchCase(
      { niche: channel.niche, excludeCaseIds },
      {
        log: deps.log,
        // Explicit, bounded, and never left to the library defaults — see the
        // per-dispatch ceiling rationale at the top of this module.
        maxIters: CASEFILE_AUTO_RESEARCH_MAX_ITERS,
        maxCandidatesPerIter: CASEFILE_AUTO_RESEARCH_MAX_CANDIDATES_PER_ITER,
      },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    deps.log(
      `casefile auto-research: "${channel.channelName}": no genuinely well-sourced case converged this cycle — ` +
        `skipping, not an error (${reason})`,
    );
    return { outcome: "research_failed", reason };
  }

  // Best-effort: a memory-write failure must not discard an otherwise valid,
  // already fail-closed-verified research result.
  try {
    await deps.recordCaseId(channel.channelId, content.caseId);
  } catch (error) {
    deps.log(
      `casefile auto-research: "${channel.channelName}": failed to record case ${content.caseId} in topic memory ` +
        `(continuing anyway): ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  await deps.triggerPipeline({ casefileSourcePacketInput: content });
  deps.log(
    `casefile auto-research: "${channel.channelName}": researched case "${content.caseId}" — pipeline triggered`,
  );
  return { outcome: "researched_and_triggered", caseId: content.caseId };
}
