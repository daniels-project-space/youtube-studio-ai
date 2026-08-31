import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { ExecutionError } from "@/engine/executionErrors";
import {
  ScenarioVisualTreatmentThumbnailBindingSchema,
  type ScenarioVisualTreatmentThumbnailBinding,
} from "@/engine/scenarioVisualTreatment";
import { canonicalJson } from "@/lib/canonicalJson";
import {
  NANO_BANANA_THUMBNAIL_PROFILE,
  nanoBananaThumbnailCostUsd,
  nanoBananaThumbnailPromptCostUsd,
  type NanoBananaImageReceipt,
} from "@/lib/nanoBananaThumbnailContract";
import { getObjectBytes, putObject } from "@/lib/storage";

interface ThumbnailQaCheckpoint {
  completed: true;
  requestHash: string;
  verdict: unknown;
  costUsd: number;
  /** Present only for a current fictional-scenario package-art review. */
  scenarioVisualTreatment?: {
    binding: ScenarioVisualTreatmentThumbnailBinding;
    visualTreatmentCompliant: boolean;
  };
}

interface LegacyThumbnailCheckpointManifest {
  version: 1;
  requestHash: string;
  generationCostUsd: number;
  qa?: ThumbnailQaCheckpoint;
}

export interface ThumbnailNanoBananaEvidence {
  version: "thumbnail-nano-banana-evidence/v1";
  requestContext: string;
  receipt: NanoBananaImageReceipt;
}

interface CurrentThumbnailCheckpointManifest {
  version: 2 | 3;
  requestHash: string;
  generationCostUsd: number;
  artifactSha256: string;
  providerEvidence?: ThumbnailNanoBananaEvidence;
  /** v3 carries this witness whenever the request is treatment-bound. */
  scenarioVisualTreatment?: ScenarioVisualTreatmentThumbnailBinding;
  qa?: ThumbnailQaCheckpoint;
}

export type ThumbnailCheckpointManifest =
  | LegacyThumbnailCheckpointManifest
  | CurrentThumbnailCheckpointManifest;

interface CheckpointPutOptions {
  contentType?: string;
  ifNoneMatch?: "*";
}

export interface ThumbnailCheckpointIo {
  getObjectBytes: (key: string) => Promise<Uint8Array>;
  putObject: (
    key: string,
    body: Uint8Array | string,
    options?: CheckpointPutOptions,
  ) => Promise<unknown>;
}

const productionIo: ThumbnailCheckpointIo = {
  getObjectBytes: (key) => getObjectBytes(key),
  putObject: (key, body, options) => putObject(key, body, options),
};

export interface ThumbnailCheckpointSession {
  requestHash: string;
  source: "new" | "local" | "remote";
  localImagePath: string;
  localManifestPath: string;
  claimKey: string;
  spendKey: string;
  claimToken: string;
  spendStarted: boolean;
  imageKey: string;
  manifestKey: string;
  /**
   * The admitted visual-treatment identity for this thumbnail request.  This
   * belongs to the session rather than an individual save call so every
   * restore and checkpoint write observes the same contract.
   */
  scenarioVisualTreatmentBinding?: ScenarioVisualTreatmentThumbnailBinding;
  manifest?: ThumbnailCheckpointManifest;
}

const PRE_SPEND_LEASE_MS = 15_000;

interface ThumbnailClaim {
  version: 2;
  requestHash: string;
  createdAt: number;
}

