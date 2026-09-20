import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { test } from "node:test";
import ts from "typescript";
import type { getObjectBytes } from "../storage";

const compiled = ts.transpileModule(readFileSync("src/lib/storage.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

type Response = { Body?: unknown; ContentLength?: unknown };
function fixture(send: (call: number, signal?: AbortSignal) => Promise<Response>, refreshed = true, hooks: {
  refresh?: () => Promise<Record<string, string>>;
  buffer?: typeof Buffer;
} = {}) {
  const state = { calls: 0, clients: 0, destroyedClients: 0, vaultCalls: 0, signals: [] as (AbortSignal | undefined)[] };
  const env: Record<string, string> = {
    R2_ENDPOINT: "https://storage-fixture.invalid", R2_BUCKET: "fixture",
    R2_ACCESS_KEY_ID: "fixture-old", R2_SECRET_ACCESS_KEY: "fixture-secret",
  };
  class Command { constructor(readonly input: unknown) {} }
  class Client {
    constructor() { state.clients++; }
    async send(command: unknown, options?: { abortSignal?: AbortSignal }) {
      assert.ok(command instanceof Command);
      assert.deepEqual(command.input, { Bucket: "fixture", Key: "object" });
      state.signals.push(options?.abortSignal);
      return await send(++state.calls, options?.abortSignal);
    }
    destroy() { state.destroyedClients++; }
  }
  const loaded = { exports: {} as { getObjectBytes: typeof getObjectBytes } };
  const requireFixture = (name: string) => {
    if (name === "@aws-sdk/client-s3") return { S3Client: Client, GetObjectCommand: Command };
    if (name === "@aws-sdk/s3-request-presigner") return {};
    if (name === "@/lib/vault") return { listByService: async (service: string) => {
      assert.equal(service, "cloudflare"); state.vaultCalls++;
      if (hooks.refresh) return await hooks.refresh();
      return refreshed ? { R2_ACCESS_KEY_ID: "fixture-renewed" } : {};
    } };
    throw new Error(`Unexpected fixture import: ${name}`);
  };
  // Execute the complete real helper with only SDK/vault and process environment isolated.
  new Function("require", "module", "exports", "process", "Buffer", compiled)(requireFixture, loaded, loaded.exports, { env }, hooks.buffer ?? Buffer);
  return { read: loaded.exports.getObjectBytes, state, env };
}

function stream(chunks: Uint8Array[], fail?: Error) {
  const counts = { next: 0, returned: 0, destroy: 0, cancel: 0, transform: 0 };
  let index = 0;
  const body = {
    [Symbol.asyncIterator]() { return {
      async next(): Promise<IteratorResult<Uint8Array>> {
        counts.next++;
        if (index < chunks.length) return { done: false, value: chunks[index++]! };
        if (fail) throw fail;
        return { done: true, value: undefined };
      },
      async return(): Promise<IteratorResult<Uint8Array>> { counts.returned++; return { done: true, value: undefined }; },
    }; },
    destroy() { counts.destroy++; },
    async cancel() { counts.cancel++; },
    async transformToByteArray() { counts.transform++; throw new Error("Full-buffer transform forbidden"); },
  };
  return { body, counts };
}

test("bounded reads consume multiple chunks without full-buffer transform", async () => {
  const s = stream([Buffer.from("ab"), Buffer.from("cd")]);
  const f = fixture(async () => ({ Body: s.body, ContentLength: 4 }));
  assert.deepEqual(await f.read("object", undefined, { maxBytes: 4 }), Buffer.from("abcd"));
  assert.equal(s.counts.next, 3);
  assert.equal(s.counts.transform, 0);
  assert.equal(s.counts.destroy, 0);
  assert.equal(f.state.signals[0]?.aborted, false);
});

test("empty and one-byte chunks retain only bounded coalesced slabs", async () => {
  for (const byteCount of [0, 65_537]) {
    const allocations: number[] = [];
    let retainedChunks = -1, copies = 0;
    const buffer = new Proxy(Buffer, { get(target, property) {
      if (property === "allocUnsafeSlow") return (size: number) => {
        allocations.push(size); return Buffer.allocUnsafeSlow(size);
      };
      if (property === "concat") return (chunks: Uint8Array[], length: number) => {
        retainedChunks = chunks.length; return Buffer.concat(chunks, length);
      };
      if (property === "from") return (...args: Parameters<typeof Buffer.from>) => {
        copies++; return Buffer.from(...args);
      };
      return Reflect.get(target, property);
    } });
    const body = { async *[Symbol.asyncIterator]() {
      const empty = new Uint8Array(0), byte = Uint8Array.of(42);
      for (let i = 0; i < Math.max(10_000, byteCount); i++) {
        yield empty;
        if (i < byteCount) yield byte;
        yield empty;
      }
    } };
    const maxBytes = 65_539;
    const f = fixture(async () => ({ Body: body }), true, { buffer });
    assert.deepEqual(await f.read("object", undefined, { maxBytes }), Buffer.alloc(byteCount, 42));
    assert.deepEqual(allocations, byteCount ? [65_536, 3] : []);
    assert.ok(allocations.reduce((a, b) => a + b, 0) <= maxBytes);
    assert.equal(retainedChunks, byteCount ? 2 : 0);
    assert.equal(copies, 0, "transport chunks must not each allocate retained copies");
  }
});

test("bounded deadline releases a stalled vault refresh and forbids a late retry", async () => {
  let release!: (secrets: Record<string, string>) => void;
  const auth = Object.assign(new Error("fixture auth failure"), { $metadata: { httpStatusCode: 403 } });
  const f = fixture(async () => { throw auth; }, true, {
    refresh: () => new Promise((resolve) => { release = resolve; }),
  });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(f.read("object", undefined, { maxBytes: 4, timeoutMs: 20 }), { name: "TimeoutError" });
    assert.equal(f.state.vaultCalls, 1);
    assert.equal(f.state.calls, 1);
    release({ R2_ACCESS_KEY_ID: "fixture-renewed" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(f.env.R2_ACCESS_KEY_ID, "fixture-renewed", "shared refresh may finish after timeout");
    assert.equal(f.state.calls, 1, "expired invocation must never send its retry");
  } finally { clearTimeout(keepAlive); }
});

test("auth retry gets only the remaining invocation deadline", async () => {
  const auth = Object.assign(new Error("fixture auth failure"), { $metadata: { httpStatusCode: 403 } });
  let destroyed = 0;
  const body = {
    async *[Symbol.asyncIterator]() {
      await new Promise((resolve) => setTimeout(resolve, 70));
      yield Buffer.from("ab");
    },
    destroy() { destroyed++; },
  };
  const f = fixture(async (call) => { if (call === 1) throw auth; return { Body: body }; }, true, {
    refresh: async () => {
      await new Promise((resolve) => setTimeout(resolve, 70));
      return { R2_ACCESS_KEY_ID: "fixture-renewed" };
    },
  });
  await assert.rejects(f.read("object", undefined, { maxBytes: 4, timeoutMs: 110 }), { name: "TimeoutError" });
  assert.equal(f.state.calls, 2);
  assert.equal(f.state.signals[1]?.aborted, true);
  assert.equal(destroyed, 1);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(f.state.calls, 2);
});

test("immediately resolved empty chunks cannot starve the absolute deadline", async () => {
  let destroyed = 0;
  const body = {
    async *[Symbol.asyncIterator]() { while (true) yield new Uint8Array(0); },
    destroy() { destroyed++; },
  };
  const f = fixture(async () => ({ Body: body }));
  await assert.rejects(f.read("object", undefined, { maxBytes: 4, timeoutMs: 10 }), { name: "TimeoutError" });
  assert.equal(destroyed, 1);
  assert.equal(f.state.signals[0]?.aborted, true);
});

test("invalid maxBytes fails before SDK construction or credential lookup", async () => {
  const f = fixture(async () => { throw new Error("Must not send"); });
  for (const maxBytes of [0, -1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "4", null]) {
    await assert.rejects(f.read("object", undefined, { maxBytes: maxBytes as number }), /positive safe integer/);
  }
  assert.equal(f.state.clients, 0);
  assert.equal(f.state.calls, 0);
  assert.equal(f.state.vaultCalls, 0);
});

test("invalid and oversized headers reject before any body consumption", async () => {
  for (const ContentLength of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "2", null, 5]) {
    const s = stream([Buffer.from("ab")]);
    const f = fixture(async () => ({ Body: s.body, ContentLength }));
    await assert.rejects(f.read("object", undefined, { maxBytes: 4 }),
      ContentLength === 5 ? { name: "ObjectSizeLimitError", message: "R2 object exceeds maxBytes" } : /ContentLength/);
    assert.equal(s.counts.next, 0);
    assert.equal(s.counts.transform, 0);
    assert.equal(s.counts.destroy, 1);
    assert.equal(s.counts.cancel, 1);
    assert.equal(f.state.signals[0]?.aborted, true);
    assert.equal(f.state.vaultCalls, 0);
  }
});

test("headerless overrun stops immediately, aborts and releases stream", async () => {
  const s = stream([Buffer.from("ab"), Buffer.from("cde"), Buffer.from("unused")]);
  const f = fixture(async () => ({ Body: s.body }));
  await assert.rejects(f.read("object", undefined, { maxBytes: 4 }), { name: "ObjectSizeLimitError", message: "R2 object exceeds maxBytes" });
  assert.equal(s.counts.next, 2);
  assert.equal(s.counts.returned, 1);
  assert.equal(s.counts.destroy, 1);
  assert.equal(s.counts.cancel, 1);
  assert.equal(f.state.signals[0]?.aborted, true);
});

test("declared length must match actual bytes, including zero and early overflow", async () => {
  for (const ContentLength of [0, 1, 3]) {
    const s = stream([Buffer.from("ab")]);
    const f = fixture(async () => ({ Body: s.body, ContentLength }));
    await assert.rejects(f.read("object", undefined, { maxBytes: 4 }), /ContentLength mismatch/);
    assert.equal(s.counts.destroy, 1);
  }
  for (const ContentLength of [0, undefined]) {
    const f = fixture(async () => ({ Body: stream([]).body, ContentLength }));
    assert.equal((await f.read("object", undefined, { maxBytes: 1 })).byteLength, 0);
  }
});

test("late chunk timeout releases caller without waiting for iterator close", async () => {
  let release!: (value: IteratorResult<Uint8Array>) => void;
  let destroys = 0, returns = 0, reads = 0;
  const body = {
    [Symbol.asyncIterator]() { return {
      next() { reads++; return new Promise<IteratorResult<Uint8Array>>((resolve) => { release = resolve; }); },
      return() { returns++; return new Promise<IteratorResult<Uint8Array>>(() => {}); },
    }; },
    destroy() { destroys++; },
  };
  const f = fixture(async () => ({ Body: body }));
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(f.read("object", undefined, { timeoutMs: 10, maxBytes: 4 }), { name: "TimeoutError" });
    assert.equal(destroys, 1);
    assert.equal(returns, 1);
    assert.equal(f.state.signals[0]?.aborted, true);
    release({ done: false, value: Buffer.from("ab") });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(reads, 1, "late bytes cannot continue reading after timeout");
  } finally { clearTimeout(keepAlive); }
});

test("late SDK response after timeout is also destroyed", async () => {
  let release!: (value: Response) => void;
  const s = stream([]);
  const f = fixture(async () => await new Promise<Response>((resolve) => { release = resolve; }));
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(f.read("object", undefined, { timeoutMs: 10, maxBytes: 4 }), { name: "TimeoutError" });
    release({ Body: s.body });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(s.counts.destroy, 1);
    assert.equal(s.counts.next, 0);
  } finally { clearTimeout(keepAlive); }
});

