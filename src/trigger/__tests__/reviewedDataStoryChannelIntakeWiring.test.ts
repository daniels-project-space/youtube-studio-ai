import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), "src", path), "utf8");
}

const buildRoute = source("app/api/build-channel/route.ts");
const inception = source("trigger/designChannelInception.ts");
const wizard = source("app/(app)/channels/new/page.tsx");

assert.match(
  buildRoute,
  /requestedMode = body\.mode \?\? designMode[\s\S]*assertReviewedDataStoryChannelIntake[\s\S]*supervisedDataStoryIntake:/,
  "the authenticated creator derives and revalidates the sealed review-first mode before dispatch",
);
assert.match(
  wizard,
  /Create reviewed Data Story intake/,
  "the owner-facing toggle names the review-first workflow",
);
assert.match(
  wizard,
  /supervisedDataStoryIntake: "reviewed_data_story_intake\/v1"[\s\S]*mode: "reviewed_data_story_intake\/v1"/,
  "the review-first selection carries its exact sealed mode through recovery and submission",
);
const shellReturn = inception.indexOf("supervisedDataStoryIntake: true");
const bootstrap = inception.indexOf("await bootstrapSecrets(log)");
assert.ok(shellReturn >= 0 && bootstrap >= 0 && shellReturn < bootstrap,
  "the supervised shell returns before secret hydration, provider setup, render, and external actions");
assert.match(
  inception,
  /assertReviewedDataStoryChannelIntake[\s\S]*approvedForPublish:[\s\S]*approveSetupSpend:[\s\S]*runProbe:[\s\S]*autoYoutube:/,
  "direct Trigger payloads independently revalidate every no-spend/no-publication boundary",
);

console.log("Reviewed data-story channel-intake wiring tests passed");
