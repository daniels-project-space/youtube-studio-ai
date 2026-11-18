import assert from "node:assert/strict";
import { comparePipelineCandidates } from "../comparePipelineCandidates";

assert.deepEqual(comparePipelineCandidates([{ block: "a", params: { b: 2, a: 1 } }], [{ block: "a", params: { a: 1, b: 2 } }]), []);
assert.deepEqual(comparePipelineCandidates([{ block: "a" }, { block: "a", params: { x: 1 } }, { block: "b" }], [{ block: "b" }, { block: "a", params: { x: 2 } }, { block: "c" }]), [
  { block: "b", occurrence: 1, changes: ["Position changed"] },
  { block: "a", occurrence: 1, changes: ["Position changed", "Settings changed"] },
  { block: "c", occurrence: 1, changes: ["Added"] },
  { block: "a", occurrence: 2, changes: ["Removed"] },
]);
assert.deepEqual(comparePipelineCandidates([{ block: "a", version: "1" }], [{ block: "a", version: "2" }]), [{ block: "a", occurrence: 1, changes: ["Version changed"] }]);
assert.deepEqual(comparePipelineCandidates([{ block: "a" }], [{ block: "a", version: "2" }]), [{ block: "a", occurrence: 1, changes: ["Version resolved"] }]);
console.log("Candidate comparison covers order, repeated modules, versions and settings");
