/**
 * Paid weekly narration producer.
 *
 * The preparation manifest and prepared-script sidecar are the only inputs to
 * this task. It renders sentence takes through the existing TTS seam, inserts
 * the frozen deterministic pause plan, proves the final bytes with local
 * FFmpeg, and writes an immutable narration receipt. A replay first verifies
 * the retained audio and returns without another provider call.
 */
import { task } from "@trigger.dev/sdk";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertPlanWeekPreparedNarrationBinding,
  assertPlanWeekPreparedScriptBinding,
  assertPlanWeekPreparationManifestBinding,
  normalizePlanWeekPreparationManifest,
  planWeekPreparedNarrationAudioKey,
  planWeekPreparedNarrationKey,
  planWeekPreparedScriptKey,
  planWeekPreparationKey,
  planWeekPreparationManifestSha256,
  PLAN_WEEK_PREPARATION_VERSION,
  type PlanWeekPreparedNarration,
  type PlanWeekPreparedScript,
  type PlanWeekPreparationManifest,
} from "@/lib/planWeekPreparation";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256BytesHex, sha256Hex } from "@/lib/sha256";
import { getObjectBytes, putObject } from "@/lib/storage";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { concatAudioWithGaps, probe } from "@/lib/ffmpeg";
import { writeBytes } from "@/lib/files";
import {
  assertNarrationSpeed,
  planNarrationCadence,
  preflightNarrationPerformance,
  type NarrationPerformanceEvidence,
} from "@/lib/narrationPerformance";
import { narrationTtsCost } from "@/engine/pricing";
import { synthNarration, normalizeTtsProvider, stripAudioTags } from "@/lib/tts";
import {
  createQwenNarrationSourceEvidence,
  QWEN3_TTS_SPEAKERS,
  qwenTtsInstruction,
  resolveQwenTtsLanguage,
  type QwenNarrationSourceChunk,
  type QwenTtsLanguage,
  type QwenTtsSpeaker,
  type QwenTtsReceipt,
} from "@/lib/qwenTts";

export interface PlanWeekPreparedNarrationArgs {
  ownerId: string;
  channelId: string;
  channelSlug: string;
  batchId: string;
  itemId: string;
  manifestKey: string;
  manifestSha256: string;
  maxCostUsd: number;
  provider?: "fish" | "elevenlabs" | "qwen3";
  speaker?: string;
  language?: string;
  speed?: number;
  baseGapSec?: number;
  jitterSec?: number;
}

function safePart(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value)) {
    throw new Error(`weekly prepared narration ${label} is invalid`);
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value.trim().toLowerCase())) {
    throw new Error(`weekly prepared narration ${label} is invalid`);
  }
  return value.trim().toLowerCase();
}

function objectNotFound(error: unknown): boolean {
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } } | null;
  return candidate?.name === "NoSuchKey" || candidate?.name === "NotFound" || candidate?.$metadata?.httpStatusCode === 404;
}

function safeNumber(value: unknown, label: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`weekly prepared narration ${label} is invalid`);
  }
  return value;
}

export function assertPlanWeekPreparedNarrationArgs(value: unknown): PlanWeekPreparedNarrationArgs {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("weekly prepared narration payload is invalid");
  const raw = value as Record<string, unknown>;
  const ownerId = safePart(raw.ownerId, "owner id");
  const channelId = safePart(raw.channelId, "channel id");
  const channelSlug = safePart(raw.channelSlug, "channel slug");
  const batchId = safePart(raw.batchId, "batch id");
  const itemId = safePart(raw.itemId, "item id");
  const manifestSha256 = digest(raw.manifestSha256, "manifest digest");
  const manifestKey = typeof raw.manifestKey === "string" ? raw.manifestKey : "";
  if (manifestKey !== planWeekPreparationKey({ ownerId, channelSlug, batchId, itemId })) {
    throw new Error("weekly prepared narration manifest key is not canonical");
  }
  const maxCostUsd = raw.maxCostUsd;
  if (typeof maxCostUsd !== "number" || !Number.isFinite(maxCostUsd) || maxCostUsd <= 0 || maxCostUsd > 100) {
    throw new Error("weekly prepared narration maxCostUsd must be greater than zero and no more than 100");
  }
  const provider = raw.provider === undefined ? undefined : raw.provider;
  if (provider !== undefined && provider !== "fish" && provider !== "elevenlabs" && provider !== "qwen3") {
    throw new Error("weekly prepared narration provider is invalid");
  }
  const speed = safeNumber(raw.speed, "speed", 0.85, 1.15);
  const baseGapSec = safeNumber(raw.baseGapSec, "base gap", 0.2, 2.1);
  const jitterSec = safeNumber(raw.jitterSec, "gap jitter", 0, 0.35);
  return {
    ownerId, channelId, channelSlug, batchId, itemId, manifestKey, manifestSha256, maxCostUsd,
    ...(provider === undefined ? {} : { provider }),
    ...(typeof raw.speaker === "string" && raw.speaker.trim() ? { speaker: raw.speaker.trim() } : {}),
    ...(typeof raw.language === "string" && raw.language.trim() ? { language: raw.language.trim() } : {}),
    ...(speed === undefined ? {} : { speed }),
    ...(baseGapSec === undefined ? {} : { baseGapSec }),
    ...(jitterSec === undefined ? {} : { jitterSec }),
  };
}

