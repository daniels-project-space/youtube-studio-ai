#!/usr/bin/env node
/**
 * Re-seal the public-base runtime bundle after a worker-only safety fix.
 * The LTX runtime and dependencies are copied byte-for-byte from the prior
 * SHA-bound bundle; only /opt/novita-worker/worker.py is replaced from this
 * checkout.  The result receives a new content-addressed R2 identity.
 */
import crypto from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const SOURCE_KEY = "novita/runtime/ltx-2.5/8668b2c673e2fb17fc16c022c670a8658a423d73d427ac21d163720e3f7a9b14.tar.zst";
const SOURCE_SHA256 = "8668b2c673e2fb17fc16c022c670a8658a423d73d427ac21d163720e3f7a9b14";
const here = path.dirname(fileURLToPath(import.meta.url));
const sourceWorker = path.resolve(here, "../infra/novita/worker.py");
for (const key of ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT"]) {
  if (!process.env[key]?.trim()) throw new Error(`${key} is required`);
}
const bucket = process.env.R2_BUCKET || "youtube-studio-ai";
const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = createReadStream(file);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

const workspace = await mkdtemp(path.join(os.tmpdir(), "youtube-studio-ltx-runtime-"));
try {
  const sourceArchive = path.join(workspace, "source.tar.zst");
  const outputArchive = path.join(workspace, "runtime.tar.gz");
  const sourceObject = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: SOURCE_KEY }));
  await pipeline(sourceObject.Body, createWriteStream(sourceArchive));
  if (await sha256File(sourceArchive) !== SOURCE_SHA256) throw new Error("source runtime bundle SHA-256 mismatch");
  await run("tar", ["--use-compress-program=zstd", "-xf", sourceArchive, "-C", workspace]);
  const workerTarget = path.join(workspace, "opt", "novita-worker", "worker.py");
  await stat(workerTarget);
  await copyFile(sourceWorker, workerTarget);
  await run("tar", ["-czf", outputArchive, "-C", workspace, "opt"]);
  const sha256 = await sha256File(outputArchive);
  const key = `novita/runtime/ltx-2.5/${sha256}.tar.gz`;
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    if (error?.$metadata?.httpStatusCode !== 404 && error?.name !== "NotFound") throw error;
    await s3.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: createReadStream(outputArchive), ContentType: "application/gzip",
      Metadata: { "source-runtime-sha256": SOURCE_SHA256, "worker-sha256": crypto.createHash("sha256").update(await readFile(sourceWorker)).digest("hex") },
    }));
  }
  console.log(JSON.stringify({ event: "runtime_bundle_resealed", key, sha256, sourceKey: SOURCE_KEY }));
} finally {
  await rm(workspace, { recursive: true, force: true });
}
