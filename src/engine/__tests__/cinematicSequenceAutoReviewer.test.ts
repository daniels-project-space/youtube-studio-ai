import assert from "node:assert/strict";

import { RECONSTRUCTION_DISCLOSURE, casefileFingerprint } from "@/engine/casefile";
import {
  CASEFILE_EVIDENCE_SHOT_MAP_VERSION,
  assertCasefileEvidenceShotMap,
  casefileEvidenceShotMapContentFingerprint,
  casefileShotPlanFingerprint,
  type CasefileEvidenceShotMapInput,
} from "@/engine/casefileEvidenceShotMap";
import {
  CINEMATIC_CASE_SEQUENCE_VERSION,
  assertCinematicCaseSequence,
  cinematicCaseSequenceContentFingerprint,
  type CinematicCaseSequenceInput,
} from "@/engine/cinematicCaseSequence";
import {
  CINEMATIC_SEQUENCE_AUTO_REVIEWER_MIN_CONFIDENCE,
  CINEMATIC_SEQUENCE_AUTO_REVIEWER_REVIEWER_ID,
  autoReviewCinematicCaseSequence,
} from "@/engine/cinematicSequenceAutoReviewer";
import {
  CASEFILE_SOURCE_PACKET_VERSION,
  assertCasefileSourcePacket,
  casefileSourcePacketContentFingerprint,
  type CasefileSourcePacket,
} from "@/engine/sourceFirstAdmission";
import { createSourceBoundStorySpineHandoff } from "@/engine/sourceBoundStorySpine";
import { cinematicCaseSequenceBlocks } from "@/trigger/blocks/cinematicCaseSequenceBlocks";

const NOW = new Date("2026-08-14T12:00:00.000Z");

// Same fixture shape already proven valid against the real structural gate in
// cinematicCaseSequence.test.ts — only the editorialReview production path
// differs here (automated instead of hand-authored).
const sourcePacket: CasefileSourcePacket = {
  version: CASEFILE_SOURCE_PACKET_VERSION,
  caseId: "case-vault-closure",
  casePacket: {
    version: "casefile/v1",
    id: "case-vault-closure",
    title: "The Vault Closure",
    kind: "historical_heist",
    status: "historical_closed",
    sourceLedger: [{
      id: "source-court-archive",
      kind: "court_record",
      title: "Closure finding",
      publisher: "Regional Court Archive",
      locator: "https://court.example.org/records/vault-closure",
      excerpt: "The finding records the closure decision and the verified repair programme.",
      rights: {
        provenance: "licensed",
        visualUse: "visual_clearance_confirmed",
        evidenceLocator: "https://court.example.org/rights/vault-closure-license",
      },
    }],
    claims: [
      {
        id: "claim-closure-order",
        order: 10,
        text: "The court finding ordered the vault's closure.",
        state: "established",
        sourceIds: ["source-court-archive"],
        operationalRisk: "none",
      },
      {
        id: "claim-public-response",
        order: 20,
        text: "The documented closure prompted public response.",
        state: "established",
        sourceIds: ["source-court-archive"],
        operationalRisk: "contextual",
      },
    ],
    sensitivity: {
      activeAllegations: false,
      involvesMinors: false,
      includesGraphicDetail: false,
      actionableWrongdoing: false,
    },
    reconstruction: { mode: "illustrated_reconstruction", disclosureText: RECONSTRUCTION_DISCLOSURE },
  },
  claimPrimarySources: [
    {
      claimId: "claim-closure-order",
      sourceId: "source-court-archive",
      primarySourceUrl: "https://court.example.org/records/vault-closure",
      provenance: "court_record",
    },
    {
      claimId: "claim-public-response",
      sourceId: "source-court-archive",
      primarySourceUrl: "https://court.example.org/records/vault-closure",
      provenance: "court_record",
    },
  ],
  sourceUsage: [{
    sourceId: "source-court-archive",
    usage: "visual_media",
    assetId: "asset-court-closure-finding",
    rightsEvidenceLocator: "https://court.example.org/rights/vault-closure-license",
  }],
  editorialReview: {
    id: "editorial-review-vault-closure-001",
    decision: "approved",
    reviewerId: "reviewer-documentary-desk",
    reviewedAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1_000).toISOString(),
    reviewedPacketFingerprint: "0".repeat(64),
    reviewedSourcePacketFingerprint: "0".repeat(64),
  },
};
sourcePacket.editorialReview.reviewedPacketFingerprint = casefileFingerprint(sourcePacket.casePacket);
sourcePacket.editorialReview.reviewedSourcePacketFingerprint = casefileSourcePacketContentFingerprint(sourcePacket);

