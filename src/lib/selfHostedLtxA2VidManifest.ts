import {
  createMusicVideoA2VidRuntimePin,
  musicVideoA2VidWorkerProfile,
  type MusicVideoA2VidWorkOrder,
} from "@/engine/selfHostedLtxMusicVideoA2Vid";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

/**
 * Pure control-plane projection for the dedicated open-weight Novita A2Vid
 * worker. It deliberately does not presign, launch, download, or spend. The
 * privileged provider adapter must obtain short-lived URLs first, then call
 * this exact builder before it creates an instance.
 */
export const SELF_HOSTED_LTX_A2VID_WORKER_MANIFEST_VERSION = "1.0.0" as const;

const SHA256 = /^[a-f0-9]{64}$/iu;
const SAFE_R2_KEY = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9][A-Za-z0-9._/@+=:-]{1,511}$/u;
const MANIFEST_ID = /^audio_video-[a-f0-9]{32}$/u;
const AUDIO_CONTENT_TYPES = new Set(["audio/mpeg", "audio/wav", "audio/x-wav", "audio/flac", "audio/mp4", "audio/aac"]);
const IMAGE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as UnknownRecord;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function sha256(value: unknown, label: string): string {
  const result = nonEmpty(value, label).toLowerCase();
  if (!SHA256.test(result)) throw new Error(`${label} must be a SHA-256 digest`);
  return result;
}

function r2Key(value: unknown, label: string): string {
  const result = nonEmpty(value, label);
  if (!SAFE_R2_KEY.test(result)) throw new Error(`${label} is not a safe object key`);
  return result;
}

