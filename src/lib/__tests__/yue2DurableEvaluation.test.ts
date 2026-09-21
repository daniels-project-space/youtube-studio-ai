import assert from "node:assert/strict";
import Module from "node:module";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createAcceptedMusicArrangement } from "@/engine/acceptedMusicArrangement";
import { canonicalJson } from "@/lib/canonicalJson";
import {
  createYuE2AcceptedArrangementRequest, yue2Sha256, YUE2_MANIFEST, YUE2_QUALIFICATION,
  YUE2_RUNTIME_MANIFEST_SHA256, YUE2_WORKER_CONTRACT, YuE2EvaluationError,
  type YuE2AcceptedArrangementRequest,
} from "@/lib/yue2Evaluation";
import type { YuE2DurableEvaluationInput } from "@/lib/yue2DurableEvaluation";

const token = "offline_durable_fixture_token_never_persist_123456";
const endpoint = "https://worker.invalid";
function request(overrides: { seed?: number; ownerId?: string; channelId?: string; runId?: string; direction?: string } = {}) {
  const arrangement = createAcceptedMusicArrangement({
    ownerId: overrides.ownerId ?? "durable-owner", channelId: overrides.channelId ?? "durable-channel", runId: overrides.runId ?? "durable-run",
    topic: "A steady native source", sourceBrief: { musicPrompt: "No build or climax" },
    arrangement: { role: "primary_music", direction: overrides.direction ?? "Remain flat, ending naturally", requestedDurationSec: 60,
      form: "continuous", ending: "natural_cadence", playback: "once",
      sections: Array.from({ length: 4 }, (_, i) => ({ id: `interval-${i}`, label: "Review interval", startFraction: i / 4,
        endFraction: (i + 1) / 4, energy: 0.2, instruction: "Remain steady" })) },
  });
  return createYuE2AcceptedArrangementRequest({ arrangement, seed: overrides.seed ?? 42, personalCreatorAcknowledged: true });
}
const baseRequest = request();
const root = "owner/durable-owner/runs/durable-run/music/yue2-evaluation/";
const bindingKey = `${root}binding.json`;
const markerKey = `${root}submission-attempt.json`;
const candidateKey = `${root}candidate.json`;
const provenanceKey = `${root}provenance.json`;
function wav() {
  const frames = 4800;
  const bytes = Buffer.alloc(44 + frames * 8);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(3, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(48000, 24); bytes.writeUInt32LE(384000, 28); bytes.writeUInt16LE(8, 32);
  bytes.writeUInt16LE(32, 34); bytes.write("data", 36); bytes.writeUInt32LE(frames * 8, 40);
  return bytes;
}
const audio = wav();
function seal(payload: unknown) {
  const payload_json = `${canonicalJson(payload)}\n`;
  return { payload_json, sha256: yue2Sha256(payload_json) };
}
function completion(bytes: Uint8Array, req: YuE2AcceptedArrangementRequest) {
  const job = seal(req.job);
  const config = seal({ schema_version: 1, manifest: YUE2_MANIFEST, cache_dir: "/offline-fixture",
    device: "cuda:0", local_files_only: true, candidate_count: 1,
    exports: ["official_pcm24_flac", "native_float32_wav", "native_float32_npy"] });
  const started = seal({ schema_version: 1, job_id: req.job.job_id, attempt: 1, started_at: "fixture-start",
    pid: 1, job_sha256: job.sha256, config_sha256: config.sha256, environment: { test: true } });
  const receipt = { schema_version: 1, job_id: req.job.job_id, attempt: 1, finished_at: "fixture-end",
    status: "completed", started_sha256: started.sha256, error: null, qualification: YUE2_QUALIFICATION,
    result: { status: "complete", truncated: { abc: false, semantic: false }, sample_rate: 48000, channels: 2,
      frames: 4800, audio_seconds: 0.1, official_identity: "b".repeat(64), timing: { load: { seconds: 1 } },
      native_audio: "audio-native.wav", official_result: "song/result.json" },
    artifacts: { "audio-native.wav": { sha256: yue2Sha256(bytes), bytes: bytes.length },
      "song/result.json": { sha256: "c".repeat(64), bytes: 23 } },
  };
  if (current.preClamp) Object.assign(receipt.artifacts, {
    "audio-unclipped.wav": { sha256: yue2Sha256(bytes), bytes: bytes.length },
    "headroom-status.json": { sha256: yue2Sha256(headroom()), bytes: headroom().length },
  });
  const terminal = seal(receipt);
  terminal.payload_json = terminal.payload_json.replace('"seconds":1}', '"seconds":1.0}');
  terminal.sha256 = yue2Sha256(terminal.payload_json);
  return { contract: YUE2_WORKER_CONTRACT, job_id: req.job.job_id, state: "completed", job: req.job,
    job_sha256: job.sha256, config_sha256: config.sha256, accepted_sha256: "d".repeat(64),
    qualification: YUE2_QUALIFICATION, progress: { phase: "terminal", receipt: "terminal.json" },
    receipt, receipt_payloads: { job, config, started, terminal }, error: null,
    artifacts: { "audio-native.wav": `/v1/jobs/${req.job.job_id}/artifacts/audio-native.wav` } };
}
function absent() { return Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } }); }
type Fault = (key: string, bytes?: Uint8Array) => void | Promise<void>;
function fixture() {
  return {
    objects: new Map<string, Buffer>(), reads: [] as string[], writes: [] as string[], calls: [] as string[],
    authorizations: 0, posts: 0, getFault: undefined as Fault | undefined, putFault: undefined as Fault | undefined,
    afterPutFault: undefined as Fault | undefined, audio, req: baseRequest,
    remote: "missing" as "missing" | "pending" | "completed" | "failed",
    invalidReceipt: false, audioFailure: false, preClamp: false,
    postMode: "completed" as "completed" | "pending" | "ambiguous",
    barrier: false, jobGets: 0, release: undefined as (() => void) | undefined,
  };
}
let current = fixture();
function headroom() {
  const payload = { schema: "yue2-pre-clamp-source/v1", decode_passes: 1, decoder_sha256: "a".repeat(64),
    source: "audio-unclipped.wav", official: "audio-native.wav", source_sha256: yue2Sha256(current.audio),
    samples_outside_unit_range: 0, raw_sample_peak: 0, clamped_samples_equal_reference: true,
    gain_applied: false, production_approved: false };
  return Buffer.from(JSON.stringify({ payload, sha256: seal(payload).sha256 }));
}
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
const originalFetch = globalThis.fetch;
loader._load = function (id, ...args) {
  if (id.endsWith("/storage")) return {
    getObjectBytes: async (key: string, bucket: unknown, options: { timeoutMs: number; maxBytes: number }) => {
      assert.equal(bucket, undefined); assert.equal(options.timeoutMs, 30_000);
      assert.ok(options.maxBytes > 0 && options.maxBytes <= 256 * 1024 * 1024);
      current.reads.push(key); await current.getFault?.(key);
      const bytes = current.objects.get(key); if (!bytes) throw absent();
      if (bytes.length > options.maxBytes) throw new Error("maxBytes exceeded");
      return Buffer.from(bytes);
    },
    putObject: async (key: string, value: Uint8Array, options: { ifNoneMatch?: string }) => {
      assert.equal(options.ifNoneMatch, "*", "all output writes are create-only");
      assert.ok(!Buffer.from(value).includes(Buffer.from(token)), "no credentials in durable storage");
      current.writes.push(key); await current.putFault?.(key, value);
      if (current.objects.has(key)) throw Object.assign(new Error("conditional collision"), { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } });
      current.objects.set(key, Buffer.from(value)); await current.afterPutFault?.(key, value);
      return key;
    },
  };
  return originalLoad.call(this, id, ...args);
};
globalThis.fetch = async (input, init = {}) => {
  assert.equal(new Headers(init.headers).get("Authorization"), `Bearer ${token}`);
  assert.equal(init.redirect, "error");
  const url = new URL(String(input));
  assert.equal(url.origin, endpoint);
  const path = url.pathname;
  current.calls.push(`${init.method ?? "GET"} ${path}`);
  if (path === "/v1/health") return Response.json({ contract: YUE2_WORKER_CONTRACT, manifest: YUE2_MANIFEST,
    manifest_sha256: YUE2_RUNTIME_MANIFEST_SHA256, qualification: YUE2_QUALIFICATION, queue_capacity: 1,
    worker_state: "ready", error: null, readiness_scope: "queue_idle_only_not_gpu_qualification" });
  if (path === "/v1/jobs" && init.method === "POST") {
    assert.ok(current.objects.has(bindingKey) && current.objects.has(markerKey), "durable identities precede POST");
    assert.ok(current.authorizations >= 3, "authority rechecked after marker readback before POST");
    assert.deepEqual(JSON.parse(String(init.body)), current.req.job);
    current.posts++;
    current.remote = current.postMode === "pending" ? "pending" : "completed";
    if (current.postMode === "ambiguous") throw new Error(`simulated lost response ${token}`);
  } else if (path.endsWith("/artifacts/headroom-status.json")) {
    return new Response(headroom());
  } else if (path.endsWith("/artifacts/audio-native.wav") || path.endsWith("/artifacts/audio-unclipped.wav")) {
    if (current.audioFailure) throw new Error("audio download failed");
    return new Response(new Uint8Array(current.audio));
  }
  else {
    assert.equal(path, `/v1/jobs/${current.req.job.job_id}`);
    current.jobGets++;
    if (current.barrier && current.jobGets <= 2) {
      if (current.jobGets === 1) await new Promise<void>((resolve) => { current.release = resolve; });
      else current.release!();
      return Response.json({ contract: YUE2_WORKER_CONTRACT, state: "refused", error: "job_not_found" }, { status: 404 });
    }
  }
  if (current.remote === "missing") return Response.json({ contract: YUE2_WORKER_CONTRACT, state: "refused", error: "job_not_found" }, { status: 404 });
  if (current.remote === "pending") return Response.json({ contract: YUE2_WORKER_CONTRACT, job_id: current.req.job.job_id, job: current.req.job, state: "accepted" });
  if (current.remote === "failed") return Response.json({ contract: YUE2_WORKER_CONTRACT, job_id: current.req.job.job_id, job: current.req.job, state: "failed" });
  const completed = completion(current.audio, current.req);
  if (current.invalidReceipt) completed.receipt_payloads.terminal.sha256 = "0".repeat(64);
  return Response.json(completed);
};

