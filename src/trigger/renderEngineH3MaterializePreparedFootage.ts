/**
 * Manual-only Engine H3 completion bridge. It has no schedule and never asks
 * Render Engine to release or dispatch a job. It copies only a completed,
 * Engine-verified project output into Studio's canonical R2 footage key.
 */
import { task } from "@trigger.dev/sdk";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { canonicalJson } from "@/lib/canonicalJson";
import { assertPlanWeekPreparedFootageBinding, assertPlanWeekPreparationManifestBinding, normalizePlanWeekPreparationManifest, planWeekPreparedFootageClipKey, planWeekPreparedFootageKey, planWeekPreparedH3FirstFrameKey, planWeekPreparationKey, planWeekPreparationManifestSha256, type PlanWeekPreparedFootage } from "@/lib/planWeekPreparation";
import { decodePreparedMetadata, PREPARED_METADATA_READ } from "@/lib/preparedMediaStorage";
import { getH3JobStatusInRenderEngine, getVerifiedH3OutputReadbackInRenderEngine } from "@/lib/renderEngineH3StageClient";
import { persistPreparedResult } from "@/lib/preparedResultStorage";
import { getObjectBytes } from "@/lib/storage";
import { sha256BytesHex } from "@/lib/sha256";
import { MINIMAX_H3_PROFILE } from "@/lib/minimaxH3";
import { renderEngineH3StagedFootageKey, type RenderEngineH3StagedFootage } from "./planWeekPreparedImages";

const MAX_ENGINE_H3_BYTES = 256 * 1024 * 1024;

export type RenderEngineH3MaterializeArgs = Readonly<{ ownerId: string; channelSlug: string; batchId: string; itemId: string }>;

function scope(args: RenderEngineH3MaterializeArgs) {
  if (![args.ownerId, args.channelSlug, args.batchId, args.itemId].every((item) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(item))) {
    throw new Error("Engine H3 materializer scope is invalid");
  }
  return args;
}

async function readStage(args: RenderEngineH3MaterializeArgs): Promise<RenderEngineH3StagedFootage> {
  const raw = await getObjectBytes(renderEngineH3StagedFootageKey(scope(args)), undefined, PREPARED_METADATA_READ);
  const stage = decodePreparedMetadata(raw) as RenderEngineH3StagedFootage;
  if (!stage || stage.version !== "render-engine-h3-staged-footage/v1" || stage.ownerId !== args.ownerId || stage.channelSlug !== args.channelSlug ||
      stage.batchId !== args.batchId || stage.itemId !== args.itemId || stage.engine?.site !== "https://jovial-camel-68.convex.site" ||
      stage.engine.projectName !== "youtube-studio-ai" || !/^[a-z0-9]{8,64}$/.test(stage.engine.workflowId) ||
      !/^[a-f0-9]{64}$/.test(stage.engine.profileRevisionSha256) || !Array.isArray(stage.jobs) || !stage.jobs.length) {
    throw new Error("Engine H3 staged footage receipt is invalid");
  }
  return stage;
}