function httpsUrl(value: unknown, label: string): string {
  const result = nonEmpty(value, label);
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch {
    throw new Error(`${label} must be an HTTPS URL`);
  }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error(`${label} must be an HTTPS URL`);
  }
  return result;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function positiveFinite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive finite number`);
  return value;
}

function headers(value: unknown, label: string): Readonly<Record<string, string>> {
  const raw = record(value, label);
  const entries = Object.entries(raw);
  if (!entries.length || entries.some(([key, item]) => !key.trim() || typeof item !== "string" || !item.trim())) {
    throw new Error(`${label} must contain non-empty string headers`);
  }
  const normalized: Record<string, string> = {};
  for (const [key, item] of entries) normalized[key.toLowerCase()] = item as string;
  return Object.freeze(normalized);
}

export interface A2VidWorkerObjectSource {
  readonly r2Key: string;
  readonly getUrl: string;
  readonly sha256: string;
  readonly contentType: string;
}

export interface A2VidWorkerAudioSource extends A2VidWorkerObjectSource {
  readonly startMs: number;
  readonly endMs: number;
}

export interface A2VidWorkerWriteTarget {
  readonly putUrl: string;
}

export interface A2VidWorkerCheckpointTarget extends A2VidWorkerWriteTarget {
  readonly getUrl: string;
}

export interface A2VidWorkerArtifactTarget extends A2VidWorkerWriteTarget {
  readonly contentType: "video/mp4";
  readonly headers: Readonly<Record<string, string>>;
}

export interface CreateSelfHostedLtxA2VidWorkerManifestInput {
  readonly workOrder: MusicVideoA2VidWorkOrder;
  readonly manifestId: string;
  readonly expiresAt: number;
  readonly maxCostUsd: number;
  readonly maxRuntimeSeconds: number;
  readonly seed: number;
  readonly prompt: string;
  readonly audio: A2VidWorkerAudioSource;
  readonly references?: readonly A2VidWorkerObjectSource[];
  readonly artifact: A2VidWorkerArtifactTarget;
  readonly checkpoint: A2VidWorkerCheckpointTarget;
  readonly heartbeat: A2VidWorkerWriteTarget;
  readonly completion: A2VidWorkerWriteTarget;
}

export interface SelfHostedLtxA2VidWorkerManifest {
  readonly contractVersion: typeof SELF_HOSTED_LTX_A2VID_WORKER_MANIFEST_VERSION;
  readonly manifestId: string;
  readonly phase: "audio_video";
  readonly gpuSku: "RTX 4090" | "RTX 5090";
  readonly gpuCount: 1;
  readonly expiresAt: number;
  readonly maxCostUsd: number;
  readonly maxRuntimeSeconds: number;
  readonly profile: ReturnType<typeof musicVideoA2VidWorkerProfile>;
  readonly profileSha256: string;
  readonly models: readonly {
    readonly id: string;
    readonly kind: "file";
    readonly repository: "Lightricks/LTX-2.5";
    readonly revision: string;
    readonly manifestSha256: string;
    readonly sizeBytes: number;
    readonly sourcePath: string;
    readonly localPath: string;
  }[];
  readonly jobs: readonly [
    {
      readonly id: "a2vid-benchmark";
      readonly prompt: string;
      readonly seed: number;
      readonly width: 1280;
      readonly height: 704;
      readonly steps: 8;
      readonly frames: number;
      readonly fps: 25;
      readonly timeoutSeconds: number;
      readonly audio: Omit<A2VidWorkerAudioSource, "r2Key">;
      readonly openingInput?: Omit<A2VidWorkerObjectSource, "r2Key">;
      readonly endingInput?: Omit<A2VidWorkerObjectSource, "r2Key">;
      readonly artifact: A2VidWorkerArtifactTarget;
    },
  ];
  readonly checkpoint: A2VidWorkerCheckpointTarget;
  readonly heartbeat: A2VidWorkerWriteTarget;
  readonly completion: A2VidWorkerWriteTarget;
  readonly manifestSha256: string;
}

function normalizeObjectSource(value: unknown, label: string, allowedContentTypes: ReadonlySet<string>): A2VidWorkerObjectSource {
  const raw = record(value, label);
  const allowed = new Set(["r2Key", "getUrl", "sha256", "contentType"]);
  const extra = Object.keys(raw).filter((key) => !allowed.has(key));
  if (extra.length || Object.keys(raw).length !== allowed.size) throw new Error(`${label} contains unsupported fields`);
  const contentType = nonEmpty(raw.contentType, `${label}.contentType`);
  if (!allowedContentTypes.has(contentType)) throw new Error(`${label}.contentType is unsupported`);
  return Object.freeze({
    r2Key: r2Key(raw.r2Key, `${label}.r2Key`),
    getUrl: httpsUrl(raw.getUrl, `${label}.getUrl`),
    sha256: sha256(raw.sha256, `${label}.sha256`),
    contentType,
  });
}

function normalizeAudioSource(value: unknown): A2VidWorkerAudioSource {
  const raw = record(value, "A2Vid audio source");
  const allowed = new Set(["r2Key", "getUrl", "sha256", "contentType", "startMs", "endMs"]);
  const extra = Object.keys(raw).filter((key) => !allowed.has(key));
  if (extra.length || Object.keys(raw).length !== allowed.size) throw new Error("A2Vid audio source contains unsupported fields");
  const source = normalizeObjectSource(
    { r2Key: raw.r2Key, getUrl: raw.getUrl, sha256: raw.sha256, contentType: raw.contentType },
    "A2Vid audio source",
    AUDIO_CONTENT_TYPES,
  );
  const startMs = raw.startMs;
  const endMs = raw.endMs;
  if (typeof startMs !== "number" || !Number.isInteger(startMs) || startMs < 0 || typeof endMs !== "number" || !Number.isInteger(endMs)) {
    throw new Error("A2Vid audio source has an invalid timing window");
  }
  if (endMs - startMs < 2_000 || endMs - startMs > 20_000) throw new Error("A2Vid audio source must be a 2–20 second window");
  return Object.freeze({ ...source, startMs, endMs });
}

function normalizeWriteTarget(value: unknown, label: string): A2VidWorkerWriteTarget {
  const raw = record(value, label);
  if (Object.keys(raw).length !== 1 || !("putUrl" in raw)) throw new Error(`${label} contains unsupported fields`);
  return Object.freeze({ putUrl: httpsUrl(raw.putUrl, `${label}.putUrl`) });
}

function normalizeCheckpointTarget(value: unknown): A2VidWorkerCheckpointTarget {
  const raw = record(value, "A2Vid checkpoint target");
  if (Object.keys(raw).length !== 2 || !("putUrl" in raw) || !("getUrl" in raw)) throw new Error("A2Vid checkpoint target contains unsupported fields");
  return Object.freeze({ putUrl: httpsUrl(raw.putUrl, "A2Vid checkpoint target.putUrl"), getUrl: httpsUrl(raw.getUrl, "A2Vid checkpoint target.getUrl") });
}

function normalizeArtifact(value: unknown, manifestId: string, profileSha256: string): A2VidWorkerArtifactTarget {
  const raw = record(value, "A2Vid artifact target");
  if (Object.keys(raw).length !== 3 || !("putUrl" in raw) || !("contentType" in raw) || !("headers" in raw)) {
    throw new Error("A2Vid artifact target contains unsupported fields");
  }
  if (raw.contentType !== "video/mp4") throw new Error("A2Vid artifact target must be an MP4 delivery");
  const normalizedHeaders = headers(raw.headers, "A2Vid artifact target.headers");
  const expected = {
    "x-amz-meta-manifest-id": manifestId,
    "x-amz-meta-profile-sha256": profileSha256,
    "x-amz-meta-job-id": "a2vid-benchmark",
  };
  if (Object.entries(expected).some(([key, value]) => normalizedHeaders[key] !== value)) {
    throw new Error("A2Vid artifact target headers do not bind the sealed manifest identity");
  }
  return Object.freeze({ putUrl: httpsUrl(raw.putUrl, "A2Vid artifact target.putUrl"), contentType: "video/mp4", headers: normalizedHeaders });
}

/** Derive a stable, URL-independent ID before presigning delivery URLs. */
export function selfHostedLtxA2VidManifestId(input: { readonly workOrder: MusicVideoA2VidWorkOrder; readonly runId: string; readonly outputKey: string }): string {
  const runId = nonEmpty(input.runId, "A2Vid manifest runId");
  const outputKey = r2Key(input.outputKey, "A2Vid manifest outputKey");
  return `audio_video-${sha256Hex(canonicalJson({ version: SELF_HOSTED_LTX_A2VID_WORKER_MANIFEST_VERSION, workOrderFingerprint: input.workOrder.fingerprint, runId, outputKey })).slice(0, 32)}`;
}

export function createSelfHostedLtxA2VidWorkerManifest(input: CreateSelfHostedLtxA2VidWorkerManifestInput): SelfHostedLtxA2VidWorkerManifest {
  const manifestId = nonEmpty(input.manifestId, "A2Vid manifestId");
  if (!MANIFEST_ID.test(manifestId)) throw new Error("A2Vid manifestId is invalid");
  // Re-parse the sealed runtime now, at the final controller boundary. A
  // caller cannot smuggle a lookalike object through a typed work order.
  const runtime = createMusicVideoA2VidRuntimePin(input.workOrder.runtime);
  const profile = musicVideoA2VidWorkerProfile(runtime);
  const profileSha256 = sha256Hex(canonicalJson(profile));
  const expiresAt = positiveInteger(input.expiresAt, "A2Vid manifest.expiresAt");
  if (expiresAt <= Date.now()) throw new Error("A2Vid manifest has already expired");
  const maxRuntimeSeconds = positiveInteger(input.maxRuntimeSeconds, "A2Vid manifest.maxRuntimeSeconds");
  if (maxRuntimeSeconds < 60 || maxRuntimeSeconds > 7_200) throw new Error("A2Vid manifest runtime cap must be 60–7200 seconds");
  const maxCostUsd = positiveFinite(input.maxCostUsd, "A2Vid manifest.maxCostUsd");
  const seed = input.seed;
  if (!Number.isInteger(seed) || seed < 0 || seed > Number.MAX_SAFE_INTEGER) throw new Error("A2Vid manifest seed is invalid");
  const prompt = nonEmpty(input.prompt, "A2Vid manifest prompt").trim();
  if (prompt.length > 20_000) throw new Error("A2Vid manifest prompt exceeds the bounded worker contract");
  const audio = normalizeAudioSource(input.audio);
  const segment = input.workOrder.audioSegment;
  if (
    audio.r2Key !== segment.sourceMusicKey
    || audio.sha256 !== segment.sourceMusicSha256
    || audio.contentType !== segment.contentType
    || audio.startMs !== segment.startMs
    || audio.endMs !== segment.endMs
  ) throw new Error("A2Vid worker audio source does not match the sealed mastered-music segment");
  const references = (input.references ?? []).map((reference) => normalizeObjectSource(reference, "A2Vid reference source", IMAGE_CONTENT_TYPES));
  if (references.length !== input.workOrder.referenceImages.length || references.length > 2) throw new Error("A2Vid worker reference count does not match the sealed work order");
  const workOrderReferences = new Map(input.workOrder.referenceImages.map((reference) => [reference.role, reference] as const));
  const referenceByRole = new Map<"opening" | "ending", A2VidWorkerObjectSource>();
  for (const reference of references) {
    const matching = [...workOrderReferences.values()].find((candidate) => candidate.r2Key === reference.r2Key);
    if (!matching || matching.contentSha256 !== reference.sha256 || matching.contentType !== reference.contentType || referenceByRole.has(matching.role)) {
      throw new Error("A2Vid worker reference source does not match an approved sealed reference image");
    }
    referenceByRole.set(matching.role, reference);
  }
  // The LTX CLI treats ``num_frames / frame_rate`` as its source-audio
  // duration. This is a frame count, not an endpoint-index interval count.
  const frames = Math.round((audio.endMs - audio.startMs) / 1_000 * profile.fps);
  if (frames < 9 || (frames - 1) % 8 !== 0 || Math.abs(Math.round(frames / profile.fps * 1_000) - (audio.endMs - audio.startMs)) > 120) {
    throw new Error("A2Vid audio window cannot be represented by the sealed 25 fps LTX frame cadence");
  }
  const artifact = normalizeArtifact(input.artifact, manifestId, profileSha256);
  const manifest: Omit<SelfHostedLtxA2VidWorkerManifest, "manifestSha256"> = Object.freeze({
    contractVersion: SELF_HOSTED_LTX_A2VID_WORKER_MANIFEST_VERSION,
    manifestId,
    phase: "audio_video" as const,
    gpuSku: runtime.requiredGpuSku,
    gpuCount: 1 as const,
    expiresAt,
    maxCostUsd,
    maxRuntimeSeconds,
    profile,
    profileSha256,
    models: Object.freeze(runtime.components.map((component) => Object.freeze({
      id: component.id,
      kind: "file" as const,
      repository: "Lightricks/LTX-2.5" as const,
      revision: runtime.modelImmutableRevision,
      manifestSha256: component.sha256,
      sizeBytes: component.sizeBytes,
      sourcePath: component.path,
      localPath: component.path,
    }))),
    jobs: Object.freeze([Object.freeze({
      id: "a2vid-benchmark" as const,
      prompt,
      seed,
      width: 1280 as const,
      height: 704 as const,
      steps: 8 as const,
      frames,
      fps: 25 as const,
      timeoutSeconds: maxRuntimeSeconds,
      audio: Object.freeze({ getUrl: audio.getUrl, sha256: audio.sha256, contentType: audio.contentType, startMs: audio.startMs, endMs: audio.endMs }),
      ...(referenceByRole.get("opening") ? { openingInput: Object.freeze((({ r2Key: _r2Key, ...reference }) => reference)(referenceByRole.get("opening")!)) } : {}),
      ...(referenceByRole.get("ending") ? { endingInput: Object.freeze((({ r2Key: _r2Key, ...reference }) => reference)(referenceByRole.get("ending")!)) } : {}),
      artifact,
    })]) as SelfHostedLtxA2VidWorkerManifest["jobs"],
    checkpoint: normalizeCheckpointTarget(input.checkpoint),
    heartbeat: normalizeWriteTarget(input.heartbeat, "A2Vid heartbeat target"),
    completion: normalizeWriteTarget(input.completion, "A2Vid completion target"),
  });
  return Object.freeze({ ...manifest, manifestSha256: sha256Hex(canonicalJson(manifest)) });
}
