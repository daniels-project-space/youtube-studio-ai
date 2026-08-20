import assert from "node:assert/strict";
import {
  beginChannelInceptionLedger,
  checkpointChannelInceptionLedgerStage,
  channelInceptionStageDescriptor,
  claimChannelInceptionLedgerStage,
  completeChannelInceptionLedgerStage,
  failChannelInceptionLedgerStage,
  heartbeatChannelInceptionLedgerStage,
  runChannelInceptionStage,
  type ChannelInceptionLedgerAdapter,
  type ChannelInceptionLedgerState,
} from "@/engine/channelInceptionLedger";
import {
  buildChannelInceptionPlan,
  channelInceptionStage,
  type ChannelInceptionPlan,
  type ChannelInceptionRequest,
  type ChannelInceptionStagePlan,
} from "@/engine/channelInceptionPlan";
import type { ChannelInceptionModuleKey } from "@/engine/channelInceptionContracts";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";

const quietRequest: ChannelInceptionRequest = {
  ownerId: "owner_daniel",
  channelRef: "channel:quiet-stoic",
  name: "The Quiet Stoic",
  slug: "quiet-stoic",
  family: "narrated_stock",
  nicheKey: "psychology",
  sourceRevision: "quiet-stoic@2026-08-07",
  pipelineSourceFingerprint: "pipeline:narrated-stock:v3",
  programBrief: createChannelProgramBrief({
    family: "narrated_stock",
    nicheKey: "psychology",
    locale: "en",
    concept: "Calm evidence-grounded stoic philosophy lessons for reflective adults",
  }),
  brand: {
    avatar: {
      existing: {
        assetKey: "channels/quiet-stoic/art/avatar-approved.png",
        contentFingerprint: "quiet-stoic-avatar-approved-v1",
      },
      protectExisting: true,
    },
    banner: {
      existing: {
        assetKey: "channels/quiet-stoic/art/banner-v1.png",
        contentFingerprint: "quiet-stoic-banner-v1",
      },
      regenerate: true,
    },
  },
};

function begin(plan: ChannelInceptionPlan, previous?: ChannelInceptionLedgerState) {
  return beginChannelInceptionLedger(previous, {
    schemaVersion: plan.schemaVersion,
    inceptionKey: plan.inceptionKey,
    requestFingerprint: plan.requestFingerprint,
    requestSnapshot: plan.requestSnapshot,
    admission: {
      executionAuthorized: true,
      executionCapUsd: 100,
      executionReceiptFingerprint: "e".repeat(64),
      probeAuthorized: true,
      probeCapUsd: 100,
      probeReceiptFingerprint: "b".repeat(64),
      boundRequestFingerprint: plan.requestFingerprint,
    },
    stages: plan.stages.map(channelInceptionStageDescriptor),
  }, 1_000);
}

function memoryAdapter(
  initial: ChannelInceptionLedgerState,
  claimant = "trigger-run:1",
): { adapter: ChannelInceptionLedgerAdapter; read: () => ChannelInceptionLedgerState } {
  let ledger = initial;
  let now = 2_000;
  const adapter: ChannelInceptionLedgerAdapter = {
    claim: async (stage, options) => {
      const claim = claimChannelInceptionLedgerStage({
        ledger,
        stage: channelInceptionStageDescriptor(stage),
        claimant,
        now: now++,
        leaseMs: 60_000,
        maximumAttempts: options.maximumAttempts,
        observedOutputFingerprint: options.observedOutputFingerprint,
      });
      ledger = claim.ledger;
      return {
        disposition: claim.disposition,
        outputs: claim.stage.outputs,
        executionPhase: claim.stage.executionPhase,
        leaseVersion: claim.stage.leaseVersion,
      };
    },
    complete: async (stage, leaseVersion, status, outputs, outputFingerprint) => {
      ledger = completeChannelInceptionLedgerStage({
        ledger,
        stage: channelInceptionStageDescriptor(stage),
        claimant,
        leaseVersion,
        status,
        outputs,
        outputFingerprint,
        now: now++,
      });
    },
    checkpoint: async (stage, leaseVersion, outputs, executionPhase) => {
      ledger = checkpointChannelInceptionLedgerStage({
        ledger,
        stage: channelInceptionStageDescriptor(stage),
        claimant,
        leaseVersion,
        outputs,
        executionPhase,
        now: now++,
      });
    },
    heartbeat: async (stage, leaseVersion) => {
      ledger = heartbeatChannelInceptionLedgerStage({
        ledger,
        stage: channelInceptionStageDescriptor(stage),
        claimant,
        leaseVersion,
        now: now++,
        leaseMs: 60_000,
      });
    },
    fail: async (stage, leaseVersion, error, retryable) => {
      ledger = failChannelInceptionLedgerStage({
        ledger,
        stage: channelInceptionStageDescriptor(stage),
        claimant,
        leaseVersion,
        error,
        retryable,
        now: now++,
      });
    },
  };
  return { adapter, read: () => ledger };
}

