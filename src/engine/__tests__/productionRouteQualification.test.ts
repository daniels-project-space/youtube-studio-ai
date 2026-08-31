import assert from "node:assert/strict";

import { buildChannelInceptionPlan } from "@/engine/channelInceptionPlan";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { resolveChannelProgramRoute } from "@/engine/channelProgramRoute";
import { createChannelShowProfile } from "@/engine/channelShowProfile";
import { designPipeline, type DesignOptions } from "@/engine/designer";
import {
  PRODUCTION_ROUTE_QUALIFICATION_VERSION,
  assessProductionRouteQualification,
  assertProductionRouteQualificationBinding,
  assertProductionRouteQualified,
  parseProductionRouteQualification,
  readProductionRouteInceptionEvidence,
  readProductionRoutePlannerEvidence,
  readProductionRouteProvenanceEvidence,
  readProductionRouteQualificationBinding,
  readProductionRouteQualityEvidence,
  readProductionRouteRuntimeEvidence,
  readProductionRouteVisualMatterEvidence,
  productionRouteQualificationBindingFingerprint,
} from "@/engine/productionRouteQualification";
import { buildQualityEvidence } from "@/engine/qualityEvidence";
import { planVisualMatter } from "@/engine/visualMatter";

const digest = (char: string): string => char.repeat(64);

function shortFormFixture() {
  const programBrief = createChannelProgramBrief({
    family: "shorts",
    nicheKey: "educational",
    subcategory: "how-to-tutorials",
    locale: "en",
    concept: "Explain difficult everyday systems in a concise visual story.",
    audience: "Curious adults who want practical explanations without noise.",
    sampleTopics: ["How compound interest compounds over time"],
  });
  const programRoute = resolveChannelProgramRoute(programBrief);
  const options: DesignOptions = {
    family: "shorts",
    nicheKey: "educational",
    programBrief,
    programRoute,
    lengthMinutes: 1,
  };
  const design = designPipeline(options);
  const showProfile = createChannelShowProfile({
    programBrief,
    programRoute,
    pipeline: design.pipeline,
  });
  const binding = readProductionRouteQualificationBinding({
    programBrief,
    programRoute,
    showProfile,
    pipeline: design.pipeline,
  });
  const planner = readProductionRoutePlannerEvidence({ binding, options });
  const plan = buildChannelInceptionPlan({
    ownerId: "owner-route-qualification",
    channelRef: "channel-route-qualification",
    name: "Clear Systems",
    slug: "clear-systems",
    family: "shorts",
    nicheKey: "educational",
    sourceRevision: "route-qualification-test/v1",
    pipelineSourceFingerprint: binding.pipelineFingerprint,
    programBrief,
    programRoute,
    showProfile,
    includeProbe: false,
  });
  const inception = readProductionRouteInceptionEvidence({ binding, plan });
  const runtime = readProductionRouteRuntimeEvidence({
    binding,
    planner,
    pipeline: design.pipeline,
  });
  const qualityReceipt = buildQualityEvidence({
    episode: {
      lane: { key: "short_form", renderer: "stock_footage" },
      topic: "How compound interest compounds over time",
      title: "Compound Interest, Visualized",
      durationSec: design.episodeLengthSeconds,
      story: {
        source: "self-contained-short-plan/v1",
        beatCount: 4,
        shotCount: 8,
        coverageRatio: 1,
      },
    },
    technical: { passed: true, evaluator: "render-validator", evidence: ["Valid master streams."] },
    visual: { score: 8.3, minimumScore: 7, evaluator: "visual-review", evidence: ["Frames meet the short-form visual rubric."] },
    temporal: { passed: true, evaluator: "timing-review", evidence: ["Every beat is paced and legible."] },
    narrative: { passed: true, evaluator: "story-review", evidence: ["Every claim maps to the teaching sequence."] },
    audio: { score: 8, minimumScore: 7, evaluator: "audio-aesthetics", evidence: ["Voice and music mix meet the rubric."] },
    brand: { passed: true, evaluator: "identity-review", evidence: ["The short-form identity remains coherent."] },
    requiredAudio: { required: true, minimumScore: 7, label: "audio aesthetics" },
  });
  const quality = readProductionRouteQualityEvidence({ binding, qualityEvidence: qualityReceipt });
  const provenance = readProductionRouteProvenanceEvidence({
    binding,
    quality,
    claim: {
      version: "video-release-provenance/v1",
      releaseCertificateKey: "owners/owner-route-qualification/runs/run-1/release-certificate.json",
      releaseCertificateFingerprint: digest("a"),
      finalMasterSha256: digest("b"),
      qualityBindingVersion: "final-master-quality-evidence-binding/v1",
      qualityBindingFingerprint: digest("c"),
      qualityEvidenceFingerprint: quality.qualityEvidenceFingerprint,
      contentLaneKey: "short_form",
      renderer: "stock_footage",
      programRoute: {
        routeFingerprint: binding.route.fingerprint,
        family: "shorts",
        contentLaneKey: "short_form",
        programBriefFingerprint: binding.programBrief.fingerprint,
      },
      evidenceStatus: "complete",
      storyMeasurementCoverage: "plan_only",
    },
  });
  const visualMatter = readProductionRouteVisualMatterEvidence({ binding });
  return { binding, planner, inception, runtime, quality, provenance, visualMatter };
}

