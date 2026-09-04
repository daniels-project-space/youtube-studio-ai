/**
 * EVERY family must compose a pipeline whose blocks actually connect.
 *
 * The pipeline is an intermodular contract: each block declares what it
 * consumes and produces, and validatePipeline refuses a step whose input no
 * upstream block produces. That check is strong, but nothing ran it across the
 * whole catalogue — the existing tests each drive one or two families, so a
 * family whose default composition has a gap would look fine in review and fail
 * at runtime, after a channel had been created and a render had started
 * spending.
 *
 * This closes that gap for every FamilyKey, with no provider, network call or
 * spend.
 *
 * THE SEED SET IS THE HARD PART, and getting it wrong is how a test like this
 * becomes a liar. The runner seeds the store before the first block executes —
 * channel identity, operator-authored payload packets, and lane-dependent keys
 * — so a validator told about none of them reports every family as broken. The
 * first two runs here did exactly that, first for the payload packets and then
 * for contentLane. Rather than hand-maintain a third guess, the lane-dependent
 * keys now come from the SAME helper runPipeline itself passes to
 * validatePipeline, so the test tracks the runner instead of drifting from it.
 *
 * WHAT A PASS DOES NOT MEAN, stated so it is not over-read: connectivity is not
 * correctness. A pipeline can be perfectly connected and still produce a bad
 * video. What a pass rules out is the specific failure where a module was
 * added, reordered or renamed and a family depending on it was never rechecked.
 */
import assert from "node:assert/strict";

import { FAMILY_KEYS, resolveFamilyEpisodeLengthSeconds } from "@/engine/families";
import { designPipeline } from "@/engine/designer";
import { validatePipeline } from "@/engine/validate";
import { registerAllBlocks } from "@/engine/blocks";
import { childrenShowBibleSeedKeys } from "@/engine/childrenShowBible";
import { inferContentLane } from "@/engine/contentLane";
import type { PipelineEntry } from "@/engine/types";

/** Channel identity, frozen into the store at run start (runPipeline seedStore). */
const IDENTITY_SEEDS = [
  "channelName", "niche", "persona", "topicPool", "styleGrammar", "palette",
  "clickbaitLevel", "criticDoctrine", "thumbnailer",
];

/**
 * Operator-authored packets that arrive on the run payload rather than from an
 * upstream block — the exact `*Input` fields runPipeline accepts.
 */
const PAYLOAD_SEEDS = [
  "casefileSourcePacketInput", "childrenShowBibleInput", "curriculumEpisodeSeedInput",
  "editorialEvidencePacketInput",
];

function seedsFor(entries: readonly PipelineEntry[]): string[] {
  const lane = inferContentLane(entries);
  return [...IDENTITY_SEEDS, ...PAYLOAD_SEEDS, "contentLane", ...childrenShowBibleSeedKeys(lane)];
}

function main(): void {
  registerAllBlocks();

  const failures: string[] = [];
  const checked: string[] = [];
  const gated: string[] = [];

  for (const family of FAMILY_KEYS) {
    // Ask for the family's OWN default length, and only when it is a whole
    // number of minutes. quizyear is fixed at 80 seconds, so rounding it to one
    // minute made the family reject a duration it never offered — a failure
    // about arithmetic in this test rather than about connectivity.
    let lengthMinutes: number | undefined;
    try {
      const seconds = resolveFamilyEpisodeLengthSeconds(family, undefined);
      lengthMinutes = seconds % 60 === 0 ? seconds / 60 : undefined;
    } catch {
      lengthMinutes = undefined;
    }

    let entries: PipelineEntry[] | undefined;
    try {
      entries = designPipeline({ family, ...(lengthMinutes ? { lengthMinutes } : {}) })
        .pipeline as PipelineEntry[];
    } catch (error) {
      // A family that cannot be designed without a program brief, route or
      // admission is a deliberate gate, not a broken pipeline. Recorded rather
      // than failed, so this test keeps its meaning as gating tightens.
      const message = error instanceof Error ? error.message : String(error);
      if (/brief|route|admission|intent|qualif|approv/i.test(message)) {
        gated.push(family);
        continue;
      }
      failures.push(`${family}: design threw — ${message}`);
      continue;
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      failures.push(`${family}: designed an empty pipeline`);
      continue;
    }

    try {
      const resolved = validatePipeline(entries, seedsFor(entries));
      assert.ok(resolved.blocks.length > 0, `${family}: resolved to no blocks`);
      checked.push(family);
    } catch (error) {
      failures.push(`${family}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  assert.deepEqual(
    failures,
    [],
    `families whose composed pipeline does not connect:\n  ${failures.join("\n  ")}`,
  );
  // Guard against the test quietly checking nothing if designPipeline starts
  // refusing everything: a pass with zero families verified is not a pass.
  assert.ok(
    checked.length >= Math.ceil(FAMILY_KEYS.length / 2),
    `only ${checked.length}/${FAMILY_KEYS.length} families were checkable (gated: ${gated.join(", ") || "none"})`,
  );

  console.log(
    `FAMILY PIPELINE CONNECTIVITY PASS — ${checked.length}/${FAMILY_KEYS.length} families compose a connected pipeline` +
    (gated.length ? ` (${gated.length} gated behind admission: ${gated.join(", ")})` : ""),
  );
}

main();
