import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Module, { createRequire } from "node:module";
import test from "node:test";
import type { Id } from "../../../convex/_generated/dataModel";

const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
const bytes = Buffer.from("accepted lo-fi keyframe pixels");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const etag = '"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"';
const prefix = "owner/daniel/channel/lofi/";
const runId = "run-1";
const sourceKey = `${prefix}runs/${runId}/lofi-keyframe/images/keyframe-1.png`;
const releaseAt = Date.UTC(2026, 8, 1);

test("release copy binds full source bytes, ETag, metadata, and idempotent create-only retry", async () => {
  const temp = await mkdtemp(join(tmpdir(), "released-keyframe-test-"));
  let destination: { key: string; bytes: Buffer; metadata: Record<string, string> } | undefined;
  let uploads = 0;
  loader._load = function(id, ...args) {
    const actual = originalLoad.call(this, id, ...args);
    if (id === "@/lib/files") return { ...actual as object,
      makeRunTempDir: async () => temp, cleanupDir: async () => {} };
    if (id === "@/lib/storage") return { ...actual as object,
      headObjectMetadata: async (key: string) => key === sourceKey
        ? { etag, contentLength: bytes.length, metadata: {} }
        : destination?.key === key
          ? { etag: '"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"', contentLength: destination.bytes.length,
            metadata: destination.metadata } : null,
      getObjectToFile: async (key: string, path: string, _bucket: string, expectedEtag: string) => {
        assert.equal(key, sourceKey); assert.equal(expectedEtag, etag);
        await writeFile(path, bytes);
      },
      putObjectFromFile: async (key: string, path: string, opts: { ifNoneMatch: string; metadata: Record<string, string> }) => {
        assert.equal(opts.ifNoneMatch, "*");
        assert.equal(destination, undefined, "create-only must never overwrite a key");
        uploads++;
        destination = { key, bytes: await readFile(path), metadata: opts.metadata };
      },
      getObjectIntegrity: async (key: string) => {
        assert.equal(key, destination?.key);
        return { sha256: createHash("sha256").update(destination!.bytes).digest("hex"),
          byteLength: destination!.bytes.length };
      },
    };
    return actual;
  };
  try {
    const { copyReleasedKeyframe } = createRequire(import.meta.url)("../releasedKeyframe") as
      typeof import("../releasedKeyframe");
    const input = { keyPrefix: prefix, runId, releaseAt,
      source: { assetId: "asset-1" as Id<"assets">, sourceKey } };
    const first = await copyReleasedKeyframe(input);
    assert.equal(first.sha256, sha256);
    assert.equal(first.sourceEtag, etag);
    assert.equal(first.expiresAt, releaseAt + 30 * 24 * 60 * 60 * 1_000);
    assert.equal(destination?.metadata.retentionWriter, "released-keyframe/v1");
    assert.equal(destination?.metadata.retentionSourceKey, sourceKey);
    assert.equal(destination?.metadata.retentionKeyframeSha256, sha256);
    assert.deepEqual(await copyReleasedKeyframe(input), first);
    assert.equal(uploads, 1);
    destination!.bytes = Buffer.from("altered");
    await assert.rejects(copyReleasedKeyframe(input), /different bytes|matching receipt metadata/);
  } finally {
    loader._load = originalLoad;
    await rm(temp, { recursive: true, force: true });
  }
});
