import assert from "node:assert/strict";
import { buildChannelInceptionPlan } from "@/engine/channelInceptionPlan";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import type { PipelineEntry } from "@/engine/types";
import {
  beginChannelInceptionLedger,
  channelInceptionStageDescriptor,
  claimChannelInceptionLedgerStage,
  invalidateChannelInceptionStageAndDescendants,
  type ChannelInceptionLedgerState,
} from "@/engine/channelInceptionLedger";
import {
  assessChannelInceptionProbeQuality,
  channelInceptionProbeEffectiveBudgetUsd,
  channelInceptionProbeObservedSpend,
  freezeChannelInceptionProbeContext,
  freezeChannelInceptionProbeInput,
  prepareChannelInceptionProbeAttempt,
  reconcileChannelInceptionProbeAttempt,
  referenceChannelInceptionProbeAttempt,
  summarizeChannelInceptionProbeSpend,
} from "@/lib/channelInceptionProbe";
import {
  issueStudioActionApproval,
  pipelineProbeApprovalSubject,
} from "@/lib/studioActionApproval";
import { pipelineInvocationSha256 } from "@/lib/pipelineInvocationHash";
import { normalizePipelineInvocationSnapshot } from "@/lib/pipelineInvocationSnapshot";
import { buildQualityEvidence } from "@/engine/qualityEvidence";

const originalSigningKey = process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY;
process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = "probe-test-signing-key";

const ownerId = "owner-a";
const channelId = "channel-a";
const pipeline: PipelineEntry[] = [
  { block: "topic_select", params: { source: "research" } },
  { block: "script_gen", params: { durationSeconds: 60 } },
  { block: "notify" },
];
const context = freezeChannelInceptionProbeContext({
  ownerId,
  family: "narrated_stock",
  channel: {
    slug: "frozen-channel",
    name: "Frozen channel",
    budget: 100,
    thumbnailer: "title_card",
    identity: {
      topicPool: ["A"],
      styleGrammar: "precise",
      palette: ["#111111"],
      persona: "teacher",
      niche: "history",
      bannedWords: ["clickbait"],
    },
    schedule: { madeForKids: false },
    styleDNA: { confidence: 0.9 },
    qaRubric: { minimum: 8 },
  },
});

assert.equal(
  channelInceptionProbeEffectiveBudgetUsd(context, 3),
  3,
  "a $100 channel must still freeze a child budget of exactly the admitted $3 cap",
);

const cinematicContext = freezeChannelInceptionProbeContext({
  ownerId,
  family: "cinematic",
  channel: {
    slug: "cinematic-frozen-channel",
    name: "Cinematic frozen channel",
    budget: 130,
    identity: { topicPool: [], styleGrammar: "", palette: [], persona: "", niche: "" },
    schedule: { madeForKids: false },
  },
});
assert.equal(
  channelInceptionProbeEffectiveBudgetUsd(cinematicContext, 55),
  55,
  "cinematic proof authority must support two bounded multi-scene attempts",
);
assert.throws(
  () => channelInceptionProbeEffectiveBudgetUsd(cinematicContext, 55.01),
  /bounded contract/,
);

const lowBudgetPlan = buildChannelInceptionPlan({
  ownerId,
  channelRef: channelId,
  name: "Low budget probe",
  slug: "low-budget-probe",
  family: "narrated_stock",
  nicheKey: "history",
  sourceRevision: "low-budget-probe/v1",
  pipelineSourceFingerprint: "pipeline/narrated-stock/v1",
  programBrief: createChannelProgramBrief({
    family: "narrated_stock",
    nicheKey: "history",
    locale: "en",
    concept: "Concise evidence-led history stories for curious adult viewers",
  }),
  includeProbe: true,
});
const lowBudgetProbe = lowBudgetPlan.stages.find(
  (stage) => stage.moduleKey === "channel-inception-probe",
)!;
const lowBudgetLedger = beginChannelInceptionLedger(undefined, {
  schemaVersion: lowBudgetPlan.schemaVersion,
  inceptionKey: lowBudgetPlan.inceptionKey,
  requestFingerprint: lowBudgetPlan.requestFingerprint,
  requestSnapshot: lowBudgetPlan.requestSnapshot,
  admission: {
    executionAuthorized: true,
    executionCapUsd: lowBudgetPlan.executionCostCeilingUsd,
    executionReceiptFingerprint: "e".repeat(64),
    probeAuthorized: true,
    probeCapUsd: 1,
    probeReceiptFingerprint: "f".repeat(64),
    boundRequestFingerprint: lowBudgetPlan.requestFingerprint,
  },
  stages: lowBudgetPlan.stages.map(channelInceptionStageDescriptor),
}, 1_000);
for (const dependency of lowBudgetProbe.dependsOn) {
  lowBudgetLedger.stages[dependency]!.status = "complete";
  lowBudgetLedger.stages[dependency]!.outputFingerprint = "d".repeat(64);
}
const lowBudgetClaim = claimChannelInceptionLedgerStage({
  ledger: lowBudgetLedger,
  stage: channelInceptionStageDescriptor(lowBudgetProbe),
  claimant: "probe-low-budget-run",
  now: 1_100,
  leaseMs: 5_000,
  maximumAttempts: 3,
});
assert.equal(lowBudgetClaim.disposition, "execute");
assert.equal(lowBudgetClaim.ledger.costReservations.at(-1)?.maximumCostUsd, 1);

