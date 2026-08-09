import assert from "node:assert/strict";
import {
  buildDocumentaryCollageShortStrategy,
  docuPlanForDocumentaryCollageShort,
  evaluateDocumentaryShortSceneQa,
  mineDocumentarySpinoffCandidates,
  shortRetentionManifestForStrategy,
} from "../documentaryCollageShort";

const narration = [
  "In 1911 a single decision set an entire city on a path nobody expected, and the first clue was hiding in plain sight.",
  "The official story sounded simple, but the records show a chain of small choices that changed who held the power.",
  "Each new document added pressure, because witnesses described the same turning point from very different positions inside the room.",
  "Then the evidence moved from rumor to proof when a forgotten ledger connected the money, the schedule, and the missing name.",
  "That connection reversed the conclusion historians had repeated for decades and forced the central figure into a different role.",
  "The payoff is not a twist for its own sake, but a clearer explanation of why the city remembered the event so differently.",
  "Look closely at the source trail, because the most useful lesson is how quickly a confident story can change when evidence arrives.",
].join(" ");

const claimEvidence = Array.from({ length: 7 }, (_, index) => ({
  claimId: `claim:${index + 1}`,
  sourceId: "source:archive",
  excerpt: `City archive record supports documentary beat ${index + 1}.`,
  locator: `folio ${index + 1}`,
}));

function run(): void {
  const manifest = buildDocumentaryCollageShortStrategy({
    runId: "run:docu-short-test",
    channelId: "channel:test",
    topic: "The overlooked decision that changed a city",
    narrationText: narration,
    targetDurationSec: 52,
    sources: [{
      id: "source:archive",
      type: "archive",
      title: "City archive record",
      citation: "City archive record, 1911.",
      url: "https://example.com/city-archive-1911",
      publisher: "City Archive",
    }],
    claimEvidence,
  });

  assert.equal(manifest.strategy.origin, "direct_short");
  assert.equal(manifest.strategy.aspectRatio, "9:16");
  assert.equal(manifest.beats.length, 7);
  assert.equal(manifest.beats[0].timing.startSec, 0);
  assert.equal(manifest.beats.at(-1)?.timing.endSec, 52);
  assert.equal(manifest.qa.plan.sceneChecks.length, 7);

  const plan = docuPlanForDocumentaryCollageShort(manifest);
  assert.equal(plan.shots.length, 7);
  assert.equal(plan.shots[0].kind, "parallax_portrait");
  assert.equal(plan.shots.at(-1)?.kind, "quote_card");
  assert.ok(plan.shots.every((shot) => shot.durationSec >= 3 && shot.durationSec <= 10));
  assert.ok(
    plan.shots.every((shot, index) => shot.assets?.some((asset) => asset.id === manifest.assets[index]?.id)),
    "each beat must carry its exact manifest asset id into the renderer plan",
  );

  const retention = shortRetentionManifestForStrategy(manifest);
  assert.equal(retention.lane, "documentary_collage_short");
  assert.equal(retention.beats.length, 7);
  assert.equal(retention.beats[0].startFrame, 0);

  const qa = evaluateDocumentaryShortSceneQa({
    manifest,
    width: 1080,
    height: 1920,
    layout: "short",
    durationSec: retention.durationSec,
    beatWindows: manifest.beats.map((beat) => ({ id: beat.id, durationSec: beat.scene.durationSec })),
    captionSafeFrame: { top: 144, right: 81, bottom: 345.6, left: 81 },
    assetReceipts: manifest.assets.map((asset, index) => ({
      receiptId: asset.provenance.generationReceiptId!,
      assetId: asset.id,
      rendererAssetId: asset.id,
      beatId: manifest.beats[index].id,
      approvalSha256: ["a".repeat(64)],
    })),
    visualVerifierPassed: true,
    audioOk: true,
  });
  assert.equal(qa.status, "passed");
  assert.equal(qa.blockers.length, 0);
  const mismatchedAssetQa = evaluateDocumentaryShortSceneQa({
    manifest,
    width: 1080,
    height: 1920,
    layout: "short",
    durationSec: retention.durationSec,
    beatWindows: manifest.beats.map((beat) => ({ id: beat.id, durationSec: beat.scene.durationSec })),
    captionSafeFrame: { top: 144, right: 81, bottom: 345.6, left: 81 },
    assetReceipts: manifest.assets.map((asset, index) => ({
      receiptId: asset.provenance.generationReceiptId!,
      assetId: asset.id,
      rendererAssetId: `unrelated-renderer-asset:${index + 1}`,
      beatId: manifest.beats[index].id,
      approvalSha256: ["a".repeat(64)],
    })),
    visualVerifierPassed: true,
    audioOk: true,
  });
  assert.equal(mismatchedAssetQa.status, "failed");
  assert.ok(mismatchedAssetQa.blockers.some((blocker) => blocker.startsWith("asset_provenance:")));

  assert.throws(
    () => buildDocumentaryCollageShortStrategy({
      runId: "run:missing-source",
      channelId: "channel:test",
      topic: "Unsupported factual Short",
      narrationText: narration,
      targetDurationSec: 52,
    }),
    /require sourceReferences/,
  );
  assert.throws(
    () => buildDocumentaryCollageShortStrategy({
      runId: "run:missing-evidence",
      channelId: "channel:test",
      topic: "Unsupported factual Short",
      narrationText: narration,
      targetDurationSec: 52,
      sources: [{
        id: "source:archive",
        type: "archive",
        title: "City archive record",
        citation: "City archive record, 1911.",
        url: "https://example.com/city-archive-1911",
      }],
    }),
    /require claimEvidence/,
  );

  const mined = mineDocumentarySpinoffCandidates({
    documentaryId: "run:long-documentary",
    sourceVideoId: "video-long-documentary",
    title: "A long documentary with multiple story turns",
    targetDurationSec: 52,
    maxCandidates: 3,
    sentenceTimings: Array.from({ length: 30 }, (_, index) => ({
      id: `sentence:${index + 1}`,
      start: index * 10,
      end: index * 10 + 9,
      text: index % 5 === 0
        ? `Then document ${index + 1} revealed evidence that changed the record.`
        : `The documentary develops the context for source sentence ${index + 1}.`,
    })),
  });
  assert.equal(mined.candidateSet.candidates.length, 3);
  assert.equal(mined.candidateSelection.rankedCandidateIds.length, 3);
  assert.ok(
    mined.candidateSet.candidates.some((candidate) => candidate.sourceDocumentary!.sourceWindow.startSec >= 80),
    "candidate mining must inspect the whole documentary, not only its opening",
  );
  assert.ok(
    mined.candidateSet.candidates.every((candidate) => {
      const window = candidate.sourceDocumentary!.sourceWindow;
      const duration = window.endSec - window.startSec;
      return duration >= 35 && duration <= 60;
    }),
  );
}

run();
