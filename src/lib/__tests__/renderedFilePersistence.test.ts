import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { classifyExecutionError } from "@/engine/executionErrors";

const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
let calls = 0;
let failures = 0;
let failure: unknown = Object.assign(new Error("storage unavailable"), { status: 503 });
async function main() {
  loader._load = function(id, ...args) {
    const actual = originalLoad.call(this, id, ...args);
    if (id === "./storage") return { ...actual as object, putObjectFromFile: async (key: string, path: string, options: unknown) => {
      calls++; assert.equal(key, "fixture/render.mp4"); assert.equal(path, "/fixture/completed.mp4");
      assert.deepEqual(options, { contentType: "video/mp4" });
      if (calls <= failures) throw failure;
      return key;
    }, putObject: async () => { throw new Error("must stream the completed file"); } };
    return actual;
  };
  try {
    const { persistRenderedFile } = createRequire(import.meta.url)("../renderedFilePersistence") as typeof import("../renderedFilePersistence");
    const delays: number[] = [];
    const wait = async (delay: number) => { delays.push(delay); };
    const persist = (beforeAttempt?: () => void) => persistRenderedFile("fixture/render.mp4", "/fixture/completed.mp4",
      { contentType: "video/mp4" }, { wait, beforeAttempt });
    failures = 2;
    assert.equal(await persist(), "fixture/render.mp4");
    assert.equal(calls, 3); assert.deepEqual(delays, [1000, 2000]);
    calls = 0; delays.length = 0; failures = 10;
    await assert.rejects(() => persist(), (error: unknown) => {
      assert.match(String(error), /after 3 storage attempt/);
      assert.equal(classifyExecutionError(error).retryable, false);
      assert.equal((error as Error).cause, failure); return true;
    });
    assert.equal(calls, 3); assert.deepEqual(delays, [1000, 2000]);
    for (const status of [400, 401, 403, 404, 409, 412]) {
      calls = 0; delays.length = 0; failure = Object.assign(new Error("request refused"), { status });
      await assert.rejects(() => persist());
      assert.equal(calls, 1); assert.deepEqual(delays, []);
    }
    calls = 0; delays.length = 0; failure = new Error("unclassified failure");
    await assert.rejects(() => persist()); assert.equal(calls, 1); assert.deepEqual(delays, []);
    calls = 0; failure = Object.assign(new Error("storage unavailable"), { status: 503 });
    let authorityChecks = 0;
    const revoked = new Error("source authority withdrawn");
    await assert.rejects(() => persist(() => { if (++authorityChecks === 2) throw revoked; }), error => error === revoked);
    assert.equal(calls, 1, "a changed authority must prevent the second upload, not be retried");
    assert.equal(authorityChecks, 2);
    calls = 0;
    await assert.rejects(() => persist(() => { throw revoked; }), error => error === revoked);
    assert.equal(calls, 0);
    console.log("RENDERED FILE PERSISTENCE PASS: bounded storage-only retries, streamed file path, deterministic/unknown refusal and per-attempt authority; storage transport synthetic.");
  } finally { loader._load = originalLoad; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
