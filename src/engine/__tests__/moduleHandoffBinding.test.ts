import assert from "node:assert/strict";
import type { Block } from "../types";
import { _clear, registerManifest } from "../registry";
import { manifestFromBlock } from "../moduleManifest";
import { assertRequiredDownstreamHandoffs } from "../runner";
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

const optionalConsumer: Block = {
  id: "handoff_binding_optional_consumer",
  consumes: [],
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

  // Structural admission deliberately permits a reusable consumer to declare
  // the handoff as optional. Once the producer is actually in this pipeline,
  // execution must still refuse a missing artifact instead of silently taking
  // a generic fallback.
  const producerManifest = manifestFromBlock(producer, {
    capabilities: ["test.specialist"],
    requiredDownstreamCapabilities: ["test.specialist"],
    requiredDownstreamConsumes: { "test.specialist": "handoffArtifact" },
  });
  const optionalConsumerManifest = manifestFromBlock(optionalConsumer, {
    capabilities: ["test.specialist"],
    optionalConsumes: ["handoffArtifact"],
  });
  assert.throws(
    () => assertRequiredDownstreamHandoffs(
      [producerManifest, optionalConsumerManifest],
      1,
      {},
    ),
    /requires handoff "handoffArtifact" from "handoff_binding_producer".*absent/,
    "an optional declaration must not bypass a required upstream handoff",
  );
  assert.doesNotThrow(
    () => assertRequiredDownstreamHandoffs(
      [producerManifest, optionalConsumerManifest],
      1,
      { handoffArtifact: { ok: true } },
    ),
    "a present handoff may cross the reusable optional input boundary",
  );
} finally {
  _clear();
}

console.log("module handoff binding tests passed");