async function readPreparationManifest(payload: PlanWeekPreparedNarrationArgs): Promise<PlanWeekPreparationManifest> {
  const bytes = await getObjectBytes(payload.manifestKey);
  if (sha256BytesHex(bytes) !== payload.manifestSha256) throw new Error("weekly prepared narration manifest digest mismatch");
  const manifest = normalizePlanWeekPreparationManifest(JSON.parse(new TextDecoder().decode(bytes)));
  return assertPlanWeekPreparationManifestBinding({
    manifest,
    pointer: { version: PLAN_WEEK_PREPARATION_VERSION, manifestKey: payload.manifestKey, manifestSha256: payload.manifestSha256 },
    ownerId: payload.ownerId,
    channelId: payload.channelId,
    batchId: payload.batchId,
    itemId: payload.itemId,
    itemKey: manifest.itemKey,
    requestKey: manifest.requestKey,
    channelSlug: payload.channelSlug,
    topic: manifest.plan.topic,
    title: manifest.plan.title,
    thumbnailKey: manifest.plan.thumbnailKey,
    thumbnailSource: manifest.plan.thumbnailSource,
  });
}

async function readScript(key: string, manifest: PlanWeekPreparationManifest): Promise<PlanWeekPreparedScript> {
  const prepared = assertPlanWeekPreparedScriptBinding({
    prepared: JSON.parse(new TextDecoder().decode(await getObjectBytes(key))),
    manifest,
  });
  return prepared;
}

async function readSidecar(key: string, audioKey: string, manifest: PlanWeekPreparationManifest): Promise<PlanWeekPreparedNarration | null> {
  let bytes: Uint8Array;
  try { bytes = await getObjectBytes(key); } catch (error) { if (objectNotFound(error)) return null; throw error; }
  const prepared = assertPlanWeekPreparedNarrationBinding({ prepared: JSON.parse(new TextDecoder().decode(bytes)), manifest });
  const audio = await getObjectBytes(audioKey);
  if (audio.byteLength !== prepared.audioByteLength || sha256BytesHex(audio) !== prepared.audioSha256) {
    throw new Error("weekly prepared narration retained audio failed its immutable receipt check");
  }
  return prepared;
}

function splitSentences(text: string): string[] {
  const normalized = stripAudioTags(text).replace(/\s+/g, " ").trim();
  const matches = normalized.match(/[^.!?]+(?:[.!?]+|$)/g)?.map((value) => value.trim()).filter(Boolean) ?? [];
  if (!matches.length && normalized) return [normalized];
  if (!matches.length || matches.length > 2_000) throw new Error("weekly prepared narration sentence plan is invalid");
  return matches;
}

function moduleConfig(manifest: PlanWeekPreparationManifest): Record<string, unknown> {
  const config = manifest.execution.moduleConfig.narration_tts;
  return config && typeof config === "object" && !Array.isArray(config) ? config : {};
}

