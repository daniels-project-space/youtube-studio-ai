import type { CasefileCaseResearchInput } from "./casefileCaseResearcher";
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
 * Eligibility is strictly opt-in: `channel.casefileAutoResearchEnabled` must
 * be exactly `true`. Nothing here infers eligibility from family/contentLane
 * — a channel with the flag unset must never be considered, and `researchCase`
 * must never even be called for it (see `dispatchCasefileAutoResearch`'s
 * first branch).
 */

export interface CasefileAutoResearchChannelInput {
  channelId: string;
  channelName: string;
  /** Free-text niche hint forwarded to `researchCase()`. */
  niche?: string;
  /** Strict opt-in signal; anything other than `true` is treated as ineligible. */
  casefileAutoResearchEnabled?: boolean;
}

export interface CasefileAutoResearchDeps {
  /** Injected so tests can stub success/failure without real web search/LLM calls. */
  researchCase: (
    input: CasefileCaseResearchInput,
    opts?: { log?: (message: string) => void },
  ) => Promise<CasefileSourcePacketContentInput>;
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
  | { outcome: "research_failed"; reason: string };

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

  const excludeCaseIds = await deps.listExcludedCaseIds(channel.channelId);

  let content: CasefileSourcePacketContentInput;
  try {
    content = await deps.researchCase(
      { niche: channel.niche, excludeCaseIds },
      { log: deps.log },
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
