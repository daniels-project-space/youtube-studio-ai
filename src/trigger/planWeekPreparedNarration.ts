/**
 * Paid weekly narration producer.
 *
 * The preparation manifest and prepared-script sidecar are the only inputs to
 * this task. It renders sentence takes through the existing TTS seam, inserts
 * the frozen deterministic pause plan, proves the final bytes with local
 * FFmpeg, and writes an immutable narration receipt. A replay first verifies
 * the retained audio and returns without another provider call.
 */
import { idempotencyKeys, task, tasks } from "@trigger.dev/sdk";
import { assertWeeklyPreparationVersionsSupported } from "@/lib/weeklyPreparationVersionAdmission";
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
  planWeekPreparationManifestSha256,
  PLAN_WEEK_PREPARATION_VERSION,
  type PlanWeekPreparedNarration,
  type PlanWeekPreparedScript,
  type PlanWeekPreparationManifest,
} from "@/lib/planWeekPreparation";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256BytesHex, sha256Hex } from "@/lib/sha256";
import { getObjectBytes } from "@/lib/storage";
import { persistPreparedResult } from "@/lib/preparedResultStorage";
import { PREPARED_METADATA_READ, decodePreparedMetadata, preparedObjectAbsent as objectNotFound } from "@/lib/preparedMediaStorage";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { claimPreparedGeneration } from "@/lib/preparedGenerationClaim";
import { concatAudioWithGaps, probe } from "@/lib/ffmpeg";
import { writeBytes } from "@/lib/files";
import {
  assertNarrationDeliveryRate,
  assertNarrationSpeed,
  planNarrationCadence,
  preflightNarrationPerformance,
  type NarrationPerformanceEvidence,
} from "@/lib/narrationPerformance";
import { narrationTtsCost } from "@/engine/pricing";
import { planStorySpine } from "@/engine/storySpine";
import { planVisualMatter, visualMatterDirectiveForShot } from "@/engine/visualMatter";
import { studioAssetRecipeProjectionFromUnknown } from "@/engine/studioAssetLibrary";
import { planVisualTreatment, visualTreatmentKeyFromUnknown } from "@/engine/visualTreatmentCatalog";
import { synthNarration, normalizeTtsProvider, stripAudioTags } from "@/lib/tts";
import {
  composeQwenNarrationInstruction,
  QWEN3_TTS_SPEAKERS,
  qwenTtsInstruction,
  resolveQwenTtsLanguage,
  type QwenTtsLanguage,
  type QwenTtsSpeaker,
} from "@/lib/qwenTts";
import { createHrsQwenNarrationSourceEvidence, type HrsQwenNarrationChunk } from "@/lib/hyperYoutubeQwenNarrationEvidence";
import { prepareHrsQwenTtsEnvironment, synthesizeHrsQwenTts, type HrsQwenTtsReceipt } from "@/lib/hyperYoutubeQwenTts";
import { configuredHyperYoutubeStageClient } from "@/lib/hyperYoutubeStageClient";
import { narrationPhysics } from "@/lib/voicecraft";
import { hasGeneratedFootageStage, type PlanWeekPreparedImageShot } from "@/trigger/planWeekPreparedImages";
import { prepareWeeklyScriptReview } from "./planWeekPreparedScriptReview";

import { assertPlanWeekPreparedNarrationArgs, type PlanWeekPreparedNarrationArgs } from "@/lib/planWeekPreparedNarrationArgs";
export { assertPlanWeekPreparedNarrationArgs, type PlanWeekPreparedNarrationArgs } from "@/lib/planWeekPreparedNarrationArgs";

function hasMusicStage(manifest: PlanWeekPreparationManifest): boolean {
  return manifest.execution.pipeline.some((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const block = (entry as Record<string, unknown>).block ?? (entry as Record<string, unknown>).id;
    return block === "music";
  });
}

function hasImageStage(manifest: PlanWeekPreparationManifest): boolean {
  if (hasGeneratedFootageStage(manifest)) return true;
  return manifest.execution.pipeline.some((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const block = (entry as Record<string, unknown>).block ?? (entry as Record<string, unknown>).id;
    return block === "novita_render_images";
  });
}

/**
 * Build the exact still packet from the frozen narration clock.  Story Spine
 * is deterministic and provider-free, so the weekly worker can prepare the
 * same shot identities the scheduled runner will later validate without
 * inventing a second creative plan or making an unpriced model call.
 */
