import assert from "node:assert/strict";
import {
  materializeSelfContainedStoryPlanningHandoff,
  produceSelfContainedStoryPlan,
  type CritiquedSelfContainedStory,
} from "@/engine/selfContainedStoryPlanning";

const whiteboardOutcome: CritiquedSelfContainedStory = {
  planner: {
    id: "fixture-non-google-storyboard/v1",
    provenance: "provider-free fixture",
  },
  critique: { accepted: true, score: 0.93, iterations: 1, issues: [] },
  story: {
    title: "The clockwork canal",
    panels: [{
      idx: 0,
      narration: "A water clock divided the city day.",
      layers: [{
        kind: "art",
        draw: "a brass water clock beside a canal",
        color: "black",
        cue: "water clock",
        box: [0.1, 0.2, 0.4, 0.4],
      }],
    }],
    fullText: "A water clock divided the city day.",
  },
};

const route = {
  family: "whiteboard" as const,
  contentLaneKey: "whiteboard_explainer",
  requiredBlocks: ["self_contained_story_plan", "self_contained_story", "whiteboard_scribe"],
  requiredBlockOrder: [
    ["self_contained_story_plan", "self_contained_story"],
    ["self_contained_story", "whiteboard_scribe"],
  ],
};

async function main(): Promise<void> {
  let calls = 0;
  const plan = await produceSelfContainedStoryPlan({
    route,
    planners: {
      whiteboard: async () => {
        calls += 1;
        return whiteboardOutcome;
      },
    },
  });
  assert.equal(calls, 1, "exactly one family-native planner may run");
  assert.equal(plan.family, "whiteboard");
  assert.equal(plan.storyKind, "whiteboard-storyboard/v1");
  assert.deepEqual(plan.planner, whiteboardOutcome.planner);
  assert.deepEqual(plan.critique, whiteboardOutcome.critique);

  const composed = materializeSelfContainedStoryPlanningHandoff({
    route,
    visualEngine: "whiteboard_scribe",
    pipeline: [
      { block: "compliance_check" },
      { block: "whiteboard_scribe" },
      { block: "qa_visual" },
    ],
  });
  assert.deepEqual(
    composed.map((entry) => entry.block),
    ["compliance_check", "self_contained_story_plan", "self_contained_story", "whiteboard_scribe", "qa_visual"],
    "a route-owned self-contained story must be planned and sealed immediately before its renderer",
  );
  assert.throws(
    () => materializeSelfContainedStoryPlanningHandoff({
      route,
      visualEngine: "whiteboard_scribe",
      pipeline: [
        { block: "self_contained_story" },
        { block: "whiteboard_scribe" },
      ],
    }),
    /plan and seal must be materialized together/i,
  );

  let blockedCalls = 0;
  await assert.rejects(
    () => produceSelfContainedStoryPlan({
      route: { ...route, requiredBlockOrder: [["self_contained_story", "whiteboard_scribe"]] },
      planners: { whiteboard: async () => { blockedCalls += 1; return whiteboardOutcome; } },
    }),
    /must order native planning before sealing/i,
  );
  assert.equal(blockedCalls, 0, "a malformed route must fail before a planner/provider action");

  await assert.rejects(
    () => produceSelfContainedStoryPlan({
      route: { ...route, contentLaneKey: "motion_comic" },
      planners: { whiteboard: async () => whiteboardOutcome },
    }),
    /requires content lane whiteboard_explainer/i,
  );

  const loreRoute = {
    family: "loreshort" as const,
    contentLaneKey: "lore_micro_doc",
    requiredBlocks: ["self_contained_story_plan", "self_contained_story", "lore_short"],
    requiredBlockOrder: [
      ["self_contained_story_plan", "self_contained_story"],
      ["self_contained_story", "lore_short"],
    ],
  };
  const lorePlan = await produceSelfContainedStoryPlan({
    route: loreRoute,
    planners: {
      loreshort: async () => ({
        planner: { id: "lore-short-claude-critic-plan/v1", provenance: "provider-free fixture" },
        critique: { accepted: true as const, score: 0.91, iterations: 2, issues: [] },
        story: {
          scenes: [{
            line: "The forest kept its oldest records in the roots.",
            shot: "wide",
            visual: "Moonlight crosses carved roots beside a hidden archive door.",
            camera: "Slowly track through the roots toward the door.",
          }],
        },
      }),
    },
  });
  assert.equal(lorePlan.family, "loreshort");
  assert.equal(lorePlan.storyKind, "lore-plan/v1");
  assert.deepEqual(
    materializeSelfContainedStoryPlanningHandoff({
      route: loreRoute,
      visualEngine: "lore_short",
      pipeline: [{ block: "lore_short" }, { block: "qa_visual" }],
    }).map((entry) => entry.block),
    ["self_contained_story_plan", "self_contained_story", "lore_short", "qa_visual"],
    "the Lore adapter must receive the same sealed plan → renderer order as the other self-contained families",
  );

  console.log("self-contained story planning tests passed");
}

void main();
