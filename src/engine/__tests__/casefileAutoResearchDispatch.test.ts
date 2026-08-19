import assert from "node:assert/strict";

import {
  CASEFILE_AUTO_RESEARCH_DEFAULT_DAILY_LIMIT,
  CASEFILE_AUTO_RESEARCH_MAX_CANDIDATES_PER_ITER,
  CASEFILE_AUTO_RESEARCH_MAX_ITERS,
  casefileResearchDayKey,
  dispatchCasefileAutoResearch,
  parseCasefileAutoResearchDailyLimit,
  type CasefileAutoResearchDeps,
} from "@/engine/casefileAutoResearchDispatch";
import type { CasefileSourcePacketContentInput } from "@/engine/casefileSourceAutoVerifier";

/**
 * Unit tests for the scheduler-facing Casefile auto-research dispatch
 * (Phase 27 wiring). No network/Convex/Trigger.dev — every external effect
 * is an injected dependency, stubbed directly, the same "swap the real
 * collaborator for a spy" shape as storySpineHookGate.test.ts's minimal
 * StageContext stub (there for a Block's run(); here for a plain async
 * dispatch function instead of a Block).
 */

const FAKE_CONTENT = {
  caseId: "case-harrow-vault-closure",
  casePacket: { id: "case-harrow-vault-closure" },
} as unknown as CasefileSourcePacketContentInput;

function spyDeps(
  overrides: Partial<CasefileAutoResearchDeps> = {},
  attemptsToday = 0,
): {
  deps: CasefileAutoResearchDeps;
  calls: {
    researchCase: unknown[][];
    listExcludedCaseIds: unknown[][];
    recordCaseId: unknown[][];
    triggerPipeline: unknown[][];
    countResearchAttemptsToday: unknown[][];
    recordResearchAttempt: unknown[][];
  };
} {
  const calls = {
    researchCase: [] as unknown[][],
    listExcludedCaseIds: [] as unknown[][],
    recordCaseId: [] as unknown[][],
    triggerPipeline: [] as unknown[][],
    countResearchAttemptsToday: [] as unknown[][],
    recordResearchAttempt: [] as unknown[][],
  };
  const deps: CasefileAutoResearchDeps = {
    researchCase: async (...args: unknown[]) => {
      calls.researchCase.push(args);
      return FAKE_CONTENT;
    },
    countResearchAttemptsToday: async (...args: unknown[]) => {
      calls.countResearchAttemptsToday.push(args);
      return attemptsToday;
    },
    recordResearchAttempt: async (...args: unknown[]) => {
      calls.recordResearchAttempt.push(args);
    },
    maxResearchAttemptsPerDay: CASEFILE_AUTO_RESEARCH_DEFAULT_DAILY_LIMIT,
    listExcludedCaseIds: async (...args: unknown[]) => {
      calls.listExcludedCaseIds.push(args);
      return [];
    },
    recordCaseId: async (...args: unknown[]) => {
      calls.recordCaseId.push(args);
    },
    triggerPipeline: async (...args: unknown[]) => {
      calls.triggerPipeline.push(args);
    },
    log: () => {},
    ...overrides,
  };
  return { deps, calls };
}

