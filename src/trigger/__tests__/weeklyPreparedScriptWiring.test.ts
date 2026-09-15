import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../runPipeline.ts", import.meta.url), "utf8");

const manifestVerification = source.indexOf("weeklyPreparation = assertPlanWeekPreparationManifestBinding({");
const sidecarKey = source.indexOf("const preparedScriptKey = planWeekPreparedScriptKey(weeklyPreparation);");
const sidecarBinding = source.indexOf("weeklyPreparedScript = assertPlanWeekPreparedScriptBinding({");
const seed = source.indexOf("preparedScript: structuredClone(weeklyPreparedScript.script)");
const narrationKey = source.indexOf("const preparedNarrationKey = planWeekPreparedNarrationKey(weeklyPreparation);");
const narrationBinding = source.indexOf("weeklyPreparedNarration = assertPlanWeekPreparedNarrationBinding({");
const narrationSeed = source.indexOf("preparedNarration: structuredClone(weeklyPreparedNarration)");
const musicKey = source.indexOf("const preparedMusicKey = planWeekPreparedMusicKey(weeklyPreparation);");
const musicBinding = source.indexOf("weeklyPreparedMusic = assertPlanWeekPreparedMusicBinding({");
const musicSeed = source.indexOf("preparedMusic: structuredClone(weeklyPreparedMusic)");
const footageKey = source.indexOf("const preparedFootageKey = planWeekPreparedFootageKey(weeklyPreparation);");
const footageBinding = source.indexOf("weeklyPreparedFootage = assertPlanWeekPreparedFootageBinding({");
const footageSeed = source.indexOf("preparedFootage: structuredClone(weeklyPreparedFootage)");
const imagesKey = source.indexOf("const preparedImagesKey = planWeekPreparedImagesKey(weeklyPreparation);");
const imagesBinding = source.indexOf("weeklyPreparedImages = assertPlanWeekPreparedImagesBinding({");
const imagesSeed = source.indexOf("preparedImages: structuredClone(weeklyPreparedImages)");
const preparedAuditionBypass = source.indexOf('const preparedWeeklyMusic = seedStore["preparedMusic"];');

assert.ok(manifestVerification >= 0, "weekly preparation must still be verified before any sidecar is considered");
assert.ok(sidecarKey > manifestVerification, "the sidecar destination must derive from the verified preparation packet");
assert.ok(sidecarBinding > sidecarKey, "the sidecar must be cryptographically/scope bound before its script reaches execution");
assert.ok(seed > sidecarBinding, "only an admitted sidecar may seed script_gen");
assert.ok(narrationKey > sidecarBinding, "the narration receipt must derive from the same verified weekly packet");
assert.ok(narrationBinding > narrationKey, "prepared narration must be scope-bound before it reaches narration_tts");
assert.ok(narrationSeed > narrationBinding, "only an admitted narration receipt may seed the paid TTS stage");
assert.ok(musicKey > narrationBinding, "the music receipt must derive from the same verified weekly packet");
assert.ok(musicBinding > musicKey, "prepared music must be scope-bound before it reaches the paid music stage");
assert.ok(musicSeed > musicBinding, "only an admitted music receipt may seed the paid music stage");
assert.ok(footageKey > musicBinding, "the footage receipt must derive from the same verified weekly packet");
assert.ok(footageBinding > footageKey, "prepared footage must be scope-bound before it reaches gen_footage");
assert.ok(footageSeed > footageBinding, "only admitted prepared footage may enter the frozen invocation");
assert.ok(imagesKey > footageBinding, "the image receipt must derive from the same verified weekly packet");
assert.ok(imagesBinding > imagesKey, "prepared images must be scope-bound before they reach novita_render_images");
assert.ok(imagesSeed > imagesBinding, "only admitted prepared images may enter the frozen invocation");
assert.ok(preparedAuditionBypass > musicSeed, "a prepared music receipt must avoid a duplicate MiniMax owner-audition checkpoint");
assert.match(
  source,
  /prepared script is unavailable or invalid/u,
  "an existing unreadable prepared script must fail closed instead of silently regenerating it",
);
assert.match(
  source,
  /prepared narration is unavailable or invalid/u,
  "an existing unreadable prepared narration must fail closed instead of purchasing a new take",
);
assert.match(
  source,
  /prepared music is unavailable or invalid/u,
  "an existing unreadable prepared music receipt must fail closed instead of buying a replacement track",
);
assert.match(
  source,
  /prepared footage is unavailable or invalid/u,
  "an existing unreadable prepared footage receipt must fail closed instead of buying replacement visuals",
);
assert.match(
  source,
  /prepared images are unavailable or invalid/u,
  "an existing unreadable prepared image receipt must fail closed instead of buying replacement stills",
);

console.log("weekly prepared-media runner wiring passed");
