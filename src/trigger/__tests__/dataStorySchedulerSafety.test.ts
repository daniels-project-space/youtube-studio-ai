import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { resolveChannelProgramRoute } from "@/engine/channelProgramRoute";
import { createChannelShowProfile } from "@/engine/channelShowProfile";
import { creativeCapabilitySelection } from "@/engine/creative/creativeCapabilityCatalog";
import { sourceDataStorySchedulerAdmission } from "@/engine/dataStorySchedulerAdmission";
import { designPipeline } from "@/engine/designer";

function channelFixture(withDataStory: boolean) {
  const programBrief = createChannelProgramBrief({
    family: "narrated_stock",
    nicheKey: "educational",
    locale: "en",
    concept: withDataStory
      ? "A source-attributed data storytelling channel with animated charts and ranked comparisons."
      : "A narrated educational documentary channel with clear practical explanations.",
  });
  const capabilitySelections = withDataStory
    ? [creativeCapabilitySelection("source_attributed_data_story")]
    : [];
  const programRoute = resolveChannelProgramRoute(programBrief);
  const design = designPipeline({
    family: programBrief.family,
    nicheKey: programBrief.nicheKey,
    locale: programBrief.locale,
    programBrief,
    capabilitySelections,
  });
  const showProfile = createChannelShowProfile({
    programBrief,
    programRoute,
    capabilitySelections,
    pipeline: design.pipeline,
  });
  return {
    identity: {
      nicheKey: programBrief.nicheKey,
      programBrief,
      programRoute,
      showProfile,
    },
    family: programBrief.family,
    pipeline: design.pipeline,
  };
}

// This gate is entirely provider-free. Its only job is to prevent the
// scheduler from leasing an ordinary plan before a human has bound a reviewed
// evidence pack to the factual episode.
const originalFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = (async () => {
  fetchCalls += 1;
  throw new Error("scheduler admission must not call a provider");
}) as typeof fetch;
try {
  const supervised = sourceDataStorySchedulerAdmission(channelFixture(true));
  assert.equal(supervised.automatic, false);
  assert.match(supervised.reason, /owner-selected immutable reviewed evidence pack/i);

  const ordinary = sourceDataStorySchedulerAdmission(channelFixture(false));
  assert.equal(ordinary.automatic, true, "ordinary narrated-stock cadence remains unchanged");

  const malformedDataStory = channelFixture(true);
  const malformed = sourceDataStorySchedulerAdmission({
    ...malformedDataStory,
    identity: { ...malformedDataStory.identity, programRoute: { forged: true } },
  });
  assert.equal(
    malformed.automatic,
    false,
    "a row that still claims the supervised capability must fail closed rather than create a false plan failure",
  );
  assert.match(malformed.reason, /could not be revalidated/i);
  assert.equal(fetchCalls, 0, "the scheduler gate must not bootstrap or call a provider");
} finally {
  globalThis.fetch = originalFetch;
}

// Wiring regression: the skip branch must execute before the lazy bootstrap,
// plan claim, Casefile provider path, or any scheduler failure mutation.
const scheduler = readFileSync(new URL("../scheduler.ts", import.meta.url), "utf8");
const admission = scheduler.indexOf("const dataStoryAdmission = sourceDataStorySchedulerAdmission");
const bootstrap = scheduler.indexOf("await ensureSchedulerBootstrap();", admission);
const planClaim = scheduler.indexOf("api.contentPlan.claimNextPlanRun", admission);
const casefileDispatch = scheduler.indexOf("dispatchCasefileAutoResearch(", admission);
assert.ok(admission >= 0 && bootstrap >= 0 && planClaim >= 0 && casefileDispatch >= 0);
assert.ok(admission < bootstrap, "data-story admission must run before credential bootstrap");
assert.ok(bootstrap < planClaim, "credential bootstrap remains after the supervised skip and before ordinary claims");
assert.ok(admission < casefileDispatch, "data-story admission must run before any provider-capable Casefile path");
const skipBranch = scheduler.slice(admission, bootstrap);
assert.match(skipBranch, /if \(!dataStoryAdmission\.automatic\)[\s\S]*continue;/);
assert.doesNotMatch(skipBranch, /claimNextPlanRun|bootstrapSecrets|dispatchCasefileAutoResearch|failClaimedPlanRun/);
assert.doesNotMatch(scheduler, /failClaimedPlanRun/, "the scheduler never converts this skip into a failed plan mutation");

console.log("Data-story scheduler safety tests passed");