const sceneManifest = {
  version: "scene-manifest/v1" as const,
  durationSec: 24,
  scenes: [
    {
      id: "scene-closure-order",
      beatId: "beat-closure-order",
      t0: 0,
      t1: 12,
      kind: "claim" as const,
      label: "The court finding ordered the vault's closure.",
      characterIds: [],
      camera: { framing: "close" as const, move: "static" as const },
      visualState: { action: "A cited court document establishes the closure order.", props: ["file", "date"] },
      text: "The court finding ordered the vault's closure.",
      causalInputBeatIds: [],
      sourceRefs: ["source-court-archive"],
      transition: "cut" as const,
    },
    {
      id: "scene-public-response",
      beatId: "beat-public-response",
      t0: 12,
      t1: 24,
      kind: "result" as const,
      label: "The documented closure prompted public response.",
      characterIds: [],
      camera: { framing: "wide" as const, move: "pan" as const },
      visualState: { action: "A neutral timeline connects response dates.", props: ["timeline"] },
      text: "The documented closure prompted public response.",
      causalInputBeatIds: ["beat-closure-order"],
      sourceRefs: ["source-court-archive"],
      transition: "dissolve" as const,
    },
  ],
  fingerprint: "a".repeat(64),
  topic: "The Vault Closure",
  audience: "general" as const,
  seriesId: "series-vault-files",
  episodeId: "episode-vault-closure",
  renderer: "deterministic-scene/v1" as const,
  externalProviderCalls: 0 as const,
};

const shotList = [
  {
    id: "shot-closure-order",
    beatId: "beat-closure-order",
    sourceSentenceIds: ["sentence-closure-order"],
    t0: 0,
    t1: 12,
    coveragePurpose: "Show the court finding as a cited document abstraction.",
    literalContent: "A neutral court-record document abstraction with a visible citation.",
    entities: [], era: "historical", wardrobe: [], props: ["court document"], continuityState: "case-file-neutral",
    cameraMove: "static" as const, shotScale: "close" as const, lens: "50mm", lighting: "soft neutral archive light",
    motion: "subtle document parallax", negative: "no gore, no likeness, no text", generationProfile: "production" as const,
    candidateCount: 1, imageMinScore: 0.8, shotMinScore: 0.8,
    prompt: "Neutral court-record document abstraction with cited provenance.", seconds: 12, storyFunction: "evidence", section: "closure", seed: 1,
  },
  {
    id: "shot-public-response",
    beatId: "beat-public-response",
    sourceSentenceIds: ["sentence-public-response"],
    t0: 12,
    t1: 24,
    coveragePurpose: "Show a cited public-response timeline.",
    literalContent: "A neutral timeline connecting the documented response dates.",
    entities: [], era: "historical", wardrobe: [], props: ["timeline"], continuityState: "case-file-neutral",
    cameraMove: "truck_right" as const, shotScale: "wide" as const, lens: "35mm", lighting: "neutral archive light",
    motion: "slow timeline reveal", negative: "no gore, no likeness, no text", generationProfile: "production" as const,
    candidateCount: 1, imageMinScore: 0.8, shotMinScore: 0.8,
    prompt: "Neutral cited timeline of documented public response.", seconds: 12, storyFunction: "context", section: "response", seed: 2,
  },
];

