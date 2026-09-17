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
  planWeekPreparationKey,
  planWeekPreparationManifestSha256,
  PLAN_WEEK_PREPARATION_VERSION,
  type PlanWeekPreparedMusic,
  type PlanWeekPreparationManifest,
} from "@/lib/planWeekPreparation";
import { ChannelMusicProgramSchema, createChannelMusicProgram, type ChannelMusicProgram } from "@/engine/channelMusicProgram";
import { parseChannelProgramRouteRunSeed, type ChannelProgramRouteRunSeed } from "@/engine/channelProgramRoute";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256BytesHex, sha256Hex } from "@/lib/sha256";
import { getObjectBytes, putObject } from "@/lib/storage";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { downloadTo, readBytes } from "@/lib/files";
import { crossfadeConcatAudio, masterAudioTransparentGain, probe } from "@/lib/ffmpeg";
import { generateMureka, generateSuno, selfLoopAudio, type MusicProvider, type MusicTrack } from "@/lib/music";
import { PRICE } from "@/engine/pricing";

export interface PlanWeekPreparedMusicArgs {
  ownerId: string;
  channelId: string;
  channelSlug: string;
  batchId: string;
  itemId: string;
  manifestKey: string;
  manifestSha256: string;
  maxCostUsd: number;
  provider?: MusicProvider;
  trackCount?: number;
  model?: string;
  preferWav?: boolean;
}

function safePart(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value)) {
    throw new Error(`weekly prepared music ${label} is invalid`);
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value.trim().toLowerCase())) {
    throw new Error(`weekly prepared music ${label} is invalid`);
  }
  return value.trim().toLowerCase();
}

function objectNotFound(error: unknown): boolean {
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } } | null;
  return candidate?.name === "NoSuchKey" || candidate?.name === "NotFound" || candidate?.$metadata?.httpStatusCode === 404;
}

function finiteNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const result = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(minimum, Math.min(maximum, result));
}

function seedRecord(manifest: PlanWeekPreparationManifest): Record<string, unknown> {
  const value = manifest.execution.seedStore;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("weekly prepared music seed store is invalid");
  return value;
}

function routeSeed(manifest: PlanWeekPreparationManifest): ChannelProgramRouteRunSeed | undefined {
  const raw = seedRecord(manifest).channelProgramRoute;
  return raw === undefined ? undefined : parseChannelProgramRouteRunSeed(raw);
}