function stage<K extends ChannelInceptionModuleKey>(
  plan: ChannelInceptionPlan,
  moduleKey: K,
): ChannelInceptionStagePlan<K> {
  const planned = channelInceptionStage(plan, moduleKey);
  assert(planned, `${moduleKey} must be planned`);
  return planned;
}

function completeBefore(
  plan: ChannelInceptionPlan,
  target: ChannelInceptionModuleKey,
  initial: ChannelInceptionLedgerState,
): ChannelInceptionLedgerState {
  let ledger = initial;
  let now = 1_010;
  for (const planned of plan.stages) {
    if (planned.moduleKey === target) break;
    const claimed = claimChannelInceptionLedgerStage({
      ledger,
      stage: channelInceptionStageDescriptor(planned),
      claimant: "test-prerequisites",
      now: now++,
      leaseMs: 5_000,
      maximumAttempts: 3,
    });
    assert.equal(claimed.disposition, "execute");
    ledger = completeChannelInceptionLedgerStage({
      ledger: claimed.ledger,
      stage: channelInceptionStageDescriptor(planned),
      claimant: "test-prerequisites",
      leaseVersion: claimed.stage.leaseVersion!,
      status: "accepted",
      outputFingerprint: "a".repeat(64),
      now: now++,
    });
  }
  return ledger;
}

function checkpointsAndLeasesAreDurable(): void {
  const plan = buildChannelInceptionPlan(quietRequest);
  const research = stage(plan, "channel-inception-research");
  const descriptor = channelInceptionStageDescriptor(research);
  let ledger = begin(plan);
  const claim = claimChannelInceptionLedgerStage({
    ledger,
    stage: descriptor,
    claimant: "trigger-run:1",
    now: 1_100,
    leaseMs: 5_000,
    maximumAttempts: 3,
  });
  assert.equal(claim.disposition, "execute");
  ledger = checkpointChannelInceptionLedgerStage({
    ledger: claim.ledger,
    stage: descriptor,
    claimant: "trigger-run:1",
    leaseVersion: claim.stage.leaseVersion!,
    outputs: { candidateKey: "candidate/avatar-v2.png" },
    now: 1_200,
  });
  ledger = heartbeatChannelInceptionLedgerStage({
    ledger,
    stage: descriptor,
    claimant: "trigger-run:1",
    leaseVersion: claim.stage.leaseVersion!,
    now: 2_000,
    leaseMs: 7_000,
  });
  assert.equal(ledger.stages[research.moduleKey].leaseExpiresAt, 9_000);
  assert.deepEqual(ledger.stages[research.moduleKey].outputs, {
    candidateKey: "candidate/avatar-v2.png",
  });
  ledger = completeChannelInceptionLedgerStage({
    ledger,
    stage: descriptor,
    claimant: "trigger-run:1",
    leaseVersion: claim.stage.leaseVersion!,
    status: "complete",
    outputs: { imageKey: "channels/quiet-stoic/avatar-v2.png" },
    outputFingerprint: "b".repeat(64),
    now: 2_100,
  });
  assert.equal(ledger.stages[research.moduleKey].status, "complete");

  const refreshed = begin(plan, ledger);
  assert.equal(refreshed.stages[research.moduleKey].status, "complete");
  assert.deepEqual(refreshed.stages[research.moduleKey].outputs, {
    imageKey: "channels/quiet-stoic/avatar-v2.png",
  });
}

