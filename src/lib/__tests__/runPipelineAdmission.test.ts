import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertFreshPipelineInvocationRouteAdmission,
  assertRunPipelineAdmission,
} from "@/lib/runPipelineAdmission";

const base = {
  runId: "runs:one",
  ownerId: "owner-one",
  channelId: "channels:one",
};

for (const status of [
  "queued",
  "running",
  "failed",
  "awaiting_factual_review",
  "awaiting_reviewed_evidence_dispatch",
  "awaiting_route_qualification_benchmark_dispatch",
]) {
  assert.doesNotThrow(() => assertRunPipelineAdmission({
    ...base,
    run: { _id: base.runId, ownerId: base.ownerId, channelId: base.channelId, status },
  }));
}

assert.throws(
  () => assertRunPipelineAdmission({
    ...base,
    run: { _id: base.runId, ownerId: "owner-two", channelId: base.channelId, status: "queued" },
  }),
  /ownership\/channel mismatch/,
);
assert.throws(
  () => assertRunPipelineAdmission({
    ...base,
    run: { _id: base.runId, ownerId: base.ownerId, channelId: "channels:two", status: "queued" },
  }),
  /ownership\/channel mismatch/,
);
for (const status of ["ok", "canceled", "cancelled"]) {
  assert.throws(
    () => assertRunPipelineAdmission({
      ...base,
      run: { _id: base.runId, ownerId: base.ownerId, channelId: base.channelId, status },
    }),
    /terminal run status/,
  );
}
assert.throws(
  () => assertRunPipelineAdmission({
    ...base,
    run: {
      _id: base.runId,
      ownerId: base.ownerId,
      channelId: base.channelId,
      status: "queued",
      planItemId: "contentPlan:one",
    },
  }),
  /scheduled-plan payload\/run mismatch/,
);
assert.doesNotThrow(() => assertRunPipelineAdmission({
  ...base,
  scheduledPlanItemId: "contentPlan:one",
  run: {
    _id: base.runId,
    ownerId: base.ownerId,
    channelId: base.channelId,
    status: "failed",
    planItemId: "contentPlan:one",
  },
}));

assert.throws(
  () => assertFreshPipelineInvocationRouteAdmission({
    hasDurableInvocation: false,
    programBrief: undefined,
    programRoute: undefined,
  }),
  /fresh pipeline invocation requires a sealed channel program brief and route/,
  "a fresh legacy channel must fail before it can seal or execute a route-less invocation",
);
assert.doesNotThrow(() => assertFreshPipelineInvocationRouteAdmission({
  hasDurableInvocation: true,
  programBrief: undefined,
  programRoute: undefined,
}), "only an already-durable route-less invocation may reach legacy replay handling");
assert.doesNotThrow(() => assertFreshPipelineInvocationRouteAdmission({
  hasDurableInvocation: false,
  programBrief: { sealed: true },
  programRoute: { sealed: true },
}));

const pipelineSource = readFileSync(
  new URL("../../trigger/runPipeline.ts", import.meta.url),
  "utf8",
);
const freshRouteAdmission = pipelineSource.indexOf("assertFreshPipelineInvocationRouteAdmission({");
assert.ok(freshRouteAdmission >= 0, "run-pipeline must invoke the fresh route admission guard");
assert.ok(
  freshRouteAdmission < pipelineSource.indexOf("assertPipelineVideoRuntimeReady(entries, reviewedLtxRuntime?.runtime)"),
  "the fresh route admission guard must run before runtime/provider preflight",
);

console.log("run-pipeline admission tests passed");