const admittedSource = assertCasefileSourcePacket(sourcePacket, { now: NOW });

function admittedMap() {
  const input: CasefileEvidenceShotMapInput = {
    version: CASEFILE_EVIDENCE_SHOT_MAP_VERSION,
    caseId: sourcePacket.caseId,
    sourcePacketFingerprint: admittedSource.receipt.sourcePacketFingerprint,
    sceneManifestFingerprint: sceneManifest.fingerprint,
    shotPlanFingerprint: casefileShotPlanFingerprint(shotList),
    visualSafetyPolicy: { noGore: true, noUnsupportedRecreation: true },
    claimMappings: [
      {
        claimId: "claim-closure-order",
        bindings: [
          { sceneIds: ["scene-closure-order"], shotIds: ["shot-closure-order"], treatment: "document_abstraction", sourceIds: ["source-court-archive"], onScreenCitation: true },
          { sceneIds: ["scene-closure-order"], shotIds: ["shot-closure-order"], treatment: "neutral_reenactment", sourceIds: ["source-court-archive"], onScreenCitation: true, reconstructionDisclosure: RECONSTRUCTION_DISCLOSURE },
        ],
      },
      {
        claimId: "claim-public-response",
        bindings: [{ sceneIds: ["scene-public-response"], shotIds: ["shot-public-response"], treatment: "timeline", sourceIds: ["source-court-archive"], onScreenCitation: true }],
      },
    ],
    editorialReview: {
      id: "evidence-shot-review-vault-closure-001",
      decision: "approved",
      reviewerId: "reviewer-documentary-desk",
      reviewedAt: new Date(NOW.getTime() - 60 * 60 * 1_000).toISOString(),
      reviewedSourcePacketFingerprint: admittedSource.receipt.sourcePacketFingerprint,
      reviewedShotMapFingerprint: "0".repeat(64),
    },
  };
  input.editorialReview.reviewedShotMapFingerprint = casefileEvidenceShotMapContentFingerprint(input);
  return assertCasefileEvidenceShotMap({ input, sourcePacket, sourceAdmission: admittedSource.receipt, sceneManifest, shotList }, { now: NOW });
}

/** Mirrors cinematicCaseSequence.test.ts's provider-free source-bound bridge
 * fixture, needed only for the human-draft-present regression test below,
 * which exercises the real "cinematic_case_sequence" trigger block. */
function sourceBoundStorySpineFor(map: ReturnType<typeof admittedMap>) {
  const storySpine = {
    version: "1.0.0" as const,
    timedScript: {
      version: "1.0.0" as const,
      narrationDurationSec: 24,
      sentences: [
        { id: "sentence-closure-order", text: "The court finding ordered the vault's closure.", t0: 0, t1: 12, sectionId: "section-closure", evidenceRefs: ["source-court-archive"] },
        { id: "sentence-public-response", text: "The documented closure prompted public response.", t0: 12, t1: 24, sectionId: "section-response", evidenceRefs: ["source-court-archive"] },
      ],
    },
    narrativeBeats: [
      { id: "beat-closure-order", sourceSentenceIds: ["sentence-closure-order"], t0: 0, t1: 12, purpose: "Establish the cited closure order.", evidenceRefs: ["source-court-archive"] },
      { id: "beat-public-response", sourceSentenceIds: ["sentence-public-response"], t0: 12, t1: 24, purpose: "Show the documented public response.", evidenceRefs: ["source-court-archive"] },
    ],
    continuityLedger: {
      version: "1.0.0" as const,
      entities: [], locations: [], era: "historical", wardrobe: [], props: ["court document", "timeline"],
      palette: ["charcoal", "ash"], cameraGrammar: ["restrained"], negativeConstraints: ["no likeness", "no gore"],
    },
    shotList,
    dpVisualSpecs: shotList.map((shot) => ({
      shotId: shot.id, keyframePrompt: shot.prompt, motionPrompt: shot.motion, negativePrompt: shot.negative,
      styleLock: "case-file-neutral", firstFrameConstraint: `Start at ${shot.t0}s.`, lastFrameConstraint: `End at ${shot.t1}s.`,
      continuityState: shot.continuityState,
    })),
    editorEdl: {
      version: "1.0.0" as const,
      durationSec: 24,
      shots: shotList.map((shot) => ({ shotId: shot.id, sourceSentenceIds: shot.sourceSentenceIds, t0: shot.t0, t1: shot.t1 })),
    },
    coverage: { mappedSec: 24, totalSec: 24, ratio: 1, gaps: [] },
  };
  return createSourceBoundStorySpineHandoff({
    sourcePacket,
    sourceAdmission: admittedSource.receipt,
    evidenceShotMap: map.map,
    evidenceShotMapAdmission: map.receipt,
    storySpine,
    now: NOW,
  });
}

