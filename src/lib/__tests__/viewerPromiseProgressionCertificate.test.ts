import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { artifactContract, validateArtifact } from "@/engine/artifactSchemas";
import {
  ChannelProgramRouteRunSeedSchema,
  channelProgramRouteRunSeedFingerprint,
  parseChannelProgramRouteRunSeed,
} from "@/engine/channelProgramRoute";
import {
  createViewerPromiseProgressionOmission,
  createViewerPromiseProgressionReceipt,
} from "@/engine/viewerPromiseProgression";
import { buildQualityEvidence } from "@/engine/qualityEvidence";
import {
  FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  assertFinalMasterReleaseCertificate,
  createFinalMasterReleaseCertificate,
  visualReviewReleaseReceiptKey,
} from "@/lib/finalMasterReleaseCertificate";
import { createFinalMasterQualityEvidenceBinding } from "@/lib/finalMasterQualityEvidenceBinding";
import { canonicalJson } from "@/lib/canonicalJson";

const keyPrefix = "owner/test/channel/viewer-promise/";
const runId = "run-viewer-promise";
const master = { sha256: "a".repeat(64), durationSec: 120 };
const frameKey = `${keyPrefix}runs/${runId}/visual-review/frames/f001.jpg`;
const visualReview = {
  reviewFingerprint: "viewer-promise-review",
  reviewReceiptVersion: "visual-review-release-receipt/v1",
  reviewReceiptFingerprint: "b".repeat(64),
  releaseReceiptFingerprint: "c".repeat(64),
};
const lane = { key: "music_loop", renderer: "loop_clips" };
const sealedRoute = {
  version: "channel-program-route-seed/v1" as const,
  routeKey: "narrated-stock/foundation/v1" as const,
  routeFingerprint: "d".repeat(64),
  family: "music_loop",
  contentLaneKey: lane.key,
  programBriefFingerprint: "e".repeat(64),
  directives: {
    viewerJob: "Help a focused listener settle into a calm, continuous nighttime loop.",
    claimMode: "editorial_lane_policy" as const,
    topicRules: ["Stay within the approved music lane."],
    scriptRules: ["Keep the listening promise coherent."],
    criticFocus: ["Check the continuous listener experience."],
  },
  requiredBlocks: ["topic_select", "qa_visual"],
  context: { locale: "en", nicheKey: "lofi" },
};
const route = {
  routeFingerprint: sealedRoute.routeFingerprint,
  family: sealedRoute.family,
  contentLaneKey: sealedRoute.contentLaneKey,
  programBriefFingerprint: sealedRoute.programBriefFingerprint,
  routeSeedFingerprint: channelProgramRouteRunSeedFingerprint(sealedRoute),
};
const viewerPromise = {
  ...route,
  claimMode: sealedRoute.directives.claimMode,
  viewerJobFingerprint: createHash("sha256")
    .update(canonicalJson({ viewerJob: sealedRoute.directives.viewerJob }))
    .digest("hex"),
};
const qualityEvidence = buildQualityEvidence({
  episode: { lane, topic: "A slow nighttime loop for focused listening" },
  technical: { passed: true, evaluator: "render-validator", evidence: ["master streams validated"] },
  visual: { passed: true, evaluator: "visual-review", evidence: ["existing final review passed"] },
  temporal: { passed: true, evaluator: "loop-review", evidence: ["loop seam passed"] },
  audio: { passed: true, evaluator: "mix-review", evidence: ["audio bed passed"] },
});
function qualityBindingFor(programRoute: typeof route) {
  return createFinalMasterQualityEvidenceBinding({
    finalMaster: master,
    visualReview,
    contentLane: lane,
    programRoute,
    qualityEvidence,
  });
}
const qualityBinding = qualityBindingFor(route);
const continuousReceipt = createViewerPromiseProgressionReceipt({
  version: "viewer-promise-progression/v1",
  mode: "continuous",
  assessmentScope: "continuous-experience-review-coverage",
  viewerPromise,
  finalMaster: master,
  visualReview,
  plan: { source: "lane_visual_pacing_policy", visualPacingMode: "exempt" },
  milestones: [
    {
      id: "opening",
      window: { startSec: 0, endSec: 40 },
      reviewFrame: {
        id: "frame-opening",
        tSec: 20,
        r2Key: frameKey,
        contentSha256: "1".repeat(64),
        byteLength: 128,
      },
    },
    { id: "middle", window: { startSec: 40, endSec: 80 } },
    { id: "closing", window: { startSec: 80, endSec: 120 } },
  ],
  coverage: {
    milestoneCount: 3,
    sampledMilestoneCount: 1,
    sampledMilestoneRatio: 1 / 3,
    maxUnsampledMilestoneSec: 40,
    reviewMaxGapSec: 40,
  },
});
const omission = createViewerPromiseProgressionOmission({
  status: "not_measured",
  mode: "continuous",
  viewerPromise,
  reasonCode: "incomplete_story_spine",
});