const passingQaOutput = {
  qaPassed: true,
  qualityEvidence: buildQualityEvidence({
    episode: {
      lane: { key: "narrated_documentary", renderer: "stock_footage" },
      topic: "A frozen probe episode",
      durationSec: 61,
      story: { source: "test", beatCount: 4, shotCount: 8, coverageRatio: 1 },
    },
    technical: { passed: true, evaluator: "test", evidence: ["ffprobe"] },
    visual: { passed: true, score: 8, minimumScore: 6, evaluator: "test", evidence: ["frames"] },
    temporal: { passed: true, evaluator: "test", evidence: ["samples"] },
    narrative: { passed: true, evaluator: "test", evidence: ["spec"] },
    audio: {
      score: 8.2,
      minimumScore: 7,
      evaluator: "audio-aesthetics",
      evidence: ["final-master production quality"],
    },
    brand: { passed: true, evaluator: "test", evidence: ["identity"] },
  }),
  qaReport: {
    structural: { ok: true, durationSec: 61, width: 1920, height: 1080 },
    lengthMatch: { ok: true, ratio: 1.01 },
    // Successful Verdicts omit `skipped`; only the fallback receipt sets it.
    video: { score: 8, issues: [] },
    thumbnail: { score: 7, issues: [] },
    // This is the current qa_visual receipt shape. `watch` is historical only.
    visualReview: { ran: true, verdict: "pass", defects: [], summary: "coherent" },
    validation: [{ id: "opening", severity: "block", passed: true, skipped: false }],
  },
};
const acceptedQuality = assessChannelInceptionProbeQuality(passingQaOutput);
assert.equal(acceptedQuality.status, "accepted");
assert.equal(acceptedQuality.watchVerdict, "pass");
assert.match(acceptedQuality.qaEvidenceFingerprint, /^[a-f0-9]{64}$/);
assert.equal(
  assessChannelInceptionProbeQuality({ qaPassed: true }).status,
  "rejected",
  "technical completion without the golden QA report must fail closed",
);
assert.match(
  assessChannelInceptionProbeQuality({
    qaPassed: true,
    qaReport: passingQaOutput.qaReport,
  }).reasons.join(" "),
  /typed final quality evidence is missing/,
  "a probe cannot be promoted from legacy opaque QA data",
);
assert.match(
  assessChannelInceptionProbeQuality({
    ...passingQaOutput,
    qualityEvidence: buildQualityEvidence({
      episode: {
        lane: { key: "narrated_documentary", renderer: "stock_footage" },
        topic: "A superficially complete probe episode",
        story: { source: "test", beatCount: 4, shotCount: 8, coverageRatio: 1 },
      },
      technical: { passed: true, evaluator: "test", evidence: ["ffprobe"] },
      visual: { passed: true, evaluator: "test", evidence: ["frames"] },
      temporal: { passed: true, evaluator: "test", evidence: ["samples"] },
      // This receipt clears the old explicit hard gates but lacks a critic
      // verdict. A channel probe must not use that loophole for promotion.
      audio: {
        score: 8.2,
        minimumScore: 7,
        evaluator: "audio-aesthetics",
        evidence: ["amended final-master production quality"],
      },
      brand: { passed: true, evaluator: "test", evidence: ["identity"] },
    }),
  }).reasons.join(" "),
  /production editorial acceptance/,
  "a held-out probe needs the complete editorial receipt, not only hard gates",
);
assert.match(
  assessChannelInceptionProbeQuality({
    ...passingQaOutput,
    qaReport: {
      ...passingQaOutput.qaReport,
      thumbnail: { score: 4, issues: ["illegible"] },
    },
  }).reasons.join(" "),
  /thumbnail quality score 4/,
);
assert.match(
  assessChannelInceptionProbeQuality({
    ...passingQaOutput,
    qaReport: {
      ...passingQaOutput.qaReport,
      visualReview: {
        ran: true,
        verdict: "pass",
        defects: [{ severity: "major", issue: "broken chapter transition" }],
      },
    },
  }).reasons.join(" "),
  /major or critical defect/,
);
assert.equal(
  assessChannelInceptionProbeQuality({
    ...passingQaOutput,
    qaReport: {
      ...passingQaOutput.qaReport,
      // A present-but-malformed current receipt must fail closed rather than
      // falling through to a legacy field a caller happened to include.
      visualReview: { ran: true, verdict: "pass" },
      watch: { ran: true, verdict: "pass", defects: [] },
    },
  }).status,
  "rejected",
  "current visualReview receipts require an explicit defects ledger",
);
assert.equal(
  assessChannelInceptionProbeQuality({
    ...passingQaOutput,
    qaReport: (() => {
      const legacyReport: Record<string, unknown> = { ...passingQaOutput.qaReport };
      delete legacyReport.visualReview;
      return {
        ...legacyReport,
        watch: { ran: true, verdict: "pass", defects: [], summary: "legacy coherent" },
      };
    })(),
  }).status,
  "accepted",
  "historical qaReport.watch receipts remain readable",
);
assert.notEqual(
  acceptedQuality.qaEvidenceFingerprint,
  assessChannelInceptionProbeQuality({
    ...passingQaOutput,
    qaReport: { ...passingQaOutput.qaReport, video: { score: 9, issues: [] } },
  }).qaEvidenceFingerprint,
  "the quality receipt must be bound to the exact QA evidence",
);
assert.notEqual(
  acceptedQuality.qaEvidenceFingerprint,
  assessChannelInceptionProbeQuality({
    ...passingQaOutput,
    qualityEvidence: buildQualityEvidence({
      episode: {
        lane: { key: "narrated_documentary", renderer: "stock_footage" },
        topic: "A frozen probe episode with amended editorial evidence",
        durationSec: 61,
        story: { source: "test", beatCount: 4, shotCount: 8, coverageRatio: 1 },
      },
      technical: { passed: true, evaluator: "test", evidence: ["ffprobe"] },
      visual: { passed: true, score: 8, minimumScore: 6, evaluator: "test", evidence: ["frames"] },
      temporal: { passed: true, evaluator: "test", evidence: ["samples"] },
      narrative: { passed: true, evaluator: "test", evidence: ["amended spec"] },
      audio: { passed: true, evaluator: "test", evidence: ["meters"] },
      brand: { passed: true, evaluator: "test", evidence: ["identity"] },
    }),
  }).qaEvidenceFingerprint,
  "the quality fingerprint must bind editorial evidence as well as the QA report",
);