async function executorRunsOnceAndRehydrates(): Promise<void> {
  const plan = buildChannelInceptionPlan(quietRequest);
  const { adapter, read } = memoryAdapter(begin(plan));
  let durableResearch: boolean | undefined;
  let executions = 0;
  const options = {
    plan,
    moduleKey: "channel-inception-research" as const,
    ledger: adapter,
    fingerprint: () => "f".repeat(64),
    loadCompleted: async () => durableResearch === undefined
      ? undefined
      : { value: durableResearch, evidence: { durable: true } },
    execute: async () => {
      executions += 1;
      durableResearch = true;
      return { value: true, evidence: { providerReceipt: "research-1" } };
    },
  };
  const first = await runChannelInceptionStage(options);
  const second = await runChannelInceptionStage(options);
  assert.equal(first.disposition, "executed");
  assert.equal(second.disposition, "reused");
  assert.equal(executions, 1, "a completed stage must never repeat provider work");
  assert.equal(read().stages[options.moduleKey].attempts, 1);
}

async function protectedExistingAssetIsAcceptedWithoutExecution(): Promise<void> {
  const plan = buildChannelInceptionPlan(quietRequest);
  const avatar = channelInceptionStage(plan, "channel-inception-avatar")!;
  assert.equal(avatar.params.asset.action, "preserve-protected");
  const { adapter, read } = memoryAdapter(
    completeBefore(plan, "channel-inception-avatar", begin(plan)),
  );
  let executions = 0;
  const persisted = "channels/quiet-stoic/art/avatar-approved.png";
  const options = {
    plan,
    moduleKey: "channel-inception-avatar" as const,
    ledger: adapter,
    fingerprint: () => "9".repeat(64),
    loadCompleted: async () => ({ value: persisted }),
    adoptExisting: async () => ({ value: persisted, evidence: { protected: true } }),
    execute: async () => {
      executions += 1;
      return { value: "should-never-be-generated" };
    },
  };
  const accepted = await runChannelInceptionStage(options);
  const reused = await runChannelInceptionStage(options);
  assert.equal(accepted.disposition, "accepted");
  assert.equal(reused.disposition, "reused");
  assert.equal(executions, 0);
  assert.equal(read().stages[options.moduleKey].status, "accepted");
}

async function finalTaskAttemptCannotRemainBuilding(): Promise<void> {
  const plan = buildChannelInceptionPlan(quietRequest);
  const { adapter, read } = memoryAdapter(begin(plan));
  await assert.rejects(
    () => runChannelInceptionStage({
      plan,
      moduleKey: "channel-inception-research",
      ledger: adapter,
      retryableOnError: false,
      loadCompleted: async () => undefined,
      execute: async () => {
        throw new Error("terminal provider failure");
      },
    }),
    /terminal provider failure/,
  );
  assert.equal(read().status, "blocked");
  assert.equal(read().stages["channel-inception-research"].status, "blocked");
}

