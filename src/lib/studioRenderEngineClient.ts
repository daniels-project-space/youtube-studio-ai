import { createHash } from "node:crypto";
import { z } from "zod";
import { STUDIO_ENGINE_AUDIO_WORKFLOWS } from "./studioRenderEngineWorkflows";

export const STUDIO_ENGINE_PROJECT = "youtube-studio-render";
export const STUDIO_ENGINE_BUCKET = "re-youtube-studio-render-p2w18g596q";
const BASE = `https://render-engine-sable.vercel.app/api/v1/projects/${STUDIO_ENGINE_PROJECT}`;
const nativeRoutes = {
  yue2: "yue2-jobs",
  "qwen3-tts": "qwen3-tts-jobs",
  "fish-audio-s2-pro": "fish-s2-pro-jobs",
  "minimax-music3": "music3-jobs",
} as const;
export type StudioEngineAudioModel = keyof typeof nativeRoutes;
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const JobId = z.string().regex(/^[a-z0-9]{32}$/);
const Workflow = z.object({ workflowId: JobId, profileRevisionSha256: Hash });
const NativeArtifact = z.object({ name: z.string(), key: z.string(), bytes: z.number().int().positive(),
  sha256: Hash, contentType: z.string() }).strict();
const NativeRead = NativeArtifact.extend({ url: z.string().url(),
  readHeaders: z.object({ "If-Match": z.string().min(1).max(160) }).strict(), expiresInSeconds: z.number().positive() });
const SIDECARS: Record<string, { contentType: string; limit: number }> = {
  "score.abc": { contentType: "text/vnd.abc", limit: 1_000_000 },
  "semantic.npy": { contentType: "application/octet-stream", limit: 2_000_000 },
  "latent.npy": { contentType: "application/octet-stream", limit: 64_000_000 },
  "request.json": { contentType: "application/json", limit: 60_000 },
  "config.json": { contentType: "application/json", limit: 60_000 },
  "result.json": { contentType: "application/json", limit: 60_000 },
};
const Output = z.object({
  bucket: z.literal(STUDIO_ENGINE_BUCKET), key: z.string().min(1), bytes: z.number().int().positive(),
  sha256: Hash, contentType: z.string().min(1), verifiedAt: z.number().positive(), url: z.string().url(),
  nativeArtifacts: z.array(NativeArtifact).length(6).optional(),
});
const Status = z.object({
  jobId: JobId, workflowId: JobId, profileId: z.enum(["yue2", "qwen3-tts", "fish-audio-s2-pro", "minimax-music3"]),
  requestSha256: Hash, status: z.string().min(1), outputRetired: z.boolean(),
  output: Output.omit({ url: true }).nullable(),
}).passthrough();
const Admission = z.object({ jobId: JobId, state: z.string().min(1), manifestSha256: Hash });
export type StudioEngineAdmission = z.infer<typeof Admission>;

export class StudioEngineError extends Error {
  constructor(readonly status: number | null, readonly submissionMayExist: boolean) {
    super(submissionMayExist
      ? "Render Engine submission requires reconciliation with its original immutable key"
      : "Render Engine request failed; no direct-provider fallback is permitted");
  }
}

async function boundedBytes(response: Response, maximum: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let slab: Uint8Array | undefined, used = 0;
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) throw new Error("Response exceeds bound");
      // A hostile stream of tiny chunks must not amplify retained metadata.
      for (let offset = 0; offset < value.length;) {
        if (!slab || used === slab.length) {
          slab = new Uint8Array(Math.min(65_536, maximum - chunks.length * 65_536));
          chunks.push(slab); used = 0;
        }
        const count = Math.min(slab.length - used, value.length - offset);
        slab.set(value.subarray(offset, offset + count), used);
        used += count; offset += count;
      }
    }
    return Buffer.concat(chunks.map((chunk, index) => index === chunks.length - 1 ? chunk.subarray(0, used) : chunk), total);
  } finally { void reader.cancel().catch(() => undefined); }
}

