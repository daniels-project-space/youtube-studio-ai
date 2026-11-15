import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "@/lib/canonicalJson";
import { rasterImageDimensions } from "@/lib/imageDimensions";
import { configuredHyperYoutubeStageClient, type HyperYoutubeStage } from "@/lib/hyperYoutubeStageClient";
import { getObjectBytes, putObject } from "@/lib/storage";
import type { PlanWeekPreparedImagesArgs } from "@/lib/planWeekPreparedImagesArgs";
import { generationProfile } from "@/engine/generationProfiles";

const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const environmentSchema = z.object({ id: z.string().uuid(), modelId: z.literal("ernie-image-turbo"), sha256: sha }).strict();

/** Native ERNIE stills have a distinct receipt; they do not satisfy the legacy Z-Image manifest. */
export async function renderWeeklyHyperStills(input: {
  payload: PlanWeekPreparedImagesArgs;
  outputRoot: string;
  bucket: string;
  wait: (jobId: string, check: number) => Promise<void>;
  client?: ReturnType<typeof configuredHyperYoutubeStageClient>;
  storage?: { get: typeof getObjectBytes; put: (key: string, bytes: Uint8Array,
    options: { bucket: string; contentType: string; ifNoneMatch: "*" }) => Promise<string> };
}) {
  const { payload, bucket, outputRoot } = input;
  const client = input.client ?? configuredHyperYoutubeStageClient();
  const read = input.storage?.get ?? getObjectBytes, put = input.storage?.put ?? putObject;
  const binding = await client.binding();
  if (!bucket || binding.outputBucket !== bucket) throw new Error("weekly ERNIE HRS and YouTube project R2 buckets must match");
  const inputSha256 = digest(canonicalJson(payload));
  const readJson = async (key: string): Promise<unknown | null> => {
    try { return JSON.parse(Buffer.from(await read(key, bucket, { maxBytes: 5_000_000, timeoutMs: 30_000 })).toString("utf8")); }
    catch (error) { const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === "NoSuchKey" && e.$metadata?.httpStatusCode === 404) return null;
      throw error; }
  };
  const putExact = async (key: string, bytes: Uint8Array, contentType: string) => {
    try { await put(key, bytes, { bucket, contentType, ifNoneMatch: "*" }); }
    catch (error) {
      const found = await read(key, bucket, { maxBytes: bytes.length, timeoutMs: 300_000 }).catch(() => null);
      if (!found || found.length !== bytes.length || digest(found) !== digest(bytes)) throw error;
    }
    const found = await read(key, bucket, { maxBytes: bytes.length, timeoutMs: 300_000 });
    if (found.length !== bytes.length || digest(found) !== digest(bytes)) throw new Error("weekly ERNIE R2 readback mismatch");
  };
  const writeJson = async (key: string, value: unknown) => {
    await putExact(key, Buffer.from(canonicalJson(value)), "application/json");
  };
  const requestKey = `${outputRoot}/request.json`;
  const request = { version: "weekly-hrs-ernie-request/v1", projectId: binding.projectId, inputSha256 };
  const savedRequest = await readJson(requestKey);
  if (savedRequest === null) await writeJson(requestKey, request);
  else if (canonicalJson(savedRequest) !== canonicalJson(request)) throw new Error("weekly ERNIE immutable request changed");
  const priorReceipt = await readJson(`${outputRoot}/receipt.json`);
  const items: Array<Record<string, unknown>> = [];
  let ordinal = 0;
  const defaultCandidates = generationProfile(payload.generationProfile ?? "production").image.candidates;
  for (const shot of payload.shots) {
    for (let candidateIndex = 0; candidateIndex < (shot.candidateCount ?? defaultCandidates); candidateIndex++, ordinal++) {
      if (shot.referenceRequired) {
        items.push({ shotId: shot.id, candidateIndex, status: "blocked", reason: "reference_image_conditioning_unsupported" });
        continue;
      }
      const prompt = [payload.director, payload.style, shot.prompt,
        [payload.negative, shot.negative].filter(Boolean).length ? `Avoid: ${[payload.negative, shot.negative].filter(Boolean).join(", ")}` : ""]
        .filter(Boolean).join("\n\n");
      if (prompt.length > 16_000) throw new Error(`weekly ERNIE shot ${shot.id} prompt is too long`);
      const seed = shot.seed === undefined ? undefined : shot.seed + candidateIndex;
      if (seed !== undefined && !Number.isSafeInteger(seed)) throw new Error("weekly ERNIE candidate seed overflow");
      const stage: HyperYoutubeStage = { modelId: "ernie-image-turbo", inputs: { prompt }, ...(seed === undefined ? {} : { seed }) };
      const requestSha256 = digest(canonicalJson({ inputSha256, shotId: shot.id, candidateIndex, stage }));
      const root = `${outputRoot}/items/${String(ordinal).padStart(4, "0")}`;
      const envSchema = z.object({ version: z.literal("weekly-hrs-ernie-environment/v1"), projectId: z.literal(binding.projectId),
        requestSha256: z.literal(requestSha256), environment: environmentSchema }).strict();
      let envRaw = await readJson(`${root}/environment.json`);
      if (envRaw === null) {
        const environment = await client.createEnvironment("ernie-image-turbo");
        try { await writeJson(`${root}/environment.json`, { version: "weekly-hrs-ernie-environment/v1", projectId: binding.projectId, requestSha256, environment }); }
        catch (error) { const existing = await readJson(`${root}/environment.json`); if (existing === null) throw error; }
        envRaw = await readJson(`${root}/environment.json`);
      }
      const environment = envSchema.parse(envRaw).environment;
      const resolved = await client.getEnvironment(environment.id, "ernie-image-turbo");
      if (resolved.sha256 !== environment.sha256) throw new Error("weekly ERNIE pinned environment changed");
      const key = `youtube-weekly-ernie:${digest(canonicalJson({ inputSha256, ordinal }))}`;
      const jobSchema = z.object({ version: z.literal("weekly-hrs-ernie-job/v1"), projectId: z.literal(binding.projectId),
        requestSha256: z.literal(requestSha256), environmentId: z.literal(environment.id), jobId: z.string().uuid() }).strict();
      let jobRaw = await readJson(`${root}/job.json`), job;
      if (jobRaw === null) {
        job = await client.submit(stage, key, environment);
        const candidate = { version: "weekly-hrs-ernie-job/v1", projectId: binding.projectId, requestSha256,
          environmentId: environment.id, jobId: job.id };
        try { await writeJson(`${root}/job.json`, candidate); }
        catch (error) { const existing = await readJson(`${root}/job.json`); if (existing === null) throw error; }
        jobRaw = await readJson(`${root}/job.json`);
        if (jobSchema.parse(jobRaw).jobId !== job.id) throw new Error("weekly ERNIE concurrent job mismatch");
      } else job = await client.get(jobSchema.parse(jobRaw).jobId, stage, key, environment);
      for (let check = 0; job.state !== "completed"; check++) {
        if (["failed", "cancelled", "expired"].includes(job.state)) throw new Error(`weekly ERNIE job ${job.id} ended ${job.state}`);
        if (check >= 720) throw new Error(`weekly ERNIE job ${job.id} remains ${job.state}; resume the same job`);
        await input.wait(job.id, check);
        job = await client.get(job.id, stage, key, environment);
      }
      const bytes = await client.download(job, stage, key, 50 * 1024 * 1024);
      const out = job.output;
      if (job.projectId !== binding.projectId || job.modelId !== "ernie-image-turbo" ||
          job.environmentId !== environment.id || job.environmentSha256 !== environment.sha256 ||
          job.outputDestination.bucket !== bucket || job.outputDestination.projectPrefix !== binding.outputPrefix ||
          !out || out.projectId !== binding.projectId || out.jobId !== job.id || out.generation !== job.generation ||
          out.bucket !== bucket || out.key !== `${binding.outputPrefix}jobs/${job.id}/${job.generation}/output.png` ||
          out.contentType !== "image/png" || out.available !== true || out.bytes !== bytes.length || out.sha256 !== digest(bytes)) {
        throw new Error("weekly ERNIE HRS receipt does not match project output bytes");
      }
      const dimensions = rasterImageDimensions(bytes);
      if (dimensions.contentType !== "image/png" || dimensions.width !== 1024 || dimensions.height !== 1024)
        throw new Error("weekly ERNIE native output must be 1024x1024 PNG");
      const stillKey = `${root}/output.png`;
      await putExact(stillKey, bytes, "image/png");
      items.push({ shotId: shot.id, candidateIndex, status: "ready", stillKey, sha256: digest(bytes), byteLength: bytes.length,
        jobId: job.id, generation: job.generation, environment, idempotencyKey: key, stage, requestSha256,
        source: { bucket: out.bucket, key: out.key, sha256: out.sha256, bytes: out.bytes, contentType: out.contentType } });
    }
  }
  const receipt = { version: "weekly-hrs-ernie-stills/v1", projectId: binding.projectId, inputSha256,
    manifestSha256: payload.manifestSha256, ownerId: payload.ownerId, channelId: payload.channelId,
    generationProfile: payload.generationProfile ?? "production", modelId: "ernie-image-turbo", width: 1024, height: 1024,
    expectedNativeProfile: { precision: "bf16", steps: 50 },
    referenceConditioning: false, costStatus: "unreported", items };
  if (priorReceipt !== null && canonicalJson(priorReceipt) !== canonicalJson(receipt)) throw new Error("weekly ERNIE receipt changed on replay");
  await writeJson(`${outputRoot}/receipt.json`, receipt);
  return { receipt, receiptKey: `${outputRoot}/receipt.json`, reused: priorReceipt !== null };
}
