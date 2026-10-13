import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { RENDER_ENGINE_STUDIO_PROJECT_NAME } from "@/lib/renderEngineStudioProject";
import {
  getRenderEngineYuE2Job,
  getRenderEngineYuE2Output,
  provisionRenderEngineYuE2Workflow,
  RenderEngineYuE2RequestSchema,
  stageRenderEngineYuE2Request,
  type RenderEngineYuE2Config,
  type RenderEngineYuE2Request,
  verifyRenderEngineYuE2ProjectIntegration,
} from "@/lib/renderEngineYuE2StageClient";

const jobId = "jd75yszsg3yt0nrgr2g43brtdd8f6f6t";
const revision = "a".repeat(64);
const score = "X:1\nT:Night Rain\nM:4/4\nL:1/8\nK:C\nCDEF GABc|";
const request: RenderEngineYuE2Request = {
  version: 2,
  idempotencyKey: "youtube-studio:channel-1:run-1:music",
  sourceId: "channel-1:run-1:music",
  profileRevisionSha256: revision,
  lyrics: "",
  style: "Instrumental ambient lo-fi, warm felt piano and soft brushed percussion",
  seed: 42,
  maxAudioSeconds: 240,
  maxCostUsd: 0.9,
  abc: score,
  abcSha256: createHash("sha256").update(score, "utf8").digest("hex"),
  sourceConstraints: { provider: "openrelay", gpuModel: "RTX 3090", maxCostUsd: 0.9, maxExecutionSeconds: 1200 },
  output: { contentType: "audio/wav", sampleRateHz: 48_000, channels: 2, sampleFormat: "float32" },
};
const projectName = RENDER_ENGINE_STUDIO_PROJECT_NAME;
const config: RenderEngineYuE2Config = {
  baseUrl: "https://render-engine-sable.vercel.app",
  projectName,
  projectCapability: "b".repeat(64),
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const nativeArtifactReads = [
  ["score.abc", "text/vnd.abc"], ["semantic.npy", "application/octet-stream"], ["latent.npy", "application/octet-stream"],
  ["request.json", "application/json"], ["config.json", "application/json"], ["result.json", "application/json"],
].map(([name, contentType]) => ({ name, contentType, key: `projects/${projectName}/jobs/${jobId}/native/${name}`,
  bytes: 32, sha256: "f".repeat(64), url: `https://studio-render-output.r2.cloudflarestorage.com/${name}`,
  readHeaders: { "If-Match": `\"etag-${name}\"` }, expiresInSeconds: 3600 }));

test("verifies the authenticated project, output binding, and YuE2 route before provisioning", async () => {
  let requestUrl: URL | undefined;
  let authorization: string | null = null;
  const fetchImpl: typeof fetch = async (input, init) => {
    requestUrl = new URL(String(input));
    authorization = new Headers(init?.headers).get("authorization");
    return response({ projectId: jobId, output: { bucket: "studio-render-output", prefix: `projects/${projectName}/` },
      endpoints: { yue2MusicJob: `/api/v1/projects/${projectName}/yue2-jobs` } });
  };
  await verifyRenderEngineYuE2ProjectIntegration({ ...config, fetchImpl });
  assert.equal(requestUrl?.pathname, `/api/v1/projects/${projectName}/integration`);
  assert.equal(requestUrl?.searchParams.get("projectName"), null);
  assert.equal(authorization, `Bearer ${config.projectCapability}`);
});

test("fails the integration handshake on unauthorized credentials before workflow creation", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return new Response("Unauthorized", { status: 401, headers: { "content-type": "text/plain" } });
  };
  await assert.rejects(verifyRenderEngineYuE2ProjectIntegration({ ...config, fetchImpl }), /handshake failed \(HTTP 401\)/);
  assert.equal(calls, 1);
});