async function run(): Promise<void> {
  /* ---- 1. eligible + due channel, researchCase succeeds ---- */
  {
    const { deps, calls } = spyDeps();
    const outcome = await dispatchCasefileAutoResearch(
      {
        channelId: "channel-1",
        channelName: "Test Cinematic Channel",
        niche: "historical heist",
        casefileAutoResearchEnabled: true,
        contentLaneKey: "cinematic_ai",
      },
      deps,
    );
    assert.deepEqual(outcome, { outcome: "researched_and_triggered", caseId: "case-harrow-vault-closure" });
    assert.equal(calls.researchCase.length, 1, "researchCase must be called exactly once for an eligible channel");
    assert.deepEqual(calls.researchCase[0]![0], { niche: "historical heist", excludeCaseIds: [] });
    assert.equal(calls.recordCaseId.length, 1, "the converged case must be recorded");
    assert.deepEqual(calls.recordCaseId[0], ["channel-1", "case-harrow-vault-closure"]);
    assert.equal(calls.triggerPipeline.length, 1, "the pipeline must be triggered exactly once");
    assert.deepEqual(
      calls.triggerPipeline[0]![0],
      { casefileSourcePacketInput: FAKE_CONTENT },
      "the exact researched CasefileSourcePacketContentInput must be handed to the pipeline trigger, seeding the store",
    );
  }

  /* ---- 2. researchCase fails (fail-closed): skip cleanly, no fallback, no retry-in-loop ---- */
  {
    const { deps, calls } = spyDeps({
      researchCase: async () => {
        throw new Error("researchCase: no admissible candidate could be constructed from available search results");
      },
    });
    let rejected = false;
    let outcome: Awaited<ReturnType<typeof dispatchCasefileAutoResearch>> | undefined;
    try {
      outcome = await dispatchCasefileAutoResearch(
        {
          channelId: "channel-2",
          channelName: "Test Channel Two",
          casefileAutoResearchEnabled: true,
          contentLaneKey: "cinematic_ai",
        },
        deps,
      );
    } catch {
      rejected = true;
    }
    assert.equal(rejected, false, "a researchCase failure must not propagate as an unhandled rejection out of dispatch");
    assert.ok(outcome, "dispatch must resolve with an outcome, not throw");
    assert.equal(outcome!.outcome, "research_failed");
    if (outcome!.outcome === "research_failed") {
      assert.match(outcome!.reason, /no admissible candidate/);
    }
    assert.equal(calls.recordCaseId.length, 0, "nothing was researched — no case id may be recorded");
    assert.equal(
      calls.triggerPipeline.length,
      0,
      "on research failure the pipeline must never be triggered — no fallback to non-Casefile content",
    );
  }

  /* ---- 3. channel without the opt-in flag is never considered ---- */
  {
    const { deps, calls } = spyDeps();
    const outcome = await dispatchCasefileAutoResearch(
      {
        channelId: "channel-3",
        channelName: "Ordinary Channel",
        contentLaneKey: "cinematic_ai",
        /* casefileAutoResearchEnabled omitted */
      },
      deps,
    );
    assert.deepEqual(outcome, { outcome: "ineligible" });
    assert.equal(calls.researchCase.length, 0, "researchCase must never be called for a channel without the opt-in flag");
    assert.equal(calls.listExcludedCaseIds.length, 0, "no research-adjacent lookups should run for an ineligible channel");
    assert.equal(calls.triggerPipeline.length, 0);

    // Explicit false must behave identically to undefined.
    const outcomeFalse = await dispatchCasefileAutoResearch(
      {
        channelId: "channel-3b",
        channelName: "Explicitly Disabled Channel",
        casefileAutoResearchEnabled: false,
        contentLaneKey: "cinematic_ai",
      },
      deps,
    );
    assert.deepEqual(outcomeFalse, { outcome: "ineligible" });
    assert.equal(calls.researchCase.length, 0, "researchCase must never be called when the flag is explicitly false");
  }

  /* ---- 4. LANE GATE: flag set but lane is not cinematic_ai -> never spend ---- */
  {
    for (const laneKey of ["narrated_documentary", "legacy_unclassified", "unresolved", ""]) {
      const { deps, calls } = spyDeps();
      const outcome = await dispatchCasefileAutoResearch(
        {
          channelId: "channel-4",
          channelName: "Wrong Lane Channel",
          casefileAutoResearchEnabled: true,
          contentLaneKey: laneKey,
        },
        deps,
      );
      assert.deepEqual(
        outcome,
        { outcome: "ineligible" },
        `lane "${laneKey}" must be ineligible even with the opt-in flag set`,
      );
      assert.equal(
        calls.researchCase.length,
        0,
        `researchCase must NEVER be called for lane "${laneKey}" — run-pipeline would reject the packet, so the spend is pure waste`,
      );
      assert.equal(
        calls.recordResearchAttempt.length,
        0,
        "a lane-skipped dispatch costs nothing and must not consume daily ceiling budget",
      );
      assert.equal(calls.listExcludedCaseIds.length, 0);
      assert.equal(calls.triggerPipeline.length, 0);
    }
  }

  /* ---- 5. researchCase receives an EXPLICIT bounded budget, never undefined ---- */
  {
    const { deps, calls } = spyDeps();
    await dispatchCasefileAutoResearch(
      {
        channelId: "channel-5",
        channelName: "Budgeted Channel",
        casefileAutoResearchEnabled: true,
        contentLaneKey: "cinematic_ai",
      },
      deps,
    );
    assert.equal(calls.researchCase.length, 1);
    const opts = calls.researchCase[0]![1] as
      | { maxIters?: unknown; maxCandidatesPerIter?: unknown }
      | undefined;
    assert.ok(opts, "researchCase must be called with an options object carrying the spend ceiling");
    assert.notEqual(
      opts!.maxIters,
      undefined,
      "maxIters must be explicit — leaving it undefined falls back to critiqueLoop's looser default of 3",
    );
    assert.equal(opts!.maxIters, CASEFILE_AUTO_RESEARCH_MAX_ITERS);
    assert.equal(opts!.maxCandidatesPerIter, CASEFILE_AUTO_RESEARCH_MAX_CANDIDATES_PER_ITER);
    assert.ok(
      typeof opts!.maxIters === "number" && opts!.maxIters >= 1 && opts!.maxIters < 3,
      "the dispatch ceiling must be strictly tighter than the library default of 3",
    );
    assert.ok(
      typeof opts!.maxCandidatesPerIter === "number" &&
        opts!.maxCandidatesPerIter >= 1 &&
        opts!.maxCandidatesPerIter < 3,
      "the candidates-per-iteration ceiling must be strictly tighter than researchCase's own default of 3",
    );
  }

  /* ---- 6. DAILY CEILING: at/over the limit -> skip cleanly, no spend, no throw ---- */
  {
    for (const attempts of [3, 4, 99]) {
      const { deps, calls } = spyDeps({ maxResearchAttemptsPerDay: 3 }, attempts);
      let threw = false;
      let outcome: Awaited<ReturnType<typeof dispatchCasefileAutoResearch>> | undefined;
      try {
        outcome = await dispatchCasefileAutoResearch(
          {
            channelId: "channel-6",
            channelName: "Over Ceiling Channel",
            casefileAutoResearchEnabled: true,
            contentLaneKey: "cinematic_ai",
          },
          deps,
        );
      } catch {
        threw = true;
      }
      assert.equal(threw, false, "a hit ceiling is normal operation and must never throw an alertable error");
      assert.deepEqual(outcome, {
        outcome: "daily_ceiling_reached",
        attemptsToday: attempts,
        limit: 3,
      });
      assert.equal(
        calls.researchCase.length,
        0,
        "researchCase must never be called once the fleet-wide daily ceiling is reached",
      );
      assert.equal(calls.recordResearchAttempt.length, 0, "a skipped dispatch must not inflate the counter");
      assert.equal(calls.listExcludedCaseIds.length, 0);
      assert.equal(calls.triggerPipeline.length, 0);
    }

    // A ceiling of 0 is a legitimate kill switch, not a misconfiguration.
    const { deps, calls } = spyDeps({ maxResearchAttemptsPerDay: 0 }, 0);
    const outcome = await dispatchCasefileAutoResearch(
      {
        channelId: "channel-6b",
        channelName: "Kill Switch Channel",
        casefileAutoResearchEnabled: true,
        contentLaneKey: "cinematic_ai",
      },
      deps,
    );
    assert.equal(outcome.outcome, "daily_ceiling_reached");
    assert.equal(calls.researchCase.length, 0, "a ceiling of 0 must disable all research spend");
  }

  /* ---- 7. POSITIVE PATH under the ceiling: still dispatches, and counts the attempt ---- */
  {
    const { deps, calls } = spyDeps({ maxResearchAttemptsPerDay: 3 }, 2);
    const outcome = await dispatchCasefileAutoResearch(
      {
        channelId: "channel-7",
        channelName: "Eligible Under Ceiling Channel",
        niche: "financial fraud",
        casefileAutoResearchEnabled: true,
        contentLaneKey: "cinematic_ai",
      },
      deps,
    );
    assert.deepEqual(outcome, {
      outcome: "researched_and_triggered",
      caseId: "case-harrow-vault-closure",
    });
    assert.equal(calls.researchCase.length, 1, "an eligible, in-budget channel must still be researched");
    assert.equal(calls.triggerPipeline.length, 1, "the pipeline must still be triggered on the happy path");
    assert.equal(
      calls.recordResearchAttempt.length,
      1,
      "a billable attempt must be recorded exactly once so the ceiling actually advances",
    );
    assert.deepEqual(calls.recordResearchAttempt[0], ["channel-7"]);
  }

  /* ---- 8. attempt-ledger write failure fails CLOSED (never research uncounted) ---- */
  {
    const { deps, calls } = spyDeps({
      recordResearchAttempt: async () => {
        throw new Error("convex unavailable");
      },
    });
    const outcome = await dispatchCasefileAutoResearch(
      {
        channelId: "channel-8",
        channelName: "Unwritable Ledger Channel",
        casefileAutoResearchEnabled: true,
        contentLaneKey: "cinematic_ai",
      },
      deps,
    );
    assert.equal(outcome.outcome, "research_failed");
    assert.equal(
      calls.researchCase.length,
      0,
      "if the attempt cannot be counted it must not be spent — an uncountable attempt is an unbounded one",
    );
    assert.equal(calls.triggerPipeline.length, 0);
  }

  /* ---- 9. daily-limit env parsing: conservative default, loud on garbage ---- */
  {
    assert.equal(
      parseCasefileAutoResearchDailyLimit(undefined),
      CASEFILE_AUTO_RESEARCH_DEFAULT_DAILY_LIMIT,
    );
    assert.equal(
      parseCasefileAutoResearchDailyLimit("  "),
      CASEFILE_AUTO_RESEARCH_DEFAULT_DAILY_LIMIT,
    );
    assert.ok(
      CASEFILE_AUTO_RESEARCH_DEFAULT_DAILY_LIMIT > 0 && CASEFILE_AUTO_RESEARCH_DEFAULT_DAILY_LIMIT <= 12,
      "the default ceiling must stay in the 'a handful per day' range",
    );
    assert.equal(parseCasefileAutoResearchDailyLimit("2"), 2);
    assert.equal(parseCasefileAutoResearchDailyLimit("0"), 0);
    for (const bad of ["-1", "1.5", "abc", "201"]) {
      assert.throws(
        () => parseCasefileAutoResearchDailyLimit(bad),
        /must be an integer from 0 to 200/,
        `"${bad}" must be rejected loudly, never silently replaced by the default`,
      );
    }
    assert.match(casefileResearchDayKey(new Date("2026-08-19T23:59:59.000Z")), /^2026-08-19$/);
    assert.match(casefileResearchDayKey(new Date("2026-08-20T00:00:00.000Z")), /^2026-08-20$/);
  }
}

run()
  .then(() => console.log("casefileAutoResearchDispatch test passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
