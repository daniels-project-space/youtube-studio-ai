import { assertPlanWeekPreparedMusicArgs as assertArgs, type PlanWeekPreparedMusicArgs } from "@/lib/planWeekPreparedMusicArgs";
export type { PlanWeekPreparedMusicArgs } from "@/lib/planWeekPreparedMusicArgs";
/**
 * Paid weekly music producer.
 *
 * This task is the provider-backed half of week-ahead preparation.  It derives
 * one sealed channel music program from the frozen manifest, generates the
 * configured provider track(s), masters and loop-proofs the retained bytes,
 * and writes a create-only receipt.  Replays verify the exact R2 bytes before
 * returning, so a retry can never buy the same episode again.
 */
import { task } from "@trigger.dev/sdk";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertPlanWeekPreparedMusicBinding,
  assertPlanWeekPreparationManifestBinding,
  normalizePlanWeekPreparationManifest,
  planWeekPreparedMusicAudioKey,
  planWeekPreparedMusicKey,
  planWeekPreparationManifestSha256,
  PLAN_WEEK_PREPARATION_VERSION,
  type PlanWeekPreparedMusic,
  type PlanWeekPreparationManifest,
} from "@/lib/planWeekPreparation";
import { planWeekMusicConfig as moduleConfig, planWeekPreparedMusicProgram as programFor } from "@/lib/planWeekPreparedMusicProgram";
import { assertWeeklyPreparationVersionsSupported } from "@/lib/weeklyPreparationVersionAdmission";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256BytesHex } from "@/lib/sha256";
import { getObjectBytes } from "@/lib/storage";
import { persistPreparedResult } from "@/lib/preparedResultStorage";
import { PREPARED_METADATA_READ, decodePreparedMetadata, preparedObjectAbsent as objectNotFound } from "@/lib/preparedMediaStorage";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { claimPreparedGeneration } from "@/lib/preparedGenerationClaim";
import { downloadTo, readBytes } from "@/lib/files";
import { crossfadeConcatAudio, masterAudioTransparentGain, probe } from "@/lib/ffmpeg";
import { generateMureka, generateSuno, selfLoopAudio, type MusicProvider, type MusicTrack } from "@/lib/music";
import { PRICE } from "@/engine/pricing";



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





function providerFor(manifest: PlanWeekPreparationManifest, payload: PlanWeekPreparedMusicArgs): MusicProvider {
  const config = moduleConfig(manifest);
  const candidate = payload.provider ?? config.provider ?? config.musicProvider ?? "mureka";
  if (candidate !== "mureka" && candidate !== "suno" && candidate !== "minimax_music3") {
    throw new Error("weekly prepared music provider is invalid");
  }
  // MiniMax Music3 release still requires an owner audition receipt.  It is
  // deliberately not silently downgraded or auto-approved by this producer.
  if (candidate === "minimax_music3") {
    throw new Error("weekly prepared MiniMax music requires the owner audition workflow; choose mureka or suno for automatic preparation");
  }
  return candidate;
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

    const provider = providerFor(manifest, payload);
    const program = programFor(manifest, provider);
    const config = moduleConfig(manifest);
    const trackCount = payload.trackCount ?? (typeof config.trackCount === "number" && Number.isSafeInteger(config.trackCount) ? Math.max(1, Math.min(8, config.trackCount)) : program.role === "primary_music" ? 2 : 1);
    const generations = provider === "suno" ? Math.ceil(trackCount / 2) : 1;
    const estimatedCost = PRICE.musicTrackUsd * generations;
    if (!Number.isFinite(estimatedCost) || estimatedCost > payload.maxCostUsd) throw new Error(`weekly prepared music conservative cost ${estimatedCost} exceeds its ${payload.maxCostUsd} USD ceiling`);
    await bootstrapSecrets(() => undefined, { services: [provider === "suno" ? "suno" : "mureka"] });

    const workDir = await mkdtemp(join(tmpdir(), "plan-week-music-"));
    try {
      await claimPreparedGeneration("music", manifest, { payload, program, trackCount, generations });
      const tracks: MusicTrack[] = [];
      const prompt = program.generation.structuredCaption;
      if (provider === "suno") {
        for (let index = 0; index < generations && tracks.length < trackCount; index += 1) {
          const result = await generateSuno({
            prompt: index === 0 ? prompt : `${prompt}\nPart ${index + 1}: same instrumentation and acoustic space, a distinct melodic progression.`,
            model: payload.model ?? (typeof config.model === "string" ? config.model : "V5"),
            title: manifest.plan.title.slice(0, 60),
            wantClips: Math.min(2, trackCount - tracks.length),
            preferWav: payload.preferWav ?? config.preferWav === true,
            timeoutMs: 600_000,
          });
          tracks.push(...result.tracks.slice(0, trackCount - tracks.length));
        }
      } else {
        const result = await generateMureka({ prompt, model: payload.model ?? (typeof config.model === "string" ? config.model : undefined), timeoutMs: 600_000 });
        tracks.push(...result.tracks.slice(0, trackCount));
      }
      if (!tracks.length) throw new Error("weekly prepared music provider returned no tracks");
      const localTracks = await downloadPreparedMusicTracks(tracks, workDir);
      const mixedPath = localTracks.length > 1 ? await crossfadeConcatAudio(localTracks, join(workDir, "mix.mp3"), 3) : localTracks[0]!;
      const masteredPath = await masterAudioTransparentGain(mixedPath, join(workDir, "master.mp3"), {
        lufs: program.mix.targetLufs,
        truePeakMaxDbtp: program.mix.truePeakMaxDbtp,
      });
      const loopedPath = await selfLoopAudio(masteredPath, join(workDir, "music-loop.mp3"), { log: () => undefined });
      const finalProbe = await probe(loopedPath);
      if (!finalProbe.hasAudio || !Number.isFinite(finalProbe.durationSec) || finalProbe.durationSec < 1.5) throw new Error("weekly prepared music output has no measurable audio");
      const finalBytes = await readBytes(loopedPath);
      const audioSha256 = sha256BytesHex(finalBytes);
      await persistPreparedResult(audioKey, finalBytes, "audio/mpeg", { "plan-week-prepared-music": "v1" });
      const prepared: PlanWeekPreparedMusic = {
        version: "plan-week-prepared-music/v1",
        manifestSha256: planWeekPreparationManifestSha256(manifest),
        ownerId: manifest.ownerId, channelId: manifest.channelId, batchId: manifest.batchId, itemId: manifest.itemId,
        requestKey: manifest.requestKey, topic: manifest.plan.topic, musicKey: audioKey, audioSha256,
        audioByteLength: finalBytes.byteLength, musicDurationSec: finalProbe.durationSec, provider, musicProgram: program, createdAt: Date.now(),
      };
      assertPlanWeekPreparedMusicBinding({ prepared, manifest });
      const body = new TextEncoder().encode(canonicalJson(prepared));
      await persistPreparedResult(sidecarKey, body, "application/json", { "plan-week-prepared-music": "v1" });
      return { ok: true, reused: false, sidecarKey, audioKey, costUsd: estimatedCost, audioSha256, provider };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  },
});

export { assertArgs as assertPlanWeekPreparedMusicArgs };
