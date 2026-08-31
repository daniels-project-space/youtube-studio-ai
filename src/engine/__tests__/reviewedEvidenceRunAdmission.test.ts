import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  channelProgramRouteRunSeed,
  resolveChannelProgramRoute,
} from "@/engine/channelProgramRoute";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { createChannelShowProfile } from "@/engine/channelShowProfile";
import { creativeCapabilitySelection } from "@/engine/creative/creativeCapabilityCatalog";
import { dataStorySourceLedgerFingerprint } from "@/engine/dataStorySourceLedger";
import { designPipeline } from "@/engine/designer";
import { editorialEvidencePacketFromDataStoryLedger } from "@/engine/editorialEvidencePacket";
import { createReviewedEvidencePack } from "@/engine/reviewedEvidencePack";
import {
  admitReviewedEvidencePackForSourceDataStoryRun,
  assertFrozenReviewedEvidencePackRunSeed,
  assertNoReviewedEvidencePackRunSeed,
  REVIEWED_EVIDENCE_PACK_RUN_ADMISSION_SEED_KEY,
  REVIEWED_EVIDENCE_PACK_SEED_KEY,
  REVIEWED_EVIDENCE_PACK_SELECTOR_SEED_KEY,
} from "@/engine/reviewedEvidenceRunAdmission";

const now = Date.now();
const ownerId = "owner-reviewed-data-story";
const topic = "Why a frozen source ledger must choose the topic before a factual episode runs";

const programBrief = createChannelProgramBrief({
  family: "narrated_stock",
  nicheKey: "educational",
  locale: "en",
  concept: "A source-attributed data storytelling channel with a repeatable viewer promise.",
});
const programRoute = resolveChannelProgramRoute(programBrief);
const route = channelProgramRouteRunSeed({ route: programRoute, programBrief });
const capabilitySelections = [creativeCapabilitySelection("source_attributed_data_story")];
const design = designPipeline({
  family: programBrief.family,
  nicheKey: programBrief.nicheKey,
  locale: programBrief.locale,
  programBrief,
  capabilitySelections,
});
const showProfile = createChannelShowProfile({
  programBrief,
  programRoute,
  capabilitySelections,
  pipeline: design.pipeline,
});

const ledgerContent = {
  version: "data-story-source-ledger/v1" as const,
  topic,
  sources: [{
    id: "public-data-source",
    name: "Reviewed public data desk",
    url: "https://example.org/public-data",
    snapshotSha256: "a".repeat(64),
  }],
  claims: [
    { id: "claim-one", sourceId: "public-data-source", numericAnchor: "12%", context: "The approved first point." },
    { id: "claim-two", sourceId: "public-data-source", numericAnchor: "18%", context: "The approved second point." },
    { id: "claim-three", sourceId: "public-data-source", numericAnchor: "24%", context: "The approved third point." },
  ],
};
const ledger = {
  ...ledgerContent,
  review: {
    decision: "approved" as const,
    reviewerId: "data-editor",
    reviewId: "review-data-story-ledger",
    reviewedAt: new Date(now).toISOString(),
    reviewedLedgerFingerprint: dataStorySourceLedgerFingerprint(ledgerContent),
  },
};
const derivedEditorialPacket = editorialEvidencePacketFromDataStoryLedger(ledger, now);
const pack = createReviewedEvidencePack({
  route,
  topic,
  showProfile,
  dataStorySourceLedger: ledger,
  derivedEditorialEvidencePacket: derivedEditorialPacket,
  review: {
    reviewerId: "pack-editor",
    reviewId: "review-data-story-pack",
    reviewedAt: new Date(now).toISOString(),
  },
  now,
});
const selector = { packId: "reviewed-pack-data-story-001", contentFingerprint: pack.contentFingerprint };
const record = { _id: selector.packId, ownerId, contentFingerprint: pack.contentFingerprint, pack };
const binding = {
  route,
  showProfileFingerprint: showProfile.fingerprint,
  selectedCapabilityKeys: showProfile.selectedCapabilityKeys,
};