interface ThumbnailSpendMarker {
  version: 1;
  requestHash: string;
  claimToken: string;
  startedAt: number;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
    .join(",")}}`;
}

/** Content address for every input that can change purchased thumbnail pixels. */
export function thumbnailRequestHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

/** Stable tenant/run/request binding included in the provider request hash. */
export function thumbnailNanoBananaRequestContext(args: {
  keyPrefix: string;
  runId: string;
  requestHash: string;
}): string {
  if (!/^[a-f0-9]{64}$/.test(args.requestHash)) {
    throw new Error("thumbnail Nano Banana context requires a SHA-256 request hash");
  }
  if (!args.keyPrefix.trim() || !args.runId.trim()) {
    throw new Error("thumbnail Nano Banana context requires a tenant prefix and run id");
  }
  return canonicalJson({
    contractVersion: "thumbnail-gen-nano-banana-context/v1",
    keyPrefix: args.keyPrefix.replace(/\/+$/, ""),
    requestHash: args.requestHash,
    runId: args.runId,
  });
}

function finiteCost(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

const SHA256 = /^[a-f0-9]{64}$/;

function validNanoBananaEvidence(
  value: unknown,
  requestHash: string,
): value is ThumbnailNanoBananaEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const evidence = value as ThumbnailNanoBananaEvidence;
  const receipt = evidence.receipt;
  if (
    evidence.version !== "thumbnail-nano-banana-evidence/v1" ||
    typeof evidence.requestContext !== "string" ||
    evidence.requestContext.length > 8_192 ||
    !receipt ||
    receipt.provider !== NANO_BANANA_THUMBNAIL_PROFILE.provider ||
    receipt.model !== NANO_BANANA_THUMBNAIL_PROFILE.model ||
    receipt.apiVersion !== NANO_BANANA_THUMBNAIL_PROFILE.apiVersion ||
    typeof receipt.modelVersion !== "string" || !receipt.modelVersion.trim() ||
    receipt.modelVersion.length > 256 ||
    typeof receipt.responseId !== "string" || !receipt.responseId.trim() ||
    receipt.responseId.length > 256 ||
    receipt.route !== NANO_BANANA_THUMBNAIL_PROFILE.route ||
    receipt.width !== NANO_BANANA_THUMBNAIL_PROFILE.providerOutputWidth ||
    receipt.height !== NANO_BANANA_THUMBNAIL_PROFILE.providerOutputHeight ||
    !Number.isInteger(receipt.promptUtf8Bytes) ||
    receipt.promptUtf8Bytes < 1 ||
    receipt.promptUtf8Bytes > NANO_BANANA_THUMBNAIL_PROFILE.maxPromptUtf8Bytes ||
    !Number.isInteger(receipt.promptTokenCount) ||
    receipt.promptTokenCount < 1 ||
    receipt.promptTokenCount > NANO_BANANA_THUMBNAIL_PROFILE.maxPromptTokenCount ||
    receipt.promptCostUsd !== nanoBananaThumbnailPromptCostUsd(receipt.promptTokenCount) ||
    receipt.outputCostUsd !== NANO_BANANA_THUMBNAIL_PROFILE.outputImageUsd ||
    receipt.costUsd !== nanoBananaThumbnailCostUsd(receipt.promptTokenCount) ||
    !Number.isFinite(receipt.costUsd) ||
    receipt.costUsd < 0 ||
    receipt.costUsd > NANO_BANANA_THUMBNAIL_PROFILE.admissionCeilingUsd + Number.EPSILON ||
    !/^image\/(?:png|jpeg|webp)$/i.test(receipt.sourceContentType) ||
    !SHA256.test(receipt.providerRequestSha256) ||
    !SHA256.test(receipt.providerResponseMetadataSha256) ||
    !SHA256.test(receipt.responseSha256) ||
    !Number.isFinite(receipt.createdAt) ||
    receipt.createdAt <= 0 ||
    typeof receipt.providerRequestCanonicalJson !== "string" ||
    receipt.providerRequestCanonicalJson.length > 200_000 ||
    typeof receipt.providerResponseMetadataCanonicalJson !== "string" ||
    receipt.providerResponseMetadataCanonicalJson.length > 100_000
  ) return false;
  try {
    const context = JSON.parse(evidence.requestContext) as Record<string, unknown>;
    const request = JSON.parse(receipt.providerRequestCanonicalJson) as Record<string, unknown>;
    const body = request["body"] as Record<string, unknown>;
    const contents = body?.["contents"] as Array<Record<string, unknown>>;
    const parts = contents?.[0]?.["parts"] as Array<Record<string, unknown>>;
    const prompt = parts?.[0]?.["text"];
    const generationConfig = body?.["generationConfig"] as Record<string, unknown>;
    const imageConfig = generationConfig?.["imageConfig"] as Record<string, unknown>;
    const modalities = generationConfig?.["responseModalities"] as unknown[];
    const responseMetadata = JSON.parse(
      receipt.providerResponseMetadataCanonicalJson,
    ) as Record<string, unknown>;
    const usageMetadata = responseMetadata["usageMetadata"] as Record<string, unknown>;
    return canonicalJson(context) === evidence.requestContext &&
      context["contractVersion"] === "thumbnail-gen-nano-banana-context/v1" &&
      context["requestHash"] === requestHash &&
      typeof context["keyPrefix"] === "string" && Boolean((context["keyPrefix"] as string).trim()) &&
      typeof context["runId"] === "string" && Boolean((context["runId"] as string).trim()) &&
      canonicalJson(request) === receipt.providerRequestCanonicalJson &&
      request["apiVersion"] === NANO_BANANA_THUMBNAIL_PROFILE.apiVersion &&
      request["model"] === NANO_BANANA_THUMBNAIL_PROFILE.model &&
      request["operation"] === "generateContent" &&
      request["context"] === evidence.requestContext &&
      Array.isArray(contents) && contents.length === 1 &&
      Array.isArray(parts) && parts.length === 1 &&
      typeof prompt === "string" &&
      Buffer.byteLength(prompt, "utf8") === receipt.promptUtf8Bytes &&
      prompt.includes("ABSOLUTE RULE — PICTURE ONLY, NO TEXT") &&
      Array.isArray(modalities) && modalities.length === 1 && modalities[0] === "IMAGE" &&
      imageConfig?.["aspectRatio"] === NANO_BANANA_THUMBNAIL_PROFILE.aspectRatio &&
      imageConfig?.["imageSize"] === undefined &&
      canonicalJson(responseMetadata) === receipt.providerResponseMetadataCanonicalJson &&
      responseMetadata["modelVersion"] === receipt.modelVersion &&
      responseMetadata["responseId"] === receipt.responseId &&
      usageMetadata?.["promptTokenCount"] === receipt.promptTokenCount &&
      createHash("sha256")
        .update(`nano-banana-provider\0${receipt.providerRequestCanonicalJson}`)
        .digest("hex") === receipt.providerRequestSha256 &&
      createHash("sha256")
        .update(`nano-banana-response-metadata\0${receipt.providerResponseMetadataCanonicalJson}`)
        .digest("hex") === receipt.providerResponseMetadataSha256;
  } catch {
    return false;
  }
}

function parseManifest(
  raw: Uint8Array | string,
  requestHash: string,
): ThumbnailCheckpointManifest {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(
      typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    throw new ExecutionError("thumbnail_gen: checkpoint manifest is unreadable", {
      code: "THUMBNAIL_CHECKPOINT_CORRUPT",
      retryable: false,
      phase: "storage",
    });
  }
  if (
    (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3) ||
    parsed.requestHash !== requestHash ||
    finiteCost(parsed.generationCostUsd) === undefined
  ) {
    throw new ExecutionError("thumbnail_gen: checkpoint manifest does not match the paid request", {
      code: "THUMBNAIL_CHECKPOINT_CORRUPT",
      retryable: false,
      phase: "storage",
    });
  }
  if (
    (parsed.version === 2 || parsed.version === 3) &&
    (
      !SHA256.test(String(parsed.artifactSha256 ?? "")) ||
      (parsed.providerEvidence !== undefined &&
        !validNanoBananaEvidence(parsed.providerEvidence, requestHash))
    )
  ) {
    throw new ExecutionError("thumbnail_gen: checkpoint provider evidence is invalid", {
      code: "THUMBNAIL_CHECKPOINT_CORRUPT",
      retryable: false,
      phase: "storage",
    });
  }
  const qa = parsed.qa as Record<string, unknown> | undefined;
  if (
    parsed.qa !== undefined &&
    (
      !qa || typeof qa !== "object" || Array.isArray(qa) ||
      qa.completed !== true ||
      !/^[a-f0-9]{64}$/.test(String(qa.requestHash ?? "")) ||
      finiteCost(qa.costUsd) === undefined
    )
  ) {
    throw new ExecutionError("thumbnail_gen: checkpoint QA record is invalid", {
      code: "THUMBNAIL_CHECKPOINT_CORRUPT",
      retryable: false,
      phase: "storage",
    });
  }
  if (
    (parsed.version === 3) !== (parsed.scenarioVisualTreatment !== undefined)
  ) {
    throw new ExecutionError("thumbnail_gen: checkpoint treatment version and binding disagree", {
      code: "THUMBNAIL_CHECKPOINT_CORRUPT",
      retryable: false,
      phase: "storage",
    });
  }
  let scenarioVisualTreatment: ScenarioVisualTreatmentThumbnailBinding | undefined;
  if (parsed.scenarioVisualTreatment !== undefined) {
    const treatment = ScenarioVisualTreatmentThumbnailBindingSchema.safeParse(parsed.scenarioVisualTreatment);
    if (!treatment.success) {
      throw new ExecutionError("thumbnail_gen: checkpoint scenario visual treatment binding is invalid", {
        code: "THUMBNAIL_CHECKPOINT_CORRUPT",
        retryable: false,
        phase: "storage",
      });
    }
    scenarioVisualTreatment = treatment.data;
  }
  if (qa?.scenarioVisualTreatment !== undefined) {
    const scenarioQa = qa.scenarioVisualTreatment as Record<string, unknown>;
    const treatment = ScenarioVisualTreatmentThumbnailBindingSchema.safeParse(scenarioQa.binding);
    if (
      !treatment.success ||
      typeof scenarioQa.visualTreatmentCompliant !== "boolean" ||
      !scenarioVisualTreatment ||
      canonicalJson(treatment.data) !== canonicalJson(scenarioVisualTreatment)
    ) {
      throw new ExecutionError("thumbnail_gen: checkpoint scenario visual treatment QA binding is invalid", {
        code: "THUMBNAIL_CHECKPOINT_CORRUPT",
        retryable: false,
        phase: "storage",
      });
    }
  }
  return parsed as unknown as ThumbnailCheckpointManifest;
}

function assertArtifactIntegrity(
  manifest: ThumbnailCheckpointManifest,
  bytes: Uint8Array,
): void {
  if (
    (manifest.version === 2 || manifest.version === 3) &&
    createHash("sha256").update(bytes).digest("hex") !== manifest.artifactSha256
  ) {
    throw new ExecutionError("thumbnail_gen: checkpoint image does not match its manifest", {
      code: "THUMBNAIL_CHECKPOINT_CORRUPT",
      retryable: false,
      phase: "storage",
    });
  }
}

/**
 * A treatment-bound thumbnail must never be restored, saved, or judged under
 * a different route/scenario/treatment identity.  Generic (including v1/v2)
 * thumbnail work intentionally remains reusable when neither side carries a
 * treatment binding.
 */
function assertScenarioVisualTreatmentBindingForSession(
  session: ThumbnailCheckpointSession,
  manifest: ThumbnailCheckpointManifest,
): void {
  const expected = session.scenarioVisualTreatmentBinding;
  const actual =
    manifest.version === 2 || manifest.version === 3
      ? manifest.scenarioVisualTreatment
      : undefined;
  if (expected === undefined && actual === undefined) return;
  if (
    expected === undefined ||
    actual === undefined ||
    canonicalJson(expected) !== canonicalJson(actual)
  ) {
    throw new ExecutionError(
      "thumbnail_gen: checkpoint scenario visual treatment binding does not match the admitted request",
      {
        code: "THUMBNAIL_CHECKPOINT_CORRUPT",
        retryable: false,
        phase: "storage",
      },
    );
  }
}

function httpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata
    ?.httpStatusCode;
  return typeof value === "number" ? value : undefined;
}

function isMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = String((error as { name?: unknown }).name ?? "");
  return httpStatus(error) === 404 || name === "NoSuchKey" || name === "NotFound";
}

function isAlreadyClaimed(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = String((error as { name?: unknown }).name ?? "");
  return (
    httpStatus(error) === 409 ||
    httpStatus(error) === 412 ||
    name === "PreconditionFailed" ||
    name === "ConditionalRequestConflict"
  );
}

function parseJsonObject(raw: Uint8Array | string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(
      typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8"),
    ) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function optionalObject(
  io: ThumbnailCheckpointIo,
  key: string,
): Promise<Uint8Array | null> {
  try {
    return await io.getObjectBytes(key);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function localCheckpoint(
  session: ThumbnailCheckpointSession,
): Promise<ThumbnailCheckpointSession | null> {
  if (!existsSync(session.localImagePath) || !existsSync(session.localManifestPath)) {
    return null;
  }
  const manifest = parseManifest(
    await readFile(session.localManifestPath),
    session.requestHash,
  );
  assertScenarioVisualTreatmentBindingForSession(session, manifest);
  assertArtifactIntegrity(manifest, await readFile(session.localImagePath));
  return { ...session, source: "local", manifest };
}

async function remoteCheckpoint(
  session: ThumbnailCheckpointSession,
  io: ThumbnailCheckpointIo,
): Promise<ThumbnailCheckpointSession | null> {
  let manifestBytes: Uint8Array;
  try {
    manifestBytes = await io.getObjectBytes(session.manifestKey);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  const manifest = parseManifest(manifestBytes, session.requestHash);
  assertScenarioVisualTreatmentBindingForSession(session, manifest);
  let image: Uint8Array;
  try {
    image = await io.getObjectBytes(session.imageKey);
  } catch (error) {
    if (!isMissing(error)) throw error;
    throw new ExecutionError(
      `thumbnail_gen: a paid checkpoint manifest exists without ${session.imageKey}; refusing regeneration`,
      {
        code: "THUMBNAIL_CHECKPOINT_INCOMPLETE",
        retryable: false,
        phase: "storage",
      },
    );
  }
  assertArtifactIntegrity(manifest, image);
  await mkdir(dirname(session.localImagePath), { recursive: true });
  await writeFile(session.localImagePath, image);
  await writeFile(session.localManifestPath, JSON.stringify(manifest));
  return { ...session, source: "remote", manifest };
}

/**
 * Reuse a completed candidate, or claim its free preparation phase. A short
 * lease lets a replacement recover if a worker dies before paid work starts;
 * beginThumbnailPaidWork is the separate atomic at-most-once billing fence.
 */
export async function openThumbnailCheckpoint(
  args: {
    checkpointRoot: string;
    requestHash: string;
    localImagePath: string;
    /**
     * Exact route/scenario/treatment identity admitted before any checkpoint
     * can be restored or provider work can be claimed.
     */
    scenarioVisualTreatmentBinding?: ScenarioVisualTreatmentThumbnailBinding;
    /** Free preflight that must pass before an irreversible paid-work claim. */
    beforeClaim?: () => void;
  },
  io: ThumbnailCheckpointIo = productionIo,
): Promise<ThumbnailCheckpointSession> {
  if (!/^[a-f0-9]{64}$/.test(args.requestHash)) {
    throw new Error("thumbnail checkpoint requires a SHA-256 request hash");
  }
  const binding = args.scenarioVisualTreatmentBinding === undefined
    ? undefined
    : ScenarioVisualTreatmentThumbnailBindingSchema.safeParse(
      args.scenarioVisualTreatmentBinding,
    );
  if (binding !== undefined && !binding.success) {
    throw new Error("thumbnail checkpoint requires a valid scenario visual treatment binding");
  }
  const root = `${args.checkpointRoot.replace(/\/+$/, "")}/${args.requestHash}`;
  const session: ThumbnailCheckpointSession = {
    requestHash: args.requestHash,
    source: "new",
    localImagePath: args.localImagePath,
    localManifestPath: `${args.localImagePath}.checkpoint.json`,
    claimKey: `${root}.claim.json`,
    spendKey: `${root}.spend.json`,
    claimToken: randomUUID(),
    spendStarted: false,
    imageKey: `${root}.jpg`,
    manifestKey: `${root}.manifest.json`,
    ...(binding && binding.success
      ? { scenarioVisualTreatmentBinding: binding.data }
      : {}),
  };

  const local = await localCheckpoint(session);
  if (local) return local;
  const remote = await remoteCheckpoint(session, io);
  if (remote) return remote;

  args.beforeClaim?.();

  try {
    await io.putObject(
      session.claimKey,
      JSON.stringify({ version: 2, requestHash: args.requestHash, createdAt: Date.now() } satisfies ThumbnailClaim),
      { contentType: "application/json", ifNoneMatch: "*" },
    );
  } catch (error) {
    if (!isAlreadyClaimed(error)) throw error;
    // Another worker may have completed between our first read and claim.
    const completed = await remoteCheckpoint(session, io);
    if (completed) return completed;
    const spendRaw = await optionalObject(io, session.spendKey);
    if (spendRaw) {
      throw new ExecutionError(
        `thumbnail_gen: paid request ${session.requestHash.slice(0, 12)} started but has no complete checkpoint; ` +
          "refusing regeneration",
        {
          code: "THUMBNAIL_CHECKPOINT_INCOMPLETE",
          retryable: false,
          phase: "generation",
        },
      );
    }
    const claimRaw = await optionalObject(io, session.claimKey);
    const claim = claimRaw ? parseJsonObject(claimRaw) : null;
    const claimCreatedAt = claim?.version === 2 && claim.requestHash === args.requestHash &&
      typeof claim.createdAt === "number" && Number.isFinite(claim.createdAt)
      ? claim.createdAt
      : null;
    if (claimCreatedAt !== null && Date.now() - claimCreatedAt >= PRE_SPEND_LEASE_MS) {
      // The old worker never crossed the atomic spend fence. Competing
      // replacements may prepare locally; beginThumbnailPaidWork elects the
      // only worker allowed to call a provider.
      return session;
    }
    throw new ExecutionError(
      `thumbnail_gen: request ${session.requestHash.slice(0, 12)} has an active pre-spend claim`,
      {
        code: claimCreatedAt === null ? "THUMBNAIL_CHECKPOINT_INCOMPLETE" : "THUMBNAIL_CHECKPOINT_BUSY",
        retryable: claimCreatedAt !== null,
        phase: "generation",
      },
    );
  }
  return session;
}

/**
 * Atomically crosses the at-most-once billing fence. Call immediately before
 * the first provider request; a different worker can never cross it too.
 */
export async function beginThumbnailPaidWork(
  session: ThumbnailCheckpointSession,
  io: ThumbnailCheckpointIo = productionIo,
): Promise<ThumbnailCheckpointSession> {
  if (session.manifest || session.spendStarted) return session;
  const marker: ThumbnailSpendMarker = {
    version: 1,
    requestHash: session.requestHash,
    claimToken: session.claimToken,
    startedAt: Date.now(),
  };
  try {
    await io.putObject(session.spendKey, JSON.stringify(marker), {
      contentType: "application/json",
      ifNoneMatch: "*",
    });
  } catch (error) {
    const existingRaw = await optionalObject(io, session.spendKey);
    const existing = existingRaw ? parseJsonObject(existingRaw) : null;
    if (existing?.requestHash === session.requestHash && existing.claimToken === session.claimToken) {
      return { ...session, spendStarted: true };
    }
    if (!isAlreadyClaimed(error) && !existing) throw error;
    throw new ExecutionError(
      `thumbnail_gen: another worker owns the paid request ${session.requestHash.slice(0, 12)}`,
      {
        code: "THUMBNAIL_CHECKPOINT_INCOMPLETE",
        retryable: false,
        phase: "generation",
      },
    );
  }
  return { ...session, spendStarted: true };
}

/** Persist local state first so an in-process storage retry never re-renders. */
export async function saveThumbnailGenerationCheckpoint(
  session: ThumbnailCheckpointSession,
  generationCostUsd: number,
  providerEvidence?: ThumbnailNanoBananaEvidence,
  io: ThumbnailCheckpointIo = productionIo,
  scenarioVisualTreatment?: ScenarioVisualTreatmentThumbnailBinding,
): Promise<ThumbnailCheckpointSession> {
  const cost = finiteCost(generationCostUsd);
  if (cost === undefined) throw new Error("thumbnail checkpoint cost must be finite and non-negative");
  if (!session.manifest && !session.spendStarted) {
    throw new Error("thumbnail paid work must cross the spend fence before checkpointing");
  }
  if (session.manifest) {
    assertScenarioVisualTreatmentBindingForSession(session, session.manifest);
  }
  if (!existsSync(session.localImagePath)) {
    throw new Error("thumbnail checkpoint image does not exist locally");
  }
  if (providerEvidence && !validNanoBananaEvidence(providerEvidence, session.requestHash)) {
    throw new Error("thumbnail checkpoint Nano Banana provider evidence is invalid");
  }
  if (
    scenarioVisualTreatment &&
    !ScenarioVisualTreatmentThumbnailBindingSchema.safeParse(scenarioVisualTreatment).success
  ) {
    throw new Error("thumbnail checkpoint scenario visual treatment binding is invalid");
  }
  if (
    scenarioVisualTreatment !== undefined &&
    session.scenarioVisualTreatmentBinding === undefined
  ) {
    throw new Error(
      "thumbnail checkpoint scenario visual treatment binding must be admitted before checkpointing",
    );
  }
  if (
    scenarioVisualTreatment !== undefined &&
    session.scenarioVisualTreatmentBinding !== undefined &&
    canonicalJson(scenarioVisualTreatment) !==
      canonicalJson(session.scenarioVisualTreatmentBinding)
  ) {
    throw new Error("thumbnail checkpoint scenario visual treatment binding does not match its session");
  }
  const effectiveScenarioVisualTreatment = session.scenarioVisualTreatmentBinding;
  const imageBytes = await readFile(session.localImagePath);
  const manifest: CurrentThumbnailCheckpointManifest = {
    version: effectiveScenarioVisualTreatment ? 3 : 2,
    requestHash: session.requestHash,
    generationCostUsd: cost,
    artifactSha256: createHash("sha256").update(imageBytes).digest("hex"),
    ...(providerEvidence ? { providerEvidence } : {}),
    ...(effectiveScenarioVisualTreatment
      ? { scenarioVisualTreatment: effectiveScenarioVisualTreatment }
      : {}),
  };
  await writeFile(session.localManifestPath, JSON.stringify(manifest));
  await io.putObject(session.imageKey, imageBytes, {
    contentType: "image/jpeg",
  });
  await io.putObject(session.manifestKey, JSON.stringify(manifest), {
    contentType: "application/json",
  });
  return { ...session, source: "local", manifest };
}

/** Save a paid QA result so a later storage/gate retry reuses its verdict. */
export async function saveThumbnailQaCheckpoint(
  session: ThumbnailCheckpointSession,
  qa: {
    requestHash: string;
    verdict: unknown;
    costUsd: number;
    scenarioVisualTreatment?: ThumbnailQaCheckpoint["scenarioVisualTreatment"];
  },
  io: ThumbnailCheckpointIo = productionIo,
): Promise<ThumbnailCheckpointSession> {
  if (!session.manifest) throw new Error("thumbnail QA requires a generation checkpoint");
  assertScenarioVisualTreatmentBindingForSession(session, session.manifest);
  const cost = finiteCost(qa.costUsd);
  if (cost === undefined) throw new Error("thumbnail QA checkpoint cost must be finite and non-negative");
  if (!/^[a-f0-9]{64}$/.test(qa.requestHash)) {
    throw new Error("thumbnail QA checkpoint requires a SHA-256 request hash");
  }
  if (
    qa.scenarioVisualTreatment &&
    (
      !ScenarioVisualTreatmentThumbnailBindingSchema.safeParse(qa.scenarioVisualTreatment.binding).success ||
      typeof qa.scenarioVisualTreatment.visualTreatmentCompliant !== "boolean"
    )
  ) {
    throw new Error("thumbnail QA scenario visual treatment binding is invalid");
  }
  if (session.scenarioVisualTreatmentBinding) {
    if (!qa.scenarioVisualTreatment) {
      throw new Error("thumbnail QA requires the admitted scenario visual treatment binding");
    }
    if (
      canonicalJson(qa.scenarioVisualTreatment.binding) !==
      canonicalJson(session.scenarioVisualTreatmentBinding)
    ) {
      throw new Error("thumbnail QA scenario visual treatment binding does not match its session");
    }
  } else if (qa.scenarioVisualTreatment !== undefined) {
    throw new Error("generic thumbnail QA cannot carry a scenario visual treatment binding");
  }
  const manifest: ThumbnailCheckpointManifest = {
    ...session.manifest,
    qa: {
      completed: true,
      requestHash: qa.requestHash,
      verdict: qa.verdict,
      costUsd: cost,
      ...(qa.scenarioVisualTreatment ? { scenarioVisualTreatment: qa.scenarioVisualTreatment } : {}),
    },
  };
  await writeFile(session.localManifestPath, JSON.stringify(manifest));
  await io.putObject(session.manifestKey, JSON.stringify(manifest), {
    contentType: "application/json",
  });
  return { ...session, manifest };
}