const certificateInput = {
  version: FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  finalMaster: {
    r2Key: `${keyPrefix}runs/${runId}/final.mp4`,
    ...master,
    byteLength: 1_024,
  },
  visualReview: {
    evidenceManifestKey: `${keyPrefix}runs/${runId}/visual-review/manifest.json`,
    evidenceFrameKeys: [frameKey],
    evidenceFrameArtifacts: [{
      id: "frame-opening",
      tSec: 20,
      r2Key: frameKey,
      contentSha256: "1".repeat(64),
      byteLength: 128,
    }],
    receiptKey: visualReviewReleaseReceiptKey(
      keyPrefix,
      runId,
      visualReview.releaseReceiptFingerprint,
    ),
    ...visualReview,
  },
  qualityEvidence: qualityBinding,
};

const certificate = createFinalMasterReleaseCertificate({
  ...certificateInput,
  viewerPromiseProgression: continuousReceipt,
  viewerPromiseProgressionRoute: sealedRoute,
});
assert.doesNotThrow(
  () => assertFinalMasterReleaseCertificate(certificate),
  "a continuous observation must bind the exact route, final master, review receipt, and retained frame",
);
assert.equal(
  certificate.qualityEvidence?.qualityEvidence.axes.visual.status,
  "pass",
  "viewer-promise evidence does not add or replace a QualityEvidence axis",
);
assert.doesNotThrow(
  () => assertFinalMasterReleaseCertificate(createFinalMasterReleaseCertificate({
    ...certificateInput,
    viewerPromiseProgressionOmission: omission,
    viewerPromiseProgressionRoute: sealedRoute,
  })),
  "a bounded optional omission remains certificate-compatible and non-gating",
);
assert.throws(
  () => createFinalMasterReleaseCertificate({
    ...certificateInput,
    viewerPromiseProgression: continuousReceipt,
    viewerPromiseProgressionOmission: omission,
    viewerPromiseProgressionRoute: sealedRoute,
  }),
  /cannot attach viewer-promise progression evidence and an omission together/,
  "one certificate cannot claim a measurement and its omission at once",
);
const { receiptFingerprint: _continuousReceiptFingerprint, ...continuousReceiptInput } = continuousReceipt;
void _continuousReceiptFingerprint;
const wrongFrameReceipt = createViewerPromiseProgressionReceipt({
  ...continuousReceiptInput,
  milestones: continuousReceipt.milestones.map((milestone) =>
    milestone.reviewFrame
      ? {
          ...milestone,
          reviewFrame: {
            ...milestone.reviewFrame,
            r2Key: `${keyPrefix}runs/${runId}/visual-review/frames/not-retained.jpg`,
          },
        }
      : milestone,
  ),
});
assert.throws(
  () => createFinalMasterReleaseCertificate({
    ...certificateInput,
    viewerPromiseProgression: wrongFrameReceipt,
    viewerPromiseProgressionRoute: sealedRoute,
  }),
  /absent from the certificate/,
  "certificate validation must reject a progression receipt that cites an unretained frame",
);

