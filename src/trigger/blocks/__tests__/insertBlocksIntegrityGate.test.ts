import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COST_PATCH_KEY, type StageContext } from "@/engine/types";
import {
  DATA_STORY_CONTRACT_VERSION,
  hasNamedSourceAttribution,
} from "@/engine/dataStory";
import { visualInserts } from "@/trigger/blocks/insertBlocks";

// P2-5 (GOLDEN_MODULE_AUDIT_2026-08.md): "inserts" was never test-run
// directly — catalog evidence is `insertBlocks.ts:22,72,107` (the
// verbatim-number integrity gate: sourceSpoken/digitGroups/anchorsSpoken).
// Those three functions are module-private (not exported) and sit between
// live planner calls inside visualInserts.run(), so they cannot be
// imported directly nor exercised end-to-end without network. This test
// extracts their bodies verbatim from the real source file and runs them in
// isolation with realistic sentences — the actual "an insert may only
// visualize numbers the narration actually speaks" trust rule the module
// header describes — plus a Block-level test of the deterministic skip paths
// that ARE reachable with zero network.

const source = readFileSync(join(process.cwd(), "src/trigger/blocks/insertBlocks.ts"), "utf8");

const startMarker = "function sourceSpoken(citation: string, sentence: string): boolean {";
const endMarkerAnchor = "function anchorsSpoken(item: InsertPlanItem, sentence: string): boolean {";
const startIdx = source.indexOf(startMarker);
assert.notEqual(startIdx, -1, "insertBlocks.ts: sourceSpoken() must remain present verbatim — the citation-integrity gate may have moved");
const anchorsStartIdx = source.indexOf(endMarkerAnchor, startIdx);
assert.notEqual(anchorsStartIdx, -1, "insertBlocks.ts: anchorsSpoken() must remain present verbatim — the numeric-integrity gate may have moved");
// anchorsSpoken's own body ends at the next top-level declaration.
const afterAnchors = source.indexOf("\nexport const visualInserts", anchorsStartIdx);
assert.notEqual(afterAnchors, -1, "insertBlocks.ts: visualInserts export must remain present — extraction boundary not found");

const extractedFunctions = source
  .slice(startIdx, afterAnchors)
  .replace(/(^|\n)function /g, "$1export function ");

async function run(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "insert-blocks-integrity-extract-"));
  try {
    const modulePath = join(dir, "insertIntegrity.ts");
    const moduleSource = [
      "// --- verbatim extract from src/trigger/blocks/insertBlocks.ts below ---",
      "export interface InsertPlanItem {",
      "  anchorValues?: (number | string)[];",
      "}",
      "",
      extractedFunctions,
      "// --- end verbatim extract ---",
      "",
    ].join("\n");
    await writeFile(modulePath, moduleSource, "utf8");
    const mod = (await import(modulePath)) as {
      sourceSpoken: (citation: string, sentence: string) => boolean;
      digitGroups: (text: string) => Set<string>;
      anchorsSpoken: (item: { anchorValues?: (number | string)[] }, sentence: string) => boolean;
    };

    /* --------------------------- sourceSpoken -------------------------- */
    // Real attribution: the citation's substantive words all appear in the sentence.
    assert.equal(
      mod.sourceSpoken("Source: the Federal Reserve", "According to the Federal Reserve, rates rose sharply."),
      true,
      "a citation whose named source is actually spoken in the sentence must pass",
    );
    // Fabricated attribution: the sentence never names this source at all.
    assert.equal(
      mod.sourceSpoken("Source: the World Bank", "According to the Federal Reserve, rates rose sharply."),
      false,
      "a citation naming a source absent from the sentence must be rejected",
    );
    // Empty/meaningless citation (only stopword-length tokens) must never pass.
    assert.equal(mod.sourceSpoken("Source: it", "It was reported."), false, "a citation with no substantive words must be rejected");

    /* ---------------------------- digitGroups --------------------------- */
    const groups = mod.digitGroups("Revenue hit $534,000.50 across 12 regions in 2026.");
    assert.ok(groups.has("534000.50"), `comma-separated thousands must normalize; got ${[...groups].join(",")}`);
    assert.ok(groups.has("534000"), "the integer part of a decimal figure must also be indexed so partial anchors still match");
    assert.ok(groups.has("12"), "a plain small integer must be indexed");
    assert.ok(groups.has("2026"), "a bare year must be indexed");

    /* --------------------------- anchorsSpoken --------------------------- */
    // Every anchor digit genuinely appears (verbatim) in the sentence.
    assert.equal(
      mod.anchorsSpoken({ anchorValues: [534000, "12"] }, "Revenue hit $534,000 across 12 regions."),
      true,
      "anchors whose digits are all actually spoken in the sentence must pass",
    );
    // A fabricated anchor value the narration never says must be rejected —
    // this is the actual anti-hallucination trust rule the module exists for.
    assert.equal(
      mod.anchorsSpoken({ anchorValues: [999999] }, "Revenue hit $534,000 across 12 regions."),
      false,
      "an anchor value the sentence never speaks must be rejected (never invent the data the model 'visualizes')",
    );
    // No anchors declared at all must be rejected outright (nothing to ground).
    assert.equal(mod.anchorsSpoken({ anchorValues: [] }, "Revenue hit $534,000."), false, "an insert with zero declared anchors must be rejected");
    // A sentence with no digits at all can never ground any anchor.
    assert.equal(mod.anchorsSpoken({ anchorValues: [12] }, "Revenue grew substantially this year."), false, "a sentence with no digits at all cannot ground any anchor");
    // Comma-formatted anchor value vs. plain-digit sentence — normalization must bridge them.
    assert.equal(
      mod.anchorsSpoken({ anchorValues: ["1,200"] }, "The census counted 1200 new residents."),
      true,
      "a comma-formatted anchor must still match a plain-digit sentence after normalization",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
  .then(() => console.log("insertBlocksIntegrityGate.test.ts: verbatim-number integrity gate (sourceSpoken/digitGroups/anchorsSpoken) verified against real source, plus visual_inserts zero-network skip paths"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
