import assert from "node:assert/strict";
import { COST_PATCH_KEY, type StageContext } from "@/engine/types";
import { DATA_STORY_CONTRACT_VERSION, hasNamedSourceAttribution } from "@/engine/dataStory";
import { sourceSpoken, anchorsSpoken, visualInserts } from "@/trigger/blocks/insertBlocks";
import { numericMentions } from "@/lib/numericClaims";

// Execute the actual shared functions. The former source-slice extraction
// tested a disconnected module copy and blessed integer-part evidence credit.
async function run(): Promise<void> {
  assert.equal(sourceSpoken("Source: the Federal Reserve", "According to the Federal Reserve, rates rose sharply."), true);
  assert.equal(sourceSpoken("Source: the World Bank", "According to the Federal Reserve, rates rose sharply."), false);
  assert.equal(sourceSpoken("Source: it", "It was reported."), false);
  const groups = numericMentions("Revenue hit $534,000.50 across 12 regions in 2026.");
  assert.deepEqual(groups.map((mention) => mention.plotValue), [534000.5, 12, 2026]);
  assert.equal(anchorsSpoken({ anchorValues: [534000, "12"] } as never, "Revenue hit $534,000 across 12 regions."), true);
  assert.equal(anchorsSpoken({ anchorValues: [999999] } as never, "Revenue hit $534,000 across 12 regions."), false);
  assert.equal(anchorsSpoken({ anchorValues: [] } as never, "Revenue hit $534,000."), false);
  assert.equal(anchorsSpoken({ anchorValues: [12] } as never, "Revenue grew substantially this year."), false);
  assert.equal(anchorsSpoken({ anchorValues: ["1,200"] } as never, "The census counted 1200 new residents."), true);
  assert.equal(anchorsSpoken({ anchorValues: [534000] } as never, "Revenue hit $534,000.50."), false, "A fractional remainder cannot be discarded as evidence");
  assert.equal(anchorsSpoken({ anchorValues: [10.9] } as never, "Returns were ten point two percent."), false);
  assert.equal(anchorsSpoken({ anchorValues: [-2] } as never, "Returns were two percent."), false);
  assert.equal(anchorsSpoken({ anchorValues: ["two million"] } as never, "The fund holds $2,000,000."), true);
  assert.equal(anchorsSpoken({ anchorValues: ["2 million"] } as never, "The fund holds two dollars."), false);
}

/* ----------------- Block-level skip paths (zero network) ------------------ */

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

async function runBlockSkipPaths(): Promise<void> {
  assert.equal(
    hasNamedSourceAttribution("According to the World Bank, inflation reached 3.2% in 2024."),
    true,
    "a concrete institution named after an attribution phrase qualifies for the strict profile",
  );
  assert.equal(
    hasNamedSourceAttribution("Data from NASA shows 42 launches in 2025."),
    true,
    "an acronym source qualifies for the strict profile",
  );
  assert.equal(
    hasNamedSourceAttribution("According to a study, inflation reached 3.2% in 2024."),
    false,
    "a vague unnamed study must not qualify a numeric claim for rendering",
  );

  // No insertTypes enabled at all -> must no-op without touching a planner.
  const noTypes = await visualInserts.run(baseCtx({
    params: {},
    store: { sentenceTimings: [{ text: "Revenue hit 534,000.", start: 0, end: 2 }] },
  }));
  assert.deepEqual(noTypes, { insertOverlays: [] }, "with no insertTypes enabled, visual_inserts must no-op");
  assert.equal(
    (noTypes as Record<string, unknown>)[COST_PATCH_KEY],
    undefined,
    "a no-op run must never patch in any spend",
  );

  // insertTypes enabled but no sentenceTimings supplied -> must also no-op.
  const noTimings = await visualInserts.run(baseCtx({
    params: { insertTypes: ["big_stat"] },
    store: {},
  }));
  assert.deepEqual(noTimings, { insertOverlays: [] }, "with insertTypes enabled but no timings, visual_inserts must no-op, never fabricate an overlay");

  // Narration speaks no numbers at all -> nothing to visualize, must no-op
  // even with a Google key set (guarded here to avoid any accidental network
  // call if a key happens to be present in this environment).
  const savedKey = process.env.GEMINI_API_KEY;
  try {
    process.env.GEMINI_API_KEY = "test-key-unused-because-no-candidates";
    const noNumbers = await visualInserts.run(baseCtx({
      params: { insertTypes: ["big_stat"] },
      store: { sentenceTimings: [{ text: "Nothing numeric is said here at all.", start: 0, end: 2 }] },
    }));
    assert.deepEqual(noNumbers, { insertOverlays: [] }, "narration with zero spoken numbers must no-op before any provider call");

    const unsourcedDataStory = await visualInserts.run(baseCtx({
      params: {
        insertTypes: ["big_stat"],
        dataStoryContract: DATA_STORY_CONTRACT_VERSION,
        requireNamedSource: true,
        requireSpokenNumericAnchor: true,
      },
      store: { sentenceTimings: [{ text: "Inflation reached 3.2% in 2024.", start: 0, end: 2 }] },
    }));
    assert.deepEqual(
      unsourcedDataStory,
      { insertOverlays: [] },
      "a strict data-story sentence without a named source must no-op before any provider can invent an attribution",
    );

    await assert.rejects(
      () => visualInserts.run(baseCtx({
        params: {
          insertTypes: ["big_stat"],
          dataStoryContract: DATA_STORY_CONTRACT_VERSION,
          requireNamedSource: true,
          requireSpokenNumericAnchor: true,
        },
        store: {
          sentenceTimings: [{
            text: "According to the World Bank, inflation reached 3.2% in 2024.",
            start: 0,
            end: 2,
          }],
        },
      })),
      /data-story source ledger rejected/,
      "a source-named sentence must still reject before planning when its reviewed ledger is absent",
    );
  } finally {
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedKey;
  }
}

Promise.all([run(), runBlockSkipPaths()])
  .then(() => console.log("INSERT BLOCK INTEGRITY PASS — actual shared functions, exact decimal/sign/magnitude evidence and zero-network skip paths"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