function input(moduleConfigOverride: Record<string, Record<string, unknown>>) {
  return freezeChannelInceptionProbeInput({
    pipelineOverride: pipeline,
    moduleConfigOverride,
    invocationContext: context,
    productionFingerprint: "a".repeat(64),
  });
}

const inputA = input({ script_gen: { preset: "concise", temperature: 0.2 } });
const inputB = input({ script_gen: { preset: "concise", temperature: 0.3 } });
assert.notEqual(
  inputA.overrideFingerprint,
  inputB.overrideFingerprint,
  "A-vs-B module configuration must produce different frozen invocation identities",
);

function approval(args: {
  runId: string;
  frozenInput: ReturnType<typeof input>;
  maximumCostUsd: number;
  now: number;
}) {
  return issueStudioActionApproval({
    action: "channel-inception-probe",
    ownerId,
    subject: pipelineProbeApprovalSubject({
      ownerId,
      channelId,
      runId: args.runId,
      pipelineOverrideFingerprint: args.frozenInput.overrideFingerprint,
      maximumCostUsd: args.maximumCostUsd,
    }),
    actor: "authenticated-operator:owner-a",
    evidence: "explicit bounded probe test approval",
    maxCostUsd: args.maximumCostUsd,
    now: args.now,
  });
}

const first = prepareChannelInceptionProbeAttempt({
  attempt: 1,
  ownerId,
  channelId,
  runId: "run-1",
  input: inputA,
  maximumCostUsd: 3,
  approval: approval({ runId: "run-1", frozenInput: inputA, maximumCostUsd: 3, now: 1_000 }),
});
// A channel/config edit after the durable claim cannot alter the child payload.
inputA.moduleConfigOverride["script_gen"]!["temperature"] = 0.99;
context.seedStore["channelName"] = "Mutated after claim";
assert.equal(first.input.moduleConfigOverride["script_gen"]?.["temperature"], 0.2);
assert.equal(first.input.invocationContext.seedStore["channelName"], "Frozen channel");
const firstReference = referenceChannelInceptionProbeAttempt(first);
const frozenInvocation = normalizePipelineInvocationSnapshot({
  version: 1,
  ownerId,
  channelId,
  runId: first.runId,
  source: "override",
  entries: first.input.pipelineOverride,
  seedStore: first.input.invocationContext.seedStore,
  budgetUsd: channelInceptionProbeEffectiveBudgetUsd(
    first.input.invocationContext,
    first.maximumCostUsd,
  ),
  keyPrefix: first.input.invocationContext.keyPrefix,
  remoteBlocks: ["timeline_assemble"],
  defaultRetries: 2,
  compilationFingerprint: "f".repeat(64),
  compilationPolicyId: "production-contract",
  compilationPolicyVersion: "2",
  compilationModules: [],
  compilationCapabilities: [],
  reservedMaxCostUsd: 2.5,
  budgetAdmission: {
    kind: "channel-inception-probe",
    maximumCostUsd: first.maximumCostUsd,
    receiptFingerprint: first.approvalFingerprint,
    subject: first.approval.subject,
    pipelineOverrideFingerprint: first.input.overrideFingerprint,
    dispatchEnvelopeFingerprint: first.dispatchEnvelopeFingerprint,
  },
});
assert.equal(frozenInvocation.budgetUsd, 3);
assert.equal(
  frozenInvocation.budgetAdmission?.dispatchEnvelopeFingerprint,
  first.dispatchEnvelopeFingerprint,
);
assert.match(pipelineInvocationSha256(frozenInvocation), /^[a-f0-9]{64}$/);
const inFlight = summarizeChannelInceptionProbeSpend([firstReference], 3);
assert.deepEqual(inFlight, {
  actualSpendUsd: 0,
  committedSpendUsd: 3,
  remainingAuthorityUsd: 3,
  activeAttempt: 1,
});

