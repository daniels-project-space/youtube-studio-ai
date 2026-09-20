import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import ts from "typescript";
import type { GET } from "./route";

const compiled = ts.transpileModule(readFileSync("src/app/api/asset-video/route.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(fetcher: typeof fetch, wait: typeof delay = async () => undefined as never,
  sign: () => Promise<string> = async () => "https://storage.invalid/video") {
  let signs = 0;
  const loaded = { exports: {} as { GET: typeof GET } };
  new Function("require", "module", "exports", "fetch", compiled)((name: string) => {
    if (name === "next/server") return { NextResponse: Response };
    if (name === "node:timers/promises") return { setTimeout: wait };
    if (name === "@/lib/config") return { OWNER_ID: "fixture-owner" };
    if (name === "@/lib/storage") return { presignDownload: () => { signs++; return sign(); } };
    throw new Error(`Unexpected import: ${name}`);
  }, loaded, loaded.exports, fetcher);
  return {
    get: (signal: AbortSignal, probe = false, range?: string) => loaded.exports.GET(new Request(
      `https://fixture.invalid/api/asset-video?key=owner/fixture-owner/master.mp4${probe ? "&probe=1" : ""}`,
      { signal, headers: range ? { Range: range } : undefined },
    )),
    signs: () => signs,
  };
}

test("already abandoned previews do no signing or storage work", async () => {
  const f = fixture(async () => { throw new Error("Unexpected storage read"); });
  for (const probe of [false, true]) {
    const response = await f.get(AbortSignal.abort(), probe);
    assert.equal(response.status, 499);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(f.signs(), 0);
});

test("abort during signing cannot start a storage request", async () => {
  const controller = new AbortController();
  const f = fixture(async () => { throw new Error("Unexpected storage read"); }, undefined, async () => {
    controller.abort();
    return "https://storage.invalid/video";
  });
  assert.equal((await f.get(controller.signal, true)).status, 499);
  assert.equal(f.signs(), 1);
});

test("abandoning aggregate proof cancels all three in-flight reads with no retry wave", async () => {
  const controller = new AbortController();
  let reads = 0;
  let cancelled = 0;
  const f = fixture(async (_url, init) => {
    const signal = init!.signal!;
    reads++;
    if (reads === 3) queueMicrotask(() => controller.abort());
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => { cancelled++; reject(signal.reason); }, { once: true });
    });
  });
  assert.equal((await f.get(controller.signal, true)).status, 499);
  assert.equal(reads, 3);
  assert.equal(cancelled, 3);
  assert.equal(f.signs(), 1);
});

test("abandoning retry backoff cancels the real timer and prevents fallback", async () => {
  for (const probe of [false, true]) {
    const controller = new AbortController();
    let reads = 0;
    let bodiesCancelled = 0;
    const f = fixture(async () => {
      reads++;
      return new Response(new ReadableStream({ cancel() { bodiesCancelled++; } }), { status: 404 });
    }, ((ms, value, options) => {
      assert.equal(ms, 1100);
      const waiting = delay(ms, value, options);
      queueMicrotask(() => controller.abort());
      return waiting;
    }) as typeof delay);
    assert.equal((await f.get(controller.signal, probe, probe ? undefined : "bytes=100-200")).status, 499);
    assert.equal(f.signs(), 1);
    assert.equal(reads, probe ? 3 : 1);
    assert.equal(bodiesCancelled, reads);
  }
});

test("active viewers retain range retries and full-source fallback, whose stream stays abortable", async () => {
  const controller = new AbortController();
  const ranges: (string | null)[] = [];
  let storageSignal: AbortSignal | undefined;
  const f = fixture(async (_url, init) => {
    ranges.push(new Headers(init?.headers).get("range"));
    if (ranges.length < 3) return new Response(null, { status: 404 });
    storageSignal = init!.signal!;
    return new Response(new ReadableStream({ start(stream) {
      stream.enqueue(new Uint8Array([1, 2, 3]));
      storageSignal!.addEventListener("abort", () => stream.error(storageSignal!.reason), { once: true });
    } }), { status: 200, headers: { "content-type": "video/mp4", etag: "unchanged-master" } });
  });
  const response = await f.get(controller.signal, false, "bytes=100-200");
  assert.deepEqual(ranges, ["bytes=100-200", "bytes=100-200", null]);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("etag"), "unchanged-master");
  const reader = response.body!.getReader();
  assert.deepEqual((await reader.read()).value, new Uint8Array([1, 2, 3]));
  controller.abort();
  assert.equal(storageSignal!.aborted, true);
  await assert.rejects(reader.read(), { name: "AbortError" });
  assert.equal(f.signs(), 3);
});

test("active proof preserves all three range checks and five-wave failure boundary", async () => {
  for (const status of [206, 200, 404]) {
    const ranges: string[] = [];
    let cancelled = 0;
    const f = fixture(async (_url, init) => {
      ranges.push(new Headers(init?.headers).get("range")!);
      return new Response(new ReadableStream({ cancel() { cancelled++; } }), { status });
    });
    const response = await f.get(new AbortController().signal, true);
    const result = await response.json();
    assert.equal(result.available, status === 206);
    assert.equal(f.signs(), status === 206 ? 1 : 5);
    assert.equal(ranges.length, status === 206 ? 3 : 15);
    assert.equal(cancelled, ranges.length);
    for (let i = 0; i < ranges.length; i += 3) {
      assert.deepEqual(ranges.slice(i, i + 3), ["bytes=0-0", "bytes=0-0", "bytes=1048576-1048576"]);
    }
  }
});

test("real HTTP storage transfer closes when a streaming preview is abandoned", { timeout: 5000 }, async () => {
  let closed!: () => void;
  const storageClosed = new Promise<void>(resolve => { closed = resolve; });
  const server = createServer((_request, response) => {
    response.writeHead(206, { "content-type": "video/mp4", "content-range": "bytes 0-999999/1000000" });
    response.write(Buffer.alloc(1024, 7));
    response.once("close", closed);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const controller = new AbortController();
  try {
    const port = (server.address() as AddressInfo).port;
    const f = fixture(fetch, undefined, async () => `http://127.0.0.1:${port}/master.mp4`);
    const response = await f.get(controller.signal, false, "bytes=0-999999");
    assert.equal(response.status, 206);
    const reader = response.body!.getReader();
    assert.equal((await reader.read()).value!.byteLength, 1024);
    controller.abort();
    await assert.rejects(reader.read(), { name: "AbortError" });
    await storageClosed;
    assert.equal(f.signs(), 1);
  } finally {
    controller.abort();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
