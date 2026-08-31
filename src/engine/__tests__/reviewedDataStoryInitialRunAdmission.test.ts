import assert from "node:assert/strict";

import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { channelProgramRouteRunSeed, resolveChannelProgramRoute } from "@/engine/channelProgramRoute";
import { createChannelShowProfile } from "@/engine/channelShowProfile";
import { creativeCapabilitySelection } from "@/engine/creative/creativeCapabilityCatalog";
import { dataStorySourceLedgerFingerprint } from "@/engine/dataStorySourceLedger";
import { designPipeline } from "@/engine/designer";
import { editorialEvidencePacketFromDataStoryLedger } from "@/engine/editorialEvidencePacket";
import { createReviewedEvidencePack } from "@/engine/reviewedEvidencePack";
import {
  admitReviewedDataStoryInitialRun,
  reviewedDataStoryInitialDispatchEnvelope,
} from "@/engine/reviewedDataStoryInitialRunAdmission";

const now = Date.now();
const ownerId = "owner-reviewed-data-story";
const channelId = "channel-reviewed-data-story";
const topic = "Why an immutable source ledger must select this factual episode";
const brief = createChannelProgramBrief({
  family: "narrated_stock",
  nicheKey: "educational",
  locale: "en",
  concept: "A source-attributed data storytelling channel with a repeatable viewer promise.",
});
const route = resolveChannelProgramRoute(brief);
const selections = [creativeCapabilitySelection("source_attributed_data_story")];
const design = designPipeline({
  family: brief.family,
  nicheKey: brief.nicheKey,
  locale: brief.locale,
  programBrief: brief,
  capabilitySelections: selections,
});
const showProfile = createChannelShowProfile({
  programBrief: brief,
  programRoute: route,
  capabilitySelections: selections,
  pipeline: design.pipeline,
});
const ledgerContent = {
  version: "data-story-source-ledger/v1" as const,
  topic,
  sources: [{
    id: "source-one",
    name: "Reviewed source",
    url: "https://example.org/source",
    snapshotSha256: "a".repeat(64),
  }],
  claims: [
    { id: "claim-one", sourceId: "source-one", numericAnchor: "12%", context: "First approved data point." },
    { id: "claim-two", sourceId: "source-one", numericAnchor: "18%", context: "Second approved data point." },
    { id: "claim-three", sourceId: "source-one", numericAnchor: "24%", context: "Third approved data point." },
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
const pack = createReviewedEvidencePack({
  route: channelProgramRouteRunSeed({ route, programBrief: brief }),
  topic,
  showProfile,
  dataStorySourceLedger: ledger,
  derivedEditorialEvidencePacket: editorialEvidencePacketFromDataStoryLedger(ledger, now),
  review: { reviewerId: "pack-editor", reviewId: "review-data-story-pack", reviewedAt: new Date(now).toISOString() },
  now,
});
const selector = { packId: "pack-data-story-001", contentFingerprint: pack.contentFingerprint };
const admission = admitReviewedDataStoryInitialRun({
  ownerId,
  channelId,
  identity: { nicheKey: brief.nicheKey, programBrief: brief, programRoute: route, showProfile },
  contentLane: undefined,
  family: "narrated_stock",
  pipeline: design.pipeline,
  selector,
  record: { _id: selector.packId, ownerId, contentFingerprint: pack.contentFingerprint, pack },
  now,
});
assert.equal(admission.selector.contentFingerprint, pack.contentFingerprint);
assert.equal(admission.admission.routeSeedFingerprint, pack.routeSeedFingerprint);
assert.equal(admission.admission.showProfileFingerprint, showProfile.fingerprint);
assert.deepEqual(
  reviewedDataStoryInitialDispatchEnvelope(admission.admission),
  { selector, admissionFingerprint: admission.admission.admissionFingerprint },
  "the queue receives only pack identity plus a sealed admission fingerprint",
);
assert.throws(
  () => admitReviewedDataStoryInitialRun({
    ownerId,
    channelId,
    identity: { nicheKey: brief.nicheKey, programBrief: brief, programRoute: route, showProfile },
    contentLane: undefined,
    family: "narrated_stock",
    pipeline: design.pipeline.filter((entry) => entry.block !== "episode_graph"),
    selector,
    record: { _id: selector.packId, ownerId, contentFingerprint: pack.contentFingerprint, pack },
    now,
  }),
  /episode_graph|Episode Graph/i,
  "a historical/pre-review source-data composition cannot be labeled supervised initial work",
);
assert.throws(
  () => reviewedDataStoryInitialDispatchEnvelope({
    ...admission.admission,
    admissionFingerprint: "not-a-hash",
  }),
  /sha256/i,
  "queue envelopes reject synthetic receipt identities",
);

console.log("Reviewed data-story initial-run admission tests passed");
