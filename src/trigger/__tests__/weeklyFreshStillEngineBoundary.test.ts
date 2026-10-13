import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generationProfile } from "@/engine/generationProfiles";
import { buildStudioZImageStageRequests } from "@/trigger/planWeekPreparedImages";
import type { PlanWeekPreparedImagesArgs } from "@/trigger/planWeekPreparedImages";

// Held Engine requests preserve Studio's exact Final landscape contract.
// They do not turn into prepared images until the candidate bytes and QA pass.
for (const [name, width, height, candidates] of [
  ["production", 1920, 1088, 1],
  ["hero", 2048, 1152, 2],
] as const) {
  const profile = generationProfile(name);
  assert.equal(profile.image.model, "Tongyi-MAI/Z-Image-Turbo");
  assert.equal(profile.image.revision, "f332072aa78be7aecdf3ee76d5c247082da564a6");
  assert.equal(profile.image.width, width);
  assert.equal(profile.image.height, height);
  assert.equal(profile.image.candidates, candidates);
  assert.notDeepEqual([width, height], [896, 1200], "page-art output cannot stand in for a Studio landscape still");
}

const payload: PlanWeekPreparedImagesArgs = {
  ownerId: "owner1", channelId: "channel1", channelSlug: "history", batchId: "week-1", itemId: "item-1",
  manifestKey: "owner/owner1/weekly/history/week-1/item-1/preparation.json", manifestSha256: "a".repeat(64),
  shots: [{ id: "shot-1", prompt: "An archival map lit by dawn", negative: "No labels", seed: 42 }],
  style: "Warm natural light", director: "Measured camera direction", negative: "No watermarks", maxCostUsd: 2,
};
const [staged] = buildStudioZImageStageRequests(payload, generationProfile("production"));
assert.ok(staged);
assert.equal(staged.request.candidates[0]?.prompt, "An archival map lit by dawn. Warm natural light. Measured camera direction");
assert.equal(staged.request.candidates[0]?.negativePrompt, "No watermarks, No labels");
assert.equal(staged.request.candidates[0]?.seed, 42);
assert.equal(staged.request.maxCostUsd, 2);
assert.equal(staged.request.candidates[0]?.width, 1920);
assert.equal(staged.request.candidates[0]?.height, 1088);
assert.throws(() => buildStudioZImageStageRequests({ ...payload, shots: [{ ...payload.shots[0]!, candidateCount: 2 }] }, generationProfile("production")), /candidate count differs/);
const [hero] = buildStudioZImageStageRequests(payload, generationProfile("hero"));
assert.equal(hero?.request.candidates.length, 2);
assert.equal(hero?.request.candidates[1]?.seed, 10_042);
assert.equal(hero?.request.candidates[1]?.negativePrompt, "No watermarks, No labels");
const unseeded = buildStudioZImageStageRequests({
  ...payload,
  shots: [
    { id: "shot-a", prompt: "A quiet forest path" },
    { id: "shot-b", prompt: "A distant mountain range" },
  ],
}, generationProfile("production"));
assert.deepEqual(unseeded.map(({ request }) => request.candidates[0]?.seed), [100_000, 100_001]);
assert.deepEqual(
  unseeded.map(({ request }) => request.candidates[0]?.seed),
  buildStudioZImageStageRequests({
    ...payload,
    shots: [
      { id: "shot-a", prompt: "A quiet forest path" },
      { id: "shot-b", prompt: "A distant mountain range" },
    ],
  }, generationProfile("production")).map(({ request }) => request.candidates[0]?.seed),
  "retries must preserve request-local seed assignments",
);

const producer = readFileSync(fileURLToPath(new URL("../planWeekPreparedImages.ts", import.meta.url)), "utf8");
const activeTask = producer.slice(producer.indexOf("export const planWeekPreparedImagesTask = task({"));
assert.match(activeTask, /const staged = await stagePreparedImagesInRenderEngine\(manifest, payload\)/);
assert.doesNotMatch(activeTask, /\brenderImages\(|\brejectNewNovitaGeneration\(/);
assert.doesNotMatch(producer, /\brenderImages\(|\btoNovitaPhaseProfile\(|\brejectNewNovitaGeneration\(/,
  "the weekly still producer must not retain a direct legacy render route");

console.log("weekly fresh stills submit only held Engine Final requests with exact prompt and geometry");
