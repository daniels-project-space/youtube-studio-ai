import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generationProfile } from "@/engine/generationProfiles";
import { rejectNewNovitaGeneration } from "@/lib/novitaGenerationRetirement";

// The current Engine ERNIE batch API accepts 896x1200 page art. Studio's
// approved landscape stills have a different immutable model and canvas.
// Until Engine admits this exact Studio profile, fresh weekly visuals must
// stop before a paid provider call. A retained verified still sidecar may
// still be staged through the existing Engine H3 path.
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

assert.throws(rejectNewNovitaGeneration, /Direct Novita generation is retired/);

const producer = readFileSync(fileURLToPath(new URL("../planWeekPreparedImages.ts", import.meta.url)), "utf8");
const freshPathStart = producer.indexOf("const prior = await verifyStoredSidecar(sidecarKey, manifest)");
const providerCall = producer.indexOf("const result = await renderImages(", freshPathStart);
const retirementGate = producer.indexOf("rejectNewNovitaGeneration();", freshPathStart);
assert.ok(freshPathStart >= 0 && retirementGate > freshPathStart && providerCall > retirementGate,
  "a fresh weekly still wave must fail closed before the retired image provider is called");

console.log("weekly fresh-still Engine boundary remains fail-closed for the exact Studio Final profile");
