import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildChannelInceptionPlan } from "@/engine/channelInceptionPlan";
import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { resolveChannelProgramRoute } from "@/engine/channelProgramRoute";
import { createChannelShowProfile } from "@/engine/channelShowProfile";
import { designPipeline } from "@/engine/designer";
import {
  PRODUCTION_ROUTE_QUALIFICATION_REQUIRED_MARKER,
  productionRouteQualificationReceiptAdmission,
  productionRouteQualificationRequirement,
} from "@/engine/productionRouteQualificationAdmission";
import {
  readProductionRouteInceptionEvidence,
  readProductionRoutePlannerEvidence,
  readProductionRouteQualificationBinding,
  readProductionRouteRuntimeEvidence,
  readProductionRouteVisualMatterEvidence,
} from "@/engine/productionRouteQualification";
import {
  createRoutePreflightReadyReceipt,
  ROUTE_PREFLIGHT_READY,
  ROUTE_RELEASE_QUALIFIED,
} from "@/engine/productionRouteQualificationReceipt";

const OWNER = "owner_route_qualification_admission";
const CHANNEL = "channel_route_qualification_admission";

function qualifiedBindingFixture() {
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
  const design = designPipeline({
    family: "shorts",
    nicheKey: "educational",
    locale: "en",
    lengthMinutes: 1,
    programBrief,
    programRoute,
  });
  const showProfile = createChannelShowProfile({ programBrief, programRoute, pipeline: design.pipeline });
  const identity = {
    programBrief,
    programRoute,
    showProfile,
  };
  const binding = readProductionRouteQualificationBinding({
    programBrief,
    programRoute,
    showProfile,
    pipeline: design.pipeline,
  });
  return { programBrief, programRoute, design, showProfile, identity, binding };
}

const fixture = qualifiedBindingFixture();
const legacyRequirement = productionRouteQualificationRequirement({
  path: "normal_cadence",
  identity: fixture.identity,
  family: "shorts",
  contentLane: undefined,
  pipeline: fixture.design.pipeline,
});
assert.equal(legacyRequirement.requiresReceipt, false, "the certified five-family surface must not be migrated by surprise");
assert.equal(legacyRequirement.level, ROUTE_RELEASE_QUALIFIED);
assert.equal(
  productionRouteQualificationReceiptAdmission({
    requirement: legacyRequirement,
    row: null,
    ownerId: OWNER,
    channelId: CHANNEL,
  }).automatic,
  true,
);

const markedIdentity = {
  ...fixture.identity,
  productionRouteQualificationRequirement: PRODUCTION_ROUTE_QUALIFICATION_REQUIRED_MARKER,
};
const normalRequirement = productionRouteQualificationRequirement({
  path: "normal_cadence",
  identity: markedIdentity,
  family: "shorts",
  contentLane: undefined,
  pipeline: fixture.design.pipeline,
});
assert.equal(normalRequirement.requiresReceipt, true);
assert.equal(normalRequirement.level, ROUTE_RELEASE_QUALIFIED);
assert.ok(normalRequirement.binding, normalRequirement.reason);
assert.equal(
  productionRouteQualificationReceiptAdmission({
    requirement: normalRequirement,
    row: null,
    ownerId: OWNER,
    channelId: CHANNEL,
  }).automatic,
  false,
  "a marked normal-cadence route must never treat a missing release receipt as automatic",
);

const privateRequirement = productionRouteQualificationRequirement({
  path: "private_benchmark_manual",
  identity: markedIdentity,
  family: "shorts",
  contentLane: undefined,
  pipeline: fixture.design.pipeline,
});
assert.equal(privateRequirement.requiresReceipt, true);
assert.equal(privateRequirement.level, ROUTE_PREFLIGHT_READY, "private benchmark/manual work may use preflight only");
assert.ok(privateRequirement.binding, privateRequirement.reason);

