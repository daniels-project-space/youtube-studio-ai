import assert from "node:assert/strict";

import {
  channelProgramRouteRunSeed,
  channelProgramRouteRunSeedFingerprint,
  resolveChannelProgramRoute,
} from "@/engine/channelProgramRoute";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { dataStorySourceLedgerFingerprint } from "@/engine/dataStorySourceLedger";
import { createEditorialEvidencePacket } from "@/engine/editorialEvidencePacket";
import {
  evidenceVisualManifestFingerprint,
  type EvidenceVisualManifest,
} from "@/engine/evidenceVisualManifest";
import {
  REVIEWED_EVIDENCE_ROUTE_BINDING_VERSION,
  assertReviewedEvidenceRouteBinding,
  assertReviewedEvidenceRouteBindingMatches,
  createReviewedEvidenceRouteBinding,
  reviewedEvidenceRouteBindingFingerprint,
  reviewedEvidenceRouteTopicFingerprint,
} from "@/engine/reviewedEvidenceRouteBinding";
import { planStorySpine, storySpineFingerprint } from "@/engine/storySpine";
import { buildEpisodeGraphFromStorySpine } from "@/trigger/blocks/episodeGraphBlocks";

const now = Date.now();
const topic = "Port delay trend";

function frozenRouteSeed(input: Readonly<Record<string, unknown>> = {}) {
  const brief = createChannelProgramBrief({
    family: "narrated_stock",
    nicheKey: "educational",
    locale: "en",
    concept: "A clear, original channel program with a repeatable viewer promise.",
    ...input,
  });
  const route = resolveChannelProgramRoute(brief);
  return channelProgramRouteRunSeed({ route, programBrief: brief });
}

const route = frozenRouteSeed();
const storySpine = planStorySpine({
  topic,
  narrationDurationSec: 24,
  targetShotSec: 6,
  sentenceTimings: [
    { text: "Port operators recorded an average berth delay of 4.1 days during the first quarter.", start: 0, end: 12 },
    { text: "The reviewed data later showed the average delay falling to 3.2 days.", start: 12, end: 24 },
  ],
});
const { episodeGraph } = buildEpisodeGraphFromStorySpine({
  storySpine,
  topic,
  seriesId: "series-port-delays",
  episodeId: "episode-port-delay-trend",
});

function reviewedEditorialPacket(subject = topic) {
  return createEditorialEvidencePacket({
    subject,
    sources: [{
      id: "source-port-authority",
      name: "Port Authority",
      url: "https://authority.example.org/port-delays",
      snapshotSha256: "a".repeat(64),
      kind: "official",
    }],
    claims: [{
      id: "claim-port-delay",
      sourceIds: ["source-port-authority"],
      approvedText: "The approved port report records the quarterly berth-delay trend.",
      numericAnchor: "4.1 days",
      context: "Use only for the reviewed quarterly port report period.",
    }],
    review: {
      reviewerId: "reviewer-editorial",
      reviewId: "review-port-delay",
      reviewedAt: new Date(now).toISOString(),
    },
    now,
  });
}

const dataStorySourceLedgerBase = {
  version: "data-story-source-ledger/v1" as const,
  topic,
  sources: [{
    id: "port-authority",
    name: "Port Authority",
    url: "https://authority.example.org/port-delays",
    snapshotSha256: "b".repeat(64),
  }],
  claims: [
    { id: "delay-q1", sourceId: "port-authority", numericAnchor: "4.1 days", context: "Q1 average berth delay." },
    { id: "delay-q2", sourceId: "port-authority", numericAnchor: "3.8 days", context: "Q2 average berth delay." },
    { id: "delay-q3", sourceId: "port-authority", numericAnchor: "3.2 days", context: "Q3 average berth delay." },
  ],
};
function reviewedDataStorySourceLedger(ledgerTopic = topic) {
  const base = { ...dataStorySourceLedgerBase, topic: ledgerTopic };
  return {
    ...base,
    review: {
      decision: "approved" as const,
      reviewerId: "reviewer-data",
      reviewId: "review-data-port-delays",
      reviewedAt: new Date(now).toISOString(),
      reviewedLedgerFingerprint: dataStorySourceLedgerFingerprint(base),
    },
  };
}