/** Public Engine API only; provider selection and paid recovery belong to Engine. */
export class StudioRenderEngineClient {
  constructor(private readonly key: string, private readonly fetchImpl: typeof fetch = fetch) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Render Engine management credential is missing or invalid");
  }

  private async request(path: string, body?: unknown, submission = false): Promise<unknown> {
    try {
      const response = await this.fetchImpl(`${BASE}/${path}`, {
        method: body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store",
        headers: { authorization: `Bearer ${this.key}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw new StudioEngineError(response.status, submission);
      }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await boundedBytes(response, 2_000_000)));
    } catch (error) {
      if (error instanceof StudioEngineError) throw error;
      throw new StudioEngineError(null, submission);
    }
  }

  integration() { return this.request("integration"); }

  async prepareAudio(model: StudioEngineAudioModel) {
    if (!Object.hasOwn(nativeRoutes, model)) throw new Error("Unsupported Studio audio model");
    return Workflow.parse(await this.request("workflows", { workflowName: `studio-${model}`, profileId: model }));
  }

  async submitAudio(model: StudioEngineAudioModel, workflowId: string, request: Record<string, unknown>) {
    if (!Object.hasOwn(nativeRoutes, model)) throw new Error("Unsupported Studio audio model");
    JobId.parse(workflowId);
    z.string().regex(/^[A-Za-z0-9:_-]{16,200}$/).parse(request.idempotencyKey);
    Hash.parse(request.profileRevisionSha256);
    const registered = STUDIO_ENGINE_AUDIO_WORKFLOWS[model];
    if (workflowId !== registered.workflowId || request.profileRevisionSha256 !== registered.profileRevisionSha256) {
      throw new Error("Audio submission must use the registered Studio workflow and its pinned model revision");
    }
    // Do not retry, rewrite fields or manufacture an alternate key after an ambiguous POST.
    const value = await this.request(nativeRoutes[model], { workflowId, request }, true);
    try { return Admission.parse(value); }
    catch { throw new StudioEngineError(null, true); }
  }

  observe(jobId: string) { return this.request(`jobs?jobId=${JobId.parse(jobId)}`); }

  async observeAudio(admission: StudioEngineAdmission, model: StudioEngineAudioModel, workflowId: string) {
    const status = Status.parse(await this.observe(admission.jobId));
    if (status.jobId !== admission.jobId || status.workflowId !== workflowId || status.profileId !== model ||
      status.requestSha256 !== admission.manifestSha256) throw new Error("Render Engine job identity changed");
    return status;
  }

  modelStorage() { return this.request("model-storage"); }

  private async download(url: string, maximum: number, headers?: Record<string, string>) {
    try {
      const response = await this.fetchImpl(url, { headers, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new StudioEngineError(response.status, false);
      return await boundedBytes(response, maximum);
    } catch (error) {
      if (error instanceof StudioEngineError) throw error;
      throw new StudioEngineError(null, false);
    }
  }

  async registerComfy(input: {
    workflowName: string; profileId: string; graph: Record<string, unknown>;
    models: Record<string, unknown>[]; settings: Record<string, unknown>; loras?: Record<string, unknown>[];
  }) {
    if (!/^[a-z][a-z0-9-]{2,79}$/.test(input.workflowName) || !input.profileId || !Object.keys(input.graph).length) {
      throw new Error("A named model workflow and real Comfy API graph are required");
    }
    const bytes = Buffer.from(JSON.stringify(input.graph));
    if (bytes.length > 1_000_000) throw new Error("Comfy graph exceeds the Engine upload limit");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const upload = z.object({ key: z.string(), url: z.string().url(), headers: z.record(z.string()) }).parse(
      await this.request("comfy-source-uploads", { kind: "workflow", sha256, bytes: bytes.length }),
    );
    const url = new URL(upload.url);
    if (upload.key !== `projects/${STUDIO_ENGINE_PROJECT}/comfy/sha256/${sha256}.json` ||
      url.protocol !== "https:" || !url.hostname.endsWith(".r2.cloudflarestorage.com") || url.username || url.password || url.hash) {
      throw new Error("Comfy upload capability is outside Studio's project");
    }
    const response = await this.fetchImpl(url, { method: "PUT", headers: upload.headers, body: bytes,
      redirect: "error", signal: AbortSignal.timeout(60_000) });
    // An immutable source may already exist. Engine independently rehashes it
    // during registration, so a conflict never authorizes an overwrite.
    if (!response.ok && response.status !== 412 && response.status !== 409) throw new StudioEngineError(response.status, false);
    void response.body?.cancel().catch(() => undefined);
    const registered = z.object({ workflowId: JobId, specificationSha256: Hash, executionReady: z.boolean() }).parse(
      await this.request("workflows", { workflowName: input.workflowName, profileId: input.profileId,
        comfySpecification: { version: 1, workflow: { key: upload.key, bytes: bytes.length, sha256 },
          models: input.models, loras: input.loras ?? [], settings: input.settings } }),
    );
    const readback = z.object({ workflowId: JobId, specificationSha256: Hash, executionReady: z.boolean() }).passthrough().parse(
      await this.request(`workflows/specification?workflowId=${registered.workflowId}`),
    );
    if (readback.workflowId !== registered.workflowId || readback.specificationSha256 !== registered.specificationSha256 ||
      readback.executionReady !== registered.executionReady) throw new Error("Comfy specification readback changed");
    return { ...registered, sourceSha256: sha256, readback };
  }

  async verifiedOutput(jobId: string, maximumBytes: number, requireNativeArtifacts = false) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 250_000_000) {
      throw new Error("Explicit bounded output size is required");
    }
    const raw = await this.request(`jobs/output?jobId=${JobId.parse(jobId)}`);
    const receipt = Output.parse(raw);
    const url = new URL(receipt.url);
    if (receipt.bytes > maximumBytes || !receipt.key.startsWith(`projects/${STUDIO_ENGINE_PROJECT}/`) ||
      receipt.key.split("/").some(part => part === ".." || part === "." || !part) ||
      url.protocol !== "https:" || url.username || url.password || url.hash ||
      !url.hostname.endsWith(".r2.cloudflarestorage.com")) throw new Error("Output is outside Studio's Engine storage contract");
    // Never forward the management credential to the signed object URL.
    const bytes = await this.download(receipt.url, receipt.bytes);
    if (bytes.byteLength !== receipt.bytes || createHash("sha256").update(bytes).digest("hex") !== receipt.sha256) {
      throw new Error("Render Engine output bytes do not match the verified R2 receipt");
    }
    const nativeArtifactBytes: Record<string, Uint8Array> = {};
    if (requireNativeArtifacts || receipt.nativeArtifacts) {
      if (!receipt.nativeArtifacts) throw new Error("Native YuE2 evidence is missing");
      const reads = z.object({ nativeArtifactReads: z.array(NativeRead).length(6) }).parse(raw).nativeArtifactReads;
      const prefix = receipt.key.slice(0, receipt.key.lastIndexOf("/"));
      if (!new RegExp(`^projects/${STUDIO_ENGINE_PROJECT}/jobs/[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`).test(prefix)) {
        throw new Error("Native artifact job scope is invalid");
      }
      const validated = Object.entries(SIDECARS).map(([name, contract]) => {
        const descriptors = receipt.nativeArtifacts!.filter(a => a.name === name);
        const capabilities = reads.filter(a => a.name === name);
        const descriptor = descriptors[0], capability = capabilities[0];
        if (descriptors.length !== 1 || capabilities.length !== 1 || descriptor.key !== `${prefix}/native/${name}` ||
          descriptor.contentType !== contract.contentType || descriptor.bytes > contract.limit ||
          ["key", "sha256", "bytes", "contentType"].some(field => descriptor[field as keyof typeof descriptor] !== capability[field as keyof typeof capability])) {
          throw new Error("Native YuE2 evidence descriptor changed");
        }
        const sourceUrl = new URL(capability.url);
        if (sourceUrl.protocol !== "https:" || !sourceUrl.hostname.endsWith(".r2.cloudflarestorage.com") ||
          sourceUrl.username || sourceUrl.password || sourceUrl.hash) throw new Error("Native artifact URL is outside R2");
        return { descriptor, capability };
      });
      for (const { descriptor, capability } of validated) {
        const data = await this.download(capability.url, descriptor.bytes, capability.readHeaders);
        if (data.length !== descriptor.bytes || createHash("sha256").update(data).digest("hex") !== descriptor.sha256) {
          throw new Error("Native YuE2 evidence bytes changed");
        }
        nativeArtifactBytes[descriptor.name] = data;
      }
    }
    return { receipt, bytes, nativeArtifactBytes };
  }
}
