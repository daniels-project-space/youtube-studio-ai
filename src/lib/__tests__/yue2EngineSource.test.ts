import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalJson } from "../canonicalJson";
import { sha256BytesHex, sha256Hex } from "../sha256";
import { createYuE2EngineRequest } from "../yue2EngineRequest";
import { StudioRenderEngineClient } from "../studioRenderEngineClient";
import { STUDIO_ENGINE_AUDIO_WORKFLOWS, STUDIO_ENGINE_BUCKET, STUDIO_ENGINE_PROJECT } from "../studioRenderEngineWorkflows";
import { YuE2SourceApprovalBasisSchema } from "@/engine/yue2SourceApproval";

const load = createRequire(__filename);
const material = JSON.parse(readFileSync("test-fixtures/music-composer/seaside-after/gpu-material.json", "utf8"));
const arrangement = material.request.acceptedArrangement;
const params = { renderer: "render-engine", seed: 42, personalCreatorAcknowledged: true, maxCostUsd: 1, maxExecutionSeconds: 600 };
const input = createYuE2EngineRequest(arrangement, params), id = "b".repeat(32), prefix = `projects/${STUDIO_ENGINE_PROJECT}/jobs/${id}`;
const directory = mkdtempSync("/tmp/yue2-engine-test-"), frames = arrangement.arrangement.requestedDurationSec * 48000 - 64;
execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-af",
  `atrim=end_sample=${frames},volume=7.5,pan=stereo|c0=c0|c1=c0`, "-c:a", "pcm_f32le", join(directory, "native.wav")]);
const audio = readFileSync(join(directory, "native.wav")), audioHash = sha256BytesHex(audio);
const npy = execFileSync("python3", ["-c", "import io,numpy as np,sys;b=io.BytesIO();np.save(b,np.zeros((2,64),dtype=np.float32),allow_pickle=False);sys.stdout.buffer.write(b.getvalue())"]);
const files: Record<string, Uint8Array> = {
  "score.abc": Buffer.from(input.native.abc), "semantic.npy": npy, "latent.npy": npy,
  "request.json": Buffer.from(JSON.stringify({ style: input.native.style, lyrics: "", abc: input.native.abc, seed: 42, cot: "full", cfg_scale: 1, id: "song" })),
  "config.json": Buffer.from(JSON.stringify({ model_dtype: "bfloat16", vae_dtype: "float32", quantization: "none", backend: "torch", cot: "full",
    cfg_scale: 1, decoder_release: "standard", vae_decode: "halo_crop", offload_ar: false,
    generation: { ode_steps: 32, ode_method: "midpoint", context: 24576,
      abc: { temperature: .7, top_p: .9, top_k: 30, repetition_penalty: 1.005, penalty_window: 100, min_tokens: 32, max_tokens: 4096 },
      semantic: { temperature: 1, top_p: .95, top_k: 100, repetition_penalty: 1.2, penalty_window: 50, min_tokens: 200, max_tokens: 9000 } } })),
};
files["result.json"] = Buffer.from(JSON.stringify({ status: "complete", sample_rate: 48000, audio_seconds: frames / 48000,
  truncated: { abc: false, semantic: false }, artifacts: Object.fromEntries(Object.entries(files).map(([name, body]) => [name, { bytes: body.length, sha256: sha256BytesHex(body) }])) }));
const descriptors = Object.entries(files).map(([name, body]) => ({ name, key: `${prefix}/native/${name}`, bytes: body.length, sha256: sha256BytesHex(body),
  contentType: name === "score.abc" ? "text/vnd.abc" : name.endsWith(".json") ? "application/json" : "application/octet-stream" }));
const output = { bucket: STUDIO_ENGINE_BUCKET, key: `${prefix}/audio.wav`, bytes: audio.length, sha256: audioHash,
  contentType: "audio/wav", verifiedAt: 1, nativeArtifacts: descriptors };
