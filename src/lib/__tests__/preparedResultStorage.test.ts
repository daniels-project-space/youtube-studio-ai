import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { mock } from "node:test";
import { sha256BytesHex } from "../sha256";

const body = Buffer.from("complete output without regeneration");
const objects = new Map<string, Uint8Array>();
let puts = 0, reads = 0;
let mode = "ok";
let late: () => void = () => {};
const absent = () => Object.assign(new Error("missing"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
const transient = () => Object.assign(new Error("unavailable"), { $metadata: { httpStatusCode: 503 } });
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function(id, ...args) {
  if (id === "@/lib/storage") return {
    putObject: async (key: string, bytes: Uint8Array, options: { ifNoneMatch: string; metadata: { sha256: string; fixture: string } }) => {
      puts++;
      assert.equal(options.ifNoneMatch, "*");
      assert.deepEqual(bytes, body);
      assert.equal(options.metadata.sha256, sha256BytesHex(body));
      assert.equal(options.metadata.fixture, "v1");
      if (mode === "late") return new Promise(resolve => { late = () => { objects.set(key, bytes); resolve(key); }; });
      if (objects.has(key)) throw Object.assign(new Error("conflict"), { $metadata: { httpStatusCode: 412 } });
      if (mode === "transient" || mode === "unknown-read" || (mode === "once" && puts === 1)) throw transient();
      if (mode === "denied") throw Object.assign(new Error("denied"), { $metadata: { httpStatusCode: 403 } });
      if (mode === "unknown") throw new Error("unclassified failure");
      objects.set(key, bytes);
      if (mode === "lost") throw transient();
      return key;
    },
    getObjectBytes: async (key: string, _bucket: unknown, options: { maxBytes: number; timeoutMs: number }) => {
      reads++;
      assert.equal(options.maxBytes, body.byteLength);
      assert.ok(options.timeoutMs > 0 && options.timeoutMs <= 300_000);
      if (mode === "unknown-read") throw Object.assign(new Error("missing bucket"), { name: "NoSuchBucket", $metadata: { httpStatusCode: 404 } });
      if (!objects.has(key)) throw absent();
      return objects.get(key)!;
    },
  };
  return originalLoad.call(this, id, ...args);
};

async function main() {
  const { persistPreparedResult } = createRequire(import.meta.url)("../preparedResultStorage") as typeof import("../preparedResultStorage");
  const reset = (next: string) => { mode = next; puts = 0; reads = 0; objects.clear(); };
  const persist = (key = "result.json", type = "application/json") => persistPreparedResult(key, body, type, { fixture: "v1" });
  await persist(); assert.equal(puts, 1); assert.equal(reads, 0, "healthy writes do not download media");
  reset("lost"); await persist(); assert.equal(puts, 1); assert.equal(reads, 1);
  reset("once"); await persist(); assert.equal(puts, 2); assert.equal(reads, 1);
  reset("ok"); objects.set("result.json", body); await persist(); assert.equal(puts, 1); assert.equal(reads, 1);
  for (const bytes of [Buffer.alloc(body.length, 1), body.subarray(1)]) {
    reset("ok"); objects.set("result.json", bytes);
    await assert.rejects(persist, /RECONCILIATION_REQUIRED/);
    assert.equal(puts, 1); assert.equal(objects.get("result.json"), bytes);
  }
  for (const failure of ["denied", "unknown", "unknown-read", "transient"]) {
    reset(failure); await assert.rejects(persist);
    assert.equal(puts, failure === "transient" ? 3 : 1);
    assert.equal(reads, puts);
  }
  reset("ok"); await assert.rejects(() => persist("result.json.dispatch.json"), /claims/);
  assert.equal(puts, 0); assert.equal(reads, 0);
  for (const [type, limit] of [["application/json", 30_000], ["audio/mpeg", 300_000]] as const) {
    reset("late");
    mock.timers.enable({ apis: ["setTimeout"] });
    const pending = assert.rejects(() => persist("result.json", type), /deadline/);
    mock.timers.tick(limit);
    await pending;
    assert.equal(puts, 1); assert.equal(reads, 0);
    late(); await Promise.resolve();
    assert.deepEqual(objects.get("result.json"), body);
    mock.timers.reset();
  }
  console.log("PREPARED RESULT STORAGE PASS: healthy zero-read, same-byte recovery, three-attempt cap, strict absence, conflicts, claim refusal, JSON/media late-write deadlines");
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  mock.timers.reset(); loader._load = originalLoad;
});
