import assert from "node:assert/strict";

import {
  channelProgramRouteRunSeed,
  resolveChannelProgramRoute,
} from "@/engine/channelProgramRoute";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { createChannelShowProfile } from "@/engine/channelShowProfile";
import { creativeCapabilitySelection } from "@/engine/creative/creativeCapabilityCatalog";
import { dataStorySourceLedgerFingerprint } from "@/engine/dataStorySourceLedger";
import { designPipeline } from "@/engine/designer";
import {
  createEditorialEvidencePacket,
  editorialEvidencePacketFromDataStoryLedger,
} from "@/engine/editorialEvidencePacket";
import {
  assertReviewedEvidencePack,
  createReviewedEvidencePack,
  reviewedEvidencePackContentFingerprint,
  reviewedEvidencePackPersistenceBinding,
  REVIEWED_EVIDENCE_PACK_VERSION,
} from "@/engine/reviewedEvidencePack";
import {
  createReviewedEvidenceRouteBinding,
  reviewedEvidenceRouteBindingFingerprint,
} from "@/engine/reviewedEvidenceRouteBinding";
import { planStorySpine } from "@/engine/storySpine";
import { buildEpisodeGraphFromStorySpine } from "@/trigger/blocks/episodeGraphBlocks";

const now = Date.now();
const topic = "How a reviewed source becomes a reliable data-story episode";

const brief = createChannelProgramBrief({
  family: "narrated_stock",
  nicheKey: "educational",
  locale: "en",
  concept: "A source-attributed data storytelling channel with a repeatable viewer promise.",
});
const programRoute = resolveChannelProgramRoute(brief);
const route = channelProgramRouteRunSeed({ route: programRoute, programBrief: brief });
const capabilitySelections = [creativeCapabilitySelection("source_attributed_data_story")];
const design = designPipeline({
  family: brief.family,
  nicheKey: brief.nicheKey,
  locale: brief.locale,
  programBrief: brief,
  capabilitySelections,
});
const showProfile = createChannelShowProfile({
  programBrief: brief,
  programRoute,
  capabilitySelections,
  pipeline: design.pipeline,
});

function editorialEvidencePacket(subject = topic) {
  return createEditorialEvidencePacket({
    subject,
    sources: [{
      id: "source-primary",
      name: "Primary evidence desk",
      url: "https://example.org/reviewed-source",
      snapshotSha256: "a".repeat(64),
      kind: "primary",
    }],
    claims: [{
      id: "claim-reviewed-source",
      sourceIds: ["source-primary"],
      approvedText: "The source was reviewed before an episode could use its factual claim.",
      context: "Use only to explain the reviewed source-bound workflow.",
    }],
    review: {
      reviewerId: "editor-reviewed",
      reviewId: "review-primary-source",
      reviewedAt: new Date(now).toISOString(),
    },
    now,
  });
}

const packet = editorialEvidencePacket();

function packReview(reviewId = "review-evidence-pack") {
  return {
    reviewerId: "editor-pack-reviewer",
    reviewId,
    reviewedAt: new Date(now).toISOString(),
  };
}

const basePack = createReviewedEvidencePack({
  route,
  topic,
  showProfile,
  editorialEvidencePacket: packet,
  review: packReview(),
  now,
});

