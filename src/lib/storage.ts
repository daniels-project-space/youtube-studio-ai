/**
 * Cloudflare R2 storage wrapper (vendored).
 *
 * Thin S3-compatible client pointed at the Cloudflare R2 endpoint, plus a
 * presign helper for direct browser uploads/downloads. All configuration is
 * read from environment variables (never hard-coded):
 *
 *   R2_ACCOUNT_ID         - Cloudflare account id (used to build the endpoint)
 *   R2_ACCESS_KEY_ID      - R2 access key id
 *   R2_SECRET_ACCESS_KEY  - R2 secret access key
 *   R2_BUCKET             - default bucket name
 *   R2_ENDPOINT           - optional explicit endpoint override
 *   R2_PUBLIC_BASE_URL    - optional public/CDN base for served objects
 *
 * Production upload, integrity, listing, and deletion operations share this
 * client. Destructive responses require object-level acknowledgement.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import type { PutObjectCommandInput } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const R2_REGION = "auto";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required R2 environment variable: ${name}`);
  }
  return value;
}

function resolveEndpoint(): string {
  if (process.env.R2_ENDPOINT) return process.env.R2_ENDPOINT;
  const accountId = requireEnv("R2_ACCOUNT_ID");
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

let cachedClient: S3Client | null = null;

/** Lazily construct (and cache) the R2-backed S3 client. */
export function getR2Client(): S3Client {
  if (cachedClient) return cachedClient;
  cachedClient = new S3Client({
    region: R2_REGION,
    endpoint: resolveEndpoint(),
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
  return cachedClient;
}

export function getBucket(bucket?: string): string {
  return bucket ?? requireEnv("R2_BUCKET");
}

export interface PresignOptions {
  bucket?: string;
  /** URL lifetime in seconds (default 1 hour). */
  expiresIn?: number;
  contentType?: string;
  /** Metadata signed into a scoped upload URL (never bucket credentials). */
  metadata?: Record<string, string>;
}

/** Presigned PUT URL for direct browser -> R2 uploads. */
export async function presignUpload(
  key: string,
  opts: PresignOptions = {},
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: getBucket(opts.bucket),
    Key: key,
    ContentType: opts.contentType,
    Metadata: opts.metadata,
  });
  return getSignedUrl(getR2Client(), command, {
    expiresIn: opts.expiresIn ?? 3600,
    // R2 stores signed object metadata only when the client sends it as
    // canonical request headers. Hoisting it into the query string both drops
    // the metadata and makes worker uploads fail signature verification.
    unhoistableHeaders: new Set(
      Object.keys(opts.metadata ?? {}).map((key) => `x-amz-meta-${key}`),
    ),
  });
}

/** Presigned GET URL for time-limited reads of a private object. */
export async function presignDownload(
  key: string,
  opts: PresignOptions = {},
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: getBucket(opts.bucket),
    Key: key,
  });
  return getSignedUrl(getR2Client(), command, {
    expiresIn: opts.expiresIn ?? 3600,
  });
}

/** Public/CDN URL for an object, when R2_PUBLIC_BASE_URL is configured. */
export function publicUrl(key: string): string {
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (!base) {
    throw new Error("R2_PUBLIC_BASE_URL is not configured");
  }
  return `${base.replace(/\/$/, "")}/${key.replace(/^\//, "")}`;
}

/**
 * Per-channel R2 key prefix. All media for a channel is namespaced under this
 * so tenancy/cleanup/quotas can be scoped per channel (and per owner later).
 * Example: `owner/<ownerId>/channel/<channelSlug>/`.
 */
export function channelPrefix(ownerId: string, channelSlug: string): string {
  const clean = (s: string) => s.replace(/^\/+|\/+$/g, "");
  return `owner/${clean(ownerId)}/channel/${clean(channelSlug)}/`;
}

/** Join a channel prefix with a relative key, normalising slashes. */
export function channelKey(
  ownerId: string,
  channelSlug: string,
  relKey: string,
): string {
  return channelPrefix(ownerId, channelSlug) + relKey.replace(/^\/+/, "");
}

export type PutBody = PutObjectCommandInput["Body"];

export interface PutOptions {
  bucket?: string;
  contentType?: string;
  metadata?: Record<string, string>;
  /** Atomic create-only write, used for paid-provider idempotency claims. */
  ifNoneMatch?: "*";
}