function coverageShot(args: {
  id: string; t0: number; t1: number; purpose: "spatial_anchor" | "mannequin_action" | "relationship" | "evidence_insert" | "contradiction" | "consequence" | "reaction" | "aftermath";
  mode: "source_proof" | "spatial_reconstruction" | "abstract_reenactment" | "atmosphere";
  scale: "wide" | "medium" | "close" | "extreme_close" | "establishing"; move: "static" | "dolly_push" | "dolly_pull" | "crane_up" | "crane_down" | "orbit_left" | "orbit_right" | "truck_left" | "truck_right" | "handheld_drift";
  cut: "new_fact" | "new_location" | "new_relationship" | "physical_action" | "contradiction" | "reveal" | "breath";
  tension: "question" | "orientation" | "pressure" | "uncertainty" | "reversal" | "release" | "residue"; cast?: string[];
}) {
  return {
    id: args.id, t0: args.t0, t1: args.t1, coveragePurpose: args.purpose, visualMode: args.mode, castIds: args.cast ?? [],
    cameraMove: args.move, shotScale: args.scale, lens: args.scale === "close" ? "85mm" : "35mm", cutReason: args.cut, tensionState: args.tension,
    cameraRationale: `A motivated ${args.move} communicates ${args.cut}.`, narrationPurpose: `Make the narrated ${args.purpose.replaceAll("_", " ")} concrete.`,
    still: `A controlled, cinematic, faceless documentary frame for ${args.purpose}; no likeness, no gore, no baked text.`,
    motion: `A restrained ${args.move} with locked wardrobe, silhouette, prop, setting, and lighting.`,
    negative: "identifiable face, real-person likeness, gore, sensational violence, text, logo, watermark, broken anatomy",
    firstFrameConstraint: "Start from the exact cited story state with the same wardrobe and prop.",
    lastFrameConstraint: "End with only motivated action advanced; preserve wardrobe and setting continuity.",
    onScreenCitation: true as const,
    ...(args.mode === "abstract_reenactment" ? { reconstructionDisclosure: RECONSTRUCTION_DISCLOSURE } : {}),
  };
}

