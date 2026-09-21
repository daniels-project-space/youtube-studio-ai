import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convexToJson } from "convex/values";
import { getAcceptedMusicArrangement } from "../../../convex/runStages";
import { runAcceptedMusicArrangementHandoffTests } from "../../trigger/blocks/__tests__/acceptedMusicArrangementHandoff.test";
import { createYuE2AcceptedArrangementRequest, YUE2_MANIFEST, YUE2_QUALIFICATION,
  YUE2_RUNTIME_MANIFEST_SHA256, YUE2_WORKER_CONTRACT } from "../yue2Evaluation";
import { createAcceptedMusicArrangement } from "../../engine/acceptedMusicArrangement";

async function main() {
  // These are actual composer/compiler/runner/planner outputs. Only its text
  // transport is synthetic; the saved-run handoff must not rebuild the brief.
  const arrangements = await runAcceptedMusicArrangementHandoffTests();
  let selected = arrangements[0];
  type Row = Record<string, unknown>;
  let run: Row, channel: Row, stages: Row[];
  let owner = selected.ownerId, role = "service", authenticated = true;
  let queryCalls = 0, stageReads = 0, networkCalls = 0;
  const reset = () => {
    owner = selected.ownerId; role = "service"; authenticated = true;
    run = { _id: selected.runId, ownerId: selected.ownerId, channelId: selected.channelId };
    channel = { _id: selected.channelId, ownerId: selected.ownerId };
    stages = [{ ownerId: selected.ownerId, runId: selected.runId, block: "music_arrangement_plan", status: "ok",
      inputs: { privateUnrelatedInput: "must not be returned" },
      outputs: { acceptedMusicArrangement: selected, otherOutput: "must not be returned" } }];
  };
  reset();
  const ctx = {
    auth: { getUserIdentity: async () => authenticated ? {
      role, owner_id: owner, subject: role === "owner" ? owner : role === "viewer" ? `viewer:${owner}` : "fixture-service",
    } : null },
    db: {
      normalizeId: (_table: string, id: string) => id,
      get: async (id: string) => id === selected.runId ? run : id === selected.channelId ? channel : null,
      query: (table: string) => {
        assert.equal(table, "runStages"); stageReads++;
        return { withIndex: (index: string, build: (range: unknown) => unknown) => {
          assert.equal(index, "by_run_block");
          const filters: unknown[] = [];
          const range = { eq: (key: string, value: unknown) => { filters.push([key, value]); return range; } };
          build(range);
          assert.deepEqual(filters, [["runId", selected.runId], ["block", "music_arrangement_plan"]]);
          return { take: async (limit: number) => { assert.equal(limit, 2); return stages.slice(0, limit); } };
        } };
      },
    },
  };
  const invoke = (args: unknown) => (getAcceptedMusicArrangement as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
  })._handler(ctx, args);
  const originalFetch = globalThis.fetch, originalLog = console.log;
  const originalKey = process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY, originalOwner = process.env.STUDIO_OWNER_ID;
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  process.env.STUDIO_OWNER_ID = selected.ownerId;
  const output: string[] = [];
  let workerEnabled = false, workerPosts = 0;
  let savedJob: ReturnType<typeof createYuE2AcceptedArrangementRequest>["job"] | undefined;
  globalThis.fetch = async (url, init) => {
    if (workerEnabled && String(url).startsWith("https://saved-run-worker.invalid/")) {
      const path = new URL(String(url)).pathname;
      if (path === "/v1/health") return Response.json({
        contract: YUE2_WORKER_CONTRACT, manifest: YUE2_MANIFEST, manifest_sha256: YUE2_RUNTIME_MANIFEST_SHA256,
        qualification: YUE2_QUALIFICATION, queue_capacity: 1, worker_state: "ready", error: null,
        readiness_scope: "queue_idle_only_not_gpu_qualification",
      });
      const expected = createYuE2AcceptedArrangementRequest({ arrangement: selected, seed: 42, personalCreatorAcknowledged: true });
      if (init?.method === "POST") {
        assert.equal(path, "/v1/jobs"); workerPosts++;
        savedJob = JSON.parse(String(init.body)); assert.deepEqual(savedJob, expected.job);
      } else assert.equal(path, `/v1/jobs/${expected.job.job_id}`);
      return savedJob ? Response.json({ contract: YUE2_WORKER_CONTRACT, job_id: savedJob.job_id, job: savedJob, state: "accepted" })
        : Response.json({ contract: YUE2_WORKER_CONTRACT, state: "refused", error: "job_not_found" }, { status: 404 });
    }
    if (String(url) !== "https://saved-run-fixture.convex.cloud/api/query") {
      networkCalls++; throw new Error("external transport forbidden");
    }
    queryCalls++;
    assert.equal(init?.cache, "no-store"); assert.equal(init?.signal?.aborted, false);
    assert.equal(init?.method, "POST");
    const bearer = new Headers(init?.headers).get("Authorization")!;
    assert.match(bearer, /^Bearer /);
    const [header, payload, signature] = bearer.slice(7).split(".");
    assert(verify("sha256", Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")));
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    assert.equal(claims.role, "service"); assert.equal(claims.owner_id, selected.ownerId);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.path, "runStages:getAcceptedMusicArrangement");
    return Response.json({ status: "success", value: convexToJson(await invoke(body.args[0]) as never) });
  };
  console.log = (value: unknown) => { output.push(String(value)); };
  try {
    const { runYuE2EvaluationCli } = await import("../../scripts/evaluate-yue2-music");
    const environment = { NEXT_PUBLIC_CONVEX_URL: "https://saved-run-fixture.convex.cloud" };
    const args = () => ["--run-id", selected.runId, "--owner-id", selected.ownerId, "--seed", "42", "--personal-creator"];
    for (selected of arrangements) {
      reset();
      await runYuE2EvaluationCli([...args(), "--durable-r2"], environment);
      const result = JSON.parse(output.at(-1)!);
      assert.deepEqual(result.request, createYuE2AcceptedArrangementRequest({ arrangement: selected, seed: 42, personalCreatorAcknowledged: true }));
      assert.equal(result.source, "accepted_studio_run");
      assert.equal(result.networkRequests, 1); assert.equal(result.workerRequests, 0);
      assert.equal(result.qualification.production_approved, false);
      assert.equal(result.request.acceptedArrangement.fingerprint, selected.fingerprint);
      assert.doesNotMatch(output.at(-1)!, /privateUnrelatedInput|otherOutput/);
    }
    for (const patch of [
      () => { authenticated = false; }, () => { role = "viewer"; }, () => { role = "owner"; },
      () => { owner = "foreign"; }, () => { run.ownerId = "foreign"; }, () => { channel.ownerId = "foreign"; },
    ]) {
      reset(); patch(); const before = stageReads;
      await assert.rejects(runYuE2EvaluationCli(args(), environment));
      assert.equal(stageReads, before, "authorization and scope checks precede stage reads");
    }
    for (const patch of [
      () => { stages = []; }, () => { stages.push(structuredClone(stages[0])); },
      ...["running", "failed", "superseded", "skipped"].map(status => () => { stages[0].status = status; }),
      () => { stages[0].ownerId = "foreign"; }, () => { stages[0].outputs = {}; },
      () => { stages[0].outputs = { acceptedMusicArrangement: { oversized: "x".repeat(256 * 1024) } }; },
      () => { stages[0].outputs = { acceptedMusicArrangement: { ...selected, fingerprint: "0".repeat(64) } }; },
      () => { stages[0].outputs = { acceptedMusicArrangement: createAcceptedMusicArrangement({
        ...selected, channelId: "foreign-channel", sourceBrief: {}, arrangement: selected.arrangement,
      }) }; },
    ]) {
      reset(); patch(); await assert.rejects(runYuE2EvaluationCli(args(), environment));
    }
    reset();
    const before = queryCalls;
    for (const extra of [["--arrangement", "not-read.json"], ["--program", "not-read.json"],
      ["--style-file", "not-read.txt"], ["--recover-only"], ["--out", "unused", "--durable-r2"]]) {
      await assert.rejects(runYuE2EvaluationCli([...args(), ...extra], environment));
    }
    for (const invalid of [
      ["--run-id", selected.runId], ["--owner-id", selected.ownerId],
      args().map(value => value === selected.runId ? "../unsafe" : value),
      args().map(value => value === "42" ? "9007199254740992" : value),
      args().filter(value => value !== "--personal-creator"),
    ]) await assert.rejects(runYuE2EvaluationCli(invalid, environment));
    assert.equal(queryCalls, before, "invalid modes, identifiers, seed and acknowledgement fail before Convex");
    assert.equal(networkCalls, 0, "no worker, R2, bootstrap or paid requests in saved-run validation");
    const directory = await mkdtemp(join(tmpdir(), "saved-run-yue-"));
    workerEnabled = true;
    try {
      const submitArgs = [...args(), "--out", directory, "--submit"];
      const workerEnv = { ...environment, YUE2_EVALUATION_URL: "https://saved-run-worker.invalid",
        YUE2_EVALUATION_TOKEN: "fixture-only-never-a-real-secret-123456789" };
      await runYuE2EvaluationCli(submitArgs, workerEnv);
      assert.equal(JSON.parse(output.at(-1)!).status, "pending");
      assert.equal(workerPosts, 1);
      await runYuE2EvaluationCli([...submitArgs, "--recover-only"], workerEnv);
      assert.equal(workerPosts, 1, "saved-run recovery preserves the exact job without another POST");
      savedJob = undefined;
      await assert.rejects(runYuE2EvaluationCli(submitArgs, workerEnv), /submission_refused/);
      assert.equal(workerPosts, 1, "a lost worker record does not erase the local submission marker");
    } finally { await rm(directory, { recursive: true, force: true }); }
    assert.equal(networkCalls, 0);
    originalLog(`SAVED RUN MUSIC HANDOFF PASS: ${arrangements.length} real module outputs preserved through authenticated query and CLI; scope, corruption and pre-I/O refusals pass`);
  } finally {
    globalThis.fetch = originalFetch; console.log = originalLog;
    if (originalKey === undefined) delete process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY;
    else process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = originalKey;
    if (originalOwner === undefined) delete process.env.STUDIO_OWNER_ID;
    else process.env.STUDIO_OWNER_ID = originalOwner;
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