test("stream errors abort without refreshing credentials or consuming further", async () => {
  const error = new Error("synthetic stream failure");
  const s = stream([Buffer.from("ab")], error);
  const f = fixture(async () => ({ Body: s.body }));
  await assert.rejects(f.read("object", undefined, { maxBytes: 4 }), (actual) => actual === error);
  assert.equal(s.counts.destroy, 1);
  assert.equal(f.state.vaultCalls, 0);
  assert.equal(f.state.calls, 1);
});

test("actual Node and SDK web-stream bodies are read incrementally", async () => {
  const node = fixture(async () => ({ Body: Readable.from([Buffer.from("ab"), Buffer.from("cd")]) }));
  assert.deepEqual(await node.read("object", undefined, { maxBytes: 4 }), Buffer.from("abcd"));
  const web = fixture(async () => ({ Body: { transformToWebStream: () => new ReadableStream({
    start(controller) { controller.enqueue(Buffer.from("ab")); controller.enqueue(Buffer.from("cd")); controller.close(); },
  }) } }));
  assert.deepEqual(await web.read("object", undefined, { maxBytes: 4 }), Buffer.from("abcd"));
});

test("unbounded calls preserve full transform and ignore inconsistent headers", async () => {
  let transformed = 0;
  const bytes = Uint8Array.from([1, 2, 3]);
  const f = fixture(async () => ({ ContentLength: -1, Body: { transformToByteArray: async () => { transformed++; return bytes; } } }));
  assert.equal(await f.read("object"), bytes);
  assert.equal(f.state.signals[0], undefined);
  assert.equal(await f.read("object", undefined, { timeoutMs: 1000 }), bytes);
  assert.equal(transformed, 2);
});