function assertDirectiveTamperRejected(tamperedSealedRoute: unknown) {
  const parsedTamperedRoute = parseChannelProgramRouteRunSeed(tamperedSealedRoute);
  const certificateRoute = ChannelProgramRouteRunSeedSchema.parse(tamperedSealedRoute);
  const tamperedRoute = {
    ...route,
    routeSeedFingerprint: channelProgramRouteRunSeedFingerprint(parsedTamperedRoute),
  };
  const forgedDirectiveReceipt = createViewerPromiseProgressionReceipt({
    ...continuousReceiptInput,
    viewerPromise: {
      ...continuousReceipt.viewerPromise,
      routeSeedFingerprint: tamperedRoute.routeSeedFingerprint,
    },
  });
  assert.throws(
    () => createFinalMasterReleaseCertificate({
      ...certificateInput,
      qualityEvidence: qualityBindingFor(tamperedRoute),
      viewerPromiseProgression: forgedDirectiveReceipt,
      viewerPromiseProgressionRoute: certificateRoute,
    }),
    /sealed route directives/,
  );
}
assertDirectiveTamperRejected({
  ...sealedRoute,
  directives: {
    ...sealedRoute.directives,
    viewerJob: "A forged viewer job that changes the sealed audience promise.",
  },
});
assertDirectiveTamperRejected({
  ...sealedRoute,
  directives: {
    ...sealedRoute.directives,
    claimMode: "certified_quiz_facts" as const,
  },
});
const omissionViewerJobTamperedRoute = {
  ...sealedRoute,
  directives: {
    ...sealedRoute.directives,
    viewerJob: "A forged viewer job must not validate an otherwise non-gating omission.",
  },
};
const parsedOmissionViewerJobTamperedRoute = parseChannelProgramRouteRunSeed(
  omissionViewerJobTamperedRoute,
);
const omissionTamperedRoute = {
  ...route,
  routeSeedFingerprint: channelProgramRouteRunSeedFingerprint(
    parsedOmissionViewerJobTamperedRoute,
  ),
};
const { omissionFingerprint: _omissionFingerprint, ...omissionInput } = omission;
void _omissionFingerprint;
const forgedDirectiveOmission = createViewerPromiseProgressionOmission({
  ...omissionInput,
  viewerPromise: {
    ...omission.viewerPromise,
    routeSeedFingerprint: omissionTamperedRoute.routeSeedFingerprint,
  },
});
assert.throws(
  () => createFinalMasterReleaseCertificate({
    ...certificateInput,
    qualityEvidence: qualityBindingFor(omissionTamperedRoute),
    viewerPromiseProgressionOmission: forgedDirectiveOmission,
    viewerPromiseProgressionRoute: ChannelProgramRouteRunSeedSchema.parse(
      omissionViewerJobTamperedRoute,
    ),
  }),
  /sealed route directives/,
  "a viewer-promise omission must also derive its job fingerprint from sealed route directives",
);

function forgedWitnessReceipt(
  reviewFramePatch: Partial<NonNullable<(typeof continuousReceipt.milestones)[number]["reviewFrame"]>>,
) {
  return createViewerPromiseProgressionReceipt({
    ...continuousReceiptInput,
    milestones: continuousReceipt.milestones.map((milestone) =>
      milestone.reviewFrame
        ? {
            ...milestone,
            reviewFrame: { ...milestone.reviewFrame, ...reviewFramePatch },
          }
        : milestone,
    ),
  });
}
for (const [label, reviewFramePatch] of [
  ["timestamp", { tSec: 20.25 }],
  ["content hash", { contentSha256: "7".repeat(64) }],
  ["byte length", { byteLength: 999 }],
] as const) {
  assert.throws(
    () => createFinalMasterReleaseCertificate({
      ...certificateInput,
      viewerPromiseProgression: forgedWitnessReceipt(reviewFramePatch),
      viewerPromiseProgressionRoute: sealedRoute,
    }),
    /durable visual-review witness/,
    `certificate validation must reject a same-key forged review-frame ${label}`,
  );
}

const qaReportArtifact = artifactContract("qaReport");
const baseQaReport = {
  structural: { ok: true, durationSec: 120, width: 1920, height: 1080 },
  lengthMatch: { videoSec: 120, targetSec: 120, ratio: 1, ok: true },
  video: { score: 8, issues: [] },
  thumbnail: { score: 8, issues: [] },
  watch: { ran: true, verdict: "pass" as const, defects: [], summary: "Passed." },
};
assert.doesNotThrow(() => validateArtifact(qaReportArtifact, {
  ...baseQaReport,
  viewerPromiseProgression: continuousReceipt,
}));
assert.throws(
  () => validateArtifact(qaReportArtifact, {
    ...baseQaReport,
    viewerPromiseProgression: continuousReceipt,
    viewerPromiseProgressionOmission: omission,
  }),
  /cannot attach viewer-promise progression evidence and an omission together/,
  "qaReport must mirror the certificate's mutually exclusive optional evidence",
);

console.log("Viewer Promise Progression certificate tests passed");