export function buildPreparedImageShots(
  manifest: PlanWeekPreparationManifest,
  narration: PlanWeekPreparedNarration,
): {
  shots: Array<{
    id: string;
    prompt: string;
    negative: string;
    seed: number;
    candidateCount: number;
    cameraMove: PlanWeekPreparedImageShot["cameraMove"];
    shotScale: PlanWeekPreparedImageShot["shotScale"];
    lens: string;
    seconds: number;
    motion: string;
    referenceRequired?: boolean;
  }>;
  generationProfile: "production" | "hero";
  style?: string;
  director: string;
} {
  const seed = seedRecord(manifest);
  const styleDNA = seed.styleDNA && typeof seed.styleDNA === "object" && !Array.isArray(seed.styleDNA)
    ? seed.styleDNA as Record<string, unknown>
    : undefined;
  const imageConfig = manifest.execution.moduleConfig.novita_render_images;
  const storySpineEntry = manifest.execution.pipeline.find((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const block = (entry as Record<string, unknown>).block ?? (entry as Record<string, unknown>).id;
    return block === "story_spine";
  });
  const storySpineParams = storySpineEntry && typeof storySpineEntry === "object" && !Array.isArray(storySpineEntry)
    ? ((storySpineEntry as Record<string, unknown>).params as Record<string, unknown> | undefined)
    : undefined;
  const spine = planStorySpine({
    topic: manifest.plan.topic,
    narrationDurationSec: narration.narrationDurationSec,
    sentenceTimings: narration.sentenceTimings,
    styleDNA,
    generationProfile: imageConfig?.generationProfile ?? storySpineParams?.generationProfile ?? "production",
    targetShotSec: typeof storySpineParams?.targetShotSec === "number"
      ? storySpineParams.targetShotSec
      : typeof imageConfig?.targetShotSec === "number" ? imageConfig.targetShotSec : 6,
  });
  const specs = new Map(spine.dpVisualSpecs.map((spec) => [spec.shotId, spec]));
  const visualEntry = manifest.execution.pipeline.find((entry): entry is {block:string;params?:Record<string,unknown>} =>
    !!entry && typeof entry === "object" && !Array.isArray(entry) && (entry as {block?:unknown}).block === "visual_matter");
  const visualParams = { ...(manifest.execution.moduleConfig.visual_matter ?? {}), ...(visualEntry?.params ?? {}) };
  const treatmentKey = visualParams.visualTreatment === undefined ? undefined : visualTreatmentKeyFromUnknown(visualParams.visualTreatment);
  if (visualParams.visualTreatment !== undefined && !treatmentKey) throw new Error("weekly visual matter treatment is invalid");
  const integer = (value:unknown,fallback:number,max:number) => {
    const parsed=Number(value); return Math.max(0,Math.min(max,Number.isFinite(parsed)?Math.floor(parsed):fallback));
  };
  const visualMatter = visualEntry && visualParams.enabled !== false ? planVisualMatter({
    topic: manifest.plan.topic, channelName:typeof seed.channelName === "string" ? seed.channelName : undefined,
    styleDNA:styleDNA ?? null, visualBrief:seed.visualBrief && typeof seed.visualBrief === "object" && !Array.isArray(seed.visualBrief)
      ? seed.visualBrief as Record<string,unknown> : null,
    continuityLedger:spine.continuityLedger,narrativeBeats:spine.narrativeBeats,shotList:spine.shotList,dpVisualSpecs:spine.dpVisualSpecs,
    studioAssetRecipeProjection:studioAssetRecipeProjectionFromUnknown(seed.studioAssetRecipeProjection),
    ...(treatmentKey ? {visualTreatment:planVisualTreatment(treatmentKey)} : {}),
    maxCharacters:integer(visualParams.maxCharacters,3,6),maxSettings:integer(visualParams.maxSettings,3,6),
  }) : undefined;
  const profiles = new Set(spine.shotList.map((shot) => shot.generationProfile));
  const generationProfile = profiles.has("hero") ? "hero" : "production";
  const shots = spine.shotList.map((shot) => {
    const spec = specs.get(shot.id);
    if (!spec) throw new Error(`weekly prepared images lost DP visual spec for ${shot.id}`);
    return {
      id: shot.id,
      prompt: [manifest.prompts.visual, spec.keyframePrompt, visualMatterDirectiveForShot(visualMatter,shot.id)?.renderPrompt,
        shot.prompt].filter(Boolean).join("\n\n"),
      negative: [shot.negative, spec.negativePrompt].filter(Boolean).join(", "),
      seed: shot.seed,
      candidateCount: shot.candidateCount,
      cameraMove: shot.cameraMove,
      shotScale: shot.shotScale,
      lens: shot.lens,
      seconds: shot.seconds,
      motion: shot.motion,
      ...(visualParams.renderReferenceAssets === true ? { referenceRequired: true } : {}),
    };
  });
  const style = typeof seed.styleGrammar === "string" && seed.styleGrammar.trim()
    ? seed.styleGrammar.trim()
    : undefined;
  return { shots, generationProfile, ...(style ? { style } : {}), director: manifest.prompts.visual };
}

