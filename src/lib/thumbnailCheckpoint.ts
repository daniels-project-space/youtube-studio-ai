import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { ExecutionError } from "@/engine/executionErrors";
import { getObjectBytes, putObject } from "@/lib/storage";

export interface ThumbnailCheckpointManifest {
  version: 1;
  requestHash: string;
  generationCostUsd: number;
  qa?: {
    completed: true;
    requestHash: string;
    verdict: unknown;
    costUsd: number;
  };
}

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

function finiteCost(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function parseManifest(
  raw: Uint8Array | string,
  requestHash: string,
): ThumbnailCheckpointManifest {
  let parsed: Partial<ThumbnailCheckpointManifest>;
  try {
    parsed = JSON.parse(
      typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8"),
    ) as Partial<ThumbnailCheckpointManifest>;
  } catch {
    throw new ExecutionError("thumbnail_gen: checkpoint manifest is unreadable", {
      code: "THUMBNAIL_CHECKPOINT_CORRUPT",
      retryable: false,
      phase: "storage",
    });
  }
  if (
    parsed.version !== 1 ||
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
    parsed.qa &&
    (
      parsed.qa.completed !== true ||
      !/^[a-f0-9]{64}$/.test(parsed.qa.requestHash ?? "") ||
      finiteCost(parsed.qa.costUsd) === undefined
    )
  ) {
    throw new ExecutionError("thumbnail_gen: checkpoint QA record is invalid", {
      code: "THUMBNAIL_CHECKPOINT_CORRUPT",
      retryable: false,
      phase: "storage",
    });
  }
  return parsed as ThumbnailCheckpointManifest;
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
    /** Free preflight that must pass before an irreversible paid-work claim. */
    beforeClaim?: () => void;
  },
  io: ThumbnailCheckpointIo = productionIo,
): Promise<ThumbnailCheckpointSession> {
  if (!/^[a-f0-9]{64}$/.test(args.requestHash)) {
    throw new Error("thumbnail checkpoint requires a SHA-256 request hash");
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
  io: ThumbnailCheckpointIo = productionIo,
): Promise<ThumbnailCheckpointSession> {
  const cost = finiteCost(generationCostUsd);
  if (cost === undefined) throw new Error("thumbnail checkpoint cost must be finite and non-negative");
  if (!session.manifest && !session.spendStarted) {
    throw new Error("thumbnail paid work must cross the spend fence before checkpointing");
  }
  if (!existsSync(session.localImagePath)) {
    throw new Error("thumbnail checkpoint image does not exist locally");
  }
  const manifest: ThumbnailCheckpointManifest = {
    version: 1,
    requestHash: session.requestHash,
    generationCostUsd: cost,
  };
  await writeFile(session.localManifestPath, JSON.stringify(manifest));
  await io.putObject(session.imageKey, await readFile(session.localImagePath), {
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
  qa: { requestHash: string; verdict: unknown; costUsd: number },
  io: ThumbnailCheckpointIo = productionIo,
): Promise<ThumbnailCheckpointSession> {
  if (!session.manifest) throw new Error("thumbnail QA requires a generation checkpoint");
  const cost = finiteCost(qa.costUsd);
  if (cost === undefined) throw new Error("thumbnail QA checkpoint cost must be finite and non-negative");
  if (!/^[a-f0-9]{64}$/.test(qa.requestHash)) {
    throw new Error("thumbnail QA checkpoint requires a SHA-256 request hash");
  }
  const manifest: ThumbnailCheckpointManifest = {
    ...session.manifest,
    qa: {
      completed: true,
      requestHash: qa.requestHash,
      verdict: qa.verdict,
      costUsd: cost,
    },
  };
  await writeFile(session.localManifestPath, JSON.stringify(manifest));
  await io.putObject(session.manifestKey, JSON.stringify(manifest), {
    contentType: "application/json",
  });
  return { ...session, manifest };
}