const dataStorySourceLedger = reviewedDataStorySourceLedger();

function reviewedEvidenceVisualManifest(id: string): EvidenceVisualManifest {
  const sourceId = `source-${id}`;
  const base = {
    version: "evidence-visual-manifest/v1" as const,
    id,
    visualKind: "chart" as const,
    surface: "data_insert" as const,
    sources: [{
      id: sourceId,
      name: "Port Authority",
      url: "https://authority.example.org/port-delays",
      snapshotSha256: "c".repeat(64),
    }],
    narrationAnchors: [{
      id: `anchor-${id}`,
      sentenceId: "sentence-0001",
      startSec: 0,
      endSec: 12,
      spokenText: "According to the Port Authority, the delay moved from 4.1 days to 3.2 days.",
      requiredAttribution: "Port Authority",
      sourceIds: [sourceId],
    }],
    values: [
      { id: `value-${id}-start`, sourceId, narrationAnchorId: `anchor-${id}`, role: "series" as const, value: 4.1, unit: "days", display: "4.1 days" },
      { id: `value-${id}-end`, sourceId, narrationAnchorId: `anchor-${id}`, role: "series" as const, value: 3.2, unit: "days", display: "3.2 days" },
    ],
    attribution: { visibleText: "Port Authority", sourceIds: [sourceId] },
  };
  return {
    ...base,
    review: {
      decision: "approved",
      reviewerId: "reviewer-visual",
      reviewId: `review-${id}`,
      reviewedAt: new Date(now).toISOString(),
      reviewedManifestFingerprint: evidenceVisualManifestFingerprint(base),
    },
  };
}

const manifestAlpha = reviewedEvidenceVisualManifest("visual-alpha");
const manifestBeta = reviewedEvidenceVisualManifest("visual-beta");
const editorialEvidencePacket = reviewedEditorialPacket();

const binding = createReviewedEvidenceRouteBinding({
  route,
  topic,
  storySpine,
  episodeGraph,
  editorialEvidencePacket,
  evidenceVisualManifests: [manifestBeta, manifestAlpha],
  now,
});
const expectedEditorialBinding = {
  route,
  topic,
  storySpine,
  episodeGraph,
  editorialEvidencePacket,
  evidenceVisualManifests: [manifestAlpha, manifestBeta],
  now,
};

assert.equal(binding.version, REVIEWED_EVIDENCE_ROUTE_BINDING_VERSION);
assert.equal(binding.sourceAuthority.kind, "editorial_evidence_packet");
assert.deepEqual(
  binding.evidenceVisualManifestRefs.map((ref) => ref.id),
  ["visual-alpha", "visual-beta"],
  "manifest receipts must be deterministically sorted regardless of caller ordering",
);
assert.deepEqual(assertReviewedEvidenceRouteBinding(binding), binding);
assert.deepEqual(
  assertReviewedEvidenceRouteBindingMatches(binding, expectedEditorialBinding),
  binding,
);

assert.equal(storySpineFingerprint(storySpine), storySpineFingerprint(structuredClone(storySpine)));
assert.equal(
  reviewedEvidenceRouteTopicFingerprint(` ${topic} `),
  reviewedEvidenceRouteTopicFingerprint(topic),
  "authority topic joins use the same canonical normalized topic identity as the receipt",
);
const changedStorySpine = structuredClone(storySpine);
changedStorySpine.timedScript.sentences[0]!.text = "A different but still timed story sentence.";
assert.notEqual(
  storySpineFingerprint(changedStorySpine),
  storySpineFingerprint(storySpine),
  "the canonical spine fingerprint must cover timed narrative content, not merely shot IDs",
);

const wrongRoute = {
  ...structuredClone(route),
  context: { ...route.context, locale: "fr" },
};
assert.throws(
  () => assertReviewedEvidenceRouteBindingMatches(binding, { ...expectedEditorialBinding, route: wrongRoute }),
  /expected frozen route seed/,
);
assert.throws(
  () => assertReviewedEvidenceRouteBindingMatches(binding, { ...expectedEditorialBinding, topic: "Different port topic" }),
  /expected topic/,
);
assert.throws(
  () => assertReviewedEvidenceRouteBindingMatches(binding, { ...expectedEditorialBinding, storySpine: changedStorySpine }),
  /expected Story Spine/,
);
const wrongEpisodeGraph = structuredClone(episodeGraph);
wrongEpisodeGraph.topic = "Different port topic";
assert.throws(
  () => assertReviewedEvidenceRouteBindingMatches(binding, { ...expectedEditorialBinding, episodeGraph: wrongEpisodeGraph }),
  /expected Episode Graph/,
);

