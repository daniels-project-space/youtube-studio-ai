/**
 * The router decides which voice a channel speaks in, so its failure modes are
 * audible to every viewer. The cases below are the ones where a plausible
 * implementation does damage.
 */
import assert from "node:assert/strict";

import {
  LOCAL_CPU_SECONDS_CEILING,
  MEASURED_F0_SPREAD,
  routeNarrationProvider,
} from "@/lib/narrationProviderRouting";

function main(): void {
  // Consistency outranks every other consideration. A channel mid-catalogue
  // must not get a new narrator because the router learned something.
  const established = routeNarrationProvider({
    voice: "quiet-mentor",
    establishedProvider: "elevenlabs",
  });
  assert.equal(established.provider, "elevenlabs");
  assert.equal(established.binding, true, "an established narrator is a hard constraint");

  // ...even when the cheap provider would otherwise be chosen.
  assert.equal(
    routeNarrationProvider({ voice: "quiet-mentor" }).provider,
    "qwen3",
    "an even register with no history should take the free provider",
  );

  // A register that lives on dynamics must not be handed to the flat provider,
  // whatever it would save.
  const dynamic = routeNarrationProvider({ voice: "chaos-commentator" });
  assert.equal(dynamic.provider, "elevenlabs");
  assert.equal(dynamic.binding, true);
  assert.match(dynamic.reason, /F0 spread/, "the refusal must cite the measurement, not taste");

  // Throughput is a separate axis from quality: the right voice on a box that
  // cannot render it in time is still the wrong plan.
  const long = routeNarrationProvider({
    voice: "quiet-mentor",
    localCpuOnly: true,
    narrationSeconds: LOCAL_CPU_SECONDS_CEILING + 1,
  });
  assert.equal(long.provider, "elevenlabs");
  assert.equal(long.binding, false, "a throughput limit is a preference, not a quality bar");

  // A short piece stays local — that is the whole point of having the free path.
  assert.equal(
    routeNarrationProvider({
      voice: "quiet-mentor",
      localCpuOnly: true,
      narrationSeconds: LOCAL_CPU_SECONDS_CEILING - 1,
    }).provider,
    "qwen3",
  );

  // Unknown register falls to the measured provider rather than guessing.
  assert.equal(routeNarrationProvider({}).provider, "elevenlabs");

  // The envelope must stay honest: if someone edits these numbers to make Qwen
  // look better, the routing rationale stops matching the recorded evidence.
  assert.ok(
    MEASURED_F0_SPREAD.qwen3.max < MEASURED_F0_SPREAD.elevenlabs.min,
    "the recorded Qwen spread must remain below the ElevenLabs floor that was measured",
  );

  console.log("NARRATION PROVIDER ROUTING PASS");
}

main();