/**
 * Upload an object to R2. Body may be a Buffer/Uint8Array/string/stream — for
 * large renders the caller streams from disk so bytes never sit in app memory.
 * Returns the stored key.
 */
export async function putObject(
  key: string,
  body: PutBody,
  opts: PutOptions = {},
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: getBucket(opts.bucket),
    Key: key,
    Body: body,
    ContentType: opts.contentType,
    Metadata: opts.metadata,
    IfNoneMatch: opts.ifNoneMatch,
  });
  await getR2Client().send(command);
  return key;
}

/** Read object metadata without downloading the media body (recovery/checkpoint path). */
export async function headObjectMetadata(
  key: string,
  bucket?: string,
): Promise<{
  contentLength?: number;
  contentType?: string;
  etag?: string;
  metadata: Record<string, string>;
} | null> {
  try {
    const response = await getR2Client().send(new HeadObjectCommand({
      Bucket: getBucket(bucket),
      Key: key,
    }));
    return {
      ...(typeof response.ContentLength === "number" ? { contentLength: response.ContentLength } : {}),
      ...(response.ContentType ? { contentType: response.ContentType } : {}),
      ...(response.ETag ? { etag: response.ETag } : {}),
      metadata: response.Metadata ?? {},
    };
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    const name = (error as { name?: string }).name;
    if (status === 404 || name === "NotFound" || name === "NoSuchKey") return null;
    throw error;
  }
}

/**
 * Upload a file to R2 by STREAMING it from disk — the bytes never sit in app
 * memory as one Buffer. `putObject(key, await readBytes(path))` buffered the
 * whole render (300MB+ meditation finals) and OOM-killed the worker mid-upload
 * (TASK_PROCESS_SIGTERM). Uses a plain read stream + ContentLength (from stat),
 * so it needs no extra dependency and stays a single streamed PUT.
 */
export async function putObjectFromFile(
  key: string,
  filePath: string,
  opts: PutOptions = {},
): Promise<string> {
  const { createReadStream } = await import("node:fs");
  const { stat } = await import("node:fs/promises");
  const size = (await stat(filePath)).size;
  const command = new PutObjectCommand({
    Bucket: getBucket(opts.bucket),
    Key: key,
    Body: createReadStream(filePath),
    ContentLength: size,
    ContentType: opts.contentType,
    Metadata: opts.metadata,
    IfNoneMatch: opts.ifNoneMatch,
  });
  await getR2Client().send(command);
  return key;
}

/** List every object key under a prefix (handles pagination). */
export async function listObjects(prefix: string, bucket?: string): Promise<string[]> {
  const client = getR2Client();
  const Bucket = getBucket(bucket);
  const keys: string[] = [];
  let ContinuationToken: string | undefined;
  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken }),
    );
    for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
    ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return keys;
}

/** An incomplete delete may already have removed some objects; never call it preserved. */
export class ObjectDeletionError extends Error {
  constructor(message: string, readonly confirmedDeleted: number, readonly requestedObjects: number) {
    super(message);
    this.name = "ObjectDeletionError";
  }
}

/** Delete exact unique keys; every success must be acknowledged, including absent keys. */
export async function deleteObjects(keys: string[], bucket?: string): Promise<number> {
  if (keys.length === 0) return 0;
  if (keys.some((key) => typeof key !== "string" || !key || Buffer.byteLength(key, "utf8") > 1024)) {
    throw new ObjectDeletionError("Object deletion requires valid exact keys", 0, keys.length);
  }
  const unique = [...new Set(keys)];
  const client = getR2Client();
  const Bucket = getBucket(bucket);
  let deleted = 0;
  for (let i = 0; i < unique.length; i += 1000) {
    const batch = unique.slice(i, i + 1000);
    const requested = new Set(batch);
    let response;
    try {
      response = await client.send(new DeleteObjectsCommand({
        Bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: false },
      }));
    } catch {
      throw new ObjectDeletionError("Object deletion outcome is unavailable", deleted, unique.length);
    }
    const acknowledged = new Set<string>();
    const failed = new Set<string>();
    const record = (rows: unknown, target: Set<string>): boolean => {
      if (rows === undefined) return true;
      if (!Array.isArray(rows)) return false;
      for (const row of rows) {
        const key = row?.Key;
        if (typeof key !== "string" || !requested.has(key) || target.has(key)) return false;
        target.add(key);
      }
      return true;
    };
    if (response?.$metadata?.httpStatusCode !== 200 ||
        !record(response.Deleted, acknowledged) || !record(response.Errors, failed) ||
        [...failed].some((key) => acknowledged.has(key))) {
      throw new ObjectDeletionError("Object deletion acknowledgement is invalid", deleted, unique.length);
    }
    deleted += acknowledged.size;
    if (failed.size || acknowledged.size !== batch.length) {
      // HTTP 200 can contain per-object failures. Do not continue later batches
      // or discard the confirmations from earlier ones. Provider text/keys are
      // deliberately absent from errors which can reach logs or the browser.
      throw new ObjectDeletionError("Object deletion is incomplete", deleted, unique.length);
    }
  }
  return deleted;
}