const objects = new Map<string, Uint8Array>(); let posts = 0, authorizations = 0, dataReads = 0;
let allocationComplete = true;
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown }, original = loader._load;
loader._load = function (name, ...args) {
  if (name === "./storage" || name === "@/lib/storage") return {
    getObjectBytes: async (key: string, bucket: string, options: { maxBytes: number }) => {
      assert.equal(bucket, "youtube-studio-ai-private"); const body = objects.get(key);
      if (!body) throw Object.assign(new Error("missing fixture"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
      assert.ok(body.length <= options.maxBytes); return body;
    },
    putObject: async (key: string, body: Uint8Array, options: { bucket: string; ifNoneMatch: string }) => {
      assert.equal(options.bucket, "youtube-studio-ai-private"); assert.equal(options.ifNoneMatch, "*");
      if (objects.has(key)) throw Object.assign(new Error("exists"), { $metadata: { httpStatusCode: 412 } });
      objects.set(key, Buffer.from(body));
    },
  };
  return original.call(this, name, ...args);
};
const fetcher: typeof fetch = async (value, options) => {
  const url = new URL(String(value));
  if (url.hostname === "render-engine-sable.vercel.app") {
    assert.equal(options?.headers && (options.headers as Record<string, string>).authorization, `Bearer ${"a".repeat(64)}`);
    if (options?.method === "POST") {
      posts++; const request = JSON.parse(String(options.body)); assert.deepEqual(request.request, input.native);
      return Response.json({ jobId: id, state: "queued", manifestSha256: sha256Hex(JSON.stringify(input.native)) });
    }
    if (url.pathname.endsWith("/jobs/output")) return Response.json({ ...output, url: "https://fixture.r2.cloudflarestorage.com/audio.wav",
      nativeArtifactReads: descriptors.map(d => ({ ...d, url: `https://fixture.r2.cloudflarestorage.com/${d.name}`,
        readHeaders: { "If-Match": d.sha256 }, expiresInSeconds: 600 })) });
    const { nativeArtifacts: sidecars, ...statusOutput } = output; void sidecars;
    return Response.json({ jobId: id, workflowId: STUDIO_ENGINE_AUDIO_WORKFLOWS.yue2.workflowId, profileId: "yue2",
      requestSha256: sha256Hex(JSON.stringify(input.native)), status: "completed", outputRetired: false, output: statusOutput,
      usage: { gpuSeconds: 50, costUsd: 0, complete: false },
      allocationUsage: { gpuSeconds: 50, costUsd: .01, complete: allocationComplete, costBasis: "engine-reservation-debit", providerInvoiceVerified: false } });
  }
  assert.equal(url.hostname, "fixture.r2.cloudflarestorage.com");
  assert.ok(!(options?.headers as Record<string, string> | undefined)?.authorization, "management credentials never reach object storage");
  dataReads++; return new Response(Buffer.from(url.pathname === "/audio.wav" ? audio : files[url.pathname.slice(1)]));
};

test("Engine music retains exact native source, stopped reservation debit, review context and same-job recovery", async () => {
  const savedPrivateBucket = process.env.R2_PRIVATE_BUCKET, savedPublicBucket = process.env.R2_BUCKET;
  process.env.R2_PRIVATE_BUCKET = "youtube-studio-ai-private"; process.env.R2_BUCKET = "youtube-studio-ai";
  try {
    const source = load("../yue2EngineSource") as typeof import("../yue2EngineSource");
    const client = new StudioRenderEngineClient("a".repeat(64), fetcher);
    const run = () => source.executeYuE2EngineSource(arrangement, params, { client,
      authorize: async () => { authorizations++; }, wait: async () => assert.fail("completed fixture never waits") });
    const retained = await run();
    assert.equal(posts, 1); assert.equal(dataReads, 7); assert.ok(authorizations >= 4);
    assert.equal(retained.candidate.version, "studio-yue2-engine-candidate/v1");
    assert.equal(retained.candidate.jobId, id); assert.equal(retained.candidate.usage.costUsd, .01);
    assert.equal(retained.candidate.usage.costBasis, "engine-reservation-debit", "reserved budget is never labeled a final invoice");
    assert.equal(retained.quality.status, "needs_audition"); assert.equal(retained.candidate.productionApproved, false);
    assert.deepEqual(retained.request.acceptedArrangement.reviewContext, arrangement.reviewContext);
    assert.equal(retained.candidate.nativeOutput.frames, frames);
    assert.deepEqual(Buffer.from(objects.get(retained.candidate.audioKey)!), audio);
    assert.ok(retained.candidate.headroom, "high-peak native source gets an attenuation-only listening derivative");
    assert.equal(retained.listeningAudioKey, retained.candidate.headroom.audioKey);
    const headroom = JSON.parse(Buffer.from(objects.get(retained.candidate.headroom.receiptKey)!).toString());
    assert.ok(headroom.gainDb < 0 && headroom.afterDbtp <= -1);
    assert.equal(headroom.frames, frames);
    assert.equal(headroom.sourceSha256, audioHash);
    const proofText = Buffer.from(objects.get(retained.candidate.provenanceKey)!).toString();
    assert.ok(!proofText.includes("fixture.r2.cloudflarestorage.com") && !proofText.includes("Bearer"));
    const again = await run(); assert.equal(again.candidateSha256, retained.candidateSha256);
    assert.equal(posts, 1, "a retained source never dispatches another job");
    const basis = { ownerId: arrangement.ownerId, channelId: arrangement.channelId, runId: arrangement.runId, invocationSha256: "a".repeat(64),
      candidateSha256: retained.candidateSha256, arrangementFingerprint: arrangement.fingerprint, jobId: id,
      listeningAudioKey: retained.listeningAudioKey, listeningAudioSha256: retained.candidate.headroom.audioSha256, nativeFrames: frames,
      sampleRateHz: 48000, channels: 2, sectionIds: arrangement.arrangement.sections.map((s: { id: string }) => s.id), technicalStatus: "needs_audition", contextRetained: true };
    assert.equal(YuE2SourceApprovalBasisSchema.parse(basis).jobId, id);
    assert.throws(() => YuE2SourceApprovalBasisSchema.parse({ ...basis, listeningAudioKey: basis.listeningAudioKey.replace("yue2-engine", "yue2-evaluation") }));
    await assert.rejects(source.executeYuE2EngineSource(arrangement, { ...params, seed: 43 }, { client, authorize: async () => {}, wait: async () => {} }), /Immutable Engine source bytes changed/);
    assert.equal(posts, 1);
    const root = source.yuE2EngineRoot(arrangement), saved = objects.get(`${root}native/score.abc`)!;
    objects.set(`${root}native/score.abc`, Buffer.from("altered"));
    await assert.rejects(source.readYuE2EngineCandidate(arrangement), /accepted score|sidecar changed/);
    objects.set(`${root}native/score.abc`, saved);
    const savedCandidate = objects.get(`${root}candidate.json`)!;
    objects.delete(`${root}candidate.json`); allocationComplete = false;
    await assert.rejects(run(), error => {
      assert.equal((error as { additionalObservedCostUsd: number }).additionalObservedCostUsd, .01,
        "unresolved allocation retains the known reservation debit instead of falsely charging zero");
      return true;
    });
    assert.equal(objects.has(`${root}candidate.json`), false);
    assert.equal(posts, 1, "incomplete accounting still recovers the original admission");
    objects.set(`${root}candidate.json`, savedCandidate); allocationComplete = true;
  } finally {
    loader._load = original; rmSync(directory, { recursive: true, force: true });
    if (savedPrivateBucket === undefined) delete process.env.R2_PRIVATE_BUCKET; else process.env.R2_PRIVATE_BUCKET = savedPrivateBucket;
    if (savedPublicBucket === undefined) delete process.env.R2_BUCKET; else process.env.R2_BUCKET = savedPublicBucket;
  }
});
