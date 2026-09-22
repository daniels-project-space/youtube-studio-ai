import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, mock } from "node:test";
import { getR2Client, putObjectFromFile } from "../storage";

test("real SDK multipart upload preserves bytes, metadata, bounded parts and cleanup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "r2-multipart-"));
  const names = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] as const;
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { R2_ENDPOINT: "https://fixture.invalid", R2_ACCESS_KEY_ID: "fixture",
    R2_SECRET_ACCESS_KEY: "fixture", R2_BUCKET: "fixture-default" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("multipart fixture forbids networking"); };
  const calls: string[] = [];
  const parts = new Map<number, { length: number; hash: string }>();
  let active = 0, maxActive = 0, singleBytes = 0;
  let mode: "success" | "part" | "complete" | "abort" | "lost-completion" | "missing-etag" | "create" = "success";
  const failure = new Error("fixture transfer failure"), cleanupFailure = new Error("fixture cleanup failure");
  const bodyBytes = Buffer.alloc(65 * 1024 ** 2, 0x57);
  const path = join(directory, "large.mp4"), small = join(directory, "small.json"), huge = join(directory, "huge.mp4");
  const client = getR2Client();
  const send = mock.method(client, "send", async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const name = command.constructor.name, input = command.input;
    calls.push(name);
    assert.equal(input.Bucket, "fixture-private"); assert.equal(input.Key, "owner/fixture/master");
    if (name === "PutObjectCommand") {
      assert.equal(input.ContentType, "video/mp4"); assert.deepEqual(input.Metadata, { source: "fixture" });
      singleBytes = 0;
      for await (const chunk of input.Body as AsyncIterable<Buffer>) singleBytes += chunk.length;
      return { ETag: "single" };
    }
    if (name === "CreateMultipartUploadCommand") {
      assert.equal(input.ContentType, "video/mp4"); assert.deepEqual(input.Metadata, { source: "fixture" });
      assert.equal(input.IfNoneMatch, undefined);
      if (mode === "create") throw failure;
      return { UploadId: "exact-attempt" };
    }
    assert.equal(input.UploadId, "exact-attempt");
    if (name === "UploadPartCommand") {
      active++; maxActive = Math.max(maxActive, active);
      const number = input.PartNumber as number, bytes = input.Body as Buffer;
      assert.ok(Buffer.isBuffer(bytes)); assert.ok(bytes.length <= 32 * 1024 ** 2);
      parts.set(number, { length: bytes.length, hash: createHash("sha256").update(bytes).digest("hex") });
      await new Promise(resolve => setTimeout(resolve, number === 1 ? 40 : 5));
      active--;
      if ((mode === "part" || mode === "abort") && number === 2) throw failure;
      if (mode === "missing-etag" && number === 2) return {};
      return { ETag: `part-${number}` };
    }
    if (name === "CompleteMultipartUploadCommand") {
      assert.equal(active, 0);
      assert.deepEqual(input.MultipartUpload, { Parts: [1, 2, 3].map(PartNumber => ({ PartNumber, ETag: `part-${PartNumber}` })) });
      if (mode === "complete" || mode === "lost-completion") throw failure;
      return { ETag: "completed" };
    }
    if (name === "AbortMultipartUploadCommand") {
      assert.equal(active, 0, "all part workers settle before temporary parts are aborted");
      if (mode === "abort") throw cleanupFailure;
      if (mode === "lost-completion") throw Object.assign(new Error("gone"), { name: "NoSuchUpload" });
      return {};
    }
    throw new Error(`unexpected storage command ${name}`);
  });
  const options = { bucket: "fixture-private", contentType: "video/mp4", metadata: { source: "fixture" } };
  const reset = () => { calls.length = 0; parts.clear(); active = 0; maxActive = 0; };
  try {
    await writeFile(path, bodyBytes); await writeFile(small, "small-file");
    assert.equal(await putObjectFromFile("owner/fixture/master", path, options), "owner/fixture/master");
    assert.equal(calls[0], "CreateMultipartUploadCommand");
    assert.equal(calls.at(-1), "CompleteMultipartUploadCommand");
    assert.equal(calls.filter(name => name === "UploadPartCommand").length, 3);
    assert.ok(maxActive <= 2);
    for (const [number, value] of parts) {
      const expected = bodyBytes.subarray((number - 1) * 32 * 1024 ** 2, number * 32 * 1024 ** 2);
      assert.equal(value.length, expected.length);
      assert.equal(value.hash, createHash("sha256").update(expected).digest("hex"));
    }
    for (mode of ["part", "complete", "abort", "lost-completion", "missing-etag", "create"] as const) {
      reset();
      await assert.rejects(putObjectFromFile("owner/fixture/master", path, options), error => {
        if (mode === "abort") { assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [failure, cleanupFailure]); }
        else if (mode === "missing-etag") assert.match(String(error), /missing ETag/);
        else assert.equal(error, failure);
        return true;
      });
      assert.equal(calls.filter(name => name === "CreateMultipartUploadCommand").length, 1, "no whole-upload retry");
      assert.equal(calls.filter(name => name === "AbortMultipartUploadCommand").length, mode === "create" ? 0 : 1);
      assert.equal(calls.some(name => name.startsWith("Delete")), false, "never delete a possibly completed object");
      if (mode === "part" || mode === "abort") {
        assert.equal(calls.filter(name => name === "UploadPartCommand").length, 2, "request failure stops reading unneeded later parts");
      }
    }
    mode = "success"; reset();
    await putObjectFromFile("owner/fixture/master", small, { ...options, ifNoneMatch: "*" });
    assert.deepEqual(calls, ["PutObjectCommand"]); assert.equal(singleBytes, 10);
    assert.equal((send.mock.calls.at(-1)!.arguments[0] as unknown as { input: { IfNoneMatch: string } }).input.IfNoneMatch, "*");
    reset();
    await putObjectFromFile("owner/fixture/master", path, { ...options, ifNoneMatch: "*" });
    assert.deepEqual(calls, ["PutObjectCommand"]); assert.equal(singleBytes, bodyBytes.length);
    const handle = await open(huge, "w");
    await handle.truncate(5 * 1024 ** 3 + 1); await handle.close();
    reset();
    await assert.rejects(putObjectFromFile("owner/fixture/master", huge, { ...options, ifNoneMatch: "*" }), /refusing to weaken IfNoneMatch/);
    await assert.rejects(putObjectFromFile("owner/fixture/master", directory, options), /regular file/);
    assert.deepEqual(calls, [], "inadmissible sources refuse before storage dispatch");
  } finally {
    send.mock.restore(); globalThis.fetch = originalFetch;
    for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
    client.destroy(); await rm(directory, { recursive: true, force: true });
  }
});
