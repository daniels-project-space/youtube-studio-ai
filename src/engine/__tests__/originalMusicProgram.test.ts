import assert from "node:assert/strict";

import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import {
  channelProgramRouteRunSeed,
  resolveChannelProgramRoute,
} from "@/engine/channelProgramRoute";
import {
  assertOriginalMusicProgramPlanBinding,
  createOriginalMusicProgramPlan,
  ORIGINAL_MUSIC_PROGRAM_PLAN_VERSION,
} from "@/engine/originalMusicProgram";

const brief = createChannelProgramBrief({
  family: "music_loop",
  locale: "en-US",
  nicheKey: "lofi",
  concept: "Original late-night instrumental focus sessions with seamless, calm visual loops.",
  audience: "people seeking focused, instrumental background music",
  sampleTopics: ["rainy night focus", "quiet city study", "warm late night work"],
});
const route = resolveChannelProgramRoute(brief);
assert.ok(route, "music loop has a route");
const seed = channelProgramRouteRunSeed({ route: route!, programBrief: brief });

const plan = createOriginalMusicProgramPlan({
  route: seed,
  topic: "Rainy city focus after midnight",
  setting: "rainy city windows after midnight",
  visualStyle: "lofi ambient",
  audioDirection: "Warm original Rhodes-and-vinyl instrumental; no vocals, no lyrics, loop-ready.",
});

assert.equal(plan.version, ORIGINAL_MUSIC_PROGRAM_PLAN_VERSION);
assert.equal(plan.routeKey, "music-loop/foundation/v1");
assert.equal(plan.audio.loopable, true);
assert.equal(plan.visual.setting, "rainy city windows after midnight");
assert.equal(assertOriginalMusicProgramPlanBinding({
  plan,
  route: seed,
  topic: "Rainy city focus after midnight",
}).fingerprint, plan.fingerprint);

assert.throws(() => assertOriginalMusicProgramPlanBinding({
  plan,
  route: seed,
  topic: "Different episode",
}), /current topic/);

assert.throws(() => createOriginalMusicProgramPlan({
  route: { ...seed, routeKey: "sleep/foundation/v1" },
  topic: "Rainy city focus after midnight",
}), /music-loop\/foundation\/v1/);

console.log("original music program contract PASS");