const routeFingerprintTamper = {
  ...structuredClone(binding),
  route: {
    ...binding.route,
    context: { ...binding.route.context, locale: "fr" },
  },
};
assert.throws(
  () => assertReviewedEvidenceRouteBinding(routeFingerprintTamper),
  /route seed fingerprint/,
  "the receipt must reject a changed full frozen seed before it trusts the outer binding fingerprint",
);

const firstManifestRef = binding.evidenceVisualManifestRefs[0];
assert.ok(firstManifestRef, "fixture needs one reviewed evidence visual manifest ref");
const unsortedManifestRefs = structuredClone(binding);
unsortedManifestRefs.evidenceVisualManifestRefs.reverse();
unsortedManifestRefs.bindingFingerprint = reviewedEvidenceRouteBindingFingerprint(unsortedManifestRefs);
assert.throws(
  () => assertReviewedEvidenceRouteBinding(unsortedManifestRefs),
  /must be sorted by id/,
);
const duplicateManifestRefs = structuredClone(binding);
duplicateManifestRefs.evidenceVisualManifestRefs = [firstManifestRef, firstManifestRef];
duplicateManifestRefs.bindingFingerprint = reviewedEvidenceRouteBindingFingerprint(duplicateManifestRefs);
assert.throws(
  () => assertReviewedEvidenceRouteBinding(duplicateManifestRefs),
  /repeats evidence visual manifest/,
);

const selfFingerprintedAuthorityTamper = structuredClone(binding);
selfFingerprintedAuthorityTamper.sourceAuthority.contentFingerprint = "d".repeat(64);
selfFingerprintedAuthorityTamper.bindingFingerprint = reviewedEvidenceRouteBindingFingerprint(selfFingerprintedAuthorityTamper);
assert.doesNotThrow(() => assertReviewedEvidenceRouteBinding(selfFingerprintedAuthorityTamper));
assert.throws(
  () => assertReviewedEvidenceRouteBindingMatches(selfFingerprintedAuthorityTamper, expectedEditorialBinding),
  /expected reviewed authority/,
  "later generic QA must compare the compact receipt back to a verified authority, not only trust a self-fingerprint",
);
const selfFingerprintedManifestTamper = structuredClone(binding);
selfFingerprintedManifestTamper.evidenceVisualManifestRefs[0]!.contentFingerprint = "e".repeat(64);
selfFingerprintedManifestTamper.bindingFingerprint = reviewedEvidenceRouteBindingFingerprint(selfFingerprintedManifestTamper);
assert.doesNotThrow(() => assertReviewedEvidenceRouteBinding(selfFingerprintedManifestTamper));
assert.throws(
  () => assertReviewedEvidenceRouteBindingMatches(selfFingerprintedManifestTamper, expectedEditorialBinding),
  /expected reviewed evidence visual manifests/,
);

assert.throws(
  () => createReviewedEvidenceRouteBinding({
    route,
    topic,
    storySpine,
    editorialEvidencePacket,
    dataStorySourceLedger,
  }),
  /exactly one reviewed authority/,
);
assert.throws(
  () => createReviewedEvidenceRouteBinding({ route, topic, storySpine }),
  /exactly one reviewed authority/,
);

const differentAuthorityTopic = "A different reviewed port topic";
const differentTopicEditorialEvidencePacket = reviewedEditorialPacket(differentAuthorityTopic);
assert.throws(
  () => createReviewedEvidenceRouteBinding({
    route,
    topic,
    storySpine,
    editorialEvidencePacket: differentTopicEditorialEvidencePacket,
    now,
  }),
  /editorial evidence packet subject does not match the receipt topic/,
  "a valid reviewed editorial packet for topic B must not bind a topic A receipt",
);
assert.throws(
  () => assertReviewedEvidenceRouteBindingMatches(binding, {
    ...expectedEditorialBinding,
    editorialEvidencePacket: differentTopicEditorialEvidencePacket,
  }),
  /editorial evidence packet subject does not match the receipt topic/,
  "the later matcher must reassert the editorial subject-to-topic join",
);

