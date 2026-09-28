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
const prefix = "owner/daniel/channel/lofi/";
const runId = "run-1";
const releaseAt = Date.UTC(2026, 8, 1);
const etag = '"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"';

test("both marked Lo-Fi video classes use shared full-byte create-only release copy", async () => {
  const temp = await mkdtemp(join(tmpdir(), "released-ordinary-test-"));
  const objects = new Map<string, { bytes: Buffer; metadata: Record<string, string> }>();
  const sources = [
    { kind: "lofi-clip" as const, assetId: "asset-clip" as Id<"assets">,
      sourceKey: `${prefix}runs/${runId}/loopraw.mp4`, bytes: Buffer.from("lofi source clip") },
    { kind: "lofi-loop-unit" as const, assetId: "asset-unit" as Id<"assets">,
      sourceKey: `${prefix}runs/${runId}/loopunit_4k.mp4`, bytes: Buffer.from("lofi finished loop unit") },
  ];
  let puts = 0;
  loader._load = function(id, ...args) {
    const actual = originalLoad.call(this, id, ...args);
    if (id === "@/lib/files") return { ...actual as object,
      makeRunTempDir: async () => temp, cleanupDir: async () => {} };
    if (id === "@/lib/storage") return { ...actual as object,
      headObjectMetadata: async (key: string) => {
        const source = sources.find((item) => item.sourceKey === key);
        if (source) return { etag, contentLength: source.bytes.length, metadata: {} };
        const object = objects.get(key);
        return object ? { etag: '"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"', lastModified: new Date(releaseAt + 1_000),
          contentLength: object.bytes.length, metadata: object.metadata } : null;
      },
      getObjectToFile: async (key: string, path: string, _bucket: string, expectedEtag: string) => {
        assert.equal(expectedEtag, etag);
        const source = sources.find((item) => item.sourceKey === key);
        assert.ok(source);
        await writeFile(path, source.bytes);
      },
      putObjectFromFile: async (key: string, path: string, opts: { ifNoneMatch: string; metadata: Record<string, string> }) => {
        assert.equal(opts.ifNoneMatch, "*");
        assert.equal(objects.has(key), false);
        puts++;
        objects.set(key, { bytes: await readFile(path), metadata: opts.metadata });
      },
      getObjectIntegrity: async (key: string) => {
        const object = objects.get(key);
        assert.ok(object);
        return { sha256: createHash("sha256").update(object.bytes).digest("hex"), byteLength: object.bytes.length };
      },
    };
    return actual;
  };
  try {
    const { copyReleasedOrdinaryAsset } = createRequire(import.meta.url)("../releasedOrdinaryAsset") as
      typeof import("../releasedOrdinaryAsset");
    for (const source of sources) {
      const { bytes, ...receiptSource } = source;
      const input = { keyPrefix: prefix, runId, releaseAt, source: receiptSource };
      const receipt = await copyReleasedOrdinaryAsset(input);
      assert.equal(receipt.sha256, createHash("sha256").update(bytes).digest("hex"));
      assert.equal(receipt.sourceEtag, etag);
      assert.equal(objects.get(receipt.r2Key)?.metadata.retentionAssetClass, source.kind);
      assert.equal(objects.get(receipt.r2Key)?.metadata.retentionAssetId, source.assetId);
      assert.deepEqual(await copyReleasedOrdinaryAsset(input), receipt);
    }
    assert.equal(puts, 2);
    await assert.rejects(copyReleasedOrdinaryAsset({ keyPrefix: prefix, runId, releaseAt,
      source: { kind: "lofi-clip", assetId: "asset-bad" as Id<"assets">,
        sourceKey: `${prefix}runs/run-2/loopraw.mp4` } }), /exact marked run-local source/);
  } finally {
    loader._load = originalLoad;
    await rm(temp, { recursive: true, force: true });
  }
});
