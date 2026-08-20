import assert from "node:assert/strict";
import { channelInceptionLedgerGuardsForTests } from "../../../convex/channels";
import {
  beginChannelInceptionLedger,
  channelInceptionStageDescriptor,
} from "@/engine/channelInceptionLedger";
import { buildChannelInceptionPlan } from "@/engine/channelInceptionPlan";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";

async function main(): Promise<void> {
  const {
    requireInceptionService,
    assertInceptionOutputSize,
    assertInceptionStageDescriptor,
    invalidatePersistedInceptionProofs,
    assertProgramBriefIdentityMutation,
  } =
    channelInceptionLedgerGuardsForTests;

  await assert.doesNotReject(() => requireInceptionService({
    auth: { getUserIdentity: async () => ({ role: "service" }) },
  }));
  await assert.rejects(() => requireInceptionService({
    auth: { getUserIdentity: async () => ({ role: "owner" }) },
  }), /service identity/);
  await assert.rejects(() => requireInceptionService({
    auth: { getUserIdentity: async () => null },
  }), /service identity/);

  assert.doesNotThrow(() => assertInceptionOutputSize({ probeRunIds: ["run_1", "run_2"] }));
  assert.throws(
    () => assertInceptionOutputSize({ evidence: "x".repeat(16_001) }),
    /exceeds 16000 characters/,
  );

  const plan = buildChannelInceptionPlan({
    ownerId: "owner_daniel",
    channelRef: "channel:quiet-stoic",
    name: "The Quiet Stoic",
    slug: "quiet-stoic",
    family: "narrated_stock",
    nicheKey: "psychology",
    sourceRevision: "security-test",
    pipelineSourceFingerprint: "pipeline-v1",
    programBrief: createChannelProgramBrief({
      family: "narrated_stock",
      nicheKey: "psychology",
      locale: "en",
      concept: "Grounded stoic philosophy lessons with a calm practical program",
    }),
  });
  const descriptor = channelInceptionStageDescriptor(plan.stages[0]);
  assert.doesNotThrow(() => assertInceptionStageDescriptor(descriptor));
  assert.throws(
    () => assertInceptionStageDescriptor({
      ...descriptor,
      moduleKey: "channel-inception-unknown" as typeof descriptor.moduleKey,
    }),
    /invalid channel inception module key/,
  );
  assert.throws(
    () => assertInceptionStageDescriptor({
      ...descriptor,
      idempotencyKey: `${descriptor.idempotencyKey}:forged`,
    }),
    /invalid channel inception idempotency key/,
  );

  const admission = {
    executionAuthorized: true,
    executionCapUsd: plan.executionCostCeilingUsd,
    executionReceiptFingerprint: "a".repeat(64),
    probeAuthorized: false,
    probeCapUsd: 0,
    boundRequestFingerprint: plan.requestFingerprint,
  };
  const ledger = beginChannelInceptionLedger(undefined, {
    schemaVersion: plan.schemaVersion,
    inceptionKey: plan.inceptionKey,
    requestFingerprint: plan.requestFingerprint,
    requestSnapshot: plan.requestSnapshot,
    stages: plan.stages.map(channelInceptionStageDescriptor),
    admission,
  }, 100);
  for (const stage of Object.values(ledger.stages)) {
    stage.status = "complete";
    stage.outputFingerprint = "b".repeat(64);
  }
  const invalidated = invalidatePersistedInceptionProofs(
    ledger,
    ["channel-inception-positioning"],
    "owner",
  );
  assert.equal(invalidated?.stages["channel-inception-research"].status, "complete");
  assert.equal(invalidated?.stages["channel-inception-positioning"].status, "pending");
  assert.equal(invalidated?.stages["channel-inception-avatar"].status, "pending");
  assert.equal(invalidated?.stages["channel-inception-readiness"].status, "pending");

  const leased = structuredClone(ledger);
  leased.stages["channel-inception-positioning"].status = "running";
  assert.throws(
    () => invalidatePersistedInceptionProofs(
      leased,
      ["channel-inception-positioning"],
      "owner",
    ),
    /locked while inception stage is running/,
  );
  assert.equal(
    invalidatePersistedInceptionProofs(
      leased,
      ["channel-inception-positioning"],
      "service",
    ),
    undefined,
    "the service may persist its own leased stage output without invalidating its lease",
  );

  const initialProgramBrief = createChannelProgramBrief({
    family: "narrated_stock",
    nicheKey: "psychology",
    locale: "en",
    concept: "Grounded stoic philosophy lessons with a calm practical program",
  });
  const revisedProgramBrief = createChannelProgramBrief({
    family: "narrated_stock",
    nicheKey: "psychology",
    locale: "en",
    concept: "A sharper daily stoic challenge program for ambitious professionals",
  });
  assert.doesNotThrow(() => assertProgramBriefIdentityMutation({
    existingIdentity: { persona: "Calm guide" },
    nextIdentity: {
      persona: "Calm guide",
      nicheKey: initialProgramBrief.nicheKey,
      programBrief: initialProgramBrief,
    },
    effectiveFamily: "narrated_stock",
  }));
  assert.throws(
    () => assertProgramBriefIdentityMutation({
      existingIdentity: { persona: "Calm guide" },
      nextIdentity: { persona: "Calm guide", nicheKey: "history", programBrief: initialProgramBrief },
      effectiveFamily: "narrated_stock",
    }),
    /nicheKey history must match canonical program brief nicheKey psychology/,
  );
  assert.throws(
    () => assertProgramBriefIdentityMutation({
      existingIdentity: { persona: "Calm guide" },
      nextIdentity: { persona: "Calm guide", programBrief: initialProgramBrief },
      effectiveFamily: "narrated_stock",
    }),
    /nicheKey undefined must match canonical program brief nicheKey psychology/,
  );
  assert.throws(
    () => assertProgramBriefIdentityMutation({
      existingIdentity: {
        persona: "Calm guide",
        nicheKey: initialProgramBrief.nicheKey,
        programBrief: initialProgramBrief,
      },
      nextIdentity: { persona: "Calm guide" },
      effectiveFamily: "narrated_stock",
    }),
    /cannot be removed/,
  );
  assert.throws(
    () => assertProgramBriefIdentityMutation({
      existingIdentity: {
        persona: "Calm guide",
        nicheKey: initialProgramBrief.nicheKey,
        programBrief: initialProgramBrief,
      },
      nextIdentity: {
        persona: "Calm guide",
        nicheKey: revisedProgramBrief.nicheKey,
        programBrief: revisedProgramBrief,
      },
      effectiveFamily: "narrated_stock",
    }),
    /immutable once stored/,
  );
  assert.throws(
    () => assertProgramBriefIdentityMutation({
      existingIdentity: { persona: "Calm guide" },
      nextIdentity: {
        persona: "Calm guide",
        nicheKey: initialProgramBrief.nicheKey,
        programBrief: initialProgramBrief,
      },
      effectiveFamily: "illustrated_explainer",
    }),
    /does not match the effective channel family/,
  );

  console.log("channel inception ledger security guards passed");
}

void main();