const dataLedgerBinding = createReviewedEvidenceRouteBinding({
  route,
  topic,
  storySpine,
  dataStorySourceLedger,
});
const expectedDataLedgerBinding = {
  route,
  topic,
  storySpine,
  dataStorySourceLedger,
  evidenceVisualManifests: [],
};
assert.equal(dataLedgerBinding.sourceAuthority.kind, "data_story_source_ledger");
assert.equal(dataLedgerBinding.episodeGraphFingerprint, undefined, "the graph remains a genuinely optional binding");
assert.doesNotThrow(() => assertReviewedEvidenceRouteBindingMatches(dataLedgerBinding, expectedDataLedgerBinding));
assert.throws(
  () => assertReviewedEvidenceRouteBindingMatches(dataLedgerBinding, { ...expectedDataLedgerBinding, episodeGraph }),
  /missing the expected Episode Graph/,
);
const differentTopicDataStorySourceLedger = reviewedDataStorySourceLedger(differentAuthorityTopic);
assert.throws(
  () => createReviewedEvidenceRouteBinding({
    route,
    topic,
    storySpine,
    dataStorySourceLedger: differentTopicDataStorySourceLedger,
  }),
  /data-story source ledger topic does not match the receipt topic/,
  "a valid reviewed data ledger for topic B must not bind a topic A receipt",
);
assert.throws(
  () => assertReviewedEvidenceRouteBindingMatches(dataLedgerBinding, {
    ...expectedDataLedgerBinding,
    dataStorySourceLedger: differentTopicDataStorySourceLedger,
  }),
  /data-story source ledger topic does not match the receipt topic/,
  "the later matcher must reassert the ledger topic-to-receipt join",
);

const tamperedEditorialEvidencePacket = structuredClone(editorialEvidencePacket);
tamperedEditorialEvidencePacket.claims[0]!.approvedText = "A substituted factual claim.";
assert.throws(
  () => createReviewedEvidenceRouteBinding({
    route,
    topic,
    storySpine,
    editorialEvidencePacket: tamperedEditorialEvidencePacket,
    now,
  }),
  /editorial evidence packet rejected/,
  "the binding may only be created from a currently reviewed authority",
);

// This is an editorial factual-provenance receipt, not a cross-policy escape
// hatch for fictional, Casefile, self-contained, or quiz routes.
const fictionalRoute = frozenRouteSeed({
  family: "illustrated_explainer",
  programIntent: { kind: "fictional_scenario", profile: "ai_town" },
});
assert.throws(
  () => createReviewedEvidenceRouteBinding({
    route: fictionalRoute,
    topic,
    storySpine,
    editorialEvidencePacket,
    now,
  }),
  /directives\.claimMode === editorial_lane_policy/,
  "fictional claim modes must not construct a factual/editorial provenance receipt",
);
const selfFingerprintedFictionalRoute = {
  ...structuredClone(binding),
  route: fictionalRoute,
  routeSeedFingerprint: channelProgramRouteRunSeedFingerprint(fictionalRoute),
};
selfFingerprintedFictionalRoute.bindingFingerprint = reviewedEvidenceRouteBindingFingerprint(selfFingerprintedFictionalRoute);
assert.throws(
  () => assertReviewedEvidenceRouteBinding(selfFingerprintedFictionalRoute),
  /directives\.claimMode === editorial_lane_policy/,
  "a self-fingerprinted non-editorial route must still fail intrinsic receipt parsing",
);
assert.throws(
  () => assertReviewedEvidenceRouteBindingMatches(selfFingerprintedFictionalRoute, {
    ...expectedEditorialBinding,
    route: fictionalRoute,
  }),
  /directives\.claimMode === editorial_lane_policy/,
  "the authority-aware matcher must inherit the same persisted-route exclusion",
);

console.log("Reviewed evidence route binding tests passed");
