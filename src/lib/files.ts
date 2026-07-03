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

/**
 * Create a temp dir for a run, e.g. /tmp/ysa-<runId>-<rand>/.
 *
 * Pass `scope` (e.g. the block id) to get a DETERMINISTIC dir instead:
 * /tmp/ysa-<runId>-<scope>/. Blocks with path-keyed asset caches (whiteboard
 * art layers, comic panels…) MUST use a scoped dir — with mkdtemp's random
 * suffix, every Trigger retry/self-heal landed in a fresh dir and regenerated
 * every paid image from scratch (the single worst retry-cost multiplier).
 */
export async function makeRunTempDir(runId: string, scope?: string): Promise<string> {
  const safe = runId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (scope) {
    const s = scope.replace(/[^a-zA-Z0-9_-]/g, "");
    const dir = join(tmpdir(), `ysa-${safe}-${s}`);
    await mkdir(dir, { recursive: true });
    return dir;
  }
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
