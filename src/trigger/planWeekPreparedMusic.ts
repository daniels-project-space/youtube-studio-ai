import { assertPlanWeekPreparedMusicArgs as assertArgs, type PlanWeekPreparedMusicArgs } from "@/lib/planWeekPreparedMusicArgs";
export type { PlanWeekPreparedMusicArgs } from "@/lib/planWeekPreparedMusicArgs";
/**
 * Paid weekly music producer.
 *
 * Historical receipts remain readable. New weekly YuE work runs in the
 * versioned pipeline after arrangement acceptance, with an owner audition.
 */
import { task } from "@trigger.dev/sdk";
import { join } from "node:path";
import {
  assertPlanWeekPreparedMusicBinding,
  assertPlanWeekPreparationManifestBinding,
  normalizePlanWeekPreparationManifest,
  planWeekPreparedMusicAudioKey,
  planWeekPreparedMusicKey,
  PLAN_WEEK_PREPARATION_VERSION,
  type PlanWeekPreparedMusic,
  type PlanWeekPreparationManifest,
} from "@/lib/planWeekPreparation";
import { assertWeeklyPreparationVersionsSupported } from "@/lib/weeklyPreparationVersionAdmission";
import { sha256BytesHex } from "@/lib/sha256";
import { getObjectBytes } from "@/lib/storage";
import { PREPARED_METADATA_READ, decodePreparedMetadata, preparedObjectAbsent as objectNotFound } from "@/lib/preparedMediaStorage";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { downloadTo } from "@/lib/files";
import type { MusicTrack } from "@/lib/music";



type PreparedMusicDownloader = (
  url: string,
  destination: string,
  options: { timeoutMs: number },
) => Promise<string>;

/**
 * Download accepted provider clips concurrently, while retaining provider
 * order for the deterministic crossfade/mix that follows. The URLs are
 * already paid/accepted and each transfer has the same bounded timeout; this
 * changes wall time only, never generation count, bytes, or track ordering.
 */
export async function downloadPreparedMusicTracks(
  tracks: readonly MusicTrack[],
  workDir: string,
  downloader: PreparedMusicDownloader = downloadTo,
): Promise<string[]> {
  return Promise.all(
    tracks.map((track, index) =>
      downloader(
        track.url,
        join(workDir, `track-${index}.${track.wavUrl ? "wav" : "mp3"}`),
        { timeoutMs: 300_000 },
      ),
    ),
  );
}





async function readManifest(payload: PlanWeekPreparedMusicArgs): Promise<PlanWeekPreparationManifest> {
  const bytes = await getObjectBytes(payload.manifestKey, undefined, PREPARED_METADATA_READ);
  if (sha256BytesHex(bytes) !== payload.manifestSha256) throw new Error("weekly prepared music manifest digest mismatch");
  const manifest = normalizePlanWeekPreparationManifest(decodePreparedMetadata(bytes));
  return assertPlanWeekPreparationManifestBinding({
    manifest,
    pointer: { version: PLAN_WEEK_PREPARATION_VERSION, manifestKey: payload.manifestKey, manifestSha256: payload.manifestSha256 },
    ownerId: payload.ownerId, channelId: payload.channelId, batchId: payload.batchId, itemId: payload.itemId,
    itemKey: manifest.itemKey, requestKey: manifest.requestKey, channelSlug: payload.channelSlug,
    topic: manifest.plan.topic, title: manifest.plan.title, thumbnailKey: manifest.plan.thumbnailKey, thumbnailSource: manifest.plan.thumbnailSource,
  });
}

async function readSidecar(sidecarKey: string, audioKey: string, manifest: PlanWeekPreparationManifest): Promise<PlanWeekPreparedMusic | null> {
  let bytes: Uint8Array;
  try { bytes = await getObjectBytes(sidecarKey, undefined, PREPARED_METADATA_READ); } catch (error) { if (objectNotFound(error)) return null; throw error; }
  const prepared = assertPlanWeekPreparedMusicBinding({ prepared: decodePreparedMetadata(bytes), manifest });
  const audio = await getObjectBytes(audioKey, undefined, { maxBytes: prepared.audioByteLength, timeoutMs: 300_000 });
  if (audio.byteLength !== prepared.audioByteLength || sha256BytesHex(audio) !== prepared.audioSha256) throw new Error("weekly prepared music retained audio failed its immutable receipt check");
  return prepared;
}

export const planWeekPreparedMusicTask = task({
  id: "plan-week-prepared-music",
  maxDuration: 3_600,
  // Completed audio replays; an incomplete dispatch claim prevents repurchase.
  retry: { maxAttempts: 2, minTimeoutInMs: 10_000, maxTimeoutInMs: 120_000, factor: 2 },
  queue: { concurrencyLimit: 2 },
  run: async (rawPayload: PlanWeekPreparedMusicArgs) => {
    const payload = assertArgs(rawPayload);
    await bootstrapSecrets(() => undefined, { services: ["cloudflare"] });
    const manifest = await readManifest(payload);
    assertWeeklyPreparationVersionsSupported(manifest.execution.pipeline, "plan-week-prepared-music");
    const scope = { ownerId: payload.ownerId, channelSlug: payload.channelSlug, batchId: payload.batchId, itemId: payload.itemId };
    const sidecarKey = planWeekPreparedMusicKey(scope);
    const audioKey = planWeekPreparedMusicAudioKey(scope);
    const prior = await readSidecar(sidecarKey, audioKey, manifest);
    if (prior) return { ok: true, reused: true, sidecarKey, audioKey, costUsd: 0, audioSha256: prior.audioSha256, provider: prior.provider };

    throw new Error("weekly music is generated by the scheduled HRS YuE2 modules after the scored arrangement is accepted; legacy prepared generation is disabled");

  },
});

export { assertArgs as assertPlanWeekPreparedMusicArgs };
