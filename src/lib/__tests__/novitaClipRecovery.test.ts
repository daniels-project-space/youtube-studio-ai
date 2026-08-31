import assert from "node:assert/strict";
import {
  reviewClipsBeforeAssembly,
  type NovitaGeneratedScene,
} from "@/lib/novitaMedia";
import { CinematicClipRejectedError } from "@/lib/cinematicClipGate";
import {
  VISUAL_ARTIFACT_REVIEW_OUTCOME_VERSION,
  VisualArtifactReviewRejectedError,
} from "@/engine/visualArtifactReviewOutcome";
import {
  CINEMATIC_CLIP_REVIEW_VERSION,
  type CinematicClipReview,
} from "@/engine/cinematicClipReview";
import type { NovitaBillingReceipt } from "@/lib/novitaRenderFarm";

const scene: NovitaGeneratedScene = {
  id: "cinematic-shot-motion-retry",
  imagePrompt: "A faceless mannequin in a charcoal wool overcoat folds a brass-key timetable in a rain-soaked station.",
  motionPrompt: "Slow dolly toward the brass key as the mannequin folds the timetable and looks toward the departure board.",
  durationSec: 4,
  continuityIds: ["mannequin-investigator"],
};
const review: CinematicClipReview = {
  version: CINEMATIC_CLIP_REVIEW_VERSION,
  reviewer: "non_google_vision",
  sceneId: scene.id,
  sampleOffsetsSec: [0.2, 2, 3.8],
  expectedCastIds: ["mannequin-investigator"],
  forbidAdditionalPeople: true,
  onlyExpectedCastVisible: true,
  semanticAlignment: 0.9,
  motionIntegrity: 0.9,
  continuity: 0.9,
  endBeat: 0.9,
  artifactFree: 0.9,
  textWatermarkFree: true,
  pass: true,
  notes: ["The exact coat, key, station, dolly, and readable end reaction remain intact."],
};
const receipt = {} as NovitaBillingReceipt;