function planChangesInvalidateOnlyAffectedStages(): void {
  const original = buildChannelInceptionPlan(quietRequest);
  let ledger = completeBefore(original, "channel-inception-avatar", begin(original));
  const plannedArtStages = [
    stage(original, "channel-inception-avatar"),
    stage(original, "channel-inception-banner"),
  ] as const;
  for (const planned of plannedArtStages) {
    const claimed = claimChannelInceptionLedgerStage({
      ledger,
      stage: channelInceptionStageDescriptor(planned),
      claimant: "trigger-run:1",
      now: 1_100,
      leaseMs: 5_000,
      maximumAttempts: 3,
    });
    ledger = completeChannelInceptionLedgerStage({
      ledger: claimed.ledger,
      stage: channelInceptionStageDescriptor(planned),
      claimant: "trigger-run:1",
      leaseVersion: claimed.stage.leaseVersion!,
      status: "complete",
      outputFingerprint: "c".repeat(64),
      now: 1_200,
    });
  }

  const revised = buildChannelInceptionPlan({
    ...quietRequest,
    brand: {
      ...quietRequest.brand,
      banner: {
        existing: {
          assetKey: "channels/quiet-stoic/art/banner-v2.png",
          contentFingerprint: "quiet-stoic-banner-v2",
        },
        regenerate: true,
      },
    },
  });
  const refreshed = begin(revised, ledger);
  assert.equal(refreshed.stages["channel-inception-avatar"].status, "complete");
  assert.equal(refreshed.stages["channel-inception-banner"].status, "pending");
  assert.equal(refreshed.stages["channel-inception-readiness"].status, "pending");
}

function retryPlanDoesNotAbsorbEarlierStageOutputs(): void {
  const original = buildChannelInceptionPlan({
    ...quietRequest,
    brand: undefined,
    voice: undefined,
    starter: { topicCount: 3, previewCount: 3 },
  });
  const ledger = begin(original);
  const rebuiltFromMutatedDomainState = buildChannelInceptionPlan({
    ...original.requestSnapshot,
    brand: {
      avatar: {
        existing: {
          assetKey: "channels/quiet-stoic/generated-avatar.png",
          contentFingerprint: "generated-avatar-v1",
        },
        protectExisting: true,
      },
    },
    voice: {
      existingCastFingerprint: "newly-generated-cast",
      protectExistingCast: true,
    },
    starter: {
      topicCount: 3,
      previewCount: 3,
      acceptedTopicFingerprints: ["new-topic"],
      acceptedPreviewFingerprints: ["new-thumbnail"],
    },
  });
  assert.notEqual(rebuiltFromMutatedDomainState.inceptionKey, original.inceptionKey);

  const retryPlan = buildChannelInceptionPlan(ledger.requestSnapshot);
  assert.equal(retryPlan.inceptionKey, original.inceptionKey);
  assert.deepEqual(
    retryPlan.stages.map((planned) => planned.stageKey),
    original.stages.map((planned) => planned.stageKey),
    "automatic retries must reconstruct the original plan instead of charging for completed outputs again",
  );
}