const planner = readProductionRoutePlannerEvidence({
  binding: fixture.binding,
  options: {
    family: "shorts",
    nicheKey: "educational",
    locale: "en",
    lengthMinutes: 1,
    programBrief: fixture.programBrief,
    programRoute: fixture.programRoute,
  },
});
const inception = readProductionRouteInceptionEvidence({
  binding: fixture.binding,
  plan: buildChannelInceptionPlan({
    ownerId: OWNER,
    channelRef: CHANNEL,
    name: "Clear Systems",
    slug: "clear-systems",
    family: "shorts",
    nicheKey: "educational",
    sourceRevision: "route-qualification-admission-test/v1",
    pipelineSourceFingerprint: fixture.binding.pipelineFingerprint,
    programBrief: fixture.programBrief,
    programRoute: fixture.programRoute,
    showProfile: fixture.showProfile,
    includeProbe: false,
  }),
});
const runtime = readProductionRouteRuntimeEvidence({
  binding: fixture.binding,
  planner,
  pipeline: fixture.design.pipeline,
});
const visualMatter = readProductionRouteVisualMatterEvidence({ binding: fixture.binding });
const preflight = createRoutePreflightReadyReceipt({
  ownerId: OWNER,
  channelId: CHANNEL,
  binding: fixture.binding,
  planner,
  inception,
  runtime,
  visualMatter,
});
const currentPreflightRow = {
  level: ROUTE_PREFLIGHT_READY,
  ownerId: OWNER,
  channelId: CHANNEL,
  bindingFingerprint: fixture.binding.bindingFingerprint,
  receiptFingerprint: preflight.receiptFingerprint,
  receipt: preflight,
};
assert.equal(
  productionRouteQualificationReceiptAdmission({
    requirement: privateRequirement,
    row: currentPreflightRow,
    ownerId: OWNER,
    channelId: CHANNEL,
  }).automatic,
  true,
  "the explicit future private benchmark/manual lane accepts only its matching current preflight receipt",
);
assert.equal(
  productionRouteQualificationReceiptAdmission({
    requirement: normalRequirement,
    row: currentPreflightRow,
    ownerId: OWNER,
    channelId: CHANNEL,
  }).automatic,
  false,
  "a preflight receipt must never authorize normal cadence",
);

const nonCertifiedMissingSeal = productionRouteQualificationRequirement({
  path: "normal_cadence",
  identity: {},
  family: "cinematic",
  contentLane: "cinematic_ai",
  pipeline: [],
});
assert.equal(nonCertifiedMissingSeal.requiresReceipt, true, "shared-unlock families fail closed before they can lease a plan");
assert.equal(nonCertifiedMissingSeal.binding, undefined);
assert.equal(
  productionRouteQualificationReceiptAdmission({
    requirement: nonCertifiedMissingSeal,
    row: null,
    ownerId: OWNER,
    channelId: CHANNEL,
  }).automatic,
  false,
);

// Wiring regressions: both checks must precede their first irreversible
// boundary. The scheduler owns plan leasing; the worker owns execution leases
// and provider credential bootstrap.
const scheduler = readFileSync(new URL("../../trigger/scheduler.ts", import.meta.url), "utf8");
const schedulerGate = scheduler.indexOf("const routeQualificationRequirement = productionRouteQualificationRequirement");
const schedulerBootstrap = scheduler.indexOf("await ensureSchedulerBootstrap();", schedulerGate);
const schedulerPlanClaim = scheduler.indexOf("api.contentPlan.claimNextPlanRun", schedulerGate);
assert.ok(schedulerGate >= 0 && schedulerBootstrap >= 0 && schedulerPlanClaim >= 0);
assert.ok(schedulerGate < schedulerBootstrap);
assert.ok(schedulerGate < schedulerPlanClaim);
assert.match(
  scheduler.slice(schedulerGate, schedulerBootstrap),
  /skipping without bootstrap, plan claim, provider work, or failure mutation/,
);

const worker = readFileSync(new URL("../../trigger/runPipeline.ts", import.meta.url), "utf8");
const workerGate = worker.indexOf("const routeQualificationRequirement = productionRouteQualificationRequirement");
const workerLease = worker.indexOf("const leaseOwner = ctx.run.id;", workerGate);
const workerBootstrap = worker.indexOf("await bootstrapSecrets(", workerGate);
assert.ok(workerGate >= 0 && workerLease >= 0 && workerBootstrap >= 0);
assert.ok(workerGate < workerLease, "missing/mismatched receipts must return before execution lease");
assert.ok(workerGate < workerBootstrap, "missing/mismatched receipts must return before provider bootstrap");
assert.match(
  worker.slice(workerGate, workerLease),
  /qualificationBlocked: true[\s\S]*manualGate: true/,
);

console.log("Production route qualification admission tests passed");
