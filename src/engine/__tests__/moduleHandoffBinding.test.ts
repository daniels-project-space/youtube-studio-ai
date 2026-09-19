import assert from "node:assert/strict";
import type { ArtifactRef, Block } from "../types";
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
  const validRef: ArtifactRef = {
    artifactId: "run:handoff_binding_producer:handoffArtifact:hash",
    key: "handoffArtifact",
    type: "LegacyArtifact<handoffArtifact>",
    schemaVersion: "1.0.0-migration",
    producerModule: "handoff_binding_producer",
    producerVersion: "1.0.0-migration",
    payloadHash: "hash",
  };
  assert.throws(
    () => assertRequiredDownstreamHandoffs(
      [producerManifest, optionalConsumerManifest],
      1,
      { handoffArtifact: { ok: true } },
    ),
    /requires handoff "handoffArtifact" from "handoff_binding_producer".*no producer lineage/,
    "a shaped payload without an artifact reference must not satisfy a required handoff",
  );
  assert.doesNotThrow(
    () => assertRequiredDownstreamHandoffs(
      [producerManifest, optionalConsumerManifest],
      1,
      { handoffArtifact: { ok: true } },
      { handoffArtifact: validRef },
    ),
    "a present, producer-bound handoff may cross the reusable optional input boundary",
  );
  assert.throws(
    () => assertRequiredDownstreamHandoffs(
      [producerManifest, optionalConsumerManifest],
      1,
      { handoffArtifact: { ok: true } },
      { handoffArtifact: { ...validRef, producerModule: "$seed" } },
    ),
    /received artifact lineage from "\$seed"/,
    "a seeded same-shaped artifact must not satisfy a producer-bound handoff",
  );
  assert.throws(
    () => assertRequiredDownstreamHandoffs(
      [producerManifest, optionalConsumerManifest],
      1,
      { handoffArtifact: { ok: true } },
      { handoffArtifact: { ...validRef, producerVersion: "0.9.0" } },
    ),
    /received producer version "0\.9\.0"/,
    "a stale producer version must not satisfy a required handoff",
  );
  assert.throws(
    () => assertRequiredDownstreamHandoffs(
      [producerManifest, optionalConsumerManifest],
      1,
      { handoffArtifact: { ok: true } },
      { handoffArtifact: { ...validRef, type: "WrongArtifact", schemaVersion: "9.9.9" } },
    ),
    /with LegacyArtifact<handoffArtifact>@1\.0\.0-migration; received handoffArtifact WrongArtifact@9\.9\.9/,
    "a mismatched artifact contract must not satisfy a required handoff",
  );
  assert.doesNotThrow(
    () => assertRequiredDownstreamHandoffs(
      [producerManifest, optionalConsumerManifest],
      1,
      { handoffArtifact: { ok: true } },
      { handoffArtifact: validRef },
    ),
    "the producer-bound artifact lineage must satisfy the handoff",
  );
} finally {
  _clear();
}

console.log("module handoff binding tests passed");
