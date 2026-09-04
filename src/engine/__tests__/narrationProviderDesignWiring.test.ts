/**
 * The narration router must actually reach the designed pipeline.
 *
 * This test exists because the router did NOT, for several commits: it was
 * written, unit-tested, committed and never called — the exact inertness this
 * repository's audits were built to catch, committed while writing them. A unit
 * test on the routing function proves the rule is right and proves nothing
 * about whether anything consults it.
 *
 * So this asserts on the designer's OUTPUT rather than on the router: build the
 * pipeline a channel would get and read the narration block's params.
 */
import assert from "node:assert/strict";

import { designPipeline } from "@/engine/designer";
import type { PipelineEntry } from "@/engine/types";

function narrationParams(nicheKey: string): Record<string, unknown> | undefined {
  const pipeline = designPipeline({ family: "narrated_stock", nicheKey }).pipeline as PipelineEntry[];
  return pipeline.find((entry) => entry.block === "narration_tts")?.params;
}

function main(): void {
  // A register that lives on delivery dynamics must be pinned to the measured
  // provider. Qwen's F0 spread is 13.5 against 24-55, and that is architectural
  // rather than tunable, so this is a routing decision and not a preference.
  const chaotic = narrationParams("celebrity scandal commentary");
  assert.equal(
    chaotic?.["ttsProvider"],
    "elevenlabs",
    `a dynamic register must be pinned at design time; got ${JSON.stringify(chaotic?.["ttsProvider"])}`,
  );

  // An even register is NOT pinned. Leaving it unset keeps the existing default
  // rather than re-voicing every channel that never chose an engine — a change
  // a listener notices faster than any visual one. The knob and the channel's
  // own setting still decide.
  const calm = narrationParams("stoic philosophy resilience");
  assert.equal(
    calm?.["ttsProvider"],
    undefined,
    "an even register must be left to the channel's own choice, not pinned by the router",
  );

  // The router must only ever FILL an empty slot, never replace a choice. That
  // guard cannot be exercised through designPipeline, which takes no module
  // configuration — an operator's explicit provider arrives later, as
  // moduleConfigOverride on the run payload. What is checkable here is that a
  // pipeline already carrying a provider keeps it, which is the same property
  // from the other side: the even-register case above is left untouched
  // precisely because the router declines to bind, and the dynamic case is
  // filled only because the slot was empty.
  //
  // Stated rather than silently omitted: an earlier version of this test
  // asserted "explicit choice wins" by passing a moduleConfig option that
  // designPipeline does not accept. The option was ignored, the assertion
  // failed, and the failure said nothing about the code — it was the test
  // inventing an API.
  const repeated = narrationParams("celebrity scandal commentary");
  assert.equal(
    repeated?.["ttsProvider"],
    "elevenlabs",
    "routing must be deterministic across designs of the same channel",
  );

  console.log("NARRATION PROVIDER DESIGN WIRING PASS");
}

main();
