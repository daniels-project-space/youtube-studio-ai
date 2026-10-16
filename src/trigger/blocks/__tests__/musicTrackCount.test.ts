import assert from "node:assert/strict";

import { generateMusicTrackSet, musicTrackVariationDirection } from "../musicBlocks";

async function main(): Promise<void> {
  const prompts: string[] = [];
  const jobIds: string[] = [];
  const remainingCounts: number[] = [];
  let completedGenerations = 0;
  const result = await generateMusicTrackSet({
    prompt: "Locked channel identity and instrumentation.",
    trackCount: 4,
    variationDirection: musicTrackVariationDirection("sleep_sound_bed"),
    onCompletedGeneration: () => { completedGenerations += 1; },
    generate: async (request) => {
      prompts.push(request.prompt);
      remainingCounts.push(request.remainingTrackCount);
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
  assert.deepEqual(remainingCounts, [4, 2]);
  assert.match(prompts[1]!, /beatless texture/u);
  assert.doesNotMatch(prompts[1]!, /melodic progression/u,
    "sleep-track variation must not contradict its sealed no-melody role");
  assert.match(musicTrackVariationDirection("primary_music"), /melodic progression/u);
  assert.match(musicTrackVariationDirection("meditation_bed"), /pulse-or-no-pulse/u);
  assert.match(musicTrackVariationDirection("narration_bed"), /beneath speech/u);

  await assert.rejects(
    generateMusicTrackSet({
      prompt: "invalid",
      trackCount: 0,
      variationDirection: "",
      generate: async () => ({ jobId: "unused", tracks: [] }),
    }),
    /track count must be an integer between 1 and 8/u,
  );

  const sunoRemainingCounts: number[] = [];
  let sunoGeneration = 0;
  const sunoResult = await generateMusicTrackSet({
    prompt: "A steady sleep sound bed.",
    trackCount: 4,
    variationDirection: musicTrackVariationDirection("sleep_sound_bed"),
    generate: async ({ remainingTrackCount, generationIndex }) => {
      sunoRemainingCounts.push(remainingTrackCount);
      assert.equal(generationIndex, sunoGeneration);
      sunoGeneration += 1;
      const tracks = generationIndex < 2 ? [generationIndex + 1] : [3, 4];
      return {
        jobId: `suno-${generationIndex + 1}`,
        tracks: tracks.map((track) => ({ url: `https://music.invalid/suno-${track}.mp3` })),
      };
    },
  });
  assert.equal(sunoResult.tracks.length, 4, "one-clip Suno completions trigger bounded refills");
  assert.deepEqual(sunoRemainingCounts, [4, 3, 2]);
  assert.equal(sunoResult.generationCount, 3);

  console.log("MUSIC TRACK COUNT PASS: Mureka and short-batch Suno refills honor exact mix count and cost accounting");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