async function main(): Promise<void> {
  let reviews = 0;
  let replacementCalls = 0;
  let replacementInput: { repairId: string; attempt: number; motionPrompt: string; terminalStillKey?: string; remainingCostUsd: number } | undefined;
  const recovered = await reviewClipsBeforeAssembly({
    scenes: [scene],
    stillByShot: new Map([[scene.id, "accepted.png"]]),
    terminalStillByShot: new Map([[scene.id, "accepted-terminal.png"]]),
    clipByShot: new Map([[scene.id, "initial.mp4"]]),
    maxVideoAttempts: 2,
    videoCostUsd: 0.4,
    videoMaxCostUsd: 1.2,
    videoReceipts: [receipt],
    review: async ({ clipKey, terminalStillKey }) => {
      reviews += 1;
      assert.equal(terminalStillKey, "accepted-terminal.png");
      if (reviews === 1) throw new CinematicClipRejectedError(scene.id, ["candidate freezes after the first frame and loses the key"]);
      assert.equal(clipKey, "replacement.mp4");
      return review;
    },
    renderReplacement: async (input) => {
      replacementCalls += 1;
      replacementInput = input;
      assert.equal(input.terminalStillKey, "accepted-terminal.png");
      return { clipKey: "replacement.mp4", costUsd: 0.4, billingReceipt: receipt };
    },
  });

  assert.equal(reviews, 2, "the repaired take must be independently re-reviewed");
  assert.equal(replacementCalls, 1, "one proven visual rejection may buy exactly one LTX replacement");
  assert.equal(recovered.clipByShot.get(scene.id), "replacement.mp4");
  assert.equal(recovered.videoCostUsd, 0.8);
  assert.equal(recovered.videoReceipts.length, 2);
  assert.equal(replacementInput?.repairId, "cinematic-shot-motion-retry-motion-retry-2");
  assert.equal(replacementInput?.attempt, 2);
  assert.match(replacementInput?.motionPrompt ?? "", /motion correction 2\/2/);
  assert.ok((replacementInput?.remainingCostUsd ?? 0) > 0);

  let checkpointOrderingReviews = 0;
  let checkpointOrderingReplacementCalls = 0;
  const checkpointOrder: string[] = [];
  await reviewClipsBeforeAssembly({
    scenes: [scene],
    stillByShot: new Map([[scene.id, "accepted.png"]]),
    clipByShot: new Map([[scene.id, "initial.mp4"]]),
    maxVideoAttempts: 2,
    videoCostUsd: 0.4,
    videoMaxCostUsd: 1.2,
    videoReceipts: [receipt],
    review: async () => {
      checkpointOrderingReviews += 1;
      if (checkpointOrderingReviews === 1) {
        throw new CinematicClipRejectedError(scene.id, ["candidate needs a durable repair record first"]);
      }
      return review;
    },
    checkpointReview: async (event) => {
      checkpointOrder.push(`${event.verdict}:${event.clipKey}`);
    },
    renderReplacement: async () => {
      checkpointOrderingReplacementCalls += 1;
      checkpointOrder.push("replacement-render");
      return { clipKey: "replacement.mp4", costUsd: 0.4, billingReceipt: receipt };
    },
  });
  assert.deepEqual(
    checkpointOrder,
    ["rejected:initial.mp4", "replacement-render", "accepted:replacement.mp4"],
    "the rejected clip checkpoint completes before the one permitted replacement render",
  );
  assert.equal(checkpointOrderingReplacementCalls, 1);

  let checkpointFailureReplacementCalls = 0;
  await assert.rejects(
    reviewClipsBeforeAssembly({
      scenes: [scene],
      stillByShot: new Map([[scene.id, "accepted.png"]]),
      clipByShot: new Map([[scene.id, "initial.mp4"]]),
      maxVideoAttempts: 2,
      videoCostUsd: 0.4,
      videoMaxCostUsd: 1.2,
      videoReceipts: [receipt],
      review: async () => {
        throw new CinematicClipRejectedError(scene.id, ["durable audit must succeed before replacement"]);
      },
      checkpointReview: async () => {
        throw new Error("visual attempt ledger write failed");
      },
      renderReplacement: async () => {
        checkpointFailureReplacementCalls += 1;
        return { clipKey: "replacement.mp4", costUsd: 0.4, billingReceipt: receipt };
      },
    }),
    /visual attempt ledger write failed/,
    "a failed clip checkpoint aborts before buying a replacement take",
  );
  assert.equal(checkpointFailureReplacementCalls, 0, "a failed clip checkpoint permits no paid replacement");

  let failedReviews = 0;
  let persistentReplacementCalls = 0;
  await assert.rejects(
    reviewClipsBeforeAssembly({
      scenes: [scene],
      stillByShot: new Map([[scene.id, "accepted.png"]]),
      clipByShot: new Map([[scene.id, "initial.mp4"]]),
      maxVideoAttempts: 2,
      videoCostUsd: 0.4,
      videoMaxCostUsd: 1.2,
      videoReceipts: [receipt],
      review: async () => {
        failedReviews += 1;
        throw new CinematicClipRejectedError(scene.id, ["persistent motion morph"]);
      },
      renderReplacement: async () => {
        persistentReplacementCalls += 1;
        return { clipKey: "replacement.mp4", costUsd: 0.4, billingReceipt: receipt };
      },
    }),
    /persistent motion morph/,
  );
  assert.equal(failedReviews, 2, "the recovery budget may not buy an unbounded third LTX take");
  assert.equal(persistentReplacementCalls, 1, "the second visual rejection must not buy a second LTX replacement");

  const operationalFaults: ReadonlyArray<readonly [string, Error]> = [
    ["malformed reviewer verdict", new Error("cinematic clip gate: malformed reviewer verdict")],
    ["reviewer outage", Object.assign(new Error("reviewer service unavailable"), { status: 503 })],
    ["R2/download failure", new Error("R2 download failed for initial.mp4")],
    ["ffprobe failure", new Error("ffprobe could not inspect candidate.mp4")],
    ["frame extraction failure", new Error("grabFrame could not write the middle sample")],
  ];
  for (const [label, fault] of operationalFaults) {
    let faultReviews = 0;
    let faultReplacementCalls = 0;
    await assert.rejects(
      reviewClipsBeforeAssembly({
        scenes: [scene],
        stillByShot: new Map([[scene.id, "accepted.png"]]),
        clipByShot: new Map([[scene.id, "initial.mp4"]]),
        maxVideoAttempts: 2,
        videoCostUsd: 0.4,
        videoMaxCostUsd: 1.2,
        videoReceipts: [receipt],
        review: async () => {
          faultReviews += 1;
          throw fault;
        },
        renderReplacement: async () => {
          faultReplacementCalls += 1;
          return { clipKey: "replacement.mp4", costUsd: 0.4, billingReceipt: receipt };
        },
      }),
      (error: unknown) => error === fault,
      `${label} must preserve the paid take rather than infer a visual rejection`,
    );
    assert.equal(faultReviews, 1, `${label} must not consume the visual repair attempt`);
    assert.equal(faultReplacementCalls, 0, `${label} must not buy another LTX take`);
  }

  const staleReview = new VisualArtifactReviewRejectedError({
    schemaVersion: VISUAL_ARTIFACT_REVIEW_OUTCOME_VERSION,
    gateId: "cinematic-clip",
    artifactKind: "video",
    subjectId: scene.id,
    reviewVersion: `${CINEMATIC_CLIP_REVIEW_VERSION}-foreign`,
    notes: ["An older evidence schema rejected this clip."],
  });
  let staleVersionReplacementCalls = 0;
  await assert.rejects(
    reviewClipsBeforeAssembly({
      scenes: [scene],
      stillByShot: new Map([[scene.id, "accepted.png"]]),
      clipByShot: new Map([[scene.id, "initial.mp4"]]),
      maxVideoAttempts: 2,
      videoCostUsd: 0.4,
      videoMaxCostUsd: 1.2,
      videoReceipts: [receipt],
      review: async () => {
        throw staleReview;
      },
      renderReplacement: async () => {
        staleVersionReplacementCalls += 1;
        return { clipKey: "replacement.mp4", costUsd: 0.4, billingReceipt: receipt };
      },
    }),
    (error: unknown) => error === staleReview,
    "a stale review schema cannot authorize a new paid take",
  );
  assert.equal(staleVersionReplacementCalls, 0, "stale evidence must fail closed without another LTX render");

  let mismatchedReplacementCalls = 0;
  await assert.rejects(
    reviewClipsBeforeAssembly({
      scenes: [scene],
      stillByShot: new Map([[scene.id, "accepted.png"]]),
      clipByShot: new Map([[scene.id, "initial.mp4"]]),
      maxVideoAttempts: 2,
      videoCostUsd: 0.4,
      videoMaxCostUsd: 1.2,
      videoReceipts: [receipt],
      review: async () => {
        throw new CinematicClipRejectedError("cinematic-shot-wrong-subject", ["different clip failed"]);
      },
      renderReplacement: async () => {
        mismatchedReplacementCalls += 1;
        return { clipKey: "replacement.mp4", costUsd: 0.4, billingReceipt: receipt };
      },
    }),
    /different clip failed/,
    "a typed rejection for another clip must not authorize repair of this one",
  );
  assert.equal(mismatchedReplacementCalls, 0, "mismatched visual evidence must fail closed");
}

void main();
