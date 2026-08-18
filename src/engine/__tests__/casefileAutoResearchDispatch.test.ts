import assert from "node:assert/strict";

import {
  dispatchCasefileAutoResearch,
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

function spyDeps(overrides: Partial<CasefileAutoResearchDeps> = {}): {
  deps: CasefileAutoResearchDeps;
  calls: {
    researchCase: unknown[][];
    listExcludedCaseIds: unknown[][];
    recordCaseId: unknown[][];
    triggerPipeline: unknown[][];
  };
} {
  const calls = {
    researchCase: [] as unknown[][],
    listExcludedCaseIds: [] as unknown[][],
    recordCaseId: [] as unknown[][],
    triggerPipeline: [] as unknown[][],
  };
  const deps: CasefileAutoResearchDeps = {
    researchCase: async (...args: unknown[]) => {
      calls.researchCase.push(args);
      return FAKE_CONTENT;
    },
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
        { channelId: "channel-2", channelName: "Test Channel Two", casefileAutoResearchEnabled: true },
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
      { channelId: "channel-3", channelName: "Ordinary Channel" /* casefileAutoResearchEnabled omitted */ },
      deps,
    );
    assert.deepEqual(outcome, { outcome: "ineligible" });
    assert.equal(calls.researchCase.length, 0, "researchCase must never be called for a channel without the opt-in flag");
    assert.equal(calls.listExcludedCaseIds.length, 0, "no research-adjacent lookups should run for an ineligible channel");
    assert.equal(calls.triggerPipeline.length, 0);

    // Explicit false must behave identically to undefined.
    const outcomeFalse = await dispatchCasefileAutoResearch(
      { channelId: "channel-3b", channelName: "Explicitly Disabled Channel", casefileAutoResearchEnabled: false },
      deps,
    );
    assert.deepEqual(outcomeFalse, { outcome: "ineligible" });
    assert.equal(calls.researchCase.length, 0, "researchCase must never be called when the flag is explicitly false");
  }
}

run()
  .then(() => console.log("casefileAutoResearchDispatch test passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
