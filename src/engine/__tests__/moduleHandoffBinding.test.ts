import assert from "node:assert/strict";
import type { Block } from "../types";
import { _clear, registerManifest } from "../registry";
import { manifestFromBlock } from "../moduleManifest";
import { validatePipeline } from "../validate";

const producer: Block = {
  id: "handoff_binding_producer",
  consumes: [],
  produces: ["handoffArtifact"],
  run: async () => ({ handoffArtifact: { ok: true } }),
};

const lookalikeConsumer: Block = {
  id: "handoff_binding_lookalike",
  consumes: [],
  produces: ["done"],
  run: async () => ({ done: true }),
};

const realConsumer: Block = {
  id: "handoff_binding_consumer",
  consumes: ["handoffArtifact"],
  produces: ["done"],
  run: async () => ({ done: true }),
};

try {
  registerManifest(manifestFromBlock(producer, {
    capabilities: ["test.specialist"],
    requiredDownstreamCapabilities: ["test.specialist"],
    requiredDownstreamConsumes: { "test.specialist": "handoffArtifact" },
  }));
  registerManifest(manifestFromBlock(lookalikeConsumer, { capabilities: ["test.specialist"] }));

  assert.throws(
    () => validatePipeline([{ block: producer.id }, { block: lookalikeConsumer.id }]),
    /requires downstream capability "test\.specialist" consuming "handoffArtifact"/,
    "a capability match without the declared artifact must not satisfy a handoff",
  );

  _clear();
  registerManifest(manifestFromBlock(producer, {
    capabilities: ["test.specialist"],
    requiredDownstreamCapabilities: ["test.specialist"],
    requiredDownstreamConsumes: { "test.specialist": "handoffArtifact" },
  }));
  registerManifest(manifestFromBlock(realConsumer, { capabilities: ["test.specialist"] }));
  assert.doesNotThrow(
    () => validatePipeline([{ block: producer.id }, { block: realConsumer.id }]),
    "the exact artifact consumer satisfies the handoff",
  );
} finally {
  _clear();
}

console.log("module handoff binding tests passed");
