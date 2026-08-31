import assert from "node:assert/strict";
import { channelInceptionLedgerGuardsForTests } from "../../../convex/channels";
import {
  beginChannelInceptionLedger,
  channelInceptionStageDescriptor,
} from "@/engine/channelInceptionLedger";
import { buildChannelInceptionPlan } from "@/engine/channelInceptionPlan";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { resolveChannelProgramRoute } from "@/engine/channelProgramRoute";
import {
  creatorIntentDiagnosisFingerprint,
  deriveCreatorIntentDiagnosis,
} from "@/engine/creatorIntentDiagnosis";
import { createChannelShowProfile } from "@/engine/channelShowProfile";
import type { CreativeCapabilitySelection } from "@/engine/creative/creativeCapabilityCatalog";
import { designPipeline } from "@/engine/designer";

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
  const capabilitySelections: readonly CreativeCapabilitySelection[] = [];
  const initialProgramRoute = resolveChannelProgramRoute(initialProgramBrief);
  const initialCreatorIntentDiagnosis = deriveCreatorIntentDiagnosis({
    programBrief: initialProgramBrief,
    programRoute: initialProgramRoute,
  });
  const initialDesign = designPipeline({
    family: initialProgramBrief.family,
    nicheKey: initialProgramBrief.nicheKey,
    locale: initialProgramBrief.locale,
    programBrief: initialProgramBrief,
    capabilitySelections,
  });
  const initialShowProfile = createChannelShowProfile({
    programBrief: initialProgramBrief,
    programRoute: initialProgramRoute,
    capabilitySelections,
    pipeline: initialDesign.pipeline,
  });
  assert.throws(
    () => assertProgramBriefIdentityMutation({
      existingIdentity: { persona: "Calm guide" },
      nextIdentity: {
        persona: "Calm guide",
        nicheKey: initialProgramBrief.nicheKey,
        programBrief: initialProgramBrief,
      },
      effectiveFamily: "narrated_stock",
    }),
    /requires a sealed channel show profile/,
    "a generic channel update cannot create a partial program identity that lacks its sealed composition",
  );
  assert.doesNotThrow(() => assertProgramBriefIdentityMutation({
    existingIdentity: {
      persona: "Calm guide",
      nicheKey: initialProgramBrief.nicheKey,
      programBrief: initialProgramBrief,
      programRoute: initialProgramRoute,
      showProfile: initialShowProfile,
    },
    nextIdentity: {
      persona: "Calm guide",
      nicheKey: initialProgramBrief.nicheKey,
      programBrief: initialProgramBrief,
      programRoute: initialProgramRoute,
      showProfile: initialShowProfile,
    },
    effectiveFamily: "narrated_stock",
    nextPipeline: initialDesign.pipeline,
  }), "an existing pre-diagnosis identity remains readable and immutable");
  assert.throws(
    () => assertProgramBriefIdentityMutation({
      existingIdentity: { persona: "Calm guide" },
      nextIdentity: {
        persona: "Calm guide",
        nicheKey: initialProgramBrief.nicheKey,
        programBrief: initialProgramBrief,
        programRoute: initialProgramRoute,
        showProfile: initialShowProfile,
      },
      effectiveFamily: "narrated_stock",
      nextPipeline: initialDesign.pipeline,
      allowFirstShowProfile: true,
    }),
    /requires a sealed creator intent diagnosis/,
    "a new admitted channel cannot omit the route-derived semantic receipt",
  );
  assert.doesNotThrow(() => assertProgramBriefIdentityMutation({
    existingIdentity: { persona: "Calm guide" },
    nextIdentity: {
      persona: "Calm guide",
      nicheKey: initialProgramBrief.nicheKey,
      programBrief: initialProgramBrief,
      programRoute: initialProgramRoute,
      creatorIntentDiagnosis: initialCreatorIntentDiagnosis,
      showProfile: initialShowProfile,
    },
    effectiveFamily: "narrated_stock",
    nextPipeline: initialDesign.pipeline,
    allowFirstShowProfile: true,
  }));
  const validLookingTamperedDiagnosis = {
    ...structuredClone(initialCreatorIntentDiagnosis),
    claimMode: "fictional_disclosed" as const,
  };
  validLookingTamperedDiagnosis.fingerprint = creatorIntentDiagnosisFingerprint(validLookingTamperedDiagnosis);
  assert.throws(
    () => assertProgramBriefIdentityMutation({
      existingIdentity: { persona: "Calm guide" },
      nextIdentity: {
        persona: "Calm guide",
        nicheKey: initialProgramBrief.nicheKey,
        programBrief: initialProgramBrief,
        programRoute: initialProgramRoute,
        creatorIntentDiagnosis: validLookingTamperedDiagnosis,
        showProfile: initialShowProfile,
      },
      effectiveFamily: "narrated_stock",
      nextPipeline: initialDesign.pipeline,
      allowFirstShowProfile: true,
    }),
    /does not match the canonical program brief and route/,
    "Convex identity admission rejects a self-hashed diagnosis that changes route semantics",
  );
  assert.throws(
    () => assertProgramBriefIdentityMutation({
      existingIdentity: { persona: "Calm guide" },
      nextIdentity: {
        persona: "Calm guide",
        nicheKey: initialProgramBrief.nicheKey,
        programBrief: initialProgramBrief,
        showProfile: initialShowProfile,
      },
      effectiveFamily: "narrated_stock",
      nextPipeline: initialDesign.pipeline,
      allowFirstShowProfile: true,
    }),
    /requires a sealed channel program route/,
    "new admission cannot persist a profile without its route identity",
  );
  assert.throws(
    () => assertProgramBriefIdentityMutation({
      existingIdentity: {
        persona: "Calm guide",
        nicheKey: initialProgramBrief.nicheKey,
        programBrief: initialProgramBrief,
        programRoute: initialProgramRoute,
        showProfile: initialShowProfile,
      },
      nextIdentity: {
        persona: "Calm guide",
        nicheKey: initialProgramBrief.nicheKey,
        programBrief: initialProgramBrief,
        showProfile: initialShowProfile,
      },
      effectiveFamily: "narrated_stock",
      nextPipeline: initialDesign.pipeline,
    }),
    /channel program route cannot be removed/,
    "a generic identity mutation cannot strip the route from a route-bearing historical channel",
  );
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
  assert.throws(
    () => assertProgramBriefIdentityMutation({
      existingIdentity: {
        persona: "Corrupt legacy profile",
        showProfile: initialShowProfile,
      },
      nextIdentity: { persona: "Corrupt legacy profile" },
      effectiveFamily: "narrated_stock",
    }),
    /show profile cannot be removed/,
    "a corrupt legacy record cannot silently lose a composition receipt during a generic mutation",
  );

  console.log("channel inception ledger security guards passed");
}

void main();