function approvedSequence(map: ReturnType<typeof admittedMap>): CinematicCaseSequenceInput {
  const input: CinematicCaseSequenceInput = {
    version: CINEMATIC_CASE_SEQUENCE_VERSION,
    sequenceId: "cinematic-sequence-vault-closure-001",
    caseId: sourcePacket.caseId,
    sourcePacketFingerprint: admittedSource.receipt.sourcePacketFingerprint,
    evidenceShotMapFingerprint: map.map.contentFingerprint,
    sceneManifestFingerprint: sceneManifest.fingerprint,
    shotPlanFingerprint: casefileShotPlanFingerprint(shotList),
    cast: [{
      id: "mannequin-investigator", role: "investigator", silhouette: "tall square-shouldered faceless silhouette",
      wardrobeSignature: "charcoal wool coat, ash scarf, worn leather folio", palette: ["charcoal", "ash"], keyProp: "sealed court folio",
      movementProfile: "deliberate measured gait and restrained hand movement", faceless: true, noLikeness: true,
    }],
    beats: [
      {
        id: "cinematic-beat-closure-order", narrativeRole: "cold_open", t0: 0, t1: 12, parentShotIds: ["shot-closure-order"],
        claimIds: ["claim-closure-order"], sourceIds: ["source-court-archive"], causalQuestion: "Why did a single court order close the vault?",
        shots: [
          coverageShot({ id: "cinematic-shot-closure-proof", t0: 0, t1: 4, purpose: "evidence_insert", mode: "source_proof", scale: "close", move: "static", cut: "new_fact", tension: "question" }),
          coverageShot({ id: "cinematic-shot-closure-figure", t0: 4, t1: 8, purpose: "mannequin_action", mode: "abstract_reenactment", scale: "medium", move: "dolly_push", cut: "physical_action", tension: "pressure", cast: ["mannequin-investigator"] }),
          coverageShot({ id: "cinematic-shot-closure-space", t0: 8, t1: 12, purpose: "spatial_anchor", mode: "spatial_reconstruction", scale: "establishing", move: "crane_up", cut: "new_location", tension: "uncertainty" }),
        ],
      },
      {
        id: "cinematic-beat-public-response", narrativeRole: "reveal", t0: 12, t1: 24, parentShotIds: ["shot-public-response"],
        claimIds: ["claim-public-response"], sourceIds: ["source-court-archive"], causalQuestion: "What did the documented response reveal about the closure?",
        storyPayoff: {
          coldOpenBeatId: "cinematic-beat-closure-order",
          answerOrReframe: "The cited public response reframes the closure as a documented consequence rather than an unexplained disappearance.",
          citedClaimIds: ["claim-public-response"],
          citedSourceIds: ["source-court-archive"],
        },
        shots: [
          coverageShot({ id: "cinematic-shot-response-proof", t0: 12, t1: 16, purpose: "evidence_insert", mode: "source_proof", scale: "close", move: "truck_right", cut: "reveal", tension: "reversal" }),
          coverageShot({ id: "cinematic-shot-response-map", t0: 16, t1: 20, purpose: "spatial_anchor", mode: "spatial_reconstruction", scale: "wide", move: "orbit_left", cut: "new_relationship", tension: "release" }),
          coverageShot({ id: "cinematic-shot-response-aftermath", t0: 20, t1: 24, purpose: "aftermath", mode: "atmosphere", scale: "establishing", move: "dolly_pull", cut: "breath", tension: "residue" }),
        ],
      },
    ],
    editorialReview: {
      id: "cinematic-sequence-review-vault-closure-001", decision: "approved", reviewerId: "reviewer-documentary-desk",
      reviewedAt: new Date(NOW.getTime() - 20 * 60 * 1_000).toISOString(),
      reviewedSourcePacketFingerprint: admittedSource.receipt.sourcePacketFingerprint,
      reviewedEvidenceShotMapFingerprint: map.map.contentFingerprint,
      reviewedSequenceFingerprint: "0".repeat(64),
    },
  };
  input.editorialReview.reviewedSequenceFingerprint = cinematicCaseSequenceContentFingerprint(input);
  return input;
}

function approvingFindings(content: { beats: CinematicCaseSequenceInput["beats"] }) {
  return content.beats.flatMap((beat) => beat.shots).map((shot) => ({
    shotId: shot.id,
    compliant: true,
    reason: "Faceless mannequin discipline and wardrobe distinctness confirmed in the written prompt.",
  }));
}