function moduleConfig(manifest: PlanWeekPreparationManifest): Record<string, unknown> {
  const value = manifest.execution.moduleConfig.music ?? manifest.execution.moduleConfig.lofi ?? {};
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function styleAudio(manifest: PlanWeekPreparationManifest): Record<string, unknown> {
  const style = seedRecord(manifest).styleDNA;
  if (!style || typeof style !== "object" || Array.isArray(style)) return {};
  const audio = (style as Record<string, unknown>).audio;
  return audio && typeof audio === "object" && !Array.isArray(audio) ? audio as Record<string, unknown> : {};
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

function programFor(manifest: PlanWeekPreparationManifest, provider: MusicProvider): ChannelMusicProgram {
  const seed = seedRecord(manifest);
  const route = routeSeed(manifest);
  const audio = styleAudio(manifest);
  const config = moduleConfig(manifest);
  const styleDNA = seed.styleDNA ?? null;
  const channelName = seed.channelName ?? null;
  const routeFingerprint = route?.routeFingerprint ?? null;
  const channelIdentityFingerprint = sha256Hex(canonicalJson({
    ownerId: manifest.ownerId,
    channelId: manifest.channelId,
    channelName,
    routeFingerprint,
    styleDNA,
    musicBrief: null,
  }));
  const family = route?.family ?? (typeof seed.family === "string" ? seed.family : "narrated_stock");
  const contentLaneKey = route?.contentLaneKey ?? (typeof seed.contentLane === "object" && seed.contentLane && !Array.isArray(seed.contentLane)
    ? String((seed.contentLane as Record<string, unknown>).key ?? "narrated_stock")
    : "narrated_stock");
  const rawBpm = audio.bpmRange;
  const bpmRange = Array.isArray(rawBpm) && rawBpm.length === 2
    ? [Number(rawBpm[0]), Number(rawBpm[1])] as [number, number]
    : undefined;
  return ChannelMusicProgramSchema.parse(createChannelMusicProgram({
    channelId: manifest.channelId,
    channelIdentityFingerprint,
    family,
    contentLaneKey,
    topic: manifest.plan.topic,
    providerPreference: provider,
    durationSec: finiteNumber(config.generationDurationSec ?? config.durationSec, 300, 10, 300),
    genre: typeof audio.genre === "string" ? audio.genre : undefined,
    instrumentation: Array.isArray(audio.instrumentation) ? audio.instrumentation.filter((value): value is string => typeof value === "string") : undefined,
    textures: Array.isArray(audio.textures) ? audio.textures.filter((value): value is string => typeof value === "string") : undefined,
    bpmRange,
    moodArc: typeof audio.moodArc === "string" ? audio.moodArc : undefined,
    composerDirection: typeof config.composerDirection === "string"
      ? config.composerDirection
      : typeof config.musicPrompt === "string" ? config.musicPrompt : undefined,
    targetLufs: finiteNumber(audio.loudnessLufs, -16, -23, -12),
    bodyMusicVol: 1,
  }));
}

function assertArgs(value: unknown): PlanWeekPreparedMusicArgs {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("weekly prepared music payload is invalid");
  const raw = value as Record<string, unknown>;
  const ownerId = safePart(raw.ownerId, "owner id");
  const channelId = safePart(raw.channelId, "channel id");
  const channelSlug = safePart(raw.channelSlug, "channel slug");
  const batchId = safePart(raw.batchId, "batch id");
  const itemId = safePart(raw.itemId, "item id");
  const manifestSha256 = digest(raw.manifestSha256, "manifest digest");
  const manifestKey = typeof raw.manifestKey === "string" ? raw.manifestKey : "";
  if (manifestKey !== planWeekPreparationKey({ ownerId, channelSlug, batchId, itemId })) throw new Error("weekly prepared music manifest key is not canonical");
  if (typeof raw.maxCostUsd !== "number" || !Number.isFinite(raw.maxCostUsd) || raw.maxCostUsd <= 0 || raw.maxCostUsd > 100) throw new Error("weekly prepared music maxCostUsd must be greater than zero and no more than 100");
  const provider = raw.provider;
  if (provider !== undefined && provider !== "mureka" && provider !== "suno" && provider !== "minimax_music3") throw new Error("weekly prepared music provider is invalid");
  const trackCount = raw.trackCount === undefined ? undefined : Number(raw.trackCount);
  if (trackCount !== undefined && (!Number.isSafeInteger(trackCount) || trackCount < 1 || trackCount > 8)) throw new Error("weekly prepared music trackCount must be between 1 and 8");
  return {
    ownerId, channelId, channelSlug, batchId, itemId, manifestKey, manifestSha256, maxCostUsd: raw.maxCostUsd,
    ...(provider === undefined ? {} : { provider }), ...(trackCount === undefined ? {} : { trackCount }),
    ...(typeof raw.model === "string" && raw.model.trim() ? { model: raw.model.trim() } : {}),
    ...(raw.preferWav === true ? { preferWav: true } : {}),
  };
}

async function readManifest(payload: PlanWeekPreparedMusicArgs): Promise<PlanWeekPreparationManifest> {
  const bytes = await getObjectBytes(payload.manifestKey);
  if (sha256BytesHex(bytes) !== payload.manifestSha256) throw new Error("weekly prepared music manifest digest mismatch");
  const manifest = normalizePlanWeekPreparationManifest(JSON.parse(new TextDecoder().decode(bytes)));
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
  try { bytes = await getObjectBytes(sidecarKey); } catch (error) { if (objectNotFound(error)) return null; throw error; }
  const prepared = assertPlanWeekPreparedMusicBinding({ prepared: JSON.parse(new TextDecoder().decode(bytes)), manifest });
  const audio = await getObjectBytes(audioKey);
  if (audio.byteLength !== prepared.audioByteLength || sha256BytesHex(audio) !== prepared.audioSha256) throw new Error("weekly prepared music retained audio failed its immutable receipt check");
  return prepared;
}

async function persistCreateOnly(key: string, body: Uint8Array, contentType: string, metadata: Record<string, string>): Promise<boolean> {
  try {
    await putObject(key, body, { contentType, metadata: { ...metadata, sha256: sha256BytesHex(body) }, ifNoneMatch: "*" });
    return true;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 409 && status !== 412) throw error;
    return false;
  }
}

export const planWeekPreparedMusicTask = task({
  id: "plan-week-prepared-music",
  maxDuration: 3_600,
  // The create-only audio/sidecar pair makes a bounded retry safe after a
  // transport failure, while avoiding an unbounded paid retry loop.
  retry: { maxAttempts: 2, minTimeoutInMs: 10_000, maxTimeoutInMs: 120_000, factor: 2 },
  queue: { concurrencyLimit: 2 },
  run: async (rawPayload: PlanWeekPreparedMusicArgs) => {
    const payload = assertArgs(rawPayload);
    await bootstrapSecrets(() => undefined, { services: ["cloudflare"] });
    const manifest = await readManifest(payload);
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
    await bootstrapSecrets(() => undefined, { services: ["cloudflare", provider === "suno" ? "suno" : "mureka"] });

    const workDir = await mkdtemp(join(tmpdir(), "plan-week-music-"));
    try {
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
      const localTracks: string[] = [];
      for (let index = 0; index < tracks.length; index += 1) {
        const track = tracks[index]!;
        localTracks.push(await downloadTo(track.url, join(workDir, `track-${index}.${track.wavUrl ? "wav" : "mp3"}`), { timeoutMs: 300_000 }));
      }
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
      const audioCreated = await persistCreateOnly(audioKey, finalBytes, "audio/mpeg", { "plan-week-prepared-music": "v1" });
      if (!audioCreated) {
        const winner = await getObjectBytes(audioKey);
        if (sha256BytesHex(winner) !== audioSha256) throw new Error("weekly prepared music audio collision has different bytes");
      }
      const prepared: PlanWeekPreparedMusic = {
        version: "plan-week-prepared-music/v1",
        manifestSha256: planWeekPreparationManifestSha256(manifest),
        ownerId: manifest.ownerId, channelId: manifest.channelId, batchId: manifest.batchId, itemId: manifest.itemId,
        requestKey: manifest.requestKey, topic: manifest.plan.topic, musicKey: audioKey, audioSha256,
        audioByteLength: finalBytes.byteLength, musicDurationSec: finalProbe.durationSec, provider, musicProgram: program, createdAt: Date.now(),
      };
      assertPlanWeekPreparedMusicBinding({ prepared, manifest });
      const body = new TextEncoder().encode(canonicalJson(prepared));
      const created = await persistCreateOnly(sidecarKey, body, "application/json", { "plan-week-prepared-music": "v1" });
      if (!created) {
        const winner = await readSidecar(sidecarKey, audioKey, manifest);
        if (!winner) throw new Error("weekly prepared music sidecar was lost after create-only collision");
        return { ok: true, reused: true, sidecarKey, audioKey, costUsd: 0, audioSha256: winner.audioSha256, provider: winner.provider };
      }
      return { ok: true, reused: false, sidecarKey, audioKey, costUsd: estimatedCost, audioSha256, provider };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  },
});

export { assertArgs as assertPlanWeekPreparedMusicArgs };