// Lost Trigger response: recovery reads the exact run checkpoint and reuses it.
const recoveredFirst = structuredClone(first);
assert.deepEqual(recoveredFirst.approval, first.approval);
assert.equal(recoveredFirst.approvalFingerprint, first.approvalFingerprint);
assert.equal(recoveredFirst.dispatchEnvelopeFingerprint, first.dispatchEnvelopeFingerprint);
const replacementReceipt = approval({
  runId: "run-1",
  frozenInput: recoveredFirst.input,
  maximumCostUsd: 3,
  now: 2_000,
});
assert.notDeepEqual(
  replacementReceipt,
  recoveredFirst.approval,
  "a retry could mint different bytes, so it must load the stored receipt instead",
);
assert.throws(
  () => summarizeChannelInceptionProbeSpend([
    firstReference,
    { ...firstReference, attempt: 2, runId: "run-2" },
  ], 3),
  /concurrent spend authority/,
  "a lost response must reattach instead of minting another spend envelope",
);

const failedFirst = reconcileChannelInceptionProbeAttempt({
  attempt: recoveredFirst,
  status: "failed",
  actualSpendUsd: 1.2,
  invocationSha256: "1".repeat(64),
});
const afterFirst = summarizeChannelInceptionProbeSpend(
  [referenceChannelInceptionProbeAttempt(failedFirst)],
  3,
);
assert.equal(afterFirst.actualSpendUsd, 1.2);
assert.equal(afterFirst.remainingAuthorityUsd, 1.8);
assert.equal(
  channelInceptionProbeObservedSpend({
    maximumCostUsd: 1.8,
    runCostTotal: 0.4,
    runStatus: "failed",
    runError: "PAID_STAGE_RECONCILIATION_REQUIRED",
    stages: [{ status: "failed", cost: 0.4 }],
  }),
  1.8,
  "unrecoverable provider spend must consume all remaining child authority",
);
const unknownFirst = reconcileChannelInceptionProbeAttempt({
  attempt: recoveredFirst,
  status: "failed",
  actualSpendUsd: 3,
  invocationSha256: "3".repeat(64),
});
const afterUnknown = summarizeChannelInceptionProbeSpend(
  [referenceChannelInceptionProbeAttempt(unknownFirst)],
  3,
);
assert.equal(afterUnknown.remainingAuthorityUsd, 0);
assert.equal(afterUnknown.committedSpendUsd, 3);