async function dispatchPreparedImages(
  manifest: PlanWeekPreparationManifest,
  payload: PlanWeekPreparedNarrationArgs,
  narration: PlanWeekPreparedNarration,
): Promise<string | undefined> {
  if (!hasImageStage(manifest)) return undefined;
  const maxCostUsd = Number(process.env.PLAN_WEEK_PREPARED_IMAGES_MAX_COST_USD ?? "8");
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0 || maxCostUsd > 1_000) {
    throw new Error("weekly prepared images dispatch has an invalid cost ceiling");
  }
  const packet = buildPreparedImageShots(manifest, narration);
  const imagesPayload = {
    ownerId: payload.ownerId,
    channelId: payload.channelId,
    channelSlug: payload.channelSlug,
    batchId: payload.batchId,
    itemId: payload.itemId,
    manifestKey: payload.manifestKey,
    manifestSha256: payload.manifestSha256,
    ...packet,
    maxCostUsd,
  };
  const idempotencyKey = await idempotencyKeys.create(
    `plan-week-images:${payload.ownerId}:${payload.manifestSha256}`,
    { scope: "global" },
  );
  const handle = await tasks.trigger("plan-week-prepared-images", imagesPayload, {
    concurrencyKey: `plan-week-images:${manifest.ownerId}:${manifest.channelId}`,
    idempotencyKey,
  });
  return handle.id;
}

async function dispatchPreparedMusic(manifest: PlanWeekPreparationManifest, payload: PlanWeekPreparedNarrationArgs): Promise<string | undefined> {
  if (!hasMusicStage(manifest)) return undefined;
  const music = manifest.execution.pipeline.filter((entry): entry is { block: string; version?: string } =>
    !!entry && typeof entry === "object" && !Array.isArray(entry) && (entry as { block?: unknown }).block === "music");
  if (music.length !== 1 || music[0]?.version !== "4.0.0-yue2-hrs") {
    throw new Error("weekly music requires the versioned HRS YuE2 pipeline; no legacy producer is dispatched");
  }
  // The scheduled pipeline first creates the run-bound scored arrangement;
  // its HRS YuE source and owner audition then execute in their own modules.
  void payload;
  return undefined;
}

async function readPreparationManifest(payload: PlanWeekPreparedNarrationArgs): Promise<PlanWeekPreparationManifest> {
  const bytes = await getObjectBytes(payload.manifestKey, undefined, PREPARED_METADATA_READ);
  if (sha256BytesHex(bytes) !== payload.manifestSha256) throw new Error("weekly prepared narration manifest digest mismatch");
  const manifest = normalizePlanWeekPreparationManifest(decodePreparedMetadata(bytes));
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
    prepared: decodePreparedMetadata(await getObjectBytes(key, undefined, PREPARED_METADATA_READ)),
    manifest,
  });
  return prepared;
}