async function main() {
  /* eslint-disable @typescript-eslint/no-require-imports -- install offline storage boundary before loading production adapter */
  const { executeDurableYuE2Evaluation: run, validateDurableYuE2Evaluation: validate } = require("@/lib/yue2DurableEvaluation") as typeof import("@/lib/yue2DurableEvaluation");
  /* eslint-enable @typescript-eslint/no-require-imports */
  const args = (patch: Partial<YuE2DurableEvaluationInput> = {}): YuE2DurableEvaluationInput => ({
    request: current.req, endpoint, bearerToken: token,
    authorizeSubmission: async () => { current.authorizations++; }, ...patch,
  });
  async function rejected(operation: Promise<unknown>) {
    await assert.rejects(operation, (error: unknown) => {
      assert.ok(error instanceof YuE2EvaluationError); assert.equal(error.retryable, false); assert.equal(error.safeToFallback, false);
      assert.ok(!error.message.includes(token)); return true;
    });
  }
  let passed = 0;
  async function test(name: string, fn: () => Promise<void> | void) {
    current = fixture(); await fn(); passed++; console.log(`PASS ${name}`);
  }
  const beforeDirectories = (await readdir(tmpdir())).filter((name) => name.startsWith("yue2-durable-native-")).sort();
  await test("pure pre-bootstrap validation rejects unsafe IDs, request, endpoint and token without I/O", () => {
    assert.equal(validate(args()).endpoint, endpoint);
    for (const patch of [{ request: request({ ownerId: "../bad" }) }, { request: request({ channelId: "bad/channel" }) },
      { request: request({ runId: ".." }) }, { request: { ...baseRequest, version: "studio-yue2-evaluation/v1" } },
      { endpoint: "https://user:secret@worker.invalid" }, { bearerToken: "short" }, { authorizeSubmission: undefined }]) {
      assert.throws(() => validate(args(patch)));
    }
    assert.equal(current.calls.length + current.reads.length + current.writes.length + current.authorizations, 0);
  });
  await test("submission seals complete native candidate; valid cache re-probes with zero HTTP or writes", async () => {
    const result = await run(args()); assert.equal(result.status, "completed");
    if (result.status !== "completed") throw new Error("expected completed");
    assert.equal(result.jobId, baseRequest.job.job_id); assert.equal(result.reused, false);
    assert.deepEqual(current.objects.get(result.audioKey), audio);
    assert.equal(result.candidate.costStatus, "not_measured"); assert.equal(result.candidate.manualAudition, "pending");
    assert.equal(result.candidate.productionApproved, false); assert.equal(result.candidate.qualified, false);
    assert.ok(!("musicKey" in result) && !("musicKey" in result.candidate));
    assert.ok(current.objects.get(provenanceKey)!.toString().includes("1.0"), "raw sealed Python receipt spelling retained");
    const counts = [current.calls.length, current.writes.length];
    const again = await run(args({ recoverOnly: true, authorizeSubmission: async () => { throw new Error("must not authorize recovery"); } }));
    assert.equal(again.status, "completed"); assert.equal(again.reused, true);
    assert.deepEqual([current.calls.length, current.writes.length], counts); assert.equal(current.posts, 1);
  });
  await test("raw source retention seals both artifacts and reuses without worker access", async () => {
    current.preClamp = true;
    const result = await run(args());
    assert.equal(result.status, "completed");
    if (result.status !== "completed") throw new Error("expected complete");
    const source = result.candidate.preClampSource;
    assert.ok(source);
    assert.deepEqual(current.objects.get(source.audioKey), audio);
    assert.deepEqual(current.objects.get(source.receiptKey), headroom());
    assert.ok(result.candidate.headroom);
    assert.ok(current.objects.has(result.candidate.headroom.audioKey));
    assert.ok(current.objects.has(result.candidate.headroom.receiptKey));
    const counts = [current.calls.length, current.writes.length];
    assert.equal((await run(args({ recoverOnly: true }))).status, "completed");
    assert.deepEqual([current.calls.length, current.writes.length], counts);
    current.objects.set(source.receiptKey, Buffer.from("corrupt"));
    await rejected(run(args({ recoverOnly: true })));
    assert.deepEqual([current.calls.length, current.writes.length], counts);
  });
  await test("interrupted source writes recover via GET only before publishing candidate", async () => {
    current.preClamp = true;
    current.putFault = key => { if (key.includes("headroom-")) throw new Error("interrupted receipt write"); };
    await rejected(run(args()));
    assert.equal(current.posts, 1);
    assert.equal(current.objects.has(candidateKey), false);
    assert.ok([...current.objects.keys()].some(key => key.includes("audio-unclipped-")));
    current.putFault = undefined;
    const result = await run(args({ recoverOnly: true }));
    assert.equal(result.status, "completed");
    assert.equal(current.posts, 1);
    assert.ok(current.objects.has(candidateKey));
  });
  await test("missing raw audio on a sealed candidate is not silently repaired or repurchased", async () => {
    current.preClamp = true;
    const result = await run(args());
    if (result.status !== "completed" || !result.candidate.preClampSource) throw new Error("expected raw source");
    current.objects.delete(result.candidate.preClampSource.audioKey);
    const calls = current.calls.length;
    await rejected(run(args()));
    assert.equal(current.calls.length, calls);
    assert.equal(current.posts, 1);
  });
  await test("interrupted preparation publication recovers from retained source without another POST", async () => {
    current.preClamp = true;
    current.putFault = key => { if (key.endsWith("headroom-preparation.json")) throw new Error("lost preparation write"); };
    await rejected(run(args()));
    assert.equal(current.objects.has(candidateKey), false);
    assert.ok([...current.objects.keys()].some(key => key.includes("audio-headroom-")));
    const calls = current.calls.length;
    current.putFault = undefined;
    const result = await run(args({ recoverOnly: true }));
    assert.equal(result.status, "completed");
    assert.equal(current.calls.length, calls, "retained source recovery requires no worker traffic");
    assert.equal(current.posts, 1);
  });
  await test("corrupted derivative or preparation receipt refuses cached completion without worker traffic", async () => {
    current.preClamp = true;
    const result = await run(args());
    if (result.status !== "completed" || !result.candidate.headroom) throw new Error("expected derivative");
    const calls = current.calls.length;
    for (const key of [result.candidate.headroom.audioKey, result.candidate.headroom.receiptKey]) {
      const saved = current.objects.get(key)!;
      current.objects.set(key, Buffer.from("corrupt"));
      await rejected(run(args({ recoverOnly: true })));
      current.objects.set(key, saved);
    }
    assert.equal(current.calls.length, calls);
    assert.equal(current.posts, 1);
  });
  await test("independent clients racing the same missing job admit one POST; loser GET-recovers", async () => {
    current.barrier = true;
    const results = await Promise.all([run(args()), run(args())]);
    assert.ok(results.every((result) => result.status === "completed")); assert.equal(current.posts, 1);
    assert.equal(current.writes.filter((key) => key === markerKey).length, 2, "both independent clients contest the durable marker");
  });
  await test("pending request recovers only by GET on a new client", async () => {
    current.postMode = "pending";
    const pending = await run(args()); assert.equal(pending.status, "pending"); assert.equal(pending.jobId, baseRequest.job.job_id);
    current.remote = "completed";
    assert.equal((await run(args({ recoverOnly: true }))).status, "completed"); assert.equal(current.posts, 1);
  });
  await test("ambiguous POST response cannot lead to another POST", async () => {
    current.postMode = "ambiguous"; await rejected(run(args())); assert.equal(current.posts, 1);
    assert.equal((await run(args())).status, "completed"); assert.equal(current.posts, 1);
  });
  await test("marker with subsequent worker 404 remains GET-only even in submit mode", async () => {
    current.postMode = "pending"; await run(args()); current.remote = "missing";
    await rejected(run(args())); assert.equal(current.posts, 1);
  });
  await test("observed pending, failed, invalid receipt and failed download all freeze GET-only recovery", async () => {
    for (const observed of ["pending", "failed", "bad-receipt", "bad-download"]) {
      current = fixture();
      current.remote = observed === "pending" || observed === "failed" ? observed : "completed";
      current.invalidReceipt = observed === "bad-receipt"; current.audioFailure = observed === "bad-download";
      if (observed === "pending") assert.equal((await run(args())).status, "pending");
      else await rejected(run(args()));
      assert.ok(current.objects.has(markerKey), "validated observation pins job even before later validation succeeds");
      assert.equal(current.posts, 0);
      current.remote = "missing"; current.invalidReceipt = false; current.audioFailure = false;
      await rejected(run(args())); assert.equal(current.posts, 0);
    }
  });
  await test("frozen run rejects changed seed, arrangement, channel and endpoint before HTTP", async () => {
    current.postMode = "pending"; await run(args()); const calls = current.calls.length;
    for (const patch of [{ request: request({ seed: 43 }) }, { request: request({ direction: "A different piece" }) },
      { request: request({ channelId: "other-channel" }) }, { endpoint: "https://replacement.invalid" }]) await rejected(run(args(patch)));
    assert.equal(current.calls.length, calls); assert.equal(current.posts, 1);
  });
  await test("recover without binding makes no writes or worker calls", async () => {
    await rejected(run(args({ recoverOnly: true }))); assert.equal(current.writes.length + current.calls.length, 0);
  });
  await test("denied initial authority cannot freeze a binding", async () => {
    await rejected(run(args({ authorizeSubmission: async () => { throw new Error(token); } })));
    assert.equal(current.writes.length + current.calls.length, 0);
  });
  await test("authority lost before marker or after marker never dispatches", async () => {
    for (const deniedAt of [2, 3]) {
      current = fixture();
      await rejected(run(args({ authorizeSubmission: async () => { if (++current.authorizations === deniedAt) throw new Error("denied"); } })));
      assert.equal(current.posts, 0);
      assert.equal(current.objects.has(markerKey), deniedAt === 3);
      if (deniedAt === 3) { await rejected(run(args())); assert.equal(current.posts, 0); }
    }
  });
  await test("storage read timeouts are not absence and cannot authorize a POST", async () => {
    for (const key of [bindingKey, markerKey, candidateKey, provenanceKey]) {
      current = fixture(); current.getFault = (value) => { if (value === key) throw new Error(`timeout ${token}`); };
      await rejected(run(args())); assert.equal(current.posts, 0);
      if (key === bindingKey) assert.equal(current.writes.length, 0);
    }
  });
  await test("lost marker PUT response is not claim ownership; later recovery cannot POST", async () => {
    current.afterPutFault = (key) => { if (key === markerKey) throw new Error("lost put response"); };
    await rejected(run(args())); assert.ok(current.objects.has(markerKey)); assert.equal(current.posts, 0);
    current.afterPutFault = undefined; await rejected(run(args())); assert.equal(current.posts, 0);
  });
  await test("stalled marker PUT times out; late SDK completion never authorizes POST", async () => {
    const originalTimer = globalThis.setTimeout;
    let release: (() => void) | undefined;
    current.putFault = (key) => key === markerKey ? new Promise<void>((resolve) => { release = resolve; }) : undefined;
    // Compress the fixed production waiter deadline only in this isolated fixture.
    globalThis.setTimeout = ((handler: (...args: unknown[]) => void, delay?: number, ...values: unknown[]) =>
      originalTimer(handler, delay === 30_000 ? 10 : delay, ...values)) as typeof setTimeout;
    try {
      await rejected(run(args())); assert.ok(release); assert.equal(current.posts, 0);
      assert.equal(current.objects.has(markerKey), false);
    } finally { globalThis.setTimeout = originalTimer; }
    release!(); await new Promise<void>((resolve) => setImmediate(resolve));
    assert.ok(current.objects.has(markerKey), "late write is retained, never cleared");
    assert.equal(current.posts, 0); assert.equal(current.authorizations, 2);
    current.putFault = undefined;
    await rejected(run(args())); assert.equal(current.posts, 0);
  });
  await test("partial uploads recover without a new POST; final candidate upload recovers offline", async () => {
    for (const phase of ["provenance", "audio", "candidate"]) {
      current = fixture();
      current.putFault = (key) => { if ((phase === "audio" && key.endsWith(".wav")) || key === `${root}${phase}.json`) throw new Error("upload interrupted"); };
      await rejected(run(args())); assert.equal(current.posts, 1);
      const calls = current.calls.length; current.putFault = undefined;
      assert.equal((await run(args({ recoverOnly: true }))).status, "completed"); assert.equal(current.posts, 1);
      if (phase === "candidate") assert.equal(current.calls.length, calls, "durable provenance/audio finish locally without provider access");
    }
  });
  await test("ambiguous output PUT can be recovered by exact immutable readback", async () => {
    current.afterPutFault = (key) => { if (key === candidateKey) throw new Error("lost candidate response"); };
    await rejected(run(args())); const calls = current.calls.length;
    current.afterPutFault = undefined;
    const restored = await run(args({ recoverOnly: true })); assert.equal(restored.status, "completed");
    assert.equal(current.calls.length, calls); assert.equal(current.posts, 1);
  });
  await test("collision with different binding, marker or output bytes never overwrites", async () => {
    for (const key of [bindingKey, markerKey, provenanceKey, candidateKey]) {
      current = fixture();
      current.putFault = (actual) => { if (actual === key) current.objects.set(key, Buffer.from("conflicting identity")); };
      await rejected(run(args())); assert.equal(current.objects.get(key)!.toString(), "conflicting identity");
      assert.equal(current.posts, key === bindingKey || key === markerKey ? 0 : 1);
    }
  });
  await test("candidate and native corruption fail closed without provider fallback", async () => {
    for (const corrupted of ["candidate", "audio", "provenance", "missing-audio"]) {
      current = fixture(); const result = await run(args()); if (result.status !== "completed") throw new Error("expected completed");
      if (corrupted === "missing-audio") current.objects.delete(result.audioKey);
      else if (corrupted === "audio") current.objects.set(result.audioKey, Buffer.alloc(audio.length));
      else current.objects.set(corrupted === "candidate" ? candidateKey : provenanceKey, Buffer.from("{}"));
      const calls = current.calls.length; await rejected(run(args({ recoverOnly: true })));
      assert.equal(current.calls.length, calls); assert.equal(current.posts, 1);
    }
  });
  await test("receipt-consistent but non-native audio fails real ffprobe before durable result publication", async () => {
    const invalid = Buffer.from(audio); invalid.writeUInt16LE(1, 20); current.audio = invalid;
    await rejected(run(args())); assert.equal(current.posts, 1);
    assert.ok(!current.objects.has(provenanceKey) && !current.objects.has(candidateKey));
    current.audio = audio; assert.equal((await run(args({ recoverOnly: true }))).status, "completed"); assert.equal(current.posts, 1);
  });
  assert.deepEqual((await readdir(tmpdir())).filter((name) => name.startsWith("yue2-durable-native-")).sort(), beforeDirectories,
    "private native-probe directories are cleaned on success and failure");
  console.log(`yue2DurableEvaluation: ${passed} offline behavioral cases passed`);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  loader._load = originalLoad; globalThis.fetch = originalFetch;
});
