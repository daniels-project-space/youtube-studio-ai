import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { artifactContract, validateArtifact } from "@/engine/artifactSchemas";
import { registerAllBlocks } from "@/engine/blocks";
import {
  resolveSelfContainedStoryPlan,
  selfContainedStoryReceiptBindingFromRoute,
  type SelfContainedStoryFamily,
} from "@/engine/selfContainedStoryReceipt";
import { getManifest } from "@/engine/registry";
import type { StageContext } from "@/engine/types";
import {
  SELF_CONTAINED_STORY_PLAN_MAX_TEXT_COST_USD,
  selfContainedStory,
  selfContainedStoryPlan,
} from "@/trigger/blocks/selfContainedStoryBlocks";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

/**
 * ABI-only future-route fixture. The current route catalog deliberately has no
 * whiteboard/comic/lore route key, so this shape-valid seed is never selected
 * by production route admission. It proves only that a future admitted route
 * can carry the shared handoff without the block inventing one.
 */
function futureRoute(family: SelfContainedStoryFamily) {
  const contract = family === "whiteboard"
    ? { lane: "whiteboard_explainer", renderer: "whiteboard_scribe" }
    : family === "comic"
      ? { lane: "motion_comic", renderer: "motion_comic" }
      : { lane: "lore_micro_doc", renderer: "lore_short" };
  return {
    version: "channel-program-route-seed/v1" as const,
    // The parser intentionally validates a run seed's frozen shape; actual
    // route admission occurs upstream and is not replicated in this module.
    routeKey: "illustrated-explainer/foundation/v1" as const,
    routeFingerprint: HASH_A,
    family,
    contentLaneKey: contract.lane,
    programBriefFingerprint: HASH_B,
    directives: {
      viewerJob: "Understand one coherent visual story.",
      claimMode: "editorial_lane_policy" as const,
      topicRules: ["Use the frozen topic."],
      scriptRules: ["Use the sealed approved story."],
      criticFocus: ["Do not replace the approved plan."],
    },
    requiredBlocks: [contract.renderer],
    context: { locale: "en-US", nicheKey: "future-shared-story-fixture" },
  };
}

function stage(store: Record<string, unknown>): StageContext {
  return {
    ownerId: "owner-fixture",
    channelId: "channel-fixture",
    runId: "run-fixture",
    keyPrefix: "owner/owner-fixture/channel/channel-fixture/",
    params: {},
    store,
    budgetUsd: 0,
    log: () => {},
  };
}

function planFor(family: SelfContainedStoryFamily) {
  if (family === "whiteboard") {
    return {
      version: "self-contained-story-plan/v1" as const,
      family,
      planner: { id: "future-planner/v1", provenance: "provider-free fixture" },
      critique: { accepted: true as const, score: 0.91, iterations: 1, issues: [] },
      storyKind: "whiteboard-storyboard/v1" as const,
      story: {
        title: "The clockwork canal",
        panels: [{
          idx: 0,
          narration: "A water clock divided the city day.",
          layers: [{
            kind: "art" as const,
            draw: "a brass water clock beside a canal",
            color: "black" as const,
            cue: "water clock",
            box: [0.1, 0.2, 0.4, 0.4],
          }],
        }],
        fullText: "A water clock divided the city day.",
      },
    };
  }
  if (family === "comic") {
    return {
      version: "self-contained-story-plan/v1" as const,
      family,
      planner: { id: "future-planner/v1", provenance: "provider-free fixture" },
      critique: { accepted: true as const, score: 0.92, iterations: 1, issues: [] },
      storyKind: "motion-comic-storyboard/v1" as const,
      story: {
        title: "The silent observatory",
        logline: "A watcher finds a signal in abandoned stone.",
        narratorVoiceId: "narrator-voice",
        characters: [],
        panels: [{
          visual: {
            environment: "ancient_ruins" as const,
            era: "ancient" as const,
            subjects: [],
            objects: ["artifact" as const],
            action: "watchful_pause" as const,
            relations: [],
            mood: "mysterious" as const,
            lighting: "moonlight" as const,
          },
          characters: [],
          shot: "wide" as const,
          lines: [{ speaker: "narrator", text: "The stones remembered every signal." }],
        }],
      },
    };
  }
  return {
    version: "self-contained-story-plan/v1" as const,
    family,
    planner: { id: "future-planner/v1", provenance: "provider-free fixture" },
    critique: { accepted: true as const, score: 0.9, iterations: 1, issues: [] },
    storyKind: "lore-plan/v1" as const,
    story: {
      scenes: [{
        line: "The forest kept its oldest records in the roots.",
        visual: "Moonlight crosses carved roots beside a hidden archive door.",
        camera: "Slowly track through the roots toward the door.",
      }],
    },
  };
}