function seedRecord(manifest: PlanWeekPreparationManifest): Record<string, unknown> {
  const value = manifest.execution.seedStore;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("weekly prepared narration seed store is invalid");
  return value;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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

export const planWeekPreparedNarrationTask = task({
  id: "plan-week-prepared-narration",
  maxDuration: 3_600,
  retry: { maxAttempts: 1 },
  queue: { concurrencyLimit: 2 },
  run: async (rawPayload: PlanWeekPreparedNarrationArgs) => {
    const payload = assertPlanWeekPreparedNarrationArgs(rawPayload);
    await bootstrapSecrets(() => undefined, { services: ["cloudflare"] });
    const manifest = await readPreparationManifest(payload);
    const scope = { ownerId: payload.ownerId, channelSlug: payload.channelSlug, batchId: payload.batchId, itemId: payload.itemId };
    const sidecarKey = planWeekPreparedNarrationKey(scope);
    const audioKey = planWeekPreparedNarrationAudioKey(scope);
    const prior = await readSidecar(sidecarKey, audioKey, manifest);
    if (prior) return { ok: true, reused: true, sidecarKey, audioKey, costUsd: 0, audioSha256: prior.audioSha256 };

    const scriptKey = planWeekPreparedScriptKey(scope);
    const preparedScript = await readScript(scriptKey, manifest);
    const script = preparedScript.script;
    const text = stripAudioTags(script.narrationText).trim();
    const sentences = splitSentences(text);
    const config = moduleConfig(manifest);
    const seed = seedRecord(manifest);
    const provider = normalizeTtsProvider(payload.provider ?? config.ttsProvider ?? "fish");
    const speed = assertNarrationSpeed(payload.speed ?? numberOr(config.ttsSpeed, 1), "weekly prepared narration speed");
    const baseGapSec = payload.baseGapSec ?? numberOr(config.sentenceGapSec, 0.85);
    const jitterSec = payload.jitterSec ?? numberOr(config.sentenceGapJitter, 0.2);
    const cadence = planNarrationCadence({ sentences, baseGapSec, jitterSec });
    const speakerValue = payload.speaker ?? (typeof config.qwenSpeaker === "string" ? config.qwenSpeaker : seed.voiceId);
    const language = resolveQwenTtsLanguage(payload.language ?? config.language ?? config.locale ?? "en");
    const instruction = qwenTtsInstruction(
      typeof config.qwenInstruction === "string" ? config.qwenInstruction : manifest.prompts.narration,
      speed,
    );
    if (provider === "qwen3" && !(QWEN3_TTS_SPEAKERS as readonly string[]).includes(String(speakerValue))) {
      throw new Error(`weekly prepared narration Qwen3 requires one pinned speaker (${QWEN3_TTS_SPEAKERS.join(", ")})`);
    }
    const speaker = String(speakerValue ?? "").trim();
    if (!speaker && provider !== "qwen3") throw new Error("weekly prepared narration requires an explicit voice");

    const estimatedUpperCost = provider === "qwen3"
      ? (text.length * 1) / 1_000
      : narrationTtsCost(provider, text.length, 0, 0);
    if (estimatedUpperCost > payload.maxCostUsd) {
      throw new Error(`weekly prepared narration conservative cost ${estimatedUpperCost} exceeds its ${payload.maxCostUsd} USD ceiling`);
    }
    if (provider === "qwen3") await bootstrapSecrets(() => undefined, { services: ["cloudflare"] });
    if (provider === "fish") await bootstrapSecrets(() => undefined, { services: ["fish-audio"] });
    if (provider === "elevenlabs") await bootstrapSecrets(() => undefined, { services: ["elevenlabs"] });

    const workDir = await mkdtemp(join(tmpdir(), "plan-week-narration-"));
    const partPaths: string[] = [];
    const partDurations: number[] = [];
    const partByteLengths: number[] = [];
    const qwenReceipts: QwenTtsReceipt[] = [];
    let billableCharacters = 0;
    try {
      let observedQwenCost = 0;
      for (const [index, sentence] of sentences.entries()) {
        const path = join(workDir, `sentence-${String(index).padStart(4, "0")}.mp3`);
        const audio = await synthNarration({
          text: sentence,
          provider,
          voiceId: speaker,
          niche: typeof seed.niche === "string" ? seed.niche : undefined,
          speed,
          elevenVoiceId: provider === "elevenlabs" ? speaker : undefined,
          qwenSpeaker: provider === "qwen3" ? speaker : undefined,
          qwenLanguage: provider === "qwen3" ? language : undefined,
          qwenInstruction: provider === "qwen3" ? instruction : undefined,
          qwenSeed: 4_242,
          qwenMaxCostUsd: provider === "qwen3" ? Math.max(0.02, payload.maxCostUsd - observedQwenCost) : undefined,
          onQwenReceipt: (receipt) => { qwenReceipts.push(receipt); observedQwenCost += receipt.runtime.costUsd; },
          onBillableCharacters: (characters) => { billableCharacters += characters; },
        });
        await writeBytes(path, audio);
        const measured = await probe(path);
        if (!measured.hasAudio || !Number.isFinite(measured.durationSec) || measured.durationSec < 0.05) {
          throw new Error(`weekly prepared narration sentence ${index + 1} has no measurable audio`);
        }
        partPaths.push(path);
        partDurations.push(measured.durationSec);
        partByteLengths.push(audio.byteLength);
      }
      const finalPath = join(workDir, "narration.mp3");
      await concatAudioWithGaps(partPaths, cadence.gapsSec, finalPath);
      const finalBytes = new Uint8Array(await import("node:fs/promises").then(({ readFile }) => readFile(finalPath)));
      const finalProbe = await probe(finalPath);
      const sentenceTimings = sentences.map((sentence, index) => {
        const start = partDurations.slice(0, index).reduce((sum, duration, previous) => sum + duration + (cadence.gapsSec[previous] ?? 0), 0);
        return { text: sentence, start, end: start + partDurations[index]! };
      });
      const baseEvidence = await preflightNarrationPerformance({ audioPath: finalPath, text, speed });
      let narrationPerformanceEvidence: NarrationPerformanceEvidence = baseEvidence;
      if (provider === "qwen3") {
        if (qwenReceipts.length !== sentences.length) throw new Error("weekly prepared narration Qwen3 receipt count does not cover every sentence");
        const chunks: QwenNarrationSourceChunk[] = qwenReceipts.map((receipt, index) => ({
          ordinal: index,
          textSha256: sha256Hex(sentences[index]!),
          audioSha256: receipt.audioSha256,
          byteLength: partByteLengths[index]!,
          receipt,
        }));
        narrationPerformanceEvidence = {
          ...baseEvidence,
          qwenProviderEvidence: createQwenNarrationSourceEvidence({
            speaker: speaker as QwenTtsSpeaker,
            language: language as QwenTtsLanguage,
            source: {
              narrationKey: audioKey,
              sha256: sha256BytesHex(finalBytes),
              byteLength: finalBytes.byteLength,
              durationSec: baseEvidence.durationSec,
              transcriptSha256: sha256Hex(text),
              assembly: "concat_audio_with_gaps/v1",
              gapPlanSha256: sha256Hex(canonicalJson(cadence.gapsSec)),
              mode: "sentence",
              voiceFx: null,
            },
            sourceChunks: chunks,
            preflightReceipts: [],
          }),
        };
      }
      const audioSha256 = sha256BytesHex(finalBytes);
      const costUsd = provider === "qwen3"
        ? qwenReceipts.reduce((sum, receipt) => sum + receipt.runtime.costUsd, 0)
        : narrationTtsCost(provider, billableCharacters, 0, 0);
      if (!Number.isFinite(costUsd) || costUsd > payload.maxCostUsd) {
        throw new Error(`weekly prepared narration cost ${costUsd} exceeds its ${payload.maxCostUsd} USD ceiling`);
      }
      const audioCreated = await persistCreateOnly(audioKey, finalBytes, "audio/mpeg", { "plan-week-prepared-narration": "v1" });
      if (!audioCreated) {
        const winner = await getObjectBytes(audioKey);
        if (sha256BytesHex(winner) !== audioSha256) throw new Error("weekly prepared narration audio collision has different bytes");
      }
      const prepared: PlanWeekPreparedNarration = {
        version: "plan-week-prepared-narration/v1",
        manifestSha256: planWeekPreparationManifestSha256(manifest),
        ownerId: manifest.ownerId,
        channelId: manifest.channelId,
        batchId: manifest.batchId,
        itemId: manifest.itemId,
        requestKey: manifest.requestKey,
        topic: manifest.plan.topic,
        scriptSha256: preparedScript.scriptSha256,
        narrationKey: audioKey,
        audioSha256,
        audioByteLength: finalBytes.byteLength,
        narrationDurationSec: finalProbe.durationSec,
        narrationTranscriptText: text,
        narrationTranscriptSha256: sha256Hex(text),
        narrationPerformanceEvidence,
        sentenceTimings,
        chapterPlan: [{ kind: "footage", durSec: finalProbe.durationSec }],
        createdAt: Date.now(),
      };
      assertPlanWeekPreparedNarrationBinding({ prepared, manifest });
      const body = new TextEncoder().encode(canonicalJson(prepared));
      const created = await persistCreateOnly(sidecarKey, body, "application/json", { "plan-week-prepared-narration": "v1" });
      if (!created) {
        const winner = await readSidecar(sidecarKey, audioKey, manifest);
        if (!winner) throw new Error("weekly prepared narration sidecar was lost after create-only collision");
        return { ok: true, reused: true, sidecarKey, audioKey, costUsd: 0, audioSha256: winner.audioSha256 };
      }
      return { ok: true, reused: false, sidecarKey, audioKey, costUsd, audioSha256 };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  },
});
