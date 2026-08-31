import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { selfContainedStoryReceiptRequiredForRoute } from "../selfContainedStoryReceipt";

const ROOT = join(__dirname, "../../..");
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function route(requiredBlocks: string[]) {
  return {
    version: "channel-program-route-seed/v1" as const,
    routeKey: "comic/foundation/v1" as const,
    routeFingerprint: HASH_A,
    family: "comic" as const,
    contentLaneKey: "motion_comic",
    programBriefFingerprint: HASH_B,
    directives: {
      viewerJob: "Follow one original visual story.",
      claimMode: "editorial_lane_policy" as const,
      topicRules: ["Use the frozen topic."],
      scriptRules: ["Use the sealed approved story."],
      criticFocus: ["Do not replace the approved plan."],
    },
    requiredBlocks,
    context: { locale: "en-US", nicheKey: "original-motion-comic" },
  };
}

async function main(): Promise<void> {
  assert.equal(
    selfContainedStoryReceiptRequiredForRoute({
      family: "comic",
      route: route(["self_contained_story_plan", "self_contained_story", "motion_comic"]),
      topic: "A canal that changed a city",
    }),
    true,
    "a sealed self-contained route must require its receipt at the renderer boundary",
  );
  assert.equal(
    selfContainedStoryReceiptRequiredForRoute({
      family: "comic",
      route: route(["motion_comic"]),
      topic: "A historical legacy comic",
    }),
    false,
    "legacy receiptless routes retain their bounded self-planning path",
  );
  assert.throws(
    () => selfContainedStoryReceiptRequiredForRoute({
      family: "whiteboard",
      route: route(["self_contained_story", "motion_comic"]),
      topic: "wrong family",
    }),
    /family does not match/i,
  );

  for (const relative of [
    "src/trigger/blocks/whiteboardScribeBlocks.ts",
    "src/trigger/blocks/motionComicBlocks.ts",
    "src/trigger/blocks/loreShortBlocks.ts",
  ]) {
    const source = await readFile(join(ROOT, relative), "utf8");
    const receipt = source.indexOf('const approvedStoryReceipt = ctx.store["selfContainedStoryReceipt"]');
    const guard = source.indexOf("selfContainedStoryReceiptRequiredForRoute", receipt + 1);
    const legacyPlanner = source.indexOf("approvedStoryReceipt === undefined", guard + 1);
    assert.ok(receipt >= 0 && guard > receipt && legacyPlanner > guard, `${relative} must fail closed before its legacy planner`);
  }

  console.log("self-contained story route guard tests passed");
}

void main();
