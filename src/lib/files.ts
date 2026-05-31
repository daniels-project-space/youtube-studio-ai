/**
 * Local-temp + HTTP-download helpers for heavy media blocks.
 *
 * Blocks address everything by R2 key / remote URL, but ffmpeg works on local
 * files. These helpers give each run an isolated temp dir and stream remote
 * assets to disk without buffering whole videos in app memory.
 */
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Create an isolated temp dir for a run, e.g. /tmp/ysa-<runId>-<rand>/. */
export async function makeRunTempDir(runId: string): Promise<string> {
  const safe = runId.replace(/[^a-zA-Z0-9_-]/g, "");
  return mkdtemp(join(tmpdir(), `ysa-${safe}-`));
}

/** Ensure a directory exists. */
export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/** Best-effort recursive cleanup of a temp dir (never throws). */
export async function cleanupDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/** Download a remote URL to a local file path, streaming to disk. */
export async function downloadTo(url: string, destPath: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`download failed (${res.status}) for ${url}`);
  }
  await pipeline(
    Readable.fromWeb(res.body as unknown as import("stream/web").ReadableStream),
    createWriteStream(destPath),
  );
  return destPath;
}

/** Write bytes to a local file. */
export async function writeBytes(
  destPath: string,
  bytes: Uint8Array,
): Promise<string> {
  await writeFile(destPath, bytes);
  return destPath;
}

/** Read a local file as bytes. */
export async function readBytes(path: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path));
}
