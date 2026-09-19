import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { artifactContract } from "@/engine/artifactSchemas";
import { AcceptedMusicArrangementSchema } from "@/engine/acceptedMusicArrangement";
import type { ModuleManifest } from "@/engine/moduleManifest";
import { PRICE } from "@/engine/pricing";
import type { StageContext } from "@/engine/types";
import { makeRunTempDir } from "@/lib/files";
import { getObjectBytes, headObjectMetadata, putObject } from "@/lib/storage";
import { canonicalJson } from "@/lib/canonicalJson";
import { validateMotionComicExternalScore } from "@/lib/motionComicScore";
import { createMotionComicBlock, type PreparedMotionComicExternalScore } from "./motionComicBlocks";

export const SHARED_SCORE_MOTION_COMIC_VERSION = "2.0.0-shared-score";
export const SHARED_SCORE_MAX_BYTES = 256 * 1024 * 1024;

const scoreConfig = z.object({
  scorePlayback: z.enum(["once", "repeat"]),
  bodyMusicVol: z.number().finite().min(0).max(2),
  targetLufs: z.number().finite().min(-23).max(-12),
}).passthrough();

async function prepareExternalScore(ctx: StageContext): Promise<PreparedMotionComicExternalScore> {
  const params = scoreConfig.parse(ctx.params);
  const key = ctx.store.musicKey;
  if (
    !/^[a-zA-Z0-9_-]+$/.test(ctx.ownerId) ||
    !/^[a-zA-Z0-9_-]+$/.test(ctx.runId) ||
    typeof key !== "string" || key.length > 1024 ||
    !key.startsWith(`owner/${ctx.ownerId}/`) ||
    !/^[a-zA-Z0-9_./-]+$/.test(key) ||
    key.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("motion_comic shared score requires an owner-scoped R2 musicKey");
  }
  const suppliedArrangement = ctx.store.acceptedMusicArrangement;
  const arrangement = suppliedArrangement === undefined
    ? undefined : AcceptedMusicArrangementSchema.parse(suppliedArrangement);
  if (arrangement && (
    arrangement.ownerId !== ctx.ownerId || arrangement.channelId !== ctx.channelId ||
    arrangement.runId !== ctx.runId || arrangement.topic !== ctx.store.topic ||
    arrangement.arrangement.playback !== params.scorePlayback
  )) {
    throw new Error("motion_comic shared score arrangement binding or playback mismatch");
  }
  const metadata = await headObjectMetadata(key);
  const length = metadata?.contentLength;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length <= 0 || length > SHARED_SCORE_MAX_BYTES) {
    throw new Error("motion_comic shared score is missing, empty, or exceeds the byte limit");
  }
  const bytes = await getObjectBytes(key, undefined, { timeoutMs: 120_000 });
  if (!bytes.byteLength || bytes.byteLength > SHARED_SCORE_MAX_BYTES || bytes.byteLength !== length) {
    throw new Error("motion_comic shared score byte length changed or exceeds the byte limit");
  }
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  const runDir = await makeRunTempDir(ctx.runId, `shared-score-${ctx.ownerId}`);
  const path = join(runDir, `${contentSha256}.audio`);
  try {
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readFile(path);
    if (existing.byteLength !== bytes.byteLength || createHash("sha256").update(existing).digest("hex") !== contentSha256) {
      throw new Error("motion_comic shared score local source integrity mismatch");
    }
  }
  const evidence = {
    contentSha256, byteLength: bytes.byteLength,
    playback: params.scorePlayback, gain: params.bodyMusicVol, targetLufs: params.targetLufs,
  };
  const externalScore = { path, ...evidence };
  // Verify decodable audio before the block's paid storyboard planner runs.
  // This proves source integrity only, not adherence or artistic approval.
  const validated = await validateMotionComicExternalScore(externalScore);
  const bindingKey = `owner/${ctx.ownerId}/runs/${ctx.runId}/bindings/motion-comic-shared-score.json`;
  const binding = {
    identity: {
      version: SHARED_SCORE_MOTION_COMIC_VERSION,
      ownerId: ctx.ownerId, channelId: ctx.channelId, runId: ctx.runId, topic: ctx.store.topic,
      musicKey: key, playback: evidence.playback, gain: evidence.gain, targetLufs: evidence.targetLufs,
      acceptedMusicArrangementFingerprint: arrangement?.fingerprint ?? null,
    },
    source: { contentSha256, byteLength: bytes.byteLength },
  };
  const bindingJson = canonicalJson(binding);
  // Pinning the accepted source is authoritative even before provider spend.
  if (ctx.assertRemoteChildExecutionLease) {
    await ctx.assertRemoteChildExecutionLease({ reason: "paid_wave" });
  } else if (ctx.assertInlinePaidExecutionLease) {
    await ctx.assertInlinePaidExecutionLease();
  } else {
    throw new Error("motion_comic shared score requires execution ownership admission");
  }
  try {
    await putObject(bindingKey, Buffer.from(bindingJson), { contentType: "application/json", ifNoneMatch: "*" });
  } catch (error) {
    const failure = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (failure.name !== "PreconditionFailed" && failure.name !== "ConditionalRequestConflict" &&
      failure.$metadata?.httpStatusCode !== 412 && failure.$metadata?.httpStatusCode !== 409) throw error;
  }
  const persisted = JSON.parse(Buffer.from(await getObjectBytes(bindingKey, undefined, { timeoutMs: 30_000 })).toString("utf8"));
  if (canonicalJson(persisted) !== bindingJson) {
    throw new Error("motion_comic shared score durable source binding mismatch; original source and mix must be restored");
  }
  return {
    externalScore,
    sourceMetadata: {
      musicKey: key, sourceBindingKey: bindingKey, ...validated,
      ...(arrangement ? { acceptedMusicArrangementFingerprint: arrangement.fingerprint } : {}),
      evidenceScope: "source-consumption-only",
    },
  };
}

export function createSharedScoreMotionComicManifest(legacy: ModuleManifest): ModuleManifest {
  if (legacy.id !== "motion_comic") throw new Error("shared score requires motion_comic");
  const block = createMotionComicBlock(prepareExternalScore);
  block.consumes = [...new Set([...legacy.block.consumes, "musicKey"])];
  const { musicKey: _musicKey, ...optionalConsumes } = legacy.optionalConsumes;
  void _musicKey;
  const legacyCeiling = legacy.costAndLatency.maxCostUsdFor;
  return {
    ...legacy,
    version: SHARED_SCORE_MOTION_COMIC_VERSION,
    requiredCapabilities: [...new Set([...legacy.requiredCapabilities, "audio.music_generated"])],
    consumes: { ...legacy.consumes, musicKey: artifactContract("musicKey") },
    optionalConsumes: {
      ...optionalConsumes,
      persona: artifactContract("persona"),
      criticDoctrine: artifactContract("criticDoctrine"),
      acceptedMusicArrangement: artifactContract("acceptedMusicArrangement"),
    },
    configSchema: legacy.configSchema.and(scoreConfig),
    costAndLatency: {
      ...legacy.costAndLatency,
      ...(legacyCeiling ? {
        // The legacy configured ceiling includes exactly one flat music job.
        maxCostUsdFor: (params, context) => Math.max(0, legacyCeiling(params, context) - PRICE.musicTrackUsd),
      } : {}),
    },
    certification: {
      status: "contract",
      evidence: "Opt-in external-score consumption; no generated-audio adherence or production qualification claim.",
    },
    block,
    execute: block.run,
  };
}
