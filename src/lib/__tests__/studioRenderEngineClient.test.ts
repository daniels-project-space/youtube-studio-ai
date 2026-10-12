import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { StudioRenderEngineClient, StudioEngineError, STUDIO_ENGINE_BUCKET, STUDIO_ENGINE_PROJECT } from "../studioRenderEngineClient";
import { STUDIO_ENGINE_AUDIO_WORKFLOWS } from "../studioRenderEngineWorkflows";

const key = "a".repeat(64), job = "a".repeat(32);
const json = (data: unknown, status = 200) => Response.json(data, { status });
test("audio workflow uses only Studio's public API and forbids redirects", async () => {
  const client = new StudioRenderEngineClient(key, async (url, init) => {
    assert.equal(String(url), `https://render-engine-sable.vercel.app/api/v1/projects/${STUDIO_ENGINE_PROJECT}/workflows`);
    assert.equal(init?.redirect, "error");
    assert.deepEqual(JSON.parse(String(init?.body)), { workflowName: "studio-yue2", profileId: "yue2" });
    return json({ workflowId: job, profileRevisionSha256: key });
  });
  assert.deepEqual(await client.prepareAudio("yue2"), { workflowId: job, profileRevisionSha256: key });
});
test("ambiguous submission never retries or changes its immutable request", async () => {
  let calls = 0;
  const workflow = STUDIO_ENGINE_AUDIO_WORKFLOWS.yue2;
  const request = { idempotencyKey: "studio:immutable:001", profileRevisionSha256: workflow.profileRevisionSha256, lyrics: "unchanged" };
  const client = new StudioRenderEngineClient(key, async (_url, init) => {
    calls++;
    assert.deepEqual(JSON.parse(String(init?.body)), { workflowId: workflow.workflowId, request });
    throw new Error("private endpoint and credential must not escape");
  });
  await assert.rejects(client.submitAudio("yue2", workflow.workflowId, request), error =>
    error instanceof StudioEngineError && error.submissionMayExist && !error.message.includes("private"));
  assert.equal(calls, 1);
});
test("output is accepted only for the exact Studio bucket, key, byte count and full hash", async () => {
  const audio = Buffer.from("retained native audio fixture");
  const receipt = { bucket: STUDIO_ENGINE_BUCKET, key: `projects/${STUDIO_ENGINE_PROJECT}/outputs/audio.wav`,
    bytes: audio.length, sha256: createHash("sha256").update(audio).digest("hex"), contentType: "audio/wav", verifiedAt: 123,
    url: "https://account.r2.cloudflarestorage.com/private/audio.wav?signature=fixture" };
  let current = { ...receipt }, objectCalls = 0, corrupt = false;
  const client = new StudioRenderEngineClient(key, async (url, init) => {
    if (String(url).includes("/jobs/output?")) return json(current);
    objectCalls++;
    assert.equal(init?.headers, undefined, "no management credential goes to object storage");
    assert.equal(init?.redirect, "error");
    return new Response(corrupt ? Buffer.alloc(audio.length) : audio);
  });
  assert.deepEqual(Buffer.from((await client.verifiedOutput(job, 1000)).bytes), audio);
  current = { ...receipt, bucket: "foreign-project" };
  await assert.rejects(client.verifiedOutput(job, 1000));
  current = { ...receipt, key: "projects/other/outputs/audio.wav" };
  await assert.rejects(client.verifiedOutput(job, 1000));
  current = { ...receipt, url: "https://untrusted.invalid/audio.wav" };
  await assert.rejects(client.verifiedOutput(job, 1000));
  assert.equal(objectCalls, 1, "foreign storage is refused before transfer");
  current = { ...receipt }; corrupt = true;
  await assert.rejects(client.verifiedOutput(job, 1000), /do not match/);
  await assert.rejects(client.verifiedOutput(job, 1), /outside/);
});
test("invalid credentials, IDs and unrecognized models fail before network", async () => {
  assert.throws(() => new StudioRenderEngineClient("bad"));
  const client = new StudioRenderEngineClient(key, async () => { throw new Error("must not call"); });
  assert.throws(() => client.observe("../other"));
  await assert.rejects(client.prepareAudio("nano-banana-pro" as never), /Unsupported/);
  await assert.rejects(client.submitAudio("yue2", job, { idempotencyKey: "short" }));
  await assert.rejects(client.submitAudio("yue2", job, { idempotencyKey: "studio:foreign:workflow", profileRevisionSha256: key }), /registered Studio workflow/);
});