function busyAndAttemptCapsFailClosed(): void {
  const plan = buildChannelInceptionPlan(quietRequest);
  const research = stage(plan, "channel-inception-research");
  const descriptor = channelInceptionStageDescriptor(research);
  let ledger = begin(plan);
  const positioning = stage(plan, "channel-inception-positioning");
  const outOfOrder = claimChannelInceptionLedgerStage({
    ledger,
    stage: channelInceptionStageDescriptor(positioning),
    claimant: "trigger-run:out-of-order",
    now: 1_050,
    leaseMs: 5_000,
    maximumAttempts: 2,
  });
  assert.equal(outOfOrder.disposition, "busy");
  assert.equal(outOfOrder.stage.attempts, 0);
  const first = claimChannelInceptionLedgerStage({
    ledger,
    stage: descriptor,
    claimant: "trigger-run:1",
    now: 1_100,
    leaseMs: 5_000,
    maximumAttempts: 2,
  });
  const resumed = claimChannelInceptionLedgerStage({
    ledger: first.ledger,
    stage: descriptor,
    claimant: "trigger-run:1",
    now: 1_150,
    leaseMs: 5_000,
    maximumAttempts: 2,
  });
  assert.equal(resumed.disposition, "execute");
  assert.equal(resumed.stage.attempts, 1, "same-run recovery must not spend a provider retry");
  assert.equal(
    resumed.stage.leaseVersion,
    (first.stage.leaseVersion ?? 0) + 1,
    "every reacquisition must advance the fencing token even for the same claimant",
  );
  assert.throws(
    () => checkpointChannelInceptionLedgerStage({
      ledger: resumed.ledger,
      stage: descriptor,
      claimant: "trigger-run:1",
      leaseVersion: first.stage.leaseVersion!,
      outputs: { staleZombie: true },
      now: 1_175,
    }),
    /lost its fenced lease/,
    "a stale same-runtime worker must not checkpoint after lease reacquisition",
  );
  assert.throws(
    () => completeChannelInceptionLedgerStage({
      ledger: resumed.ledger,
      stage: descriptor,
      claimant: "trigger-run:1",
      leaseVersion: first.stage.leaseVersion!,
      status: "complete",
      outputFingerprint: "f".repeat(64),
      now: 1_176,
    }),
    /lost its fenced lease/,
    "a stale same-runtime worker must not publish a completion receipt",
  );
  const concurrent = claimChannelInceptionLedgerStage({
    ledger: resumed.ledger,
    stage: descriptor,
    claimant: "trigger-run:2",
    now: 1_200,
    leaseMs: 5_000,
    maximumAttempts: 2,
  });
  assert.equal(concurrent.disposition, "busy");
  ledger = failChannelInceptionLedgerStage({
    ledger: resumed.ledger,
    stage: descriptor,
    claimant: "trigger-run:1",
    leaseVersion: resumed.stage.leaseVersion!,
    error: "transient provider failure",
    retryable: true,
    now: 1_300,
  });
  const second = claimChannelInceptionLedgerStage({
    ledger,
    stage: descriptor,
    claimant: "trigger-run:2",
    now: 1_400,
    leaseMs: 5_000,
    maximumAttempts: 2,
  });
  ledger = failChannelInceptionLedgerStage({
    ledger: second.ledger,
    stage: descriptor,
    claimant: "trigger-run:2",
    leaseVersion: second.stage.leaseVersion!,
    error: "second provider failure",
    retryable: true,
    now: 1_500,
  });
  const blocked = claimChannelInceptionLedgerStage({
    ledger,
    stage: descriptor,
    claimant: "trigger-run:3",
    now: 1_600,
    leaseMs: 5_000,
    maximumAttempts: 2,
  });
  assert.equal(blocked.disposition, "blocked");
  assert.equal(blocked.ledger.status, "blocked");
}

function readinessCannotLieOrSkipDependencies(): void {
  const plan = buildChannelInceptionPlan(quietRequest);
  const readiness = stage(plan, "channel-inception-readiness");
  const initial = begin(plan);
  const premature = claimChannelInceptionLedgerStage({
    ledger: initial,
    stage: channelInceptionStageDescriptor(readiness),
    claimant: "trigger-run:readiness",
    now: 1_100,
    leaseMs: 5_000,
    maximumAttempts: 2,
  });
  assert.equal(premature.disposition, "busy");
  assert.equal(premature.ledger.status, "running");

  let ledger = completeBefore(plan, "channel-inception-readiness", initial);
  const claimed = claimChannelInceptionLedgerStage({
    ledger,
    stage: channelInceptionStageDescriptor(readiness),
    claimant: "trigger-run:readiness",
    now: 2_000,
    leaseMs: 5_000,
    maximumAttempts: 2,
  });
  ledger = completeChannelInceptionLedgerStage({
    ledger: claimed.ledger,
    stage: channelInceptionStageDescriptor(readiness),
    claimant: "trigger-run:readiness",
    leaseVersion: claimed.stage.leaseVersion!,
    status: "blocked",
    outputs: { projection: { status: "draft", blockers: ["probe failed"] } },
    outputFingerprint: "d".repeat(64),
    now: 2_100,
  });
  assert.equal(ledger.status, "blocked");
  assert.equal(ledger.stages[readiness.moduleKey].status, "blocked");
}

