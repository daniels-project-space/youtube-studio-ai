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
 * This is an intentionally minimal stub: it compiles and gives a typed
 * surface, but real upload/list logic is filled in per-feature.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
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
  });
  return getSignedUrl(getR2Client(), command, {
    expiresIn: opts.expiresIn ?? 3600,
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
  });
  await getR2Client().send(command);
  return key;
}

/** Fetch an object's bytes from R2 as a Uint8Array. */
export async function getObjectBytes(
  key: string,
  bucket?: string,
): Promise<Uint8Array> {
  const command = new GetObjectCommand({
    Bucket: getBucket(bucket),
    Key: key,
  });
  const res = await getR2Client().send(command);
  if (!res.Body) {
    throw new Error(`R2 object has no body: ${key}`);
  }
  // @aws-sdk v3 streams expose transformToByteArray in Node + browser builds.
  return await (
    res.Body as { transformToByteArray: () => Promise<Uint8Array> }
  ).transformToByteArray();
}
