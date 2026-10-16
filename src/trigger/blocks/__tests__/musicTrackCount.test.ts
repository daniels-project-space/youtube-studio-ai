import assert from "node:assert/strict";

import { generateMurekaTrackSet, musicTrackVariationDirection } from "../musicBlocks";

async function main(): Promise<void> {
  const prompts: string[] = [];
  const jobIds: string[] = [];
  let completedGenerations = 0;
  const result = await generateMurekaTrackSet({
    prompt: "Locked channel identity and instrumentation.",
    trackCount: 4,
    variationDirection: musicTrackVariationDirection("sleep_sound_bed"),
    model: "auto",
    onCompletedGeneration: () => { completedGenerations += 1; },
    generate: async (request) => {
      assert.equal(request.model, "auto");
      assert.equal(request.timeoutMs, 600_000);
      prompts.push(request.prompt);
      const index = prompts.length;
      const tracks = index === 1 ? [1, 2] : [3, 4, 5];
      const jobId = `job-${index}`;
      jobIds.push(jobId);
      return {
        provider: "mureka",
        url: `https://music.invalid/${index}.mp3`,
        jobId,
        tracks: tracks.map((track) => ({ url: `https://music.invalid/track-${track}.mp3` })),
      };
    },
  });

  assert.equal(result.tracks.length, 4, "short provider batches are replenished to the requested count");
  assert.deepEqual(result.tracks.map((track) => track.url), [
    "https://music.invalid/track-1.mp3",
    "https://music.invalid/track-2.mp3",
    "https://music.invalid/track-3.mp3",
    "https://music.invalid/track-4.mp3",
  ]);
  assert.deepEqual(result.jobIds, jobIds);
  assert.equal(result.generationCount, 2);
  assert.equal(completedGenerations, 2, "each completed paid job is accounted before another can fail");
  assert.match(prompts[1]!, /beatless texture/u);
  assert.doesNotMatch(prompts[1]!, /melodic progression/u,
    "sleep-track variation must not contradict its sealed no-melody role");
  assert.match(musicTrackVariationDirection("primary_music"), /melodic progression/u);
  assert.match(musicTrackVariationDirection("meditation_bed"), /pulse-or-no-pulse/u);
  assert.match(musicTrackVariationDirection("narration_bed"), /beneath speech/u);

  await assert.rejects(
    generateMurekaTrackSet({ prompt: "invalid", trackCount: 0, variationDirection: "" }),
    /track count must be an integer between 1 and 8/u,
  );

  console.log("MUREKA TRACK COUNT PASS: bounded refills honor exact mix count and expose each completed generation for cost accounting");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