const secondInput = input({ script_gen: { preset: "repaired", temperature: 0.1 } });
const second = prepareChannelInceptionProbeAttempt({
  attempt: 2,
  ownerId,
  channelId,
  runId: "run-2",
  input: secondInput,
  maximumCostUsd: afterFirst.remainingAuthorityUsd,
  approval: approval({
    runId: "run-2",
    frozenInput: secondInput,
    maximumCostUsd: afterFirst.remainingAuthorityUsd,
    now: 2_000,
  }),
});
const withSecondCommitted = summarizeChannelInceptionProbeSpend([
  referenceChannelInceptionProbeAttempt(failedFirst),
  referenceChannelInceptionProbeAttempt(second),
], 3);
assert.equal(withSecondCommitted.committedSpendUsd, 3);

const completedSecond = reconcileChannelInceptionProbeAttempt({
  attempt: second,
  status: "ok",
  actualSpendUsd: 1.8,
  invocationSha256: "2".repeat(64),
});
const finalSpend = summarizeChannelInceptionProbeSpend([
  referenceChannelInceptionProbeAttempt(failedFirst),
  referenceChannelInceptionProbeAttempt(completedSecond),
], 3);
assert.deepEqual(finalSpend, {
  actualSpendUsd: 3,
  committedSpendUsd: 3,
  remainingAuthorityUsd: 0,
});
assert.throws(
  () => reconcileChannelInceptionProbeAttempt({
    attempt: second,
    status: "failed",
    actualSpendUsd: 1.81,
  }),
  /above its admitted authority/,
);

const provenLedger = {
  status: "complete",
  completedAt: 10,
  admission: { executionAuthorized: true },
  stages: {
    "channel-inception-pipeline": {
      moduleKey: "channel-inception-pipeline",
      status: "complete",
      dependsOn: [],
      attempts: 1,
      outputs: { pipeline: true },
      outputFingerprint: "a".repeat(64),
    },
    "channel-inception-probe": {
      moduleKey: "channel-inception-probe",
      status: "complete",
      dependsOn: ["channel-inception-pipeline"],
      attempts: 1,
      outputs: { invocationSha256: "2".repeat(64) },
      outputFingerprint: "b".repeat(64),
    },
    "channel-inception-readiness": {
      moduleKey: "channel-inception-readiness",
      status: "accepted",
      dependsOn: ["channel-inception-probe"],
      attempts: 1,
      outputs: { status: "paused" },
      outputFingerprint: "c".repeat(64),
    },
  },
} as unknown as ChannelInceptionLedgerState;
invalidateChannelInceptionStageAndDescendants(
  provenLedger,
  "channel-inception-probe",
);
assert.equal(provenLedger.stages["channel-inception-pipeline"]?.status, "complete");
assert.equal(provenLedger.stages["channel-inception-probe"]?.status, "pending");
assert.equal(provenLedger.stages["channel-inception-readiness"]?.status, "pending");
assert.equal(provenLedger.stages["channel-inception-probe"]?.outputs, undefined);
assert.equal(provenLedger.stages["channel-inception-readiness"]?.outputFingerprint, undefined);
assert.equal(provenLedger.status, "running");
assert.equal(provenLedger.completedAt, undefined);

if (originalSigningKey === undefined) delete process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY;
else process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = originalSigningKey;

console.log("channel inception probe budget, fingerprint and recovery tests passed");
