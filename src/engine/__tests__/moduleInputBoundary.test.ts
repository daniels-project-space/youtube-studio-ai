import assert from "node:assert/strict";
import type { Block } from "@/engine/types";
import { manifestFromBlock } from "@/engine/moduleManifest";
import { assertConsumedArtifacts } from "@/engine/runner";

const probe: Block = {
  id: "module_input_boundary_probe",
  consumes: ["topic"],
  produces: ["ok"],
  run: async () => ({ ok: true }),
};

const manifest = manifestFromBlock(probe, {
  requiredConsumes: ["topic"],
  optionalConsumes: ["childrenVideoTreatment"],
  capabilities: [],
});

assert.doesNotThrow(
  () => assertConsumedArtifacts(manifest, { topic: "A valid topic" }),
  "an absent optional handoff must use the module's declared fallback path",
);

assert.doesNotThrow(
  () => assertConsumedArtifacts(manifest, {
    topic: "A valid topic",
    // The exact treatment schema is owned by the children module. This probe
    // deliberately does not pretend to construct it; the boundary only needs
    // to prove that malformed payloads cannot cross into a consumer.
  }),
);

assert.throws(
  () => assertConsumedArtifacts(manifest, { topic: "", childrenVideoTreatment: {} }),
  /received invalid .*childrenVideoTreatment|received invalid .*VideoIntent|requires input/,
  "invalid required and optional handoffs must fail before module execution",
);

assert.throws(
  () => assertConsumedArtifacts(manifest, { childrenVideoTreatment: {} }),
  /requires input "topic"/,
  "a missing required upstream artifact must fail closed",
);

console.log("Module input boundary tests passed");