async function fetchExactVideo(url: string, bytes: number, sha256: string): Promise<Uint8Array> {
  if (!Number.isSafeInteger(bytes) || bytes < 1_024 || bytes > MAX_ENGINE_H3_BYTES || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Engine H3 output receipt exceeds the bounded transfer contract");
  const response = await fetch(url, { redirect: "error", headers: { accept: "video/mp4" }, signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith("video/mp4") ||
      Number(response.headers.get("content-length")) !== bytes) throw new Error("Engine H3 signed output response does not match its receipt");
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength !== bytes || sha256BytesHex(body) !== sha256) throw new Error("Engine H3 output bytes do not match the verified receipt");
  return body;
}

export async function materializeRenderEngineH3PreparedFootage(args: RenderEngineH3MaterializeArgs): Promise<string> {
  const input = scope(args);
  const stage = await readStage(input);
  const manifestKey = planWeekPreparationKey(input);
  const manifestBytes = await getObjectBytes(manifestKey, undefined, PREPARED_METADATA_READ);
  if (sha256BytesHex(manifestBytes) !== stage.manifestSha256) throw new Error("Engine H3 materializer manifest digest changed");
  const manifest = normalizePlanWeekPreparationManifest(decodePreparedMetadata(manifestBytes));
  assertPlanWeekPreparationManifestBinding({ manifest, pointer: { version: manifest.version, manifestKey, manifestSha256: stage.manifestSha256 },
    ownerId: input.ownerId, channelId: stage.channelId, batchId: input.batchId, itemId: input.itemId, itemKey: manifest.itemKey,
    requestKey: manifest.requestKey, channelSlug: input.channelSlug, topic: manifest.plan.topic, title: manifest.plan.title,
    thumbnailKey: manifest.plan.thumbnailKey, thumbnailSource: manifest.plan.thumbnailSource });
  const token = process.env.RENDER_ENGINE_PROJECT_TOKEN?.trim() ?? "";
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Engine H3 materializer project capability is unavailable");
  const engine = { baseUrl: stage.engine.site, projectName: stage.engine.projectName, projectCapability: token };
  const clips: PlanWeekPreparedFootage["clips"] = [];
  const engineH3Jobs: NonNullable<PlanWeekPreparedFootage["engineH3Jobs"]> = [];
  for (const [index, staged] of stage.jobs.entries()) {
    const expectedClipKey = planWeekPreparedFootageClipKey({ ...input, index });
    const expectedFirstFrameKey = planWeekPreparedH3FirstFrameKey({ ...input, index });
    if (staged.output.r2Key !== expectedClipKey || staged.studioFirstFrame.r2Key !== expectedFirstFrameKey ||
        !/^[a-z0-9]{8,64}$/.test(staged.engineJobId) || !/^[a-f0-9]{64}$/.test(staged.requestManifestSha256) ||
        !/^[a-f0-9]{64}$/.test(staged.studioFirstFrame.sha256) ||
        !/^projects\/youtube-studio-ai\/inputs\/sha256\/[a-f0-9]{64}\.(?:png|jpg)$/.test(staged.engineFirstFrame.r2Key) ||
        !/^[a-f0-9]{64}$/.test(staged.engineFirstFrame.sha256)) {
      throw new Error("Engine H3 staged job binding is invalid");
    }
    const [status, output] = await Promise.all([getH3JobStatusInRenderEngine(engine, staged.engineJobId), getVerifiedH3OutputReadbackInRenderEngine(engine, staged.engineJobId)]);
    if (status.status !== "completed" || status.outputRetired || !status.output || status.output.sha256 !== output.sha256 ||
        status.output.bytes !== output.bytes || status.output.key !== output.key || status.output.bucket !== output.bucket ||
        status.output.contentType !== output.contentType || status.output.verifiedAt !== output.verifiedAt || output.contentType !== "video/mp4") {
      throw new Error("Engine H3 job is not a current verified completion");
    }
    const video = await fetchExactVideo(output.url, output.bytes, output.sha256);
    await persistPreparedResult(staged.output.r2Key, video, "video/mp4", { "render-engine-h3-job": staged.engineJobId, "render-engine-h3-sha256": output.sha256 });
    const retained = await getObjectBytes(staged.output.r2Key, undefined, { maxBytes: output.bytes, timeoutMs: 300_000 });
    if (retained.byteLength !== output.bytes || sha256BytesHex(retained) !== output.sha256) {
      throw new Error("Studio R2 clip does not match the verified Engine output");
    }
    clips.push({ r2Key: staged.output.r2Key, sha256: output.sha256, byteLength: output.bytes, durationSec: MINIMAX_H3_PROFILE.frames / MINIMAX_H3_PROFILE.fps });
    engineH3Jobs.push({ sceneId: staged.sceneId, jobId: staged.engineJobId, requestManifestSha256: staged.requestManifestSha256,
      firstFrame: staged.studioFirstFrame, output: { bucket: output.bucket, key: output.key, sha256: output.sha256, byteLength: output.bytes, verifiedAt: output.verifiedAt } });
  }
  const durationSec = MINIMAX_H3_PROFILE.frames / MINIMAX_H3_PROFILE.fps;
  const prepared: PlanWeekPreparedFootage = {
    version: "plan-week-prepared-footage/v1", manifestSha256: stage.manifestSha256, ownerId: input.ownerId, channelId: stage.channelId,
    batchId: input.batchId, itemId: input.itemId, requestKey: stage.requestKey, topic: manifest.plan.topic,
    generatedFootageSceneManifest: { version: "generated-footage-scene-manifest/v1", source: "story_spine", exactOrder: true,
      durationSec: durationSec * clips.length, items: clips.map((clip, index) => ({ sceneId: stage.jobs[index]!.sceneId, clipKey: clip.r2Key, t0: durationSec * index, t1: durationSec * (index + 1) })) },
    clips, renderer: { kind: "render-engine-h3", projectName: "youtube-studio-ai", workflowId: stage.engine.workflowId, profileRevisionSha256: stage.engine.profileRevisionSha256 }, engineH3Jobs, createdAt: Date.now(),
  };
  const checked = assertPlanWeekPreparedFootageBinding({ prepared, manifest });
  const key = planWeekPreparedFootageKey(input);
  await persistPreparedResult(key, new TextEncoder().encode(canonicalJson(checked)), "application/json", { "plan-week-prepared-footage": checked.version });
  return key;
}

export const renderEngineH3MaterializePreparedFootageTask = task({ id: "render-engine-h3-materialize-prepared-footage", maxDuration: 1_800, retry: { maxAttempts: 1 },
  run: async (raw: RenderEngineH3MaterializeArgs) => {
    await bootstrapSecrets(() => undefined, { services: ["cloudflare"], required: ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] });
    return { sidecarKey: await materializeRenderEngineH3PreparedFootage(raw) };
  },
});