function anthropicResponse(verdict: unknown) {
  return new Response(
    JSON.stringify({
      id: "msg-cinematic-sequence-auto-reviewer-test",
      content: [{ type: "text", text: JSON.stringify(verdict) }],
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

async function main(): Promise<void> {
  const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const previousAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const previousModel = process.env.ANTHROPIC_CREATIVE_PRO_MODEL;
  const originalFetch = global.fetch;
  try {
    // Force the plain Anthropic-messages code path (not OpenRouter) so the
    // mocked fetch below has a single, predictable request shape to assert on.
    delete process.env.OPENROUTER_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.ANTHROPIC_CREATIVE_PRO_MODEL = "claude-cinematic-sequence-auto-reviewer-test";

    const map = admittedMap();
    const fullInput = approvedSequence(map);
    const { editorialReview: _humanReview, ...content } = fullInput;
    const baseArgs = (candidateContent: typeof content) => ({
      content: candidateContent,
      sourceAdmission: admittedSource.receipt,
      evidenceShotMap: map.map,
      evidenceShotMapAdmission: map.receipt,
      sceneManifest,
      shotList,
      now: NOW,
    });

    // --- 1) All gates pass: the auto-reviewer produces a correctly
    // fingerprint-bound editorial review. This is the real integration proof:
    // feed it back through cinematicCaseSequence.ts's UNMODIFIED
    // assertCinematicCaseSequence and confirm it independently re-admits.
    global.fetch = (async () => anthropicResponse({
      pass: true,
      confidence: 0.92,
      issues: [],
      findings: approvingFindings(content),
    })) as typeof fetch;
    const autoReview = await autoReviewCinematicCaseSequence(baseArgs(content));
    assert.equal(autoReview.reviewerId, CINEMATIC_SEQUENCE_AUTO_REVIEWER_REVIEWER_ID);
    assert.equal(autoReview.decision, "approved");
    assert.equal(autoReview.reviewedSourcePacketFingerprint, admittedSource.receipt.sourcePacketFingerprint);
    assert.equal(autoReview.reviewedEvidenceShotMapFingerprint, map.map.contentFingerprint);
    assert.equal(autoReview.reviewedSequenceFingerprint, cinematicCaseSequenceContentFingerprint(content));

    const admitted = assertCinematicCaseSequence(
      {
        input: { ...content, editorialReview: autoReview },
        sourceAdmission: admittedSource.receipt,
        evidenceShotMap: map.map,
        evidenceShotMapAdmission: map.receipt,
        sceneManifest,
        shotList,
      },
      { now: NOW },
    );
    assert.equal(admitted.receipt.release, "private_human_editorial_review_only");
    assert.equal(admitted.receipt.requiresHumanEditorialReview, true);
    assert.equal(admitted.generatedScenePlan.scenes.length, 6);

    // --- 2) A structurally unsafe candidate must fail closed WITHOUT ever
    // reaching the provider — the real evaluateCinematicCaseSequence gate is
    // the hard prerequisite, not a suggestion.
    let unexpectedCall = false;
    global.fetch = (async () => {
      unexpectedCall = true;
      throw new Error("must not call a provider when structural admission already failed");
    }) as typeof fetch;
    const mangledContent = structuredClone(content);
    mangledContent.beats[0]!.shots[1]!.castIds = ["mannequin-ghost"];
    await assert.rejects(
      () => autoReviewCinematicCaseSequence(baseArgs(mangledContent)),
      /structural admission failed, refusing to auto-approve/,
    );
    assert.equal(unexpectedCall, false, "a structurally unsafe candidate must never reach the provider");

    // --- 3) Missing provider key fails closed.
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    await assert.rejects(
      () => autoReviewCinematicCaseSequence(baseArgs(content)),
      /no permitted provider is configured/,
    );
    process.env.ANTHROPIC_API_KEY = "test-key";

    // --- 4) A malformed/incomplete verdict (missing a finding) is not an
    // implicit pass on the missing shot.
    global.fetch = (async () => anthropicResponse({
      pass: true,
      confidence: 0.95,
      issues: [],
      findings: [approvingFindings(content)[0]],
    })) as typeof fetch;
    await assert.rejects(
      () => autoReviewCinematicCaseSequence(baseArgs(content)),
      /provider returned a malformed or incomplete verdict/,
    );

    // --- 5) A verdict claiming pass:true below the confidence floor must
    // still fail closed — pass alone is never sufficient.
    global.fetch = (async () => anthropicResponse({
      pass: true,
      confidence: CINEMATIC_SEQUENCE_AUTO_REVIEWER_MIN_CONFIDENCE - 0.1,
      issues: [],
      findings: approvingFindings(content),
    })) as typeof fetch;
    await assert.rejects(
      () => autoReviewCinematicCaseSequence(baseArgs(content)),
      /automated review did not approve/,
    );

    // --- 6) A single non-compliant shot finding fails closed even though the
    // provider's overall pass flag claims true.
    global.fetch = (async () => {
      const findings = approvingFindings(content);
      findings[0]!.compliant = false;
      findings[0]!.reason = "Motion prompt requests a visible identifiable face.";
      return anthropicResponse({ pass: true, confidence: 0.95, issues: [], findings });
    }) as typeof fetch;
    await assert.rejects(
      () => autoReviewCinematicCaseSequence(baseArgs(content)),
      /automated review did not approve/,
    );

    // --- 7) Provider transport failure fails closed.
    global.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "upstream outage" } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    await assert.rejects(
      () => autoReviewCinematicCaseSequence(baseArgs(content)),
      /cinematic sequence auto-reviewer: provider call failed/,
    );

    // --- 8) REGRESSION: the human-draft-present path in the real
    // "cinematic_case_sequence" trigger block must be entirely unaffected.
    // Strip every provider key and make fetch throw, so the block would fail
    // loudly if it mistakenly invoked the auto-reviewer; it must still
    // succeed because a human editorialReview is already bound onto the
    // stored cinematicCaseSequenceInput.
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    global.fetch = (async () => {
      throw new Error("auto-reviewer must never run when a human editorialReview is already present");
    }) as typeof fetch;

    const sourceBoundStorySpine = sourceBoundStorySpineFor(map);
    const admissionBlock = cinematicCaseSequenceBlocks.find((block) => block.id === "cinematic_case_sequence");
    assert.ok(admissionBlock, "the cinematic route must expose its admission stage");
    const logs: string[] = [];
    const patch = await admissionBlock.run({
      ownerId: "owner-test",
      runId: "run-cinematic-sequence-auto-reviewer-regression",
      channelId: "channel-test",
      keyPrefix: "owner/owner-test/channel/channel-test/",
      params: {},
      store: {
        casefileSourceAdmission: admittedSource.receipt,
        casefileEvidenceShotMap: map.map,
        casefileEvidenceShotMapAdmission: map.receipt,
        sourceBoundStorySpine,
        cinematicCaseSequenceInput: fullInput,
        sceneManifest,
        shotList,
      },
      budgetUsd: 0,
      log: (message: string) => logs.push(message),
    });
    assert.ok(patch.cinematicCaseSequenceAdmission, "the human-reviewed path must still admit the sequence unchanged");
    assert.ok(
      logs.some((line) => line.includes("cinematic_case_sequence:")),
      "the unmodified admission block must still run and log normally",
    );

    console.log("cinematic sequence auto-reviewer tests passed");
  } finally {
    global.fetch = originalFetch;
    if (previousOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
    if (previousAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropicKey;
    if (previousModel === undefined) delete process.env.ANTHROPIC_CREATIVE_PRO_MODEL;
    else process.env.ANTHROPIC_CREATIVE_PRO_MODEL = previousModel;
  }
}

main().catch((error) => {
  throw error;
});