const shortForm = shortFormFixture();
assert.equal(shortForm.runtime.ready, true, "short form must use the actual non-video runtime assessment");
assert.equal(shortForm.quality.ready, true, "quality reader must require a complete editorial receipt");
assert.equal(shortForm.provenance.ready, true, "provenance reader must bind route, brief, lane, and quality evidence");

const qualified = assessProductionRouteQualification(shortForm);
assert.equal(qualified.status, "qualified");
assert.equal(qualified.automaticReady, true);
assert.doesNotThrow(() => assertProductionRouteQualified(shortForm));

const supervisedReview = assessProductionRouteQualification({
  ...shortForm,
  mode: "supervised",
});
assert.equal(supervisedReview.status, "supervised_review");
assert.equal(supervisedReview.automaticReady, false, "supervised review never masquerades as automatic qualification");

assert.equal(
  assessProductionRouteQualification({}).status,
  "blocked",
  "missing proof must fail closed rather than default to an eligible route",
);
assert.throws(
  () => parseProductionRouteQualification({ ...qualified, automaticReady: false }),
  /qualified status|fingerprint/i,
  "a stored qualification cannot be changed with an unsealed ready flag",
);

const routeLessProvenance = readProductionRouteProvenanceEvidence({
  binding: shortForm.binding,
  quality: shortForm.quality,
  claim: {
    version: "video-release-provenance/v1",
    releaseCertificateKey: "owners/owner-route-qualification/runs/run-2/release-certificate.json",
    releaseCertificateFingerprint: digest("d"),
    finalMasterSha256: digest("e"),
    qualityBindingVersion: "final-master-quality-evidence-binding/v1",
    qualityBindingFingerprint: digest("f"),
    qualityEvidenceFingerprint: shortForm.quality.qualityEvidenceFingerprint,
    contentLaneKey: "short_form",
    renderer: "stock_footage",
    evidenceStatus: "complete",
  },
});
assert.equal(routeLessProvenance.ready, false, "final-master provenance without the exact route is not eligible evidence");
assert.ok(routeLessProvenance.blockers.some((entry) => /route and program-brief/i.test(entry)));