test("custom Comfy source stays content addressed in Studio R2 and registration readiness is read back", async () => {
  const graph = { "1": { class_type: "KSampler", inputs: { steps: 50 } } };
  const bytes = Buffer.from(JSON.stringify(graph));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const sourceKey = `projects/${STUDIO_ENGINE_PROJECT}/comfy/sha256/${sha256}.json`;
  let readbackHash = key;
  const client = new StudioRenderEngineClient(key, async (url, init) => {
    if (String(url).endsWith("/comfy-source-uploads")) {
      assert.deepEqual(JSON.parse(String(init?.body)), { kind: "workflow", sha256, bytes: bytes.length });
      return json({ key: sourceKey, url: "https://account.r2.cloudflarestorage.com/workflow.json?fixture=1",
        headers: { "content-type": "application/json", "if-none-match": "*" } });
    }
    if (init?.method === "PUT") {
      assert.deepEqual(Buffer.from(init.body as Uint8Array), bytes);
      assert.deepEqual(init.headers, { "content-type": "application/json", "if-none-match": "*" });
      return new Response(null, { status: 412 });
    }
    if (String(url).endsWith("/workflows")) {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.comfySpecification.workflow, { key: sourceKey, bytes: bytes.length, sha256 });
      assert.equal(body.comfySpecification.settings["1"].steps, 50);
      return json({ workflowId: job, specificationSha256: key, executionReady: false });
    }
    return json({ workflowId: job, specificationSha256: readbackHash, executionReady: false });
  });
  const input = { workflowName: "studio-comfy-profile", profileId: "ernie-image", graph, models: [], settings: { "1": { steps: 50 } } };
  const result = await client.registerComfy(input);
  assert.equal(result.executionReady, false, "registration never manufactures executor qualification");
  assert.equal(result.sourceSha256, sha256);
  readbackHash = "f".repeat(64);
  await assert.rejects(client.registerComfy(input), /readback changed/);
});

test("YuE2 preserves six scoped native artifacts, verifies their bytes and sends conditional read headers", async () => {
  const source = Buffer.from("source"), prefix = `projects/${STUDIO_ENGINE_PROJECT}/jobs/${job}`;
  const names = ["score.abc", "semantic.npy", "latent.npy", "request.json", "config.json", "result.json"];
  const data = new Map(names.map(name => [name, Buffer.from(`fixture-${name}`)]));
  let corrupt = false;
  const nativeArtifacts = names.map(name => ({ name, key: `${prefix}/native/${name}`, bytes: data.get(name)!.length,
    sha256: createHash("sha256").update(data.get(name)!).digest("hex"),
    contentType: name.endsWith(".json") ? "application/json" : name.endsWith(".abc") ? "text/vnd.abc" : "application/octet-stream" }));
  const client = new StudioRenderEngineClient(key, async (url, init) => {
    if (String(url).includes("/jobs/output?")) return json({ bucket: STUDIO_ENGINE_BUCKET, key: `${prefix}/audio.flac`,
      bytes: source.length, sha256: createHash("sha256").update(source).digest("hex"), contentType: "audio/flac", verifiedAt: 123,
      url: "https://account.r2.cloudflarestorage.com/source.flac", nativeArtifacts,
      nativeArtifactReads: nativeArtifacts.map(item => ({ ...item,
        url: `https://account.r2.cloudflarestorage.com/${item.name}`, readHeaders: { "If-Match": '"frozen-etag"' }, expiresInSeconds: 600 })) });
    const name = new URL(String(url)).pathname.slice(1);
    if (name === "source.flac") return new Response(source);
    assert.deepEqual(init?.headers, { "If-Match": '"frozen-etag"' });
    return new Response(corrupt ? Buffer.alloc(data.get(name)!.length) : data.get(name));
  });
  const output = await client.verifiedOutput(job, 1000, true);
  assert.equal(Object.keys(output.nativeArtifactBytes).length, 6);
  assert.deepEqual(Buffer.from(output.nativeArtifactBytes["score.abc"]), data.get("score.abc"));
  assert.ok(!("nativeArtifactReads" in output.receipt), "signed native capabilities are not persisted");
  corrupt = true;
  await assert.rejects(client.verifiedOutput(job, 1000, true), /evidence bytes changed/);
});
