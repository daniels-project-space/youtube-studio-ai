import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { resolveChannelProgramRoute } from "@/engine/channelProgramRoute";
import { createChannelShowProfile } from "@/engine/channelShowProfile";
import { designPipeline } from "@/engine/designer";
import { assertPlanWeekChannelRouteAdmission } from "@/trigger/planWeekAhead";

function admittedChannel(input: {
  family: "narrated_stock" | "quizyear";
  programIntent?: { kind: "certified_quiz"; profile: "world_geography" };
  serializedProgram?: {
    version: "serialized_program/v1";
    seriesTitle: string;
    seriesCount?: number;
  };
}) {
  const programBrief = createChannelProgramBrief({
    family: input.family,
    nicheKey: input.family === "quizyear" ? "educational" : "psychology",
    locale: "en",
    concept: "A clear, recurring channel program with a bounded viewer promise.",
    ...(input.programIntent ? { programIntent: input.programIntent } : {}),
    ...(input.serializedProgram ? { serializedProgram: input.serializedProgram } : {}),
  });
  const programRoute = resolveChannelProgramRoute(programBrief);
  const design = designPipeline({
    family: programBrief.family,
    nicheKey: programBrief.nicheKey,
    locale: programBrief.locale,
    programBrief,
    programRoute,
  });
  const showProfile = createChannelShowProfile({
    programBrief,
    programRoute,
    pipeline: design.pipeline,
  });
  return {
    identity: {
      nicheKey: programBrief.nicheKey,
      programBrief,
      programRoute,
      showProfile,
    },
    pipeline: design.pipeline,
  };
}

const narrated = admittedChannel({ family: "narrated_stock" });
const admission = assertPlanWeekChannelRouteAdmission(narrated);
assert.equal(admission.programRoute.routeKey, "narrated-stock/foundation/v1");
assert.match(
  admission.programDirective,
  /FROZEN CHANNEL PROGRAM ROUTE: narrated-stock\/foundation\/v1/,
  "Topicraft must receive a directive derived from the admitted route, never a raw selector",
);

assert.throws(
  () => assertPlanWeekChannelRouteAdmission({
    identity: { nicheKey: "psychology" },
    pipeline: narrated.pipeline,
  }),
  /missing a canonical program brief/,
  "a route-less legacy channel cannot create a fresh week-ahead batch",
);

const quiz = admittedChannel({
  family: "quizyear",
  programIntent: { kind: "certified_quiz", profile: "world_geography" },
});
assert.throws(
  () => assertPlanWeekChannelRouteAdmission(quiz),
  /certified QuizYear routes require their dedicated sealed planner/,
  "generic week-ahead Topicraft cannot create raw quiz plans",
);

const serialized = admittedChannel({
  family: "narrated_stock",
  serializedProgram: {
    version: "serialized_program/v1",
    seriesTitle: "Seven Days of Better Questions",
    seriesCount: 7,
  },
});
assert.throws(
  () => assertPlanWeekChannelRouteAdmission(serialized),
  /require the atomic episode reservation planner/,
  "generic week-ahead planning must stop before reserve/optimizer/provider spend for a serialized route",
);

const taskSource = readFileSync(new URL("../planWeekAhead.ts", import.meta.url), "utf8");
const routeAdmissionIndex = taskSource.indexOf(
  "routeAdmission = assertPlanWeekChannelRouteAdmission(channel)",
);
assert.ok(routeAdmissionIndex >= 0, "the worker must admit the route after loading the channel");
for (const [boundary, index] of [
  ["api.contentPlan.reservePlanBatch", taskSource.indexOf("api.contentPlan.reservePlanBatch")],
  ["await optimizeTopics({", taskSource.indexOf("await optimizeTopics({")],
  [
    "generateNanoBananaImageWithReceipt",
    taskSource.lastIndexOf("generateNanoBananaImageWithReceipt("),
  ],
] as const) {
  assert.ok(index >= 0, `expected ${boundary} in the plan-week worker`);
  assert.ok(
    routeAdmissionIndex < index,
    `route admission must exit before ${boundary} can persist or spend`,
  );
}
assert.ok(
  taskSource.indexOf("programDirective: routeAdmission.programDirective") > routeAdmissionIndex,
  "the provider planner must receive the route-derived topic directive",
);

const apiSource = readFileSync(new URL("../../app/api/plan-week/route.ts", import.meta.url), "utf8");
assert.match(apiSource, /tasks\.trigger\("plan-week-ahead"/);
assert.doesNotMatch(
  apiSource,
  /optimizeTopics|generateNanoBananaImageWithReceipt/,
  "the API may only dispatch the route-gated worker; it must not own an alternate planner path",
);

console.log("plan-week program-route admission tests passed");
