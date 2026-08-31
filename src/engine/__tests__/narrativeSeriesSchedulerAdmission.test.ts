import assert from "node:assert/strict";

import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import {
  channelProgramRouteRunSeed,
  resolveChannelProgramRoute,
} from "@/engine/channelProgramRoute";
import { createNarrativeSeriesPlanFromInception } from "@/engine/narrativeSeriesIntelligence";
import {
  admitNarrativeSeriesSchedulerRun,
  narrativeSeriesSchedulerRequirement,
} from "@/engine/narrativeSeriesSchedulerAdmission";
import { serializedProgramEpisodeIdentity } from "@/lib/serializedProgramEpisode";

const digest = (value: string) => value.repeat(64);

const brief = createChannelProgramBrief({
  family: "illustrated_explainer",
  nicheKey: "history",
  locale: "en",
  concept: "A recurring character-led history series that makes turning points easy to understand.",
  serializedProgram: {
    version: "serialized_program/v1",
    seriesTitle: "Signals From History",
    seriesCount: 8,
  },
});
const route = resolveChannelProgramRoute(brief);
const routeSeed = channelProgramRouteRunSeed({ route, programBrief: brief });
const serialIdentity = serializedProgramEpisodeIdentity(routeSeed);
assert(serialIdentity, "serialized route must expose its durable series identity");
const plan = createNarrativeSeriesPlanFromInception({
  accountId: "owner-series",
  channelId: "channel-series",
  seriesIdentity: serialIdentity.value,
  channelProgramBrief: brief,
  researchEvidenceFingerprint: digest("a"),
  planningHorizonEpisodes: 3,
  topicBets: [
    { topic: "The signal that changed a city", hookPromise: "A recurring guide follows one signal from curiosity to a city-wide change." },
    { topic: "The map that rewrote a journey", hookPromise: "The guide learns why a clearer map changes what people dare to do." },
    { topic: "The tool that changed a workshop", hookPromise: "A small tool changes who can make, share, and improve an idea." },
  ],
});
const identity = {
  programBrief: brief,
  programRoute: route,
  narrativeSeriesPlan: {
    version: "narrative-series-intelligence/v1" as const,
    fingerprint: plan.fingerprint,
    seriesIdentity: plan.seriesIdentity,
    researchEvidenceFingerprint: digest("a"),
    planningHorizonEpisodes: plan.planningHorizonEpisodes,
  },
};

const requirement = narrativeSeriesSchedulerRequirement({
  ownerId: "owner-series",
  channelId: "channel-series",
  identity,
});
assert.equal(requirement.status, "plan_required");
if (requirement.status !== "plan_required") throw new Error("expected a series plan requirement");

const admitted = admitNarrativeSeriesSchedulerRun({ requirement, plan });
assert.equal(admitted.status, "eligible", admitted.status === "blocked" ? admitted.reason : undefined);
if (admitted.status !== "eligible") throw new Error("expected a sealed narrative series selector");
assert.equal(admitted.selector.seriesPlanFingerprint, plan.fingerprint);
assert.equal(admitted.selector.routeFingerprint, route.fingerprint);
assert.deepEqual(admitted.selector.acceptedCharacterAdapters, []);

const substituted = admitNarrativeSeriesSchedulerRun({
  requirement,
  plan: { ...plan, fingerprint: digest("b") },
});
assert.equal(substituted.status, "blocked", "a selector cannot be minted for substituted horizon data");

const missingPointer = narrativeSeriesSchedulerRequirement({
  ownerId: "owner-series",
  channelId: "channel-series",
  identity: { programBrief: brief, programRoute: route },
});
assert.equal(missingPointer.status, "blocked", "serialized channels cannot fall back to generic topic planning");

const nonSerialBrief = createChannelProgramBrief({
  family: "illustrated_explainer",
  nicheKey: "history",
  locale: "en",
  concept: "A standalone history explainer channel.",
});
assert.deepEqual(
  narrativeSeriesSchedulerRequirement({
    ownerId: "owner-series",
    channelId: "channel-series",
    identity: { programBrief: nonSerialBrief },
  }),
  { status: "not_serialized" },
);

console.log("NARRATIVE SERIES SCHEDULER ADMISSION PASS");