async function readSidecar(key: string, audioKey: string, manifest: PlanWeekPreparationManifest): Promise<PlanWeekPreparedNarration | null> {
  let bytes: Uint8Array;
  try { bytes = await getObjectBytes(key, undefined, PREPARED_METADATA_READ); } catch (error) { if (objectNotFound(error)) return null; throw error; }
  const prepared = assertPlanWeekPreparedNarrationBinding({ prepared: decodePreparedMetadata(bytes), manifest });
  const audio = await getObjectBytes(audioKey, undefined, { maxBytes: prepared.audioByteLength, timeoutMs: 300_000 });
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

export const planWeekPreparedNarrationTask = task({
  id: "plan-week-prepared-narration",
  maxDuration: 3_600,
  // Completed audio/handoffs replay without TTS. An incomplete claimed take
  // is held even when only part of its sentence generation completed.
  retry: { maxAttempts: 2, minTimeoutInMs: 10_000, maxTimeoutInMs: 120_000, factor: 2 },
  queue: { concurrencyLimit: 2 },
  run: async (rawPayload: PlanWeekPreparedNarrationArgs) => {
    const payload = assertPlanWeekPreparedNarrationArgs(rawPayload);
    await bootstrapSecrets(() => undefined, { services: ["cloudflare"] });
    const manifest = await readPreparationManifest(payload);
    assertWeeklyPreparationVersionsSupported(manifest.execution.pipeline, "plan-week-prepared-narration");
    const scope = { ownerId: payload.ownerId, channelSlug: payload.channelSlug, batchId: payload.batchId, itemId: payload.itemId };
    const sidecarKey = planWeekPreparedNarrationKey(scope);
    const audioKey = planWeekPreparedNarrationAudioKey(scope);
    const prior = await readSidecar(sidecarKey, audioKey, manifest);
    if (prior) {
      const musicTriggerRunId = await dispatchPreparedMusic(manifest, payload);
      const imagesTriggerRunId = await dispatchPreparedImages(manifest, payload, prior);
      return { ok: true, reused: true, sidecarKey, audioKey, musicTriggerRunId, imagesTriggerRunId, costUsd: 0, audioSha256: prior.audioSha256 };
    }
    // Reject a legacy music selection before script review or narration spend.
    await dispatchPreparedMusic(manifest, payload);

    const scriptKey = planWeekPreparedScriptKey(scope);
    const preparedScript = await readScript(scriptKey, manifest);
    const script = preparedScript.script;
    const text = stripAudioTags(script.narrationText).trim();
    const sentences = splitSentences(text);
    const config = moduleConfig(manifest);
    const seed = seedRecord(manifest);
    const provider = normalizeTtsProvider(payload.provider ?? config.ttsProvider ?? "qwen3");
    const speed = assertNarrationSpeed(payload.speed ?? numberOr(config.ttsSpeed, 1), "weekly prepared narration speed");
    const baseGapSec = payload.baseGapSec ?? numberOr(config.sentenceGapSec, 0.85);
    const jitterSec = payload.jitterSec ?? numberOr(config.sentenceGapJitter, 0.2);
    const cadence = planNarrationCadence({ sentences, baseGapSec, jitterSec });
    const speakerValue = payload.speaker ?? (typeof config.qwenSpeaker === "string" ? config.qwenSpeaker : seed.voiceId);
    const language = resolveQwenTtsLanguage(payload.language ?? config.language ?? config.locale ?? "en");
    const dnaNarrative = seed.styleDNA && typeof seed.styleDNA === "object" && !Array.isArray(seed.styleDNA)
      ? (seed.styleDNA as { narrative?: { pacing?: unknown; delivery?: unknown } }).narrative
      : undefined;
    const physics = narrationPhysics(typeof seed.niche === "string" ? seed.niche : undefined);
    const instruction = qwenTtsInstruction(composeQwenNarrationInstruction({
      explicit: config.qwenInstruction,
      editorialBrief: manifest.prompts.narration,
      delivery: dnaNarrative?.delivery,
      pacing: dnaNarrative?.pacing,
      archetype: physics.archetype,
    }), speed);
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
    const scriptReview = await prepareWeeklyScriptReview(manifest, preparedScript, payload.maxCostUsd - estimatedUpperCost);
    const narrationAllowance = payload.maxCostUsd - scriptReview.chargedCostUsd;
    if (provider === "fish") await bootstrapSecrets(() => undefined, { services: ["fish-audio"] });
    if (provider === "elevenlabs") await bootstrapSecrets(() => undefined, { services: ["elevenlabs"] });

    const workDir = await mkdtemp(join(tmpdir(), "plan-week-narration-"));
    const partPaths: string[] = [];
    const partDurations: number[] = [];
    const partByteLengths: number[] = [];
    const qwenReceipts: HrsQwenTtsReceipt[] = [];
    let billableCharacters = 0;
    try {
      const hrsClient = provider === "qwen3" ? configuredHyperYoutubeStageClient() : undefined;
      if (hrsClient) {
        const binding = await hrsClient.binding();
        if (!process.env.R2_BUCKET || binding.outputBucket !== process.env.R2_BUCKET) {
          throw new Error("weekly narration HRS and YouTube project R2 buckets must match");
        }
      }
      await claimPreparedGeneration("narration", manifest, { payload, scriptSha256: preparedScript.scriptSha256,
        scriptReviewFingerprint: scriptReview.fingerprint, provider, speed, cadence, speaker, language, instruction });
      const authorize = async () => undefined; // The exclusive, read-back dispatch claim above admitted this task.
      const environment = hrsClient ? await prepareHrsQwenTtsEnvironment({
        scope: { ownerId: payload.ownerId, channelId: payload.channelId, batchId: payload.batchId, itemId: payload.itemId, stage: "weekly-narration" },
        authorize, client: hrsClient,
      }) : undefined;
      for (const [index, sentence] of sentences.entries()) {
        const path = join(workDir, `sentence-${String(index).padStart(4, "0")}.mp3`);
        const audio = provider === "qwen3" ? await (async () => {
          const result = await synthesizeHrsQwenTts({
            scope: { ownerId: payload.ownerId, channelId: payload.channelId, batchId: payload.batchId, itemId: payload.itemId, stage: "weekly-narration", ordinal: index },
            text: sentence, speaker: speaker as QwenTtsSpeaker, language: language as QwenTtsLanguage,
            instruct: instruction, seed: 4_242, authorize, client: hrsClient, environment,
          });
          qwenReceipts.push(result.receipt);
          return result.bytes;
        })() : await synthNarration({
          text: sentence,
          provider,
          voiceId: speaker,
          niche: typeof seed.niche === "string" ? seed.niche : undefined,
          speed,
          elevenVoiceId: provider === "elevenlabs" ? speaker : undefined,
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
      assertNarrationDeliveryRate({
        wordCount: baseEvidence.wordCount,
        durationSec: baseEvidence.durationSec,
        speed,
        label: "weekly prepared narration",
      });
      let narrationPerformanceEvidence: NarrationPerformanceEvidence = baseEvidence;
      if (provider === "qwen3") {
        if (qwenReceipts.length !== sentences.length) throw new Error("weekly prepared narration Qwen3 receipt count does not cover every sentence");
        const chunks: HrsQwenNarrationChunk[] = qwenReceipts.map((receipt, index) => ({
          ordinal: index,
          textSha256: sha256Hex(sentences[index]!),
          audioSha256: receipt.audioSha256,
          byteLength: partByteLengths[index]!,
          receipt,
        }));
        narrationPerformanceEvidence = {
          ...baseEvidence,
          qwenProviderEvidence: createHrsQwenNarrationSourceEvidence({
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
      const costUsd = provider === "qwen3" ? 0 : narrationTtsCost(provider, billableCharacters, 0, 0);
      if (!Number.isFinite(costUsd) || costUsd > narrationAllowance) {
        throw new Error(`weekly prepared narration cost ${costUsd} exceeds its ${narrationAllowance} USD allowance after script review`);
      }
      await persistPreparedResult(audioKey, finalBytes, "audio/mpeg", { "plan-week-prepared-narration": "v1" });
      const retainedAudio = await getObjectBytes(audioKey, undefined, { maxBytes: finalBytes.byteLength, timeoutMs: 300_000 });
      if (retainedAudio.byteLength !== finalBytes.byteLength || sha256BytesHex(retainedAudio) !== audioSha256) {
        throw new Error("weekly prepared narration project R2 readback does not match the final audio");
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
      await persistPreparedResult(sidecarKey, body, "application/json", { "plan-week-prepared-narration": "v1" });
      const retainedSidecar = await getObjectBytes(sidecarKey, undefined, { maxBytes: body.byteLength, timeoutMs: 30_000 });
      if (retainedSidecar.byteLength !== body.byteLength || sha256BytesHex(retainedSidecar) !== sha256BytesHex(body)) {
        throw new Error("weekly prepared narration project R2 receipt readback mismatch");
      }
      const musicTriggerRunId = await dispatchPreparedMusic(manifest, payload);
      const imagesTriggerRunId = await dispatchPreparedImages(manifest, payload, prepared);
      return { ok: true, reused: false, sidecarKey, audioKey, musicTriggerRunId, imagesTriggerRunId,
        costUsd: provider === "qwen3" ? null : costUsd + scriptReview.costUsd,
        ...(provider === "qwen3" ? { narrationCostStatus: "unreported" as const, scriptReviewCostUsd: scriptReview.costUsd } : {}),
        scriptReviewReceiptKey: scriptReview.receiptKey, audioSha256 };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  },
});
