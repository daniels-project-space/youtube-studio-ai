import assert from "node:assert/strict";
import { assertPlanWeekPreparedNarrationArgs, buildPreparedImageShots } from "@/trigger/planWeekPreparedNarration";
import { planWeekPreparationKey } from "@/lib/planWeekPreparation";
import type { PlanWeekPreparationManifest, PlanWeekPreparedNarration } from "@/lib/planWeekPreparation";

const base = {
  ownerId: "owner-1",
  channelId: "channel-1",
  channelSlug: "history",
  batchId: "batch-1",
  itemId: "item-1",
  manifestSha256: "a".repeat(64),
  maxCostUsd: 2,
  provider: "qwen3" as const,
  speaker: "Ryan",
  language: "en",
  speed: 0.96,
  baseGapSec: 0.9,
  jitterSec: 0.15,
};

const parsed = assertPlanWeekPreparedNarrationArgs({
  ...base,
  manifestKey: planWeekPreparationKey(base),
});
assert.equal(parsed.provider, "qwen3");
assert.equal(parsed.speed, 0.96);
assert.equal(parsed.baseGapSec, 0.9);

assert.throws(
  () => assertPlanWeekPreparedNarrationArgs({ ...base, manifestKey: "owner/foreign/not-a-manifest" }),
  /canonical/,
);
assert.throws(
  () => assertPlanWeekPreparedNarrationArgs({ ...base, manifestKey: planWeekPreparationKey(base), maxCostUsd: 0 }),
  /maxCostUsd/,
);
assert.throws(
  () => assertPlanWeekPreparedNarrationArgs({ ...base, manifestKey: planWeekPreparationKey(base), speed: 1.4 }),
  /speed/,
);
assert.throws(
  () => assertPlanWeekPreparedNarrationArgs({ ...base, manifestKey: planWeekPreparationKey(base), provider: "unknown" }),
  /provider/,
);

const visualManifest: PlanWeekPreparationManifest = {
  version: "plan-week-preparation/inputs-v1",
  ownerId: "owner-1",
  channelId: "channel-1",
  batchId: "batch-1",
  itemId: "item-1",
  itemKey: "week-1:0",
  requestKey: "week-1",
  channelSlug: "history",
  frozenAt: 1,
  plan: {
    topic: "A missing pin changed a kingdom",
    title: "The Missing Pin",
    description: "A short history story.",
    sceneSeed: "A battered lock over a medieval market.",
    thumbnailKey: "owner/owner-1/channel/history/plan/item-1.jpg",
    thumbnailSource: "planner_artwork",
  },
  execution: {
    pipeline: [{ block: "novita_render_images" }],
    moduleConfig: {},
    seedStore: { styleDNA: { visual: "inked documentary" }, styleGrammar: "inked documentary" },
  },
  prompts: { script: "", narration: "", shotlist: "", visual: "Keep the lock readable." },
};
const visualNarration = {
  narrationDurationSec: 10,
  sentenceTimings: [
    { text: "The old lock was never meant to open.", start: 0, end: 4 },
    { text: "One missing pin changed the kingdom.", start: 4, end: 10 },
  ],
} as unknown as PlanWeekPreparedNarration;
const imagePacket = buildPreparedImageShots(visualManifest, visualNarration);
assert.equal(imagePacket.shots.length, 2);
assert.equal(imagePacket.generationProfile, "production");
assert.match(imagePacket.shots[0]!.prompt, /Keep the lock readable/);
assert.equal(imagePacket.shots[0]!.candidateCount, 2);

console.log("weekly prepared narration producer contract passed");