function activePaidLeaseRejectsPlanReplacement(): void {
  const original = buildChannelInceptionPlan(quietRequest);
  const research = stage(original, "channel-inception-research");
  const claimed = claimChannelInceptionLedgerStage({
    ledger: begin(original),
    stage: channelInceptionStageDescriptor(research),
    claimant: "trigger-run:active",
    now: 1_100,
    leaseMs: 60_000,
    maximumAttempts: 3,
  });
  const revised = buildChannelInceptionPlan({
    ...quietRequest,
    nicheKey: "history",
    programBrief: createChannelProgramBrief({
      family: "narrated_stock",
      nicheKey: "history",
      locale: "en",
      concept: "Evidence-led history stories for curious adult viewers",
    }),
    sourceRevision: "revision-2",
  });
  assert.throws(
    () => beginChannelInceptionLedger(claimed.ledger, {
      schemaVersion: revised.schemaVersion,
      inceptionKey: revised.inceptionKey,
      requestFingerprint: revised.requestFingerprint,
      requestSnapshot: revised.requestSnapshot,
      admission: claimed.ledger.admission,
      stages: revised.stages.map(channelInceptionStageDescriptor),
    }, 1_200),
    /conflicts with active stage lease/,
  );

  const finished = completeChannelInceptionLedgerStage({
    ledger: claimed.ledger,
    stage: channelInceptionStageDescriptor(research),
    claimant: "trigger-run:active",
    leaseVersion: claimed.stage.leaseVersion!,
    status: "complete",
    outputFingerprint: "e".repeat(64),
    now: 1_300,
  });
  assert.doesNotThrow(() => beginChannelInceptionLedger(finished, {
    schemaVersion: revised.schemaVersion,
    inceptionKey: revised.inceptionKey,
    requestFingerprint: revised.requestFingerprint,
    requestSnapshot: revised.requestSnapshot,
    admission: finished.admission,
    stages: revised.stages.map(channelInceptionStageDescriptor),
  }, 1_400));
}

function providerStagesRequirePersistedCostAdmission(): void {
  const plan = buildChannelInceptionPlan(quietRequest);
  const research = stage(plan, "channel-inception-research");
  const denied = beginChannelInceptionLedger(undefined, {
    schemaVersion: plan.schemaVersion,
    inceptionKey: plan.inceptionKey,
    requestFingerprint: plan.requestFingerprint,
    requestSnapshot: plan.requestSnapshot,
    admission: {
      executionAuthorized: false,
      executionCapUsd: 0,
      probeAuthorized: false,
      probeCapUsd: 0,
      boundRequestFingerprint: plan.requestFingerprint,
    },
    stages: plan.stages.map(channelInceptionStageDescriptor),
  }, 1_000);
  const claim = claimChannelInceptionLedgerStage({
    ledger: denied,
    stage: channelInceptionStageDescriptor(research),
    claimant: "direct-trigger-without-approval",
    now: 1_100,
    leaseMs: 5_000,
    maximumAttempts: 3,
  });
  assert.equal(claim.disposition, "blocked");
  assert.equal(claim.stage.attempts, 0);
  assert.match(claim.stage.error ?? "", /admission is missing/);
  assert.equal(claim.ledger.status, "planned");
}