// The admission core must make no network/provider call. A selector supplies
// only an immutable DB identity; the facts come from `record.pack`.
const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = (async () => {
  networkCalls += 1;
  throw new Error("reviewed evidence admission must not call a provider");
}) as typeof fetch;
try {
  const admitted = admitReviewedEvidencePackForSourceDataStoryRun({
    selector,
    record,
    ownerId,
    binding,
    scheduledTopic: topic,
    now,
  });
  assert.equal(networkCalls, 0, "the provider-free evidence admission must make no network call");
  assert.equal(admitted.pack.contentFingerprint, pack.contentFingerprint);
  assert.equal(admitted.seed.plannedTopic, topic, "topic_select must receive the exact reviewed topic");
  assert.deepEqual(
    admitted.seed.dataStorySourceLedger,
    ledger,
    "only the reviewed ledger may seed factual script generation",
  );
  assert.deepEqual(admitted.seed.editorialEvidencePacket, derivedEditorialPacket);
  assert.deepEqual(admitted.seed.evidenceVisualManifests, []);
  assert.equal(
    (admitted.seed[REVIEWED_EVIDENCE_PACK_RUN_ADMISSION_SEED_KEY] as { contentFingerprint: string }).contentFingerprint,
    pack.contentFingerprint,
  );

  assert.doesNotThrow(() =>
    assertFrozenReviewedEvidencePackRunSeed({
      seedStore: admitted.seed,
      record,
      ownerId,
      binding,
      scheduledTopic: topic,
      now,
    }),
  );

  const forgedSeed = structuredClone(admitted.seed) as Record<string, unknown>;
  forgedSeed.dataStorySourceLedger = { rawBrowserFacts: true };
  assert.throws(
    () => assertFrozenReviewedEvidencePackRunSeed({
      seedStore: forgedSeed,
      record,
      ownerId,
      binding,
      scheduledTopic: topic,
      now,
    }),
    /does not match its immutable reviewed pack/,
    "a retry cannot replace reviewed facts with a browser-shaped payload",
  );

  assert.throws(
    () => admitReviewedEvidencePackForSourceDataStoryRun({
      selector: { ...selector, rawBrowserFacts: ledger },
      record,
      ownerId,
      binding,
      scheduledTopic: topic,
      now,
    }),
    /unrecognized key/i,
    "the Trigger selector must reject raw factual fields",
  );
  assert.throws(
    () => admitReviewedEvidencePackForSourceDataStoryRun({
      selector,
      record: { ...record, ownerId: "other-owner" },
      ownerId,
      binding,
      scheduledTopic: topic,
      now,
    }),
    /not owned by this pipeline owner/,
  );
  assert.throws(
    () => admitReviewedEvidencePackForSourceDataStoryRun({
      selector,
      record,
      ownerId,
      binding: { ...binding, selectedCapabilityKeys: [] },
      scheduledTopic: topic,
      now,
    }),
    /not accepted by this channel route/,
    "ordinary routes cannot silently consume a reviewed pack",
  );
  assert.throws(
    () => admitReviewedEvidencePackForSourceDataStoryRun({
      selector,
      record,
      ownerId,
      binding,
      scheduledTopic: "A different scheduled topic",
      now,
    }),
    /claimed scheduled-plan topic/,
    "the pack topic must be exact before a planned episode can run",
  );
  assert.throws(
    () => assertNoReviewedEvidencePackRunSeed({
      [REVIEWED_EVIDENCE_PACK_SELECTOR_SEED_KEY]: selector,
      [REVIEWED_EVIDENCE_PACK_SEED_KEY]: pack,
    }),
    /only accepted by source_attributed_data_story/,
  );
} finally {
  globalThis.fetch = originalFetch;
}

// Source-level ordering is a regression guard for the live task: the pack
// lookup/admission must happen before credentials and before the engine run.
const pipelineSource = readFileSync(new URL("../../trigger/runPipeline.ts", import.meta.url), "utf8");
const evidenceAdmission = pipelineSource.lastIndexOf("admitReviewedEvidencePackForSourceDataStoryRun({");
const evidenceLookup = pipelineSource.lastIndexOf("api as unknown as {");
const secretHydration = pipelineSource.lastIndexOf("await bootstrapSecrets(");
const engineRun = pipelineSource.lastIndexOf("runEngine(");
assert.ok(evidenceAdmission >= 0 && evidenceLookup >= 0 && secretHydration >= 0 && engineRun >= 0);
assert.ok(evidenceAdmission < secretHydration, "reviewed evidence must bind before provider credentials hydrate");
assert.ok(evidenceLookup < secretHydration, "the owner-bound pack lookup must occur before provider credentials hydrate");
assert.ok(secretHydration < engineRun, "credentials must hydrate only after factual admission and before execution");

console.log("Reviewed evidence run admission tests passed");