async function main() {
  const planArtifact = artifactContract("selfContainedStoryPlan");
  const receiptArtifact = artifactContract("selfContainedStoryReceipt");
  assert.equal(planArtifact.type, "SelfContainedStoryPlan");
  assert.equal(planArtifact.opaque, false);
  assert.equal(receiptArtifact.opaque, false);
  assert.equal(selfContainedStoryPlan.paid, true, "native planning is the only paid half of the shared handoff");
  assert.deepEqual(selfContainedStoryPlan.consumes, ["topic", "channelProgramRoute", "contentLane"]);
  assert.deepEqual(selfContainedStoryPlan.produces, ["selfContainedStoryPlan"]);
  assert.ok(SELF_CONTAINED_STORY_PLAN_MAX_TEXT_COST_USD > 0, "the planner must hold a finite pre-spend ceiling");
  assert.equal(selfContainedStory.paid, undefined, "sealing must remain provider-free");

  await assert.rejects(
    () => selfContainedStoryPlan.run(stage({
      topic: "unreserved planning fixture",
      channelProgramRoute: futureRoute("whiteboard"),
      contentLane: { key: "whiteboard_explainer" },
    })),
    /compiler-signed.*reservation/i,
    "the paid planner must fail before an adapter can run without its exact reservation",
  );
  await assert.rejects(
    () => selfContainedStoryPlan.run({
      ...stage({
        topic: "mismatched lane planning fixture",
        channelProgramRoute: futureRoute("whiteboard"),
        contentLane: { key: "motion_comic" },
      }),
      stageBudgetUsd: SELF_CONTAINED_STORY_PLAN_MAX_TEXT_COST_USD,
    }),
    /active content lane.*frozen route lane/i,
    "the paid planner must reject lane drift before an adapter can run",
  );

  for (const family of ["whiteboard", "comic", "loreshort"] as const) {
    const topic = `${family} future sealed-story fixture`;
    const route = futureRoute(family);
    const plan = planFor(family);
    assert.deepEqual(validateArtifact(planArtifact, plan), plan);

    const patch = await selfContainedStory.run(stage({
      topic,
      channelProgramRoute: route,
      selfContainedStoryPlan: plan,
    }));
    const receipt = patch.selfContainedStoryReceipt;
    assert.ok(receipt, `${family} must receive a sealed receipt`);
    assert.deepEqual(validateArtifact(receiptArtifact, receipt), receipt);
    assert.equal((receipt as { family: string }).family, family);

    const binding = selfContainedStoryReceiptBindingFromRoute({ family, route, topic });
    assert.throws(
      () => resolveSelfContainedStoryPlan({
        family,
        receipt,
        binding,
        legacyPlan: { substituted: "must not become a fallback" },
      }),
      /conflicts/i,
      `${family} must reject a legacy self-plan when a sealed receipt is present`,
    );
  }

  const missingRendererRoute = { ...futureRoute("whiteboard"), requiredBlocks: ["qa_visual"] };
  await assert.rejects(
    () => selfContainedStory.run(stage({
      topic: "missing renderer route fixture",
      channelProgramRoute: missingRendererRoute,
      selfContainedStoryPlan: planFor("whiteboard"),
    })),
    /does not admit the requested renderer/i,
    "the handoff must not materialize a route which does not already admit its renderer",
  );

  await assert.rejects(
    () => selfContainedStory.run(stage({
      topic: "unapproved plan fixture",
      channelProgramRoute: futureRoute("whiteboard"),
      selfContainedStoryPlan: {
        ...planFor("whiteboard"),
        critique: { accepted: false, score: 0.1, iterations: 1, issues: ["rejected"] },
      },
    })),
    /true|invalid/i,
    "only an explicitly accepted planner/critic handoff may be sealed",
  );

  registerAllBlocks();
  const plannerManifest = getManifest("self_contained_story_plan");
  assert.ok(plannerManifest, "the bounded native planner must be centrally registered");
  assert.deepEqual(Object.keys(plannerManifest.consumes).sort(), ["channelProgramRoute", "contentLane", "topic"]);
  assert.deepEqual(Object.keys(plannerManifest.produces), ["selfContainedStoryPlan"]);
  const handoffManifest = getManifest("self_contained_story");
  assert.ok(handoffManifest, "the shared handoff block must be centrally registered");
  assert.deepEqual(Object.keys(handoffManifest.consumes).sort(), ["channelProgramRoute", "selfContainedStoryPlan", "topic"]);
  assert.deepEqual(Object.keys(handoffManifest.produces), ["selfContainedStoryReceipt"]);
  for (const renderer of ["whiteboard_scribe", "motion_comic", "lore_short"]) {
    const manifest = getManifest(renderer);
    assert.ok(manifest, `${renderer} must remain registered`);
    assert.ok("selfContainedStoryReceipt" in manifest.optionalConsumes, `${renderer} must opt into the sealed handoff`);
    assert.ok("channelProgramRoute" in manifest.optionalConsumes, `${renderer} must bind a receipt to its frozen route`);
  }

  // The receipt needs to reach the existing renderer adapters before their
  // legacy planner branch. These small source locks complement the pure block
  // test above without starting any provider, GPU, or render work.
  for (const [relativePath, planner] of [
    ["src/trigger/blocks/whiteboardScribeBlocks.ts", "planScribeWithCritique"],
    ["src/trigger/blocks/motionComicBlocks.ts", "planComicWithCritique"],
    ["src/trigger/blocks/loreShortBlocks.ts", "planLoreWithCritique"],
  ] as const) {
    const source = await readFile(join(process.cwd(), relativePath), "utf8");
    assert.match(source, /approvedStoryReceipt = ctx\.store\["selfContainedStoryReceipt"\]/);
    assert.match(source, /selfContainedStoryReceiptBindingFromRoute\(/);
    assert.match(
      source,
      new RegExp(`approvedStoryReceipt === undefined\\s*\\?\\s*\\(?\\s*await ${planner}\\(`),
      `${relativePath} must retain self-planning only for receipt-less legacy calls`,
    );
    assert.match(source, /\.\.\.receiptInput/, `${relativePath} must forward the sealed receipt to its renderer`);
  }

  console.log("self-contained story shared handoff block test passed");
}

void main();
