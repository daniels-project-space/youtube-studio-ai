import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalJson } from "@/lib/canonicalJson";
import { yue2Sha256 } from "@/lib/yue2Evaluation";

const load = createRequire(__filename);
const fixture = JSON.parse(readFileSync("test-fixtures/music-composer/seaside-after/gpu-material.json", "utf8"));
const arrangement = fixture.request.acceptedArrangement;
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };

function arrangementWithRole(role: string) {
  const body = { ...arrangement,
    arrangement: { ...arrangement.arrangement, role },
    musicIntent: { ...arrangement.musicIntent, role },
  };
  delete body.fingerprint;
  const normalized = JSON.parse(JSON.stringify(body));
  return { ...normalized, fingerprint: yue2Sha256(canonicalJson(normalized)) };
}

test("YuE2 preflight failures are not treated as paid jobs, and unqualified jobs are not polled", async () => {
  const originalLoad = loader._load;
  const previousSecret = process.env.MANAGEMENT_PROJECT_SECRET;
  const calls = { verify: 0, provision: 0, stage: 0, status: 0, output: 0, wait: 0 };
  let bootstrapCalls = 0;
  let route: unknown;
  let inputArrangement: unknown = arrangement;
  let failVerification = true;
  process.env.MANAGEMENT_PROJECT_SECRET = "s".repeat(64);

  loader._load = function (id, ...args) {
    if (id === "@/lib/bootstrap") return { bootstrapSecrets: async (_log: unknown, options: unknown) => {
      bootstrapCalls++;
      assert.deepEqual(options, { services: ["cloudflare", "render-engine"],
        required: ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "MANAGEMENT_PROJECT_SECRET"] });
    } };
    if (id === "@/lib/renderEngineYuE2StageClient") return {
      verifyRenderEngineYuE2ProjectIntegration: async () => {
        calls.verify++;
        if (failVerification) throw new Error("contract mismatch");
      },
      provisionRenderEngineYuE2Workflow: async () => { calls.provision++; return {
        workflowId: "a".repeat(32), profileRevisionSha256: "d".repeat(64),
      }; },
      stageRenderEngineYuE2Request: async () => { calls.stage++; return {
        jobId: "b".repeat(32), state: "awaiting-final-qualification", manifestSha256: "c".repeat(64),
        dispatchEnabled: false, output: { bucket: "studio-output", key: "projects/studio/jobs/audio.wav",
          receiptKey: "projects/studio/jobs/yue2.receipt.json" },
      }; },
      getRenderEngineYuE2Job: async () => { calls.status++; throw new Error("must not poll an undispatched job"); },
      getRenderEngineYuE2Output: async () => { calls.output++; throw new Error("must not read absent output"); },
      assertRenderEngineYuE2StageReplay: (original: unknown) => original,
    };
    if (id === "@trigger.dev/sdk/v3") return { wait: { for: async () => { calls.wait++; throw new Error("must not wait for unqualified dispatch"); } } };
    if (id === "@/lib/renderEngineYuE2Candidate") return { materializeRenderEngineYuE2Candidate: async () => {
      throw new Error("must not materialize absent output");
    } };
    if (id === "./blockContext") return {
      musicProgramForCurrentRoute: () => undefined,
      channelProgramRouteFromContext: () => route,
    };
    return originalLoad.call(this, id, ...args);
  };

  try {
    const { createRenderEngineYuE2MusicManifest } = load("../yue2MusicEngine") as typeof import("../yue2MusicEngine");
    const run = createRenderEngineYuE2MusicManifest().block.run!;
    const runBlock = () => run({
      ownerId: arrangement.ownerId, channelId: arrangement.channelId, runId: arrangement.runId,
      keyPrefix: `owner/${arrangement.ownerId}/`,
      params: {
        seed: 42, personalCreatorAcknowledged: true, maxCostUsd: 0.04,
        executionPolicy: { schema_version: 1, provider: "openrelay", allocation_basis: "supervised_dispatch_wall_time",
          rate_source: "operator_configured", rate_reference: "test-only", runtime_id: "fixture",
          hourly_rate_usd_micros: 180000, max_execution_seconds: 600, termination_grace_seconds: 10,
          reserved_allocation_usd_micros: 30500 },
      },
      budgetUsd: 1, stageBudgetUsd: 0.04, assertInlinePaidExecutionLease: async () => {},
      store: { topic: arrangement.topic, acceptedMusicArrangement: inputArrangement }, log: () => {},
    } as never).then(() => null, caught => caught);

    const preflightError = await runBlock();
    assert.equal(preflightError?.code, "RENDER_ENGINE_PROJECT_INTEGRATION_REQUIRED");
    assert.equal(preflightError?.phase, "preflight");
    assert.match(preflightError?.message ?? "", /no workflow or music job was created/i);
    assert.deepEqual(calls, { verify: 1, provision: 0, stage: 0, status: 0, output: 0, wait: 0 });

    Object.assign(calls, { verify: 0, provision: 0, stage: 0, status: 0, output: 0, wait: 0 });
    failVerification = false;
    const error = await runBlock();

    assert.equal(error?.code, "RENDER_ENGINE_YUE2_FINAL_QUALIFICATION_PENDING");
    assert.match(error?.message ?? "", /b{32}/);
    assert.deepEqual(calls, { verify: 1, provision: 1, stage: 1, status: 0, output: 0, wait: 0 });

    const soundRoutes = [
      { family: "narrated_stock", contentLaneKey: "background_music", role: "narration_bed" },
      { family: "sleep", contentLaneKey: "ambient_guided", role: "sleep_sound_bed" },
      { family: "meditation", contentLaneKey: "meditation", role: "meditation_bed" },
    ] as const;
    failVerification = false;
    for (const soundRoute of soundRoutes) {
      Object.assign(calls, { verify: 0, provision: 0, stage: 0, status: 0, output: 0, wait: 0 });
      bootstrapCalls = 0;
      route = { family: soundRoute.family, contentLaneKey: soundRoute.contentLaneKey, requiredBlocks: [] };
      inputArrangement = arrangementWithRole(soundRoute.role);
      const staged = await runBlock();
      assert.equal(staged?.code, "RENDER_ENGINE_YUE2_FINAL_QUALIFICATION_PENDING",
        `${soundRoute.contentLaneKey} reaches the shared YuE2 route and remains held before dispatch`);
      assert.equal(bootstrapCalls, 1);
      assert.deepEqual(calls, { verify: 1, provision: 1, stage: 1, status: 0, output: 0, wait: 0 },
        `${soundRoute.contentLaneKey} stages exactly once and does not poll or render before qualification`);
    }
  } finally {
    loader._load = originalLoad;
    if (previousSecret === undefined) delete process.env.MANAGEMENT_PROJECT_SECRET;
    else process.env.MANAGEMENT_PROJECT_SECRET = previousSecret;
  }
});
