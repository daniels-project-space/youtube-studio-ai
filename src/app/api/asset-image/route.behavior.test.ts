import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import type { GET } from "./route";

const compiled = ts.transpileModule(readFileSync("src/app/api/asset-image/route.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
class ObjectSizeLimitError extends Error {}

function fixture(read: (key: string, attempt: number) => Promise<Uint8Array>) {
  const calls: string[] = [];
  const loaded = { exports: {} as { GET: typeof GET } };
  const requireFixture = (name: string) => {
    if (name === "next/server") return { NextResponse: Response };
    if (name === "@/lib/config") return { OWNER_ID: "fixture-owner" };
    if (name === "@/lib/storage") return {
      ObjectSizeLimitError,
      isR2CredentialFailure: (error: unknown) => error instanceof Error && error.message === "credential failure",
      getObjectBytes: async (key: string, bucket: unknown, options: unknown) => {
        assert.equal(bucket, undefined);
        assert.deepEqual(options, { timeoutMs: 15_000, maxBytes: 25 * 1024 * 1024 });
        calls.push(key);
        return read(key, calls.length);
      },
    };
    throw new Error(`Unexpected route import: ${name}`);
  };
  new Function("require", "module", "exports", compiled)(requireFixture, loaded, loaded.exports);
  return {
    calls,
    get: (key = "owner/fixture-owner/art.png", probe = false) => loaded.exports.GET(
      new Request(`https://fixture.invalid/api/asset-image?key=${encodeURIComponent(key)}${probe ? "&probe=1" : ""}`),
    ),
  };
}

test("overlapping probe and display requests share a bounded read but completed bytes are not cached", async () => {
  let release!: (bytes: Uint8Array) => void;
  const pending = new Promise<Uint8Array>(resolve => { release = resolve; });
  const f = fixture(async (_key, attempt) => attempt === 1 ? pending : Uint8Array.of(0xff, 0xd8, 0xff));
  const probe = f.get(undefined, true);
  const first = f.get();
  const second = f.get();
  assert.equal(f.calls.length, 1);
  release(png);
  assert.deepEqual(await (await probe).json(), { available: true });
  for (const response of await Promise.all([first, second])) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png);
  }
  const replaced = await f.get();
  assert.equal(f.calls.length, 2);
  assert.equal(replaced.headers.get("content-type"), "image/jpeg", "replaced bytes must not use stale MIME");
});

test("oversized objects are not retried and cannot pass an availability probe", async () => {
  const f = fixture(async () => { throw new ObjectSizeLimitError(); });
  const display = await f.get();
  assert.equal(display.status, 413);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(await display.json(), { error: "image too large" });
  const probe = await f.get(undefined, true);
  assert.equal(probe.status, 200);
  assert.deepEqual(await probe.json(), { available: false });
  assert.equal(f.calls.length, 2, "failed reads must leave no retained promise");
});

test("one transient retry is shared by overlapping callers", async () => {
  const f = fixture(async (_key, attempt) => {
    if (attempt === 1) throw new Error("transient edge miss");
    return png;
  });
  const responses = await Promise.all([f.get(), f.get()]);
  assert.equal(f.calls.length, 2);
  assert.ok(responses.every(response => response.status === 200));
});

test("persistent read failures clear shared state and preserve unavailable responses", async () => {
  const f = fixture(async () => { throw new Error("credential failure"); });
  const responses = await Promise.all([f.get(), f.get()]);
  assert.equal(f.calls.length, 2);
  assert.ok(responses.every(response => response.status === 503));
  assert.equal(responses[0].headers.get("retry-after"), "60");
  await f.get();
  assert.equal(f.calls.length, 4);
});

test("different keys remain isolated and overflow does not deny unrelated reads", async () => {
  let release!: (bytes: Uint8Array) => void;
  const pending = new Promise<Uint8Array>(resolve => { release = resolve; });
  const f = fixture(async () => pending);
  const keys = Array.from({ length: 6 }, (_, i) => `owner/fixture-owner/${i}.png`);
  const responses = keys.map(key => f.get(key));
  const duplicate = f.get(keys[0]);
  assert.deepEqual(f.calls, keys);
  release(png);
  assert.ok((await Promise.all([...responses, duplicate])).every(response => response.status === 200));
  await f.get(keys[0]);
  assert.equal(f.calls.length, 7);
});

test("invalid owner keys are rejected before joining or starting storage reads", async () => {
  const f = fixture(async () => png);
  for (const key of ["owner/other/art.png", "owner/fixture-owner/../art.png", "owner/fixture-owner/art.svg"]) {
    assert.equal((await f.get(key)).status, 403);
  }
  assert.equal(f.calls.length, 0);
});
