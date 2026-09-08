import assert from "node:assert/strict";
import {
  completedLogSummary,
  isLiveRunStatus,
  runConsoleStartsOpen,
} from "../logConsolePresentation";

assert.equal(isLiveRunStatus("queued"), true);
assert.equal(isLiveRunStatus("running"), true);
assert.equal(isLiveRunStatus("ok"), false);

for (const status of ["queued", "running", "failed", "factual_review_blocked", "route_qualification_benchmark_blocked"]) {
  assert.equal(runConsoleStartsOpen(status), true, `${status} should expose the diagnostic tail immediately`);
}
for (const status of ["ok", "canceled", "awaiting_factual_review", undefined]) {
  assert.equal(runConsoleStartsOpen(status), false, `${String(status)} should begin as a compact receipt`);
}

assert.equal(completedLogSummary({ loading: true, lines: 0, warnings: 0, errors: 0 }), "Reading receipt");
assert.equal(completedLogSummary({ loading: false, lines: 1, warnings: 0, errors: 0 }), "1 line · clean");
assert.equal(completedLogSummary({ loading: false, lines: 92, warnings: 1, errors: 2 }), "92 lines · 1W · 2E");

console.log("Log console presentation contracts passed");
