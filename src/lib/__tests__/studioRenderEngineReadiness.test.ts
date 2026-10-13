import assert from "node:assert/strict";
import { assessStudioEngineRouteReadiness } from "../studioRenderEngineReadiness";

const ready = { profiles: [{ profileId: "yue2", sources: [
  { provider: "openrelay", state: "qualified", dispatchable: true, executorReady: true, blockers: [] },
]}] };
assert.deepEqual(assessStudioEngineRouteReadiness(ready, "yue2", "openrelay"), { ready: true });
assert.deepEqual(assessStudioEngineRouteReadiness({ profiles: [{ profileId: "yue2", sources: [
  { provider: "openrelay", state: "unprepared", dispatchable: false, executorReady: false,
    blockers: ["exact-model-storage-proof-missing"] },
]}] }, "yue2", "openrelay"), {
  ready: false,
  reason: "Render Engine route yue2/openrelay is not dispatch-ready: exact-model-storage-proof-missing",
});
assert.deepEqual(assessStudioEngineRouteReadiness({ profiles: [] }, "yue2", "openrelay"), {
  ready: false, reason: "Render Engine profile yue2 is not registered",
});
assert.throws(() => assessStudioEngineRouteReadiness({}, "yue2", "openrelay"));
console.log("STUDIO RENDER ENGINE READINESS PASS: only the pinned executor-ready route admits; missing route/profile and malformed status fail closed");