function liveOutputMutationInvalidatesDescendants(): void {
  const plan = buildChannelInceptionPlan(quietRequest);
  const research = stage(plan, "channel-inception-research");
  const positioning = stage(plan, "channel-inception-positioning");
  const completed = completeBefore(plan, "channel-inception-seo", begin(plan));
  assert.equal(completed.stages[positioning.moduleKey].status, "accepted");

  const changed = claimChannelInceptionLedgerStage({
    ledger: completed,
    stage: channelInceptionStageDescriptor(research),
    claimant: "trigger-run:changed-research",
    now: 2_000,
    leaseMs: 5_000,
    maximumAttempts: 3,
    observedOutputFingerprint: "9".repeat(64),
  });
  assert.equal(changed.disposition, "blocked");
  assert.match(changed.stage.error ?? "", /fresh provider approval/);
  assert.equal(changed.ledger.stages[research.moduleKey].status, "pending");
  assert.equal(changed.ledger.stages[positioning.moduleKey].status, "pending");
  assert.equal(changed.ledger.stages[positioning.moduleKey].outputs, undefined);

  const reauthorized = structuredClone(changed.ledger);
  reauthorized.admission.executionReceiptFingerprint = "f".repeat(64);
  reauthorized.admission.executionAuthorized = true;
  const freshClaim = claimChannelInceptionLedgerStage({
    ledger: reauthorized,
    stage: channelInceptionStageDescriptor(research),
    claimant: "trigger-run:fresh-approval",
    now: 2_100,
    leaseMs: 5_000,
    maximumAttempts: 3,
    observedOutputFingerprint: "9".repeat(64),
  });
  assert.equal(freshClaim.disposition, "execute");
  assert.equal(freshClaim.ledger.costReservations.length, completed.costReservations.length + 1);
}

async function providerStartedCrashUsesRecoveryOnly(): Promise<void> {
  const plan = buildChannelInceptionPlan(quietRequest);
  const research = stage(plan, "channel-inception-research");
  const first = claimChannelInceptionLedgerStage({
    ledger: begin(plan),
    stage: channelInceptionStageDescriptor(research),
    claimant: "trigger-run:crashed",
    now: 1_000,
    leaseMs: 1_000,
    maximumAttempts: 3,
  });
  const providerStarted = checkpointChannelInceptionLedgerStage({
    ledger: first.ledger,
    stage: channelInceptionStageDescriptor(research),
    claimant: "trigger-run:crashed",
    leaseVersion: first.stage.leaseVersion!,
    outputs: { providerRequestId: "research-request-1" },
    executionPhase: "provider-started",
    now: 1_100,
  });
  const { adapter, read } = memoryAdapter(providerStarted, "trigger-run:recovery");
  let executions = 0;
  let recoveries = 0;
  const result = await runChannelInceptionStage({
    plan,
    moduleKey: "channel-inception-research",
    ledger: adapter,
    loadCompleted: async () => undefined,
    execute: async () => {
      executions += 1;
      return { value: "must-not-run" };
    },
    recover: async (checkpoint) => {
      recoveries += 1;
      assert.deepEqual(checkpoint, { providerRequestId: "research-request-1" });
      return {
        value: "recovered-research",
        evidence: { providerReceipt: "research-receipt-1" },
        outputFingerprint: "7".repeat(64),
      };
    },
  });
  assert.equal(result.disposition, "accepted");
  assert.equal(executions, 0, "ambiguous paid work must never execute again");
  assert.equal(recoveries, 1);
  assert.equal(read().stages[research.moduleKey].attempts, 1);
  assert.equal(read().costReservations.length, 1);
}

async function main(): Promise<void> {
  checkpointsAndLeasesAreDurable();
  await executorRunsOnceAndRehydrates();
  await protectedExistingAssetIsAcceptedWithoutExecution();
  await finalTaskAttemptCannotRemainBuilding();
  planChangesInvalidateOnlyAffectedStages();
  retryPlanDoesNotAbsorbEarlierStageOutputs();
  busyAndAttemptCapsFailClosed();
  readinessCannotLieOrSkipDependencies();
  activePaidLeaseRejectsPlanReplacement();
  providerStagesRequirePersistedCostAdmission();
  liveOutputMutationInvalidatesDescendants();
  await providerStartedCrashUsesRecoveryOnly();
  console.log("channel inception ledger and retry tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