assert.equal(basePack.version, REVIEWED_EVIDENCE_PACK_VERSION);
assert.equal(basePack.reviewedPlan, undefined, "a reviewed evidence pack must be admitted before any story plan exists");
assert.equal(basePack.sourceAuthority.kind, "editorial_evidence_packet");
assert.deepEqual(assertReviewedEvidencePack(basePack, now), basePack);
assert.equal(
  reviewedEvidencePackContentFingerprint(structuredClone(basePack)),
  basePack.contentFingerprint,
  "canonical content identity must be stable across equivalent object copies",
);
assert.deepEqual(
  reviewedEvidencePackPersistenceBinding(basePack),
  {
    contentFingerprint: basePack.contentFingerprint,
    reviewId: basePack.review.reviewId,
    reviewerId: basePack.review.reviewerId,
    reviewedAt: basePack.review.reviewedAt,
    routeSeedFingerprint: basePack.routeSeedFingerprint,
    routeKey: route.routeKey,
    family: route.family,
    contentLaneKey: route.contentLaneKey,
    showProfileFingerprint: showProfile.fingerprint,
    capabilityFingerprint: basePack.showProfile.capabilityFingerprint,
    selectedCapabilityKeys: ["source_attributed_data_story"],
    topicFingerprint: basePack.topicFingerprint,
    authorityKind: "editorial_evidence_packet",
    authorityContentFingerprint: basePack.authorityContentFingerprint,
  },
  "the persistence projection must contain only immutable owner-scoped lookup identities",
);

const dataStoryLedgerBase = {
  version: "data-story-source-ledger/v1" as const,
  topic,
  sources: [{
    id: "source-data",
    name: "Reviewed data desk",
    url: "https://example.org/reviewed-data",
    snapshotSha256: "c".repeat(64),
  }],
  claims: [
    { id: "claim-one", sourceId: "source-data", numericAnchor: "12%", context: "The approved first data point." },
    { id: "claim-two", sourceId: "source-data", numericAnchor: "18%", context: "The approved second data point." },
    { id: "claim-three", sourceId: "source-data", numericAnchor: "24%", context: "The approved third data point." },
  ],
};
const dataStoryLedger = {
  ...dataStoryLedgerBase,
  review: {
    decision: "approved" as const,
    reviewerId: "editor-data-reviewer",
    reviewId: "review-reviewed-data",
    reviewedAt: new Date(now).toISOString(),
    reviewedLedgerFingerprint: dataStorySourceLedgerFingerprint(dataStoryLedgerBase),
  },
};
const derivedPacket = editorialEvidencePacketFromDataStoryLedger(dataStoryLedger, now);
const dataStoryPack = createReviewedEvidencePack({
  route,
  topic,
  showProfile,
  dataStorySourceLedger: dataStoryLedger,
  derivedEditorialEvidencePacket: derivedPacket,
  review: packReview("review-data-story-pack"),
  now,
});
assert.equal(dataStoryPack.sourceAuthority.kind, "data_story_source_ledger");
assert.equal(dataStoryPack.authorityContentFingerprint, dataStoryLedger.review.reviewedLedgerFingerprint);
assert.equal(
  dataStoryPack.sourceAuthority.kind === "data_story_source_ledger"
    ? dataStoryPack.sourceAuthority.derivedEditorialEvidencePacket?.contentFingerprint
    : undefined,
  derivedPacket.contentFingerprint,
  "a data-story pack may retain only the exact deterministic editorial adaptation of its reviewed ledger",
);
const substitutedDerivedPacket = editorialEvidencePacket("A different but valid reviewed subject");
assert.throws(
  () => createReviewedEvidencePack({
    route,
    topic,
    showProfile,
    dataStorySourceLedger: dataStoryLedger,
    derivedEditorialEvidencePacket: substitutedDerivedPacket,
    review: packReview("review-substituted-derived"),
    now,
  }),
  /not the exact adaptation/,
);