// Cinematic currently remains route-supervised. This sealed fixture exercises
// only the future-route compatibility reader; it is not a certified admission
// and is never passed to the automatic qualification assertion above.
const cinematicBindingBody = {
  version: PRODUCTION_ROUTE_QUALIFICATION_VERSION,
  family: "cinematic" as const,
  contentLaneKey: "cinematic_ai",
  programBrief: {
    version: "channel-program-brief/v1",
    catalogFingerprint: digest("1"),
    fingerprint: digest("2"),
  },
  showProfile: {
    version: "channel-show-profile/v1",
    fingerprint: digest("3"),
    designedPipelineFingerprint: digest("4"),
  },
  route: {
    version: "channel-program-route/v1",
    key: "cinematic/private-review/v1",
    admission: "supervised_private" as const,
    definitionVersion: 1,
    definitionFingerprint: digest("5"),
    fingerprint: digest("6"),
  },
  composition: {
    kind: "exact_catalog_v1" as const,
    version: "channel-composition-receipt/v1",
    key: "cinematic-private-review",
    definitionVersion: "v1",
    definitionFingerprint: digest("7"),
    fingerprint: digest("8"),
    selectedCapabilityKeys: [],
  },
  pipelineFingerprint: digest("9"),
};
const cinematicBinding = assertProductionRouteQualificationBinding({
  ...cinematicBindingBody,
  bindingFingerprint: productionRouteQualificationBindingFingerprint(cinematicBindingBody),
});
const visualMatterManifest = planVisualMatter({
  topic: "The first practical clockwork escape",
  channelName: "Clockwork Stories",
  continuityLedger: {
    version: "1.0.0",
    entities: [{ id: "maker", name: "The Maker", look: "a brick-built watchmaker in a blue work apron" }],
    locations: [{ id: "shop", name: "Workshop", look: "warm brass-and-wood clock workshop" }],
    era: "18th century",
    wardrobe: ["blue work apron"],
    props: ["brass gears"],
    palette: ["brass", "cobalt", "warm wood"],
    cameraGrammar: ["slow dolly push"],
    negativeConstraints: ["text", "watermarks"],
  },
  narrativeBeats: [{
    id: "beat-1",
    sourceSentenceIds: ["sentence-1"],
    t0: 0,
    t1: 5,
    purpose: "show the watchmaker testing the first escape",
    evidenceRefs: ["script:1"],
  }],
  shotList: [{
    id: "shot-1",
    beatId: "beat-1",
    sourceSentenceIds: ["sentence-1"],
    t0: 0,
    t1: 5,
    coveragePurpose: "show the mechanism working",
    literalContent: "The Maker gently tests a brass clockwork escape.",
    entities: ["maker"],
    locationId: "shop",
    era: "18th century",
    wardrobe: ["blue work apron"],
    props: ["brass gears"],
    continuityState: "maker and workshop remain unchanged",
    cameraMove: "dolly_push",
    shotScale: "medium",
    lens: "35mm natural",
    lighting: "warm workshop practicals",
    motion: "The Maker tests the gear train.",
    negative: "text, watermarks",
    generationProfile: "production",
    candidateCount: 2,
    imageMinScore: 0.8,
    shotMinScore: 0.8,
    prompt: "Brick-built watchmaker tests a clockwork escape.",
    seconds: 5,
    storyFunction: "hook",
    section: "section-1",
    seed: 1,
  }],
  dpVisualSpecs: [{
    shotId: "shot-1",
    keyframePrompt: "Brick-built watchmaker and clockwork escape in warm workshop.",
    motionPrompt: "Slow dolly as the maker tests the mechanism.",
    negativePrompt: "text, watermarks",
    styleLock: "brick-built cobalt and brass",
    firstFrameConstraint: "The Maker holds the escape at 0 seconds.",
    lastFrameConstraint: "The gear train has visibly moved by 5 seconds.",
    continuityState: "maker and workshop remain unchanged",
  }],
});
const visualMatter = readProductionRouteVisualMatterEvidence({
  binding: cinematicBinding,
  required: true,
  manifest: visualMatterManifest,
  shotIds: ["shot-1"],
});
assert.equal(visualMatter.status, "planned_controls");
assert.equal(visualMatter.controls.length, 1);
assert.throws(
  () => readProductionRouteVisualMatterEvidence({
    binding: cinematicBinding,
    required: true,
    requiresAnchoredReferenceAssets: true,
    manifest: visualMatterManifest,
  }),
  /anchored/i,
  "a planned prompt lock must not claim to be byte-bound reference-image control",
);

console.log("PRODUCTION ROUTE QUALIFICATION TESTS PASS");