/** Fetch an object's bytes from R2 as a Uint8Array. */
export async function getObjectBytes(
  key: string,
  bucket?: string,
  options: { timeoutMs?: number } = {},
): Promise<Uint8Array> {
  const command = new GetObjectCommand({
    Bucket: getBucket(bucket),
    Key: key,
  });
  const timeoutMs = options.timeoutMs;
  const signal =
    typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? AbortSignal.timeout(Math.floor(timeoutMs))
      : undefined;
  const res = await getR2Client().send(command, signal ? { abortSignal: signal } : undefined);
  if (!res.Body) {
    throw new Error(`R2 object has no body: ${key}`);
  }
  // @aws-sdk v3 streams expose transformToByteArray in Node + browser builds.
  const body = res.Body as {
    transformToByteArray: () => Promise<Uint8Array>;
    destroy?: (error?: Error) => void;
    cancel?: (reason?: unknown) => Promise<void> | void;
  };
  if (!signal) return await body.transformToByteArray();

  return await new Promise<Uint8Array>((resolve, reject) => {
    const cancel = () => {
      const reason = signal.reason instanceof Error ? signal.reason : new Error("R2 object download timed out");
      try {
        body.destroy?.(reason);
      } catch {
        // The deadline still releases the local waiter for non-Node streams.
      }
      try {
        void Promise.resolve(body.cancel?.(reason)).catch(() => undefined);
      } catch {
        // The request signal is already aborted; cancellation is best effort.
      }
      reject(reason);
    };
    const cleanup = () => signal.removeEventListener("abort", cancel);
    if (signal.aborted) {
      cancel();
      return;
    }
    signal.addEventListener("abort", cancel, { once: true });
    void body.transformToByteArray().then(
      (bytes) => {
        cleanup();
        resolve(bytes);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/**
 * Compute the exact byte identity of an R2 object without materialising a
 * potentially multi-gigabyte master in memory.  Release evidence uses this
 * instead of `getObjectBytes()` for final video masters; evidence frames and
 * JSON receipts remain safely bounded byte reads.
 */
export async function getObjectIntegrity(
  key: string,
  bucket?: string,
): Promise<{ sha256: string; byteLength: number }> {
  const command = new GetObjectCommand({
    Bucket: getBucket(bucket),
    Key: key,
  });
  const res = await getR2Client().send(command);
  if (!res.Body) throw new Error(`R2 object has no body: ${key}`);
  const body = res.Body as AsyncIterable<Uint8Array | Buffer | string>;
  if (typeof body[Symbol.asyncIterator] !== "function") {
    throw new Error(`R2 object body is not an async byte stream: ${key}`);
  }
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256");
  let byteLength = 0;
  for await (const chunk of body) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    hash.update(bytes);
    byteLength += bytes.byteLength;
  }
  if (!Number.isSafeInteger(byteLength) || byteLength < 1) {
    throw new Error(`R2 object has an invalid streamed byte length: ${key}`);
  }
  return { sha256: hash.digest("hex"), byteLength };
}

/** Stream a large R2 object directly to disk without buffering the render. */
export async function getObjectToFile(
  key: string,
  filePath: string,
  bucket?: string,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: getBucket(bucket),
    Key: key,
  });
  const res = await getR2Client().send(command);
  if (!res.Body) throw new Error(`R2 object has no body: ${key}`);
  const body = res.Body as NodeJS.ReadableStream;
  if (typeof body.pipe !== "function") {
    throw new Error(`R2 object body is not a Node stream: ${key}`);
  }
  const [{ createWriteStream }, { pipeline }] = await Promise.all([
    import("node:fs"),
    import("node:stream/promises"),
  ]);
  await pipeline(body, createWriteStream(filePath));
  return filePath;
}
