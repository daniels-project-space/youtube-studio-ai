/**
 * Build one short-lived bootstrap manifest plus the URL-free verification
 * manifest for the persistent OpenRelay H3 volume. This is an operator tool,
 * not a Trigger task: provider VMs never receive R2 credentials.
 */
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { bootstrapSecrets } from "@/lib/bootstrap";
import {
  MINIMAX_H3_MANIFEST_SHA256,
  MINIMAX_H3_RUNTIME_ID,
} from "@/lib/minimaxH3";
import { sha256BytesHex } from "@/lib/sha256";
import { getObjectBytes, presignDownload } from "@/lib/storage";

const MODEL_BUCKET = "salad-render-infra";
const MANIFEST_KEY = `${MINIMAX_H3_RUNTIME_ID}/immutable-manifest.json`;

type ImmutableFile = { key: string; path: string; sha256: string; bytes: number };

function usage(): never {
  throw new Error("usage: tsx scripts/build-openrelay-h3-bootstrap-manifest.ts <empty-output-directory>");
}

function validateFile(value: unknown): ImmutableFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("H3 immutable manifest has a non-object file entry");
  const file = value as Record<string, unknown>;
  const key = typeof file.key === "string" ? file.key : "";
  const path = typeof file.path === "string" ? file.path : "";
  const sha256 = typeof file.sha256 === "string" ? file.sha256 : "";
  const bytes = typeof file.bytes === "number" ? file.bytes : Number.NaN;
  const prefix = `${MINIMAX_H3_RUNTIME_ID}/files/`;
  if (
    !key.startsWith(prefix) || key.length > 1_000 || !path || path.startsWith("/") || path.includes("\\") || /(?:^|\/)\.\.?(?:\/|$)/u.test(path) ||
    key !== `${prefix}${path}` || !/^[a-f0-9]{64}$/u.test(sha256) || !Number.isSafeInteger(bytes) || bytes < 1
  ) throw new Error("H3 immutable manifest file binding is invalid");
  return { key, path, sha256, bytes };
}

async function main(): Promise<void> {
  const target = process.argv[2] ? resolve(process.argv[2]) : usage();
  await bootstrapSecrets(() => undefined, {
    services: ["cloudflare"],
    required: ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"],
  });
  const bytes = await getObjectBytes(MANIFEST_KEY, MODEL_BUCKET);
  if (sha256BytesHex(bytes) !== MINIMAX_H3_MANIFEST_SHA256) throw new Error("H3 immutable manifest digest does not match the admitted model pack");
  const raw = JSON.parse(new TextDecoder().decode(bytes)) as { route?: unknown; files?: unknown };
  if (raw.route !== "minimax-h3-turbo8-5090" || !Array.isArray(raw.files) || raw.files.length !== 5) {
    throw new Error("H3 immutable manifest route or file count is invalid");
  }
  const files = raw.files.map(validateFile);
  if (new Set(files.map((file) => file.path)).size !== files.length) throw new Error("H3 immutable manifest repeats a local path");
  const bootstrap = {
    route: raw.route,
    files: await Promise.all(files.map(async (file) => ({
      ...file,
      // Enough time for the one-time 44.4 GB hydration; this file is deleted
      // on the VM immediately after the checksum-gated cache commits.
      url: await presignDownload(file.key, { bucket: MODEL_BUCKET, expiresIn: 12 * 60 * 60 }),
    }))),
  };
  const verification = { route: raw.route, files };
  try {
    if ((await readdir(target)).length) throw new Error("bootstrap output directory must be empty");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(target, { recursive: true, mode: 0o700 });
  }
  await Promise.all([
    writeFile(resolve(target, "bootstrap-manifest.json"), JSON.stringify(bootstrap) + "\n", { mode: 0o600 }),
    writeFile(resolve(target, "model-manifest.json"), JSON.stringify(verification) + "\n", { mode: 0o600 }),
  ]);
  console.log(JSON.stringify({ files: files.length, modelBytes: files.reduce((sum, file) => sum + file.bytes, 0) }));
}

void main();
