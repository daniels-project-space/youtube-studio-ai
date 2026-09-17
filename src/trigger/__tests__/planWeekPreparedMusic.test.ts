import assert from "node:assert/strict";
import {
  assertPlanWeekPreparedMusicArgs,
  downloadPreparedMusicTracks,
} from "@/trigger/planWeekPreparedMusic";
import { planWeekPreparationKey } from "@/lib/planWeekPreparation";

const base = {
  ownerId: "owner-1",
  channelId: "channel-1",
  channelSlug: "history",
  batchId: "batch-1",
  itemId: "item-1",
  manifestSha256: "a".repeat(64),
  maxCostUsd: 1,
  provider: "mureka" as const,
  trackCount: 2,
};

const parsed = assertPlanWeekPreparedMusicArgs({ ...base, manifestKey: planWeekPreparationKey(base) });
assert.equal(parsed.provider, "mureka");
assert.equal(parsed.trackCount, 2);

assert.throws(
  () => assertPlanWeekPreparedMusicArgs({ ...base, manifestKey: "owner/foreign/not-a-manifest" }),
  /canonical/,
);
assert.throws(
  () => assertPlanWeekPreparedMusicArgs({ ...base, manifestKey: planWeekPreparationKey(base), maxCostUsd: 0 }),
  /maxCostUsd/,
);
assert.throws(
  () => assertPlanWeekPreparedMusicArgs({ ...base, manifestKey: planWeekPreparationKey(base), trackCount: 9 }),
  /trackCount/,
);
assert.throws(
  () => assertPlanWeekPreparedMusicArgs({ ...base, manifestKey: planWeekPreparationKey(base), provider: "unknown" }),
  /provider/,
);

async function parallelTrackDownloadPreservesMixOrder(): Promise<void> {
  const tracks = [
    { url: "https://music.example/one.mp3", durationSec: 100 },
    { url: "https://music.example/two.wav", wavUrl: "https://music.example/two.wav", durationSec: 100 },
    { url: "https://music.example/three.mp3", durationSec: 100 },
  ] as const;
  let active = 0;
  let maxActive = 0;
  const starts: string[] = [];
  const paths = await downloadPreparedMusicTracks(tracks, "/tmp/music", async (url, destination, options) => {
    assert.equal(options.timeoutMs, 300_000);
    starts.push(url);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, url.endsWith("one.mp3") ? 15 : 1));
    active -= 1;
    return destination;
  });
  assert.equal(maxActive, 3, "independent accepted clips download concurrently");
  assert.deepEqual(starts, tracks.map((track) => track.url), "download scheduling keeps the provider order");
  assert.deepEqual(paths, ["/tmp/music/track-0.mp3", "/tmp/music/track-1.wav", "/tmp/music/track-2.mp3"]);
}

parallelTrackDownloadPreservesMixOrder()
  .then(() => console.log("weekly prepared music producer contract passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
