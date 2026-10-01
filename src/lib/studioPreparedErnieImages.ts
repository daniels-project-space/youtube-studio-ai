import { canonicalJson } from "@/lib/canonicalJson";
import { sha256BytesHex, sha256Hex } from "@/lib/sha256";
import { getObjectBytes } from "@/lib/storage";
import { persistPreparedResult } from "@/lib/preparedResultStorage";
import { generationProfile } from "@/engine/generationProfiles";
import { planWeekPreparedImagesKey, planWeekPreparedImageKey } from "@/lib/planWeekPreparation";
import { STUDIO_ERNIE_CONTRACT, provisionStudioErnieWorkflow, stageStudioErnieBatch, readStudioErnieBatch, readStudioErnieOutputs, type ErnieRequest } from "@/lib/renderEngineErnieClient";
import type { PlanWeekPreparedImagesArgs } from "@/trigger/planWeekPreparedImages";

export const erniePreparedDependencies = { persist: persistPreparedResult, read: getObjectBytes,
  provision: provisionStudioErnieWorkflow, stage: stageStudioErnieBatch, readiness: readStudioErnieBatch, outputs: readStudioErnieOutputs };

/** Freeze before HTTP. Replays use Engine's project idempotency ledger, never a fresh generation claim. */
export async function prepareStudioErnieImages(payload: PlanWeekPreparedImagesArgs, deps = erniePreparedDependencies) {
  const profile = generationProfile(payload.generationProfile);
  const prefix = planWeekPreparedImagesKey(payload).replace(/\.json$/, ".engine-ernie");
  const freeze = async (key: string, value: unknown) => deps.persist(key, new TextEncoder().encode(canonicalJson(value)), "application/json", { "studio-ernie": "v1" });
  const candidates = payload.shots.flatMap((shot, shotIndex) => Array.from({ length: shot.candidateCount ?? profile.image.candidates }, (_, candidateIndex) => ({
    id: `s${shotIndex}-c${candidateIndex}`, shotId: shot.id, candidateIndex,
    seed: (shot.seed ?? 100_000 + shotIndex) + candidateIndex,
    // ERNIE has no separate negative/director fields. Preserve all approved text explicitly.
    prompt: [payload.director, payload.style, shot.prompt, [payload.negative, shot.negative].filter(Boolean).length ? `Avoid: ${[payload.negative, shot.negative].filter(Boolean).join("; ")}` : undefined].filter(Boolean).join("\n"),
  })));
  if (candidates.some(c => !Number.isSafeInteger(c.seed) || c.seed < 0 || c.seed > 0xffffffff || c.prompt.length > 20_000)) throw new Error("Studio ERNIE candidate exceeds Engine limits");
  const source = { version: "studio-ernie-source/v1", preparationManifestSha256: payload.manifestSha256,
    ownerId: payload.ownerId, channelId: payload.channelId, batchId: payload.batchId, itemId: payload.itemId,
    requestedProfile: profile.id, requestedGeometry: { width: profile.image.width, height: profile.image.height }, maxCostUsd: payload.maxCostUsd, candidates };
  await freeze(`${prefix}.source.json`, source);
  if (payload.approvedErnieNativeGeometry !== "1376x768") return {
    kind: "pending" as const, state: "awaiting-image-geometry-approval", sourceKey: `${prefix}.source.json`,
    requestedGeometry: source.requestedGeometry, availableGeometry: { width: 1376, height: 768 }, jobs: [],
  };
  const capability = process.env.RENDER_ENGINE_PROJECT_TOKEN?.trim() ?? "";
  const bucket = process.env.R2_BUCKET?.trim() ?? "";
  if (!/^[a-f0-9]{64}$/.test(capability) || !bucket || bucket === "render-engine") throw new Error("Studio ERNIE project capability or dedicated R2 bucket is missing");
  const waveCount = Math.ceil(candidates.length / 16);
  // Divide the existing total cap across waves; never increase it to cover a provider minimum.
  const maxCostUsd = Math.min(10, payload.maxCostUsd / waveCount);
  const config = await deps.provision({ projectCapability: capability });
  const sourceSha256 = sha256Hex(canonicalJson(source));
  const requests: ErnieRequest[] = Array.from({ length: waveCount }, (_, wave) => ({
    version: 2, idempotencyKey: `studio-ernie-${sha256Hex(canonicalJson([sourceSha256, STUDIO_ERNIE_CONTRACT, wave])).slice(0, 48)}`,
    sourceId: `studio-${sourceSha256.slice(0, 48)}`, candidates: candidates.slice(wave * 16, wave * 16 + 16).map(({ id, prompt, seed }) => ({ id, prompt, seed, width: 1376, height: 768 })),
    output: { contentType: "image/png" }, maxCostUsd,
    profileRevisionSha256: STUDIO_ERNIE_CONTRACT.modelManifestSha256, imageContract: STUDIO_ERNIE_CONTRACT,
    imageContractSha256: sha256Hex(JSON.stringify(STUDIO_ERNIE_CONTRACT)),
  }));
  await freeze(`${prefix}.requests.json`, { version: "studio-ernie-requests/v1", sourceSha256, workflowId: config.workflowId, requests });
  const jobs = [];
  const ready = [];
  for (const [wave, batch] of requests.entries()) {
    const receipt = await deps.stage(config, batch);
    // No timestamp/state in immutable receipt: replay may advance state after a lost HTTP response.
    await freeze(`${prefix}.wave-${wave}.receipt.json`, { jobId: receipt.jobId, manifestSha256: receipt.manifestSha256 });
    const state = await deps.readiness(config, receipt, batch);
    if (["failed", "cancelled"].includes(state.state)) throw new Error(`Studio ERNIE batch requires reconciliation: ${state.state}`);
    jobs.push({ jobId: receipt.jobId, state: state.state });
    ready.push({ receipt, batch, state });
  }
  if (ready.some(job => job.state.state !== "completed")) return { kind: "pending" as const,
    state: ready.some(job => job.state.state === "awaiting-final-qualification") ? "awaiting-final-qualification" : "awaiting-engine-image-output", jobs, sourceKey: `${prefix}.source.json` };
  const outputs = [];
  for (const job of ready) outputs.push(...await deps.outputs(config, job.receipt, job.batch, bucket));
  const items = [];
  const stillItems = [];
  for (const [index, candidate] of candidates.entries()) {
    const output = outputs.find(o => o.candidateId === candidate.id);
    if (!output) throw new Error("Studio ERNIE output candidate mapping is incomplete");
    const bytes = await deps.read(output.key, bucket, { maxBytes: output.bytes, timeoutMs: 300_000 });
    const buffer = Buffer.from(bytes);
    if (bytes.byteLength !== output.bytes || sha256BytesHex(bytes) !== output.sha256 || buffer.length < 24 ||
      buffer.subarray(0,8).toString("hex") !== "89504e470d0a1a0a" || buffer.readUInt32BE(8) !== 13 || buffer.subarray(12,16).toString("ascii") !== "IHDR" ||
      buffer.readUInt32BE(16) !== 1376 || buffer.readUInt32BE(20) !== 768) throw new Error("Studio ERNIE byte receipt or native geometry changed");
    const stillKey = planWeekPreparedImageKey({ ...payload, index });
    await deps.persist(stillKey, bytes, "image/png", {});
    const retained = await deps.read(stillKey, undefined, { maxBytes: output.bytes, timeoutMs: 300_000 });
    if (retained.byteLength !== output.bytes || sha256BytesHex(retained) !== output.sha256) throw new Error("Studio ERNIE canonical R2 receipt failed");
    items.push({ shotId: candidate.shotId, candidateIndex: candidate.candidateIndex, stillKey, sha256: output.sha256, byteLength: output.bytes });
    stillItems.push({ shotId: candidate.shotId, candidateIndex: candidate.candidateIndex, stillKey, outputId: output.key });
  }
  await freeze(`${prefix}.outputs.json`, { version: "studio-ernie-output-receipts/v1", sourceSha256, outputs, items });
  return { kind: "completed" as const, items, stillItems, jobs };
}