test("web reader timeout cancels the underlying source even with a pending read", async () => {
  for (const sdkWrapper of [false, true]) {
    let cancelled = 0;
    const web = new ReadableStream<Uint8Array>({ cancel() { cancelled++; } });
    const f = fixture(async () => ({ Body: sdkWrapper ? { transformToWebStream: () => web } : web }));
    const keepAlive = setTimeout(() => {}, 1000);
    try {
      await assert.rejects(f.read("object", undefined, { timeoutMs: 10, maxBytes: 4 }), { name: "TimeoutError" });
      assert.equal(cancelled, 1);
      assert.equal(web.locked, false);
    } finally { clearTimeout(keepAlive); }
  }
});

test("unbounded timeout retains cancellation behavior", async () => {
  let destroyed = 0, cancelled = 0;
  const f = fixture(async () => ({ Body: {
    transformToByteArray: () => new Promise<Uint8Array>(() => {}),
    destroy() { destroyed++; }, cancel() { cancelled++; },
  } }));
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(f.read("object", undefined, { timeoutMs: 10 }), { name: "TimeoutError" });
    assert.equal(destroyed, 1); assert.equal(cancelled, 1);
  } finally { clearTimeout(keepAlive); }
});

test("bounded and unbounded reads preserve one credential-refresh retry", async () => {
  for (const maxBytes of [undefined, 4]) {
    const auth = Object.assign(new Error("fixture auth failure"), { $metadata: { httpStatusCode: 403 } });
    const body = { ...stream([Buffer.from("ab")]).body, transformToByteArray: async () => Buffer.from("ab") };
    const f = fixture(async (call) => { if (call === 1) throw auth; return { Body: body }; });
    assert.deepEqual(await f.read("object", undefined, { maxBytes }), Buffer.from("ab"));
    assert.equal(f.state.calls, 2); assert.equal(f.state.vaultCalls, 1);
    assert.equal(f.state.clients, 2); assert.equal(f.state.destroyedClients, 1);
    assert.equal(f.env.R2_ACCESS_KEY_ID, "fixture-renewed");
    const unchanged = fixture(async () => { throw auth; }, false);
    await assert.rejects(unchanged.read("object", undefined, { maxBytes }), (error) => error === auth);
    assert.equal(unchanged.state.calls, 1); assert.equal(unchanged.state.vaultCalls, 1);
    const stillDenied = fixture(async () => { throw auth; });
    await assert.rejects(stillDenied.read("object", undefined, { maxBytes }), (error) => error === auth);
    assert.equal(stillDenied.state.calls, 2); assert.equal(stillDenied.state.vaultCalls, 1);
  }
});