const storySpine = planStorySpine({
  topic,
  narrationDurationSec: 24,
  targetShotSec: 6,
  sentenceTimings: [
    { text: "The evidence desk reviewed the original source before planning the episode.", start: 0, end: 12 },
    { text: "The approved source stays bound to the final factual explanation.", start: 12, end: 24 },
  ],
});
const { episodeGraph } = buildEpisodeGraphFromStorySpine({
  storySpine,
  topic,
  seriesId: "series-reviewed-evidence",
  episodeId: "episode-reviewed-evidence-pack",
});
const routeBinding = createReviewedEvidenceRouteBinding({
  route,
  topic,
  storySpine,
  episodeGraph,
  editorialEvidencePacket: packet,
  now,
});
const postPlanPack = createReviewedEvidencePack({
  route,
  topic,
  showProfile,
  editorialEvidencePacket: packet,
  reviewedPlan: { storySpine, episodeGraph, reviewedEvidenceRouteBinding: routeBinding },
  review: packReview("review-evidence-pack-post-plan"),
  now,
});
assert.equal(
  postPlanPack.reviewedPlan?.reviewedEvidenceRouteBinding.bindingFingerprint,
  routeBinding.bindingFingerprint,
  "an optional plan must retain its exact authority-aware route binding",
);
assert.doesNotThrow(() => assertReviewedEvidencePack(postPlanPack, now));

const forgedPlanBinding = structuredClone(routeBinding);
forgedPlanBinding.sourceAuthority.contentFingerprint = "b".repeat(64);
forgedPlanBinding.bindingFingerprint = reviewedEvidenceRouteBindingFingerprint(forgedPlanBinding);
assert.throws(
  () => createReviewedEvidencePack({
    route,
    topic,
    showProfile,
    editorialEvidencePacket: packet,
    reviewedPlan: { storySpine, episodeGraph, reviewedEvidenceRouteBinding: forgedPlanBinding },
    review: packReview("review-forged-plan"),
    now,
  }),
  /expected reviewed authority/,
  "a self-fingerprinted optional plan must still be checked against raw validated authority",
);

assert.throws(
  () => createReviewedEvidencePack({
    route,
    topic,
    showProfile,
    editorialEvidencePacket: editorialEvidencePacket("A different reviewed subject"),
    review: packReview("review-cross-topic"),
    now,
  }),
  /does not match the pack topic/,
  "a valid reviewed authority for another topic cannot be relabeled into this pack",
);

const originalFetch = globalThis.fetch;
let invalidPackNetworkCalls = 0;
try {
  globalThis.fetch = (async () => {
    invalidPackNetworkCalls += 1;
    throw new Error("an invalid evidence pack must fail before any network/provider action");
  }) as typeof fetch;
  assert.throws(
    () => createReviewedEvidencePack({
      route,
      topic,
      showProfile,
      editorialEvidencePacket: editorialEvidencePacket("A second wrong reviewed subject"),
      review: packReview("review-invalid-no-spend"),
      now,
    }),
    /does not match the pack topic/,
  );
  assert.equal(invalidPackNetworkCalls, 0, "an invalid pack admission must not invoke network/provider work");
} finally {
  globalThis.fetch = originalFetch;
}

const mismatchedShowProfile = structuredClone(showProfile);
mismatchedShowProfile.programRoute = {
  ...mismatchedShowProfile.programRoute!,
  family: "sleep",
};
assert.throws(
  () => createReviewedEvidencePack({
    route,
    topic,
    showProfile: mismatchedShowProfile,
    editorialEvidencePacket: packet,
    review: packReview("review-route-mismatch"),
    now,
  }),
  /fingerprint|frozen route seed/i,
  "a tampered Show Profile route must fail before it can create a pack",
);

const stalePack = structuredClone(basePack);
stalePack.review.reviewedAt = new Date(now - 31 * 24 * 60 * 60 * 1_000).toISOString();
assert.throws(
  () => assertReviewedEvidencePack(stalePack, now),
  /approval is older than 30 days/,
  "pack approval freshness is a hard requirement independent of the authority receipt",
);

const rawBrowserFacts = {
  ...structuredClone(basePack),
  rawBrowserFacts: [{ url: "https://unreviewed.example.org", text: "unreviewed browser output" }],
};
assert.throws(
  () => assertReviewedEvidencePack(rawBrowserFacts, now),
  /unrecognized key/i,
  "the pack schema must not accept raw browser facts as an alternate authority path",
);

console.log("Reviewed Evidence Pack tests passed");
