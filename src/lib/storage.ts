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

import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
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