test("provisions and stages only the pinned Studio YuE2 project workflow", async () => {
  const posted: Array<{ url: string; body: unknown; authorization: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body));
    posted.push({ url, body, authorization: new Headers(init?.headers).get("authorization") });
    if (url.endsWith(`/projects/${projectName}/workflows`)) return response({ workflowId: jobId, profileRevisionSha256: revision });
    return response({ jobId, state: "awaiting-final-qualification", manifestSha256: "c".repeat(64), dispatchEnabled: false,
      output: { bucket: "studio-render-output", key: `projects/${projectName}/jobs/${jobId}/audio.wav`, receiptKey: `projects/${projectName}/jobs/${jobId}/yue2.receipt.json` } }, 202);
  };
  const workflow = await provisionRenderEngineYuE2Workflow({ ...config, fetchImpl });
  assert.deepEqual(posted[0]?.body, { projectName: config.projectName, workflowName: "youtube-studio-yue2-scored-source-v2", profileId: "yue2" });
  assert.deepEqual(workflow, { workflowId: jobId, profileRevisionSha256: revision });
  const staged = await stageRenderEngineYuE2Request({ ...config, ...workflow, fetchImpl, request });
  assert.equal(staged.jobId, jobId);
  assert.equal(staged.dispatchEnabled, false);
  assert.equal(posted[1]?.url, `https://render-engine-sable.vercel.app/api/v1/projects/${projectName}/yue2-jobs`);
  assert.equal(posted[1]?.authorization, `Bearer ${config.projectCapability}`);
  assert.deepEqual(posted[1]?.body, { projectName: config.projectName, workflowId: jobId, request });
});

test("rejects score, profile, cost, and project-scope mismatches before dispatch", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls += 1; return response({}); };
  assert.throws(() => RenderEngineYuE2RequestSchema.parse({ ...request, lyrics: "unexpected lyrics" }), /Instrumental score jobs cannot include lyrics/);
  assert.throws(() => RenderEngineYuE2RequestSchema.parse({ ...request, abcSha256: "d".repeat(64) }), /Accepted score digest/);
  await assert.rejects(stageRenderEngineYuE2Request({ ...config, workflowId: jobId, profileRevisionSha256: "d".repeat(64), fetchImpl, request }), /profile revision/);
  await assert.rejects(stageRenderEngineYuE2Request({ ...config, workflowId: "bad", profileRevisionSha256: revision, fetchImpl, request }), /workflow ID/);
  await assert.rejects(stageRenderEngineYuE2Request({ ...config, workflowId: jobId, profileRevisionSha256: revision, baseUrl: "http://render-engine-sable.vercel.app", fetchImpl, request }), /canonical HTTPS management API origin/);
  assert.equal(calls, 0);
});

test("reads only the requesting project's job and verified audio object", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    if (url.pathname.endsWith(`/projects/${projectName}/jobs`)) return response({ jobId, profileId: "yue2", status: "completed" });
    return response({ jobId, bucket: "studio-render-output", key: `projects/${projectName}/jobs/${jobId}/audio.wav`,
      executionJobId: jobId, bytes: 48, sha256: "e".repeat(64), contentType: "audio/wav", verifiedAt: 1, expiresInSeconds: 3600,
      url: "https://studio-render-output.r2.cloudflarestorage.com/audio.wav", nativeArtifactReads });
  };
  const status = await getRenderEngineYuE2Job({ ...config, fetchImpl }, jobId);
  assert.equal(status.status, "completed");
  const output = await getRenderEngineYuE2Output({ ...config, fetchImpl }, jobId);
  assert.equal(output.sha256, "e".repeat(64));
  assert.ok(calls.every((url) => url.includes(`/projects/${config.projectName}/`) && url.includes(`jobId=${jobId}`)));
  await assert.rejects(getRenderEngineYuE2Job({ ...config, fetchImpl }, "bad"), /job ID/);
});

test("rejects non-R2 artifact hosts before following signed URLs", async () => {
  const base = { jobId, bucket: "studio-render-output", key: `projects/${projectName}/jobs/${jobId}/audio.wav`,
      executionJobId: jobId, bytes: 48, sha256: "e".repeat(64), contentType: "audio/wav", verifiedAt: 1, expiresInSeconds: 3600,
      url: "https://studio-render-output.r2.cloudflarestorage.com/audio.wav", nativeArtifactReads };
  const responses = [
    { ...base, url: "https://169.254.169.254/latest/meta-data/" },
    { ...base, nativeArtifactReads: nativeArtifactReads.map((artifact, index) => index === 0
      ? { ...artifact, url: "https://metadata.google.internal/computeMetadata/v1/" } : artifact) },
  ];
  let engineRequests = 0;
  for (const body of responses) {
    const fetchImpl: typeof fetch = async () => {
      engineRequests += 1;
      return response(body);
    };
    await assert.rejects(getRenderEngineYuE2Output({ ...config, fetchImpl }, jobId), /trusted Cloudflare R2|native sidecar URL is invalid/);
  }
  assert.equal(engineRequests, 2, "only the authenticated Engine API is contacted");
});
