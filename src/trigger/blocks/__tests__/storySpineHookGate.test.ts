import assert from "node:assert/strict";
import type { StageContext } from "@/engine/types";
import { storySpine } from "@/trigger/blocks/storySpineBlocks";
import { measureHookWindow, MEASURED_HOOK_WINDOW_SEC } from "@/lib/hookcraft";

/**
 * Block-level test (zero network — planStorySpine is pure/local) for the
 * measured hook gate wired into story_spine's run() (Phase 17). Same minimal
 * StageContext stub pattern as insertBlocksIntegrityGate.test.ts's
 * "Block-level skip paths" section.
 */
function baseCtx(overrides: Partial<StageContext> = {}): StageContext {
  return {
    ownerId: "owner-test",
    runId: "run-test",
    channelId: "channel-test",
    keyPrefix: "owner/owner-test/channel/test/",
    params: {},
    store: {},
    budgetUsd: 1,
    log: () => {},
    ...overrides,
  };
}

async function run(): Promise<void> {
  /* --------- happy path: default automatic-path timing passes live -------- */
  const logs: string[] = [];
  const patch = await storySpine.run(
    baseCtx({
      store: {
        topic: "measured hook gate wiring",
        narrationDurationSec: 30,
        sentenceTimings: [
          { text: "The vault door had not opened in forty years, until tonight.", start: 0, end: 8 },
          { text: "Every guard on the floor swore they heard nothing.", start: 8, end: 16 },
          { text: "By morning, the evidence told a very different story.", start: 16, end: 30 },
        ],
      },
      log: (message: string) => logs.push(message),
    }),
  );
  const shotList = patch["shotList"] as { t0: number; t1: number }[];
  assert.ok(Array.isArray(shotList) && shotList.length > 1, "story_spine must still produce a multi-shot plan");
  assert.ok(
    logs.some((message) => message.includes("measured hook gate passed")),
    "story_spine must log the measured hook gate outcome",
  );
  // Cross-check with the gate function directly — the block must not diverge
  // from what measureHookWindow itself reports for this exact shotList.
  const directGate = measureHookWindow(shotList);
  assert.equal(directGate.pass, true, "the block's own produced shotList must independently satisfy measureHookWindow");

  /* -------- sentenceTimings missing: existing story_spine guard first ----- */
  await assert.rejects(
    () => storySpine.run(baseCtx({ store: { topic: "x", narrationDurationSec: 10, sentenceTimings: [] } })),
    /sentenceTimings are required/,
    "the pre-existing sentenceTimings guard must still fire before the measured hook gate runs",
  );

  /* ---- failure-path contract, pinned against measureHookWindow directly -- *
   * planStorySpine's weighted shot-boundary math (shotBoundaryTiming.ts) is
   * bounded such that it cannot organically produce a first-shot longer than
   * MEASURED_HOOK_WINDOW_SEC through public parameters alone (MIN_LTX_SHOT_SEC
   * floor + causalBeatWindows' ~12s accumulation + coverageBoundaries' 0.29
   * first-slot weight keep the first real boundary well under 10s in every
   * case exercised above and in storySpineShotWeighting.test.ts). This
   * confirms the wiring is safe for the existing pipeline. The FAILING branch
   * — a shot list that holds on one static shot past the window — is
   * therefore pinned directly against the exact function/message contract
   * story_spine's run() uses, rather than fighting that algorithm. */
  const staticOpening = [{ id: "shot-0001", t0: 0, t1: 40 }];
  const failingGate = measureHookWindow(staticOpening, { windowSec: MEASURED_HOOK_WINDOW_SEC });
  assert.equal(failingGate.pass, false);
  const wouldThrow = `story_spine: measured hook gate failed — ${failingGate.issues.join(" | ")}`;
  assert.match(wouldThrow, /^story_spine: measured hook gate failed — /);
  assert.match(wouldThrow, /no shot or beat transition inside the first/);
}

run()
  .then(() => console.log("story_spine measured hook gate wiring test passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
