import assert from "node:assert/strict";
import { assertRunPipelineAdmission } from "@/lib/runPipelineAdmission";

const base = {
  runId: "runs:one",
  ownerId: "owner-one",
  channelId: "channels:one",
};

for (const status of ["queued", "running", "failed"]) {
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

console.log("run-pipeline admission tests passed");
