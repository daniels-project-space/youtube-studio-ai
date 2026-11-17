import assert from "node:assert/strict";
import { clearAcceptedPrivateBenchmark, preparePrivateBenchmark, readPendingPrivateBenchmark } from "../privateBenchmarkRequest";

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
};
let keys = 0;
const next = () => `request-${++keys}`;
const original = preparePrivateBenchmark(storage, "channel-a", 25, next);
assert.deepEqual(readPendingPrivateBenchmark(storage, "channel-a"), original);
assert.deepEqual(preparePrivateBenchmark(storage, "channel-a", 25, next), original);
assert.equal(keys, 1, "reload and retry must not allocate another request");
assert.throws(() => preparePrivateBenchmark(storage, "channel-a", 30, next), /original cost ceiling/);
assert.equal(readPendingPrivateBenchmark(storage, "channel-b"), null);
clearAcceptedPrivateBenchmark(storage, "channel-a", "different-request");
assert.deepEqual(readPendingPrivateBenchmark(storage, "channel-a"), original);
clearAcceptedPrivateBenchmark(storage, "channel-a", original.requestKey);
assert.equal(preparePrivateBenchmark(storage, "channel-a", 30, next).requestKey, "request-2");
values.set("youtube-automation:private-benchmark:channel-a", "invalid");
assert.throws(() => preparePrivateBenchmark(storage, "channel-a", 30, next), /cannot be read/);
assert.throws(() => preparePrivateBenchmark({ ...storage, setItem: () => { throw new Error("unavailable"); } }, "channel-c", 25, next), /unavailable/);
console.log("Private benchmark requests survive reload and retain one cost ceiling until confirmed");
