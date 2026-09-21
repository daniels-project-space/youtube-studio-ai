import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createChannelMusicProgram } from "@/engine/channelMusicProgram";
import { createAcceptedMusicArrangement, projectAcceptedMusicArrangementToYuEStyle } from "@/engine/acceptedMusicArrangement";
import { canonicalJson } from "@/lib/canonicalJson";
import {
  assertYuE2Manifest, createYuE2EvaluationRequest, createYuE2AcceptedArrangementRequest, validateYuE2Endpoint, validateYuE2EvaluationRequest,
  verifyYuE2Audio, verifyYuE2Completion, yue2Sha256, YUE2_MANIFEST, YUE2_QUALIFICATION,
  YUE2_RUNTIME_MANIFEST_SHA256, YUE2_WORKER_CONTRACT, YuE2EvaluationClient, YuE2EvaluationError,
  YUE2_ARRANGEMENT_EVALUATION_VERSION, type YuE2SealedReceipt, type YuE2BoundEvaluationRequest,
} from "@/lib/yue2Evaluation";
import { executeYuE2Evaluation, probeYuE2NativeWav, runYuE2EvaluationCli } from "@/scripts/evaluate-yue2-music";

const execute = promisify(execFile);
const program = createChannelMusicProgram({
  channelId: "fixture-channel-not-production", channelIdentityFingerprint: "a".repeat(64),
  family: "music_loop", contentLaneKey: "lofi", topic: "Explicit fixture evaluation",
  genre: "gentle lofi", instrumentation: ["felt piano", "soft drums"],
});
const style = "Gentle lofi, felt piano and soft drums; slow movement, instrumental intent.";
const request = createYuE2EvaluationRequest({ program, style, seed: 42, personalCreatorAcknowledged: true });
const arrangement = createAcceptedMusicArrangement({
  ownerId: "fixture-owner", channelId: "fixture-channel-not-production", runId: "fixture-run",
  topic: "A steady quiet piece", sourceBrief: { musicPrompt: "Keep a flat pulse and end naturally." },
  arrangement: {
    role: "primary_music", direction: "Keep a flat pulse; no added climax or melodic variation.",
    requestedDurationSec: 60, form: "continuous", ending: "natural_cadence", playback: "once",
    sections: ["opening", "first", "second", "ending"].map((id, index) => ({
      id, label: id, startFraction: index / 4, endFraction: (index + 1) / 4, energy: 0.3,
      instruction: index === 3 ? "Resolve once to silence." : "Preserve the same quiet pulse.",
    })),
  },
});
const arrangementRequest = createYuE2AcceptedArrangementRequest({ arrangement, seed: 42, personalCreatorAcknowledged: true });
const clone = <T>(value: T): T => structuredClone(value);
const token = "fixture-bearer-never-log-this-secret-123456";
const executionPolicy = {
  schema_version: 1, provider: "openrelay", allocation_basis: "supervised_dispatch_wall_time",
  rate_source: "operator_configured", rate_reference: "explicit-offline-test-rate", runtime_id: "cpu-fixture",
  hourly_rate_usd_micros: 3600000, max_execution_seconds: 5, termination_grace_seconds: 1,
  reserved_allocation_usd_micros: 6000,
};

// These HTTP fixtures explicitly simulate transport and runtime receipts. FFmpeg
// creates synthetic test audio; ffprobe and all production parsers run unchanged.
function seal(payload: unknown): YuE2SealedReceipt {
  const payload_json = `${canonicalJson(payload)}\n`;
  return { payload_json, sha256: yue2Sha256(payload_json) };
}
function health() {
  return { contract: YUE2_WORKER_CONTRACT, manifest: clone(YUE2_MANIFEST),
    manifest_sha256: YUE2_RUNTIME_MANIFEST_SHA256, qualification: YUE2_QUALIFICATION,
    queue_capacity: 1, worker_state: "ready", error: null,
    readiness_scope: "queue_idle_only_not_gpu_qualification" };
}
function absent() {
  return Response.json({ contract: YUE2_WORKER_CONTRACT, state: "refused", error: "job_not_found" }, { status: 404 });
}
function pending(job = request.job, state = "accepted") {
  return { contract: YUE2_WORKER_CONTRACT, job_id: job.job_id, state, job };
}
function completed(audio: Uint8Array, req: YuE2BoundEvaluationRequest = request, attempt = 1, frames = 4800) {
  const job = seal(req.job);
  const config = seal({ schema_version: 1, manifest: YUE2_MANIFEST, cache_dir: "/explicit-test-cache",
    device: "cuda:0", local_files_only: true, candidate_count: 1,
    exports: ["official_pcm24_flac", "native_float32_wav", "native_float32_npy"] });
  const started = seal({ schema_version: 1, job_id: req.job.job_id, attempt, started_at: "2026-09-19T00:00:00Z",
    pid: 1, job_sha256: job.sha256, config_sha256: config.sha256, environment: { backend: "explicitly_fake_cpu_test" } });
  const receipt = { schema_version: 1, job_id: req.job.job_id, attempt, finished_at: "2026-09-19T00:00:01Z",
    status: "completed", started_sha256: started.sha256, error: null, qualification: YUE2_QUALIFICATION,
    result: { status: "complete", truncated: { abc: false, semantic: false }, sample_rate: 48000, channels: 2,
      frames, audio_seconds: frames / 48000, official_identity: "b".repeat(64),
      timing: { load: { seconds: 1, phases: [0.1, { seconds: 0.2 }] }, plan: { nested: { elapsed: 2 } } },
      native_audio: "audio-native.wav", official_result: "song/result.json" },
    artifacts: { "audio-native.wav": { sha256: yue2Sha256(audio), bytes: audio.length },
      "song/result.json": { sha256: "c".repeat(64), bytes: 23 },
      "empty-evidence.txt": { sha256: yue2Sha256(""), bytes: 0 } },
  };
  const terminal = seal(receipt);
  // Deliberately retain Python's 1.0 spelling: parsing then JSON.stringify differs.
  terminal.payload_json = terminal.payload_json.replace('"seconds":1}', '"seconds":1.0}');
  terminal.sha256 = yue2Sha256(terminal.payload_json);
  return { contract: YUE2_WORKER_CONTRACT, job_id: req.job.job_id, state: "completed", job: req.job,
    job_sha256: job.sha256, config_sha256: config.sha256, accepted_sha256: "d".repeat(64),
    qualification: YUE2_QUALIFICATION, progress: { phase: "terminal", receipt: "terminal.json" },
    receipt, receipt_payloads: { job, config, started, terminal }, error: null,
    artifacts: { "audio-native.wav": `/v1/jobs/${req.job.job_id}/artifacts/audio-native.wav` } };
}

function stub(handler: (path: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    const path = new URL(String(input)).pathname;
    assert.equal(init.redirect, "error");
    assert.ok(init.signal);
    assert.equal(new Headers(init.headers).get("Authorization"), `Bearer ${token}`);
    calls.push({ path, method: init.method ?? "GET", ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) });
    return handler(path, init);
  };
  return { calls, fetcher, client: new YuE2EvaluationClient({ endpoint: "http://127.0.0.1:8787", bearerToken: token, fetch: fetcher, timeoutMs: 100 }) };
}
async function rejected(operation: Promise<unknown>, expectedJobId = request.job.job_id): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof YuE2EvaluationError);
    assert.equal(error.retryable, false);
    assert.equal(error.safeToFallback, false);
    assert.equal(error.jobId, expectedJobId);
    assert.ok(!error.message.includes(token));
    assert.match(error.message, /recover only with GET/);
    return true;
  });
}

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "yue2-evaluation-unit-"));
  const originalFetch = globalThis.fetch;
  let passed = 0;
  async function test(name: string, run: () => void | Promise<void>) {
    await run(); passed += 1; console.log(`PASS ${name}`);
  }
  try {
    const audioPath = join(directory, "fixture.wav");
    await execute("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "0.1", "-c:a", "pcm_f32le", audioPath]);
    const audio = await readFile(audioPath);
    const wire = completed(audio);
    await test("stable ID binds admitted program, exact style, seed, manifest and explicit licence", () => {
      assert.equal(request.job.lyrics, "");
      assert.equal(request.job.style, style);
      assert.equal(request.job.job_id, createYuE2EvaluationRequest({ program, style, seed: 42, personalCreatorAcknowledged: true }).job.job_id);
      for (const variation of [{ style: `${style} `, seed: 42 }, { style, seed: 43 }]) {
        assert.notEqual(request.job.job_id, createYuE2EvaluationRequest({ program, ...variation, personalCreatorAcknowledged: true }).job.job_id);
      }
      const other = createChannelMusicProgram({ channelId: "other", channelIdentityFingerprint: "e".repeat(64), family: "sleep", contentLaneKey: "meditation", topic: "fixture" });
      assert.notEqual(request.job.job_id, createYuE2EvaluationRequest({ program: other, style, seed: 42, personalCreatorAcknowledged: true }).job.job_id);
      assert.throws(() => createYuE2EvaluationRequest({ program, style, seed: 42, personalCreatorAcknowledged: false }));
      assert.throws(() => createYuE2EvaluationRequest({ program: { ...program, fingerprint: "0".repeat(64) }, style, seed: 42, personalCreatorAcknowledged: true }));
      for (const seed of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
        assert.throws(() => createYuE2EvaluationRequest({ program, style, seed, personalCreatorAcknowledged: true }));
      }
      assert.throws(() => validateYuE2EvaluationRequest({ ...request, manifestSha256: "0".repeat(64) }));
      assert.throws(() => validateYuE2EvaluationRequest({ ...request, job: { ...request.job, style: "changed" } }));
      assert.throws(() => validateYuE2EvaluationRequest({ ...request, job: { ...request.job, lyrics: program.generation.lyricsControl } }));
      assert.throws(() => createYuE2EvaluationRequest({ program, style: "\u00e9".repeat(16001), seed: 1, personalCreatorAcknowledged: true }));
    });
    await test("endpoint scheme, credentials, queries, fragments and path restrictions", () => {
      for (const url of ["http://example.org", "https://user:secret@example.org", "https://example.org?", "https://example.org?q=x", "https://example.org/#fragment", "https://example.org/base", "file:///tmp/a", "http://127.0.0.1.evil.invalid", "https://example.org\\oops"]) {
        assert.throws(() => validateYuE2Endpoint(url));
      }
      for (const url of ["https://worker.example", "http://localhost:8787", "http://127.0.0.1:8787", "http://[::1]:8787"]) assert.ok(validateYuE2Endpoint(url));
    });
    await test("bearer exactly matches worker URL-safe 32..512 character contract", () => {
      for (const bearerToken of ["a", "a".repeat(31), "a".repeat(513), "a".repeat(31) + ".", "a".repeat(31) + "/", "a".repeat(31) + "=", "a".repeat(31) + "\n"]) {
        assert.throws(() => new YuE2EvaluationClient({ endpoint: "http://127.0.0.1:8787", bearerToken }));
      }
      for (const bearerToken of ["a".repeat(32), "_".repeat(512), "-".repeat(32)]) {
        assert.ok(new YuE2EvaluationClient({ endpoint: "http://127.0.0.1:8787", bearerToken }));
      }
    });
    await test("Python lexical floats, nested timings, zero-byte evidence and explicit prior attempt", async () => {
      assert.notEqual(seal(wire.receipt).sha256, wire.receipt_payloads.terminal.sha256);
      const parsed = verifyYuE2Completion(request, wire);
      verifyYuE2Audio(parsed, audio);
      await probeYuE2NativeWav(audioPath, parsed.result, audio.length);
      assert.equal(parsed.qualification.production_approved, false);
      assert.equal(verifyYuE2Completion(request, completed(audio, request, 2)).result.frames, 4800);
    });
    await test("durable observation runs before terminal validation or audio and cannot be bypassed by a failed write", async () => {
      for (const state of [pending(request.job), pending(request.job, "failed"), { ...wire, receipt: null }]) {
        let observed = 0;
        const fixture = stub((path) => path.endsWith("/health") ? Response.json(health()) : Response.json(state));
        const operation = fixture.client.evaluate(request, { recoverOnly: true, afterJobObserved: async () => { observed++; } });
        if (state.state === "accepted") assert.equal((await operation).status, "pending");
        else await rejected(operation);
        assert.equal(observed, 1);
        assert.equal(fixture.calls.some((call) => call.method === "POST" || call.path.endsWith(".wav")), false);
      }
      const blocked = stub((path) => path.endsWith("/health") ? Response.json(health()) : Response.json(wire));
      await rejected(blocked.client.evaluate(request, { afterJobObserved: async () => { throw new Error(token); } }));
      assert.equal(blocked.calls.some((call) => call.path.endsWith(".wav")), false);
      const wrong = stub((path) => path.endsWith("/health") ? Response.json(health()) : Response.json({ ...wire, job_id: `yue2-eval-${"0".repeat(64)}` }));
      let wrongObservations = 0;
      await rejected(wrong.client.evaluate(request, { afterJobObserved: async () => { wrongObservations++; } }));
      assert.equal(wrongObservations, 0, "wrong job must not be recorded");
    });
    await test("empty and one-byte audio chunks preserve exact bytes across bounded slabs", async () => {
      const path = join(directory, "multi-slab.wav");
      await execute("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "0.5", "-c:a", "pcm_f32le", path]);
      const largeAudio = await readFile(path);
      assert.ok(largeAudio.length > 2 * 65536);
      const largeWire = completed(largeAudio, request, 1, 24000);
      let offset = 0;
      const fixture = stub((url) => url.endsWith("/health") ? Response.json(health()) : url.endsWith(".wav")
        ? new Response(new ReadableStream<Uint8Array>({ pull(controller) {
            if (offset === largeAudio.length) { controller.close(); return; }
            controller.enqueue(new Uint8Array());
            controller.enqueue(largeAudio.subarray(offset, ++offset));
          } }))
        : Response.json(largeWire));
      const client = new YuE2EvaluationClient({ endpoint: "http://127.0.0.1:8787", bearerToken: token,
        fetch: fixture.fetcher, timeoutMs: 10000, maxAudioBytes: largeAudio.length });
      const result = await client.evaluate(request, { recoverOnly: true });
      assert.equal(result.status, "completed");
      if (result.status === "completed") assert.deepEqual(Buffer.from(result.audio), largeAudio);
      assert.equal(fixture.calls.some((call) => call.method === "POST"), false);
    });
    await test("late audio read cannot restart consumption after timeout when cancellation fails", async () => {
      let reads = 0;
      let release: (value: ReadableStreamReadResult<Uint8Array>) => void = () => undefined;
      const delayed = new Promise<ReadableStreamReadResult<Uint8Array>>((resolveRead) => { release = resolveRead; });
      const late = {
        status: 200, redirected: false, headers: new Headers(),
        body: { getReader: () => ({
          read: () => { reads++; return reads === 1 ? delayed : new Promise(() => undefined); },
          cancel: async () => { throw new Error("synthetic cancellation failure"); },
        }) },
      } as unknown as Response;
      const fixture = stub((path) => path.endsWith("/health") ? Response.json(health()) : path.endsWith(".wav") ? late : Response.json(wire));
      const client = new YuE2EvaluationClient({ endpoint: "http://127.0.0.1:8787", bearerToken: token,
        fetch: fixture.fetcher, timeoutMs: 20 });
      await rejected(client.evaluate(request, { recoverOnly: true }));
      assert.equal(reads, 1);
      release({ done: false, value: audio.subarray(0, 10) });
      await new Promise((done) => setTimeout(done, 10));
      assert.equal(reads, 1, "expired operation must not resume consuming the audio stream");
    });
    await test("immediately resolved empty audio cannot starve the request deadline", async () => {
      let reads = 0;
      const endless = {
        status: 200, redirected: false, headers: new Headers(),
        body: { getReader: () => ({
          read: async () => {
            reads++;
            return reads < 1_000_000 ? { done: false, value: new Uint8Array() } : { done: true };
          },
          cancel: async () => undefined,
        }) },
      } as unknown as Response;
      const fixture = stub((path) => path.endsWith("/health") ? Response.json(health()) : path.endsWith(".wav") ? endless : Response.json(wire));
      const client = new YuE2EvaluationClient({ endpoint: "http://127.0.0.1:8787", bearerToken: token,
        fetch: fixture.fetcher, timeoutMs: 20 });
      await rejected(client.evaluate(request, { recoverOnly: true }));
      assert.ok(reads > 0 && reads < 1_000_000, "absolute deadline must interrupt microtask-only empty chunks");
    });
    await test("native format checked by ffprobe, not trusted from receipt", async () => {
      for (const [rate, channels, codec] of [[44100, 2, "pcm_f32le"], [48000, 1, "pcm_f32le"], [48000, 2, "pcm_s16le"]] as const) {
        const file = join(directory, `${rate}-${channels}-${codec}.wav`);
        await execute("ffmpeg", ["-v", "error", "-i", audioPath, "-ar", String(rate), "-ac", String(channels), "-c:a", codec, file]);
        await assert.rejects(probeYuE2NativeWav(file, verifyYuE2Completion(request, wire).result, (await stat(file)).size));
      }
      await assert.rejects(probeYuE2NativeWav(audioPath, { ...verifyYuE2Completion(request, wire).result, frames: 4799 }, audio.length));
    });
    for (const field of ["source", "model", "vae", "preset", "packages", "qualification", "license"] as const) {
      await test(`wrong ${field} pins fail before any POST`, async () => {
        const changed = health();
        Object.assign(changed.manifest, { [field]: {} });
        assert.throws(() => assertYuE2Manifest(changed.manifest));
        const fixture = stub(() => Response.json(changed));
        await rejected(fixture.client.evaluate(request, { submit: true }));
        assert.equal(fixture.calls.length, 1);
      });
    }
    await test("health Python manifest digest is independent of Studio canonical JSON", async () => {
      assert.notEqual(YUE2_RUNTIME_MANIFEST_SHA256, yue2Sha256(canonicalJson(YUE2_MANIFEST)));
      const fixture = stub(() => Response.json({ ...health(), manifest_sha256: "0".repeat(64) }));
      await rejected(fixture.client.evaluate(request, { submit: true }));
      assert.equal(fixture.calls.length, 1);
    });
    await test("GET existing completed job downloads fixed native path without POST", async () => {
      const hostileUrls = { ...wire, artifacts: { "audio-native.wav": "https://attacker.invalid/steal" } };
      const fixture = stub((path) => path.endsWith("/health") ? Response.json(health()) : path.endsWith(".wav") ? new Response(audio) : Response.json(hostileUrls));
      const outcome = await fixture.client.evaluate(request, { submit: true });
      assert.equal(outcome.status, "completed");
      assert.equal(fixture.calls.filter((call) => call.method === "POST").length, 0);
      assert.equal(fixture.calls.at(-1)?.path, `/v1/jobs/${request.job.job_id}/artifacts/audio-native.wav`);
    });
    await test("accounting transport recovers failed-job evidence with GET only and refuses absent evidence", async () => {
      const failed = pending(request.job, "failed");
      const policy = seal({ test: "transport-only-not-verified" });
      const accounting = { test: "untrusted-until-sealed-accounting-validation" };
      const fixture = stub((path, init) => {
        assert.equal(init.method, "GET");
        if (path === "/v1/execution-policy") return Response.json(policy);
        return Response.json(path.endsWith("/accounting") ? accounting : failed);
      });
      assert.deepEqual(await fixture.client.fetchExecutionPolicy(), policy);
      assert.deepEqual(await fixture.client.fetchExecutionAccounting(request), { statusResponse: failed, accountingResponse: accounting });
      assert.equal(fixture.calls.length, 3);
      const missing = stub(() => absent());
      await assert.rejects(missing.client.fetchExecutionPolicy());
      await rejected(missing.client.fetchExecutionAccounting(request));
      assert.equal(missing.calls.length, 2);
    });

    await test("execution policy hash is validated locally and bound only to submission", async () => {
      let calls = 0;
      const hash = "e".repeat(64);
      const fetcher: typeof fetch = async (url, init = {}) => {
        calls++;
        const isPost = init.method === "POST";
        assert.equal(new Headers(init.headers).get("X-YuE2-Execution-Policy-SHA256"), isPost ? hash : null);
        if (String(url).endsWith("/v1/health")) return Response.json(health());
        if (isPost) {
          assert.deepEqual(JSON.parse(String(init.body)), request.job);
          return Response.json(pending());
        }
        return absent();
      };
      for (const invalid of ["", "E".repeat(64), "e".repeat(63), `${hash}\n`, null, 42]) {
        assert.throws(() => new YuE2EvaluationClient({ endpoint: "http://127.0.0.1:8787", bearerToken: token,
          fetch: fetcher, executionPolicySha256: invalid as string }));
      }
      assert.equal(calls, 0);
      const client = new YuE2EvaluationClient({ endpoint: "http://127.0.0.1:8787", bearerToken: token,
        fetch: fetcher, executionPolicySha256: hash });
      assert.equal((await client.evaluate(request, { submit: true })).status, "pending");
      assert.equal(calls, 3);
    });

    await test("GET missing then at most one exact POST; subsequent GET reuse", async () => {
      let admitted = false;
      const fixture = stub((path, init) => {
        if (path.endsWith("/health")) return Response.json(health());
        if (init.method === "POST") { admitted = true; return Response.json(pending(), { status: 202 }); }
        return admitted ? Response.json(pending()) : absent();
      });
      assert.equal((await fixture.client.evaluate(request, { submit: true })).status, "pending");
      assert.equal((await fixture.client.evaluate(request, { submit: true })).status, "pending");
      assert.deepEqual(fixture.calls.find((call) => call.method === "POST")?.body, request.job);
      assert.equal(fixture.calls.filter((call) => call.method === "POST").length, 1);
    });
    for (const failure of ["throw", "http", "malformed", "mismatched", "timeout"] as const) {
      await test(`ambiguous POST ${failure} never replays even if recovery GET says missing`, async () => {
        const fixture = stub((path, init) => {
          if (path.endsWith("/health")) return Response.json(health());
          if (init.method !== "POST") return absent();
          if (failure === "throw") throw new Error(token);
          if (failure === "http") return Response.json({ error: token }, { status: 500 });
          if (failure === "malformed") return new Response("invalid");
          if (failure === "mismatched") return Response.json(pending({ ...request.job, seed: 10 }));
          return new Promise<Response>(() => undefined);
        });
        await rejected(fixture.client.evaluate(request, { submit: true }));
        await rejected(fixture.client.evaluate(request, { submit: true }));
        assert.equal(fixture.calls.filter((call) => call.method === "POST").length, 1);
      });
    }
    await test("ambiguous submission recovers same ID by GET when result becomes available", async () => {
      let recover = false;
      const fixture = stub((path, init) => {
        if (path.endsWith("/health")) return Response.json(health());
        if (path.endsWith(".wav")) return new Response(audio);
        if (init.method === "POST") throw new Error("simulated connection loss");
        return recover ? Response.json(wire) : absent();
      });
      await rejected(fixture.client.evaluate(request, { submit: true }));
      recover = true;
      assert.equal((await fixture.client.evaluate(request, { submit: true })).status, "completed");
      assert.equal(fixture.calls.filter((call) => call.method === "POST").length, 1);
    });
    for (const state of ["failed", "ambiguous", "refused"]) {
      await test(`existing ${state} is never resubmitted`, async () => {
        const fixture = stub((path) => Response.json(path.endsWith("/health") ? health() : pending(request.job, state)));
        await rejected(fixture.client.evaluate(request, { submit: true }));
        assert.equal(fixture.calls.filter((call) => call.method === "POST").length, 0);
      });
    }
    await test("missing-job refusal, explicit recovery and busy health never POST", async () => {
      for (const options of [{}, { submit: true, recoverOnly: true }, { submit: true, beforeSubmit: async () => false }]) {
        const fixture = stub((path) => path.endsWith("/health") ? Response.json(health()) : absent());
        await rejected(fixture.client.evaluate(request, options));
        assert.equal(fixture.calls.filter((call) => call.method === "POST").length, 0);
      }
      const fixture = stub((path) => path.endsWith("/health") ? Response.json({ ...health(), worker_state: "busy" }) : absent());
      await rejected(fixture.client.evaluate(request, { submit: true }));
      assert.equal(fixture.calls.length, 2);
    });
    await test("unrecognized 404 does not authorize POST", async () => {
      const fixture = stub((path) => path.endsWith("/health") ? Response.json(health()) : new Response("not found", { status: 404 }));
      await rejected(fixture.client.evaluate(request, { submit: true }));
      assert.equal(fixture.calls.length, 2);
    });
    await test("concurrent callers share an in-memory at-most-once reservation", async () => {
      const fixture = stub((path, init) => path.endsWith("/health") ? Response.json(health()) : init.method === "POST" ? Response.json(pending()) : absent());
      const outcomes = await Promise.allSettled([
        fixture.client.evaluate(request, { submit: true, beforeSubmit: async () => { await new Promise((done) => setTimeout(done, 10)); return true; } }),
        fixture.client.evaluate(request, { submit: true }),
      ]);
      assert.equal(outcomes.filter((value) => value.status === "fulfilled").length, 1);
      assert.equal(fixture.calls.filter((call) => call.method === "POST").length, 1);
    });
    for (const mutation of ["job", "hash", "chain", "terminal", "attempt", "qualification", "truncated", "length", "config"] as const) {
      await test(`reject ${mutation} mismatch in completed receipt`, () => {
        const altered = clone(wire);
        if (mutation === "job") altered.job = { ...altered.job, seed: 7 };
        if (mutation === "hash") altered.receipt_payloads.terminal.sha256 = "0".repeat(64);
        if (mutation === "chain") altered.receipt.started_sha256 = "0".repeat(64);
        if (mutation === "terminal") altered.receipt.result.frames += 1;
        if (mutation === "attempt") altered.receipt.attempt = 2;
        if (mutation === "qualification") Object.assign(altered.receipt.qualification, { production_approved: true });
        if (mutation === "truncated") altered.receipt.result.truncated.abc = true;
        if (mutation === "length") altered.receipt.result.audio_seconds = 99;
        if (mutation === "config") {
          const payload = JSON.parse(altered.receipt_payloads.config.payload_json);
          payload.manifest.vae.repository = "wrong-decoder";
          altered.receipt_payloads.config = seal(payload);
        }
        if (!["hash", "config"].includes(mutation)) altered.receipt_payloads.terminal = seal(altered.receipt);
        assert.throws(() => verifyYuE2Completion(request, altered));
      });
    }
    await test("tampered bytes and declared native length fail before success", async () => {
      for (const corrupt of [Buffer.concat([audio, Buffer.from([0])]), Buffer.from(audio)]) {
        corrupt[100] ^= 1;
        const fixture = stub((path) => path.endsWith("/health") ? Response.json(health()) : path.endsWith(".wav") ? new Response(corrupt) : Response.json(wire));
        await rejected(fixture.client.evaluate(request));
      }
    });
    for (const kind of ["declared", "streamed", "stalled-fetch", "stalled-body", "redirect"] as const) {
      await test(`bounded response ${kind} fails closed`, async () => {
        const fixture = stub(() => {
          if (kind === "declared") return new Response("{}", { headers: { "content-length": "9999999" } });
          if (kind === "streamed") return new Response("x".repeat(300));
          if (kind === "stalled-fetch") return new Promise<Response>(() => undefined);
          if (kind === "stalled-body") return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([123])); } }));
          return Response.redirect("https://attacker.invalid/", 302);
        });
        const client = new YuE2EvaluationClient({ endpoint: "https://worker.example", bearerToken: token, fetch: fixture.fetcher, timeoutMs: 15, maxResponseBytes: 256 });
        await rejected(client.evaluate(request, { submit: true }));
        assert.equal(fixture.calls.length, 1);
      });
    }
    await test("audio byte limit is enforced before download", async () => {
      const fixture = stub((path) => Response.json(path.endsWith("/health") ? health() : wire));
      const client = new YuE2EvaluationClient({ endpoint: "https://worker.example", bearerToken: token, fetch: fixture.fetcher, maxAudioBytes: 100 });
      await rejected(client.evaluate(request));
      assert.equal(fixture.calls.length, 2);
    });
    await test("CLI defaults to validation with explicit source files and no network or output artifacts", async () => {
      const programPath = join(directory, "program.json");
      const stylePath = join(directory, "style.txt");
      await writeFile(programPath, JSON.stringify(program));
      await writeFile(stylePath, style);
      globalThis.fetch = async () => { assert.fail("dry run must not use network"); };
      const logs: string[] = [];
      const log = console.log;
      console.log = (value: string) => { logs.push(value); };
      try {
        await runYuE2EvaluationCli(["--program", programPath, "--style-file", stylePath, "--seed", "42", "--personal-creator", "--out", join(directory, "unused")], {});
      } finally { console.log = log; }
      assert.equal(JSON.parse(logs[0]).mode, "validate_only");
      assert.equal(JSON.parse(logs[0]).request.job.job_id, request.job.job_id);
      await assert.rejects(stat(join(directory, "unused")), { code: "ENOENT" });
      await assert.rejects(runYuE2EvaluationCli(["--program", programPath, "--style-file", stylePath, "--seed", "42"], {}));
    });
    await test("CLI persists immutable unqualified candidate; cache reuse revalidates bytes and real format without network", async () => {
      const fixture = stub((path) => path.endsWith("/health") ? Response.json(health()) : path.endsWith(".wav") ? new Response(audio) : Response.json(wire));
      globalThis.fetch = fixture.fetcher;
      const input = { request, outputRoot: join(directory, "cache"), endpoint: "http://127.0.0.1:8787", bearerToken: token };
      const first = await executeYuE2Evaluation(input);
      const candidatePath = join(first.directory, "candidate.json");
      const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
      assert.equal(candidate.qualified, false);
      assert.equal(candidate.manualAudition, "pending");
      assert.equal(candidate.costStatus, "not_measured");
      assert.equal((await stat(candidatePath)).mode & 0o222, 0);
      globalThis.fetch = async () => { assert.fail("verified immutable cache uses no network"); };
      assert.equal((await executeYuE2Evaluation(input)).reused, true);
      const storedAudio = join(first.directory, "audio-native.wav");
      await chmod(storedAudio, 0o600);
      const corrupt = Buffer.from(audio); corrupt[100] ^= 1;
      await writeFile(storedAudio, corrupt);
      await assert.rejects(executeYuE2Evaluation(input));
    });
    await test("durable CLI marker prevents a new client POST after ambiguous response", async () => {
      const fixture = stub((path, init) => {
        if (path.endsWith("/health")) return Response.json(health());
        if (init.method === "POST") throw new Error(token);
        return absent();
      });
      globalThis.fetch = fixture.fetcher;
      const input = { request, outputRoot: join(directory, "ambiguous"), endpoint: "http://127.0.0.1:8787", bearerToken: token };
      await rejected(executeYuE2Evaluation(input));
      await rejected(executeYuE2Evaluation(input));
      assert.equal(fixture.calls.filter((call) => call.method === "POST").length, 1);
      assert.equal((await stat(join(input.outputRoot, request.job.job_id, "submission-attempt.json"))).mode & 0o222, 0);
    });
    await test("accepted arrangement entry retains exact artifact and deterministic projected style without independent overrides", () => {
      assert.equal(arrangementRequest.version, YUE2_ARRANGEMENT_EVALUATION_VERSION);
      assert.equal(arrangementRequest.programFingerprint, arrangement.fingerprint);
      assert.deepEqual(arrangementRequest.acceptedArrangement, arrangement);
      assert.equal(arrangementRequest.job.style, projectAcceptedMusicArrangementToYuEStyle(arrangement));
      assert.equal(arrangementRequest.job.lyrics, "");
      assert.equal(arrangementRequest.job.schema_version, 2);
      assert.ok(arrangementRequest.job.schema_version === 2);
      assert.equal(arrangementRequest.job.requested_duration_sec, arrangement.arrangement.requestedDurationSec);
      assert.deepEqual(validateYuE2EvaluationRequest(arrangementRequest), arrangementRequest);
      assert.deepEqual(createYuE2AcceptedArrangementRequest({ arrangement, seed: 42, personalCreatorAcknowledged: true }), arrangementRequest);
      assert.notEqual(createYuE2AcceptedArrangementRequest({ arrangement, seed: 43, personalCreatorAcknowledged: true }).job.job_id, arrangementRequest.job.job_id);
      assert.throws(() => createYuE2AcceptedArrangementRequest({ arrangement, seed: 42, personalCreatorAcknowledged: false }));
      const override = { arrangement, seed: 42, personalCreatorAcknowledged: true, style: "Replace accepted direction" };
      assert.throws(() => createYuE2AcceptedArrangementRequest(override));
      assert.throws(() => validateYuE2EvaluationRequest({ ...arrangementRequest, style: "Replace accepted direction" }));
      assert.equal(request.version, "studio-yue2-evaluation/v1");
      assert.equal(Object.hasOwn(request, "acceptedArrangement"), false);
    });
    await test("duration is bound independently of prose and retained v1 jobs remain readable", () => {
      assert.ok(arrangementRequest.job.schema_version === 2);
      const { requested_duration_sec: duration, ...legacyFields } = arrangementRequest.job;
      const legacy = { ...arrangementRequest, job: { ...legacyFields, schema_version: 1 as const } };
      const rehash = (value: typeof arrangementRequest) => {
        const { job_id, ...body } = value.job;
        assert.match(job_id, /^yue2-eval-/);
        value.job.job_id = `yue2-eval-${yue2Sha256(canonicalJson({ version: value.version,
          programFingerprint: value.programFingerprint, manifestSha256: value.manifestSha256, request: body }))}`;
      };
      rehash(legacy);
      assert.deepEqual(validateYuE2EvaluationRequest(legacy), legacy);
      const changed = { ...arrangementRequest, job: { ...arrangementRequest.job, requested_duration_sec: duration + 1 } };
      rehash(changed);
      assert.throws(() => validateYuE2EvaluationRequest(changed), /accepted arrangement/);
      for (const invalid of [true, 9, 301, 30.5, "30", null]) {
        assert.throws(() => validateYuE2EvaluationRequest({ ...arrangementRequest,
          job: { ...arrangementRequest.job, requested_duration_sec: invalid } }));
      }
      assert.notEqual(legacy.job.job_id, arrangementRequest.job.job_id);
    });
    await test("explicit symbolic score binds exact bytes without replacing accepted direction", () => {
      const symbolicScore = "Explicit CPU text fixture; native structural validation belongs to the runtime.";
      const scored = createYuE2AcceptedArrangementRequest({ arrangement, seed: 42, personalCreatorAcknowledged: true, symbolicScore });
      assert.ok(scored.job.schema_version === 2);
      assert.equal(scored.job.abc, symbolicScore);
      assert.equal(scored.job.style, arrangementRequest.job.style);
      assert.deepEqual(scored.acceptedArrangement, arrangementRequest.acceptedArrangement);
      assert.notEqual(scored.job.job_id, arrangementRequest.job.job_id);
      assert.deepEqual(validateYuE2EvaluationRequest(scored), scored);
      assert.throws(() => validateYuE2EvaluationRequest({ ...scored, job: { ...scored.job, abc: `${symbolicScore}\n` } }));
      for (const score of [" ", "a".repeat(32001), "\u00e9".repeat(16001)]) {
        assert.throws(() => createYuE2AcceptedArrangementRequest({ arrangement, seed: 42, personalCreatorAcknowledged: true, symbolicScore: score }));
      }
    });
    await test("tampered arrangement, fingerprint and independently rehashed style fail before any HTTP or output directory", async () => {
      const changedArtifact = clone(arrangementRequest);
      changedArtifact.acceptedArrangement.arrangement.sections[0].energy = 0.9;
      const changedStyle = clone(arrangementRequest);
      changedStyle.job.style += " Add an unaccepted climax.";
      const { job_id: previousId, ...body } = changedStyle.job;
      assert.equal(previousId, arrangementRequest.job.job_id);
      changedStyle.job.job_id = `yue2-eval-${yue2Sha256(canonicalJson({
        version: changedStyle.version, programFingerprint: changedStyle.programFingerprint,
        manifestSha256: changedStyle.manifestSha256, request: body,
      }))}`;
      const { acceptedArrangement: removed, ...missingArtifact } = arrangementRequest;
      assert.deepEqual(removed, arrangement);
      const fixture = stub(() => { assert.fail("invalid arrangement must be rejected before health GET"); });
      for (const invalid of [changedArtifact, changedStyle, missingArtifact,
        { ...arrangementRequest, programFingerprint: "0".repeat(64) },
        { ...arrangementRequest, job: { ...arrangementRequest.job, job_id: request.job.job_id } },
        { ...arrangementRequest, acceptedArrangement: { ...arrangement, unknown: "field" } },
      ]) {
        await assert.rejects(fixture.client.evaluate(invalid, { submit: true }));
      }
      assert.equal(fixture.calls.length, 0);
      globalThis.fetch = fixture.fetcher;
      const outputRoot = join(directory, "invalid-arrangement-output");
      await assert.rejects(executeYuE2Evaluation({ request: changedStyle, outputRoot, endpoint: "http://127.0.0.1:8787", bearerToken: token }));
      await assert.rejects(stat(outputRoot), { code: "ENOENT" });
      assert.equal(fixture.calls.length, 0);
    });
    await test("actual CLI arrangement creation is validate-only, mutually exclusive, and refuses tampered files before HTTP", async () => {
      const arrangementPath = join(directory, "arrangement.json");
      const outputRoot = join(directory, "arrangement-dry-run");
      await writeFile(arrangementPath, JSON.stringify(arrangement));
      const args = ["--arrangement", arrangementPath, "--seed", "42", "--personal-creator", "--out", outputRoot];
      const fixture = stub(() => { assert.fail("validate-only and invalid CLI input must not contact worker"); });
      globalThis.fetch = fixture.fetcher;
      const logs: string[] = [];
      const log = console.log;
      console.log = (value: string) => { logs.push(value); };
      try {
        await runYuE2EvaluationCli(args, {});
      } finally { console.log = log; }
      assert.deepEqual(JSON.parse(logs[0]).request, arrangementRequest);
      assert.equal(JSON.parse(logs[0]).networkRequests, 0);
      const cli = await execute(process.execPath, ["--import", "tsx", "src/scripts/evaluate-yue2-music.ts", ...args]);
      assert.deepEqual(JSON.parse(cli.stdout).request, arrangementRequest);
      assert.equal(JSON.parse(cli.stdout).mode, "validate_only");
      const scorePath = join(directory, "explicit-score.abc");
      const symbolicScore = "CPU fixture: runtime structural validation remains pending.";
      await writeFile(scorePath, symbolicScore);
      const scoredCli = await execute(process.execPath, ["--import", "tsx", "src/scripts/evaluate-yue2-music.ts", ...args, "--score-file", scorePath]);
      const scoredOutput = JSON.parse(scoredCli.stdout);
      assert.equal(scoredOutput.symbolicScoreValidation, "runtime_pending");
      assert.equal(scoredOutput.request.job.abc, symbolicScore);
      assert.notEqual(scoredOutput.request.job.job_id, arrangementRequest.job.job_id);
      assert.equal(scoredOutput.networkRequests, 0);
      await assert.rejects(stat(outputRoot), { code: "ENOENT" });
      for (const extra of [["--program", "unused.json"], ["--style-file", "unused.txt"], ["--style", "unused.txt"], ["--recover-only"], ["--durable-r2"]]) {
        await assert.rejects(runYuE2EvaluationCli([...args, ...extra], {}));
      }
      const changed = clone(arrangement);
      changed.arrangement.ending = "seamless_wrap";
      await writeFile(arrangementPath, JSON.stringify(changed));
      await assert.rejects(runYuE2EvaluationCli([...args, "--submit"], {
        YUE2_EVALUATION_URL: "http://127.0.0.1:8787", YUE2_EVALUATION_TOKEN: token,
      }));
      assert.equal(fixture.calls.length, 0);
      await writeFile(arrangementPath, JSON.stringify(arrangement));
    });
    await test("durable R2 CLI is opt-in, arrangement-only and validate-only without submit", async () => {
      const arrangementPath = join(directory, "durable-arrangement.json");
      await writeFile(arrangementPath, JSON.stringify(arrangement));
      const args = ["--arrangement", arrangementPath, "--seed", "42", "--personal-creator", "--durable-r2"];
      globalThis.fetch = async () => { assert.fail("durable dry-run must not access worker or vault"); };
      const logs: string[] = [];
      const log = console.log;
      console.log = (value: string) => { logs.push(value); };
      try { await runYuE2EvaluationCli(args, {}); } finally { console.log = log; }
      const result = JSON.parse(logs[0]);
      assert.equal(result.mode, "validate_only");
      assert.equal(result.storage, "r2");
      assert.equal(result.networkRequests, 0);
      assert.equal(result.costStatus, "not_measured");
      assert.deepEqual(result.request, arrangementRequest);
      for (const extra of [["--out", "unused"], ["--recover-only"], ["--durable-r2"], ["--submit"]]) {
        await assert.rejects(runYuE2EvaluationCli([...args, ...extra], {}));
      }
      await assert.rejects(runYuE2EvaluationCli(["--program", "unused.json", "--style-file", "unused.txt", "--seed", "42", "--personal-creator", "--durable-r2"], {}));
      const unsafeArrangement = createAcceptedMusicArrangement({
        ownerId: "../other-owner", channelId: arrangement.channelId, runId: arrangement.runId,
        topic: arrangement.topic, sourceBrief: {}, arrangement: arrangement.arrangement,
      });
      await writeFile(arrangementPath, JSON.stringify(unsafeArrangement));
      let networkCalls = 0;
      globalThis.fetch = async () => { networkCalls++; throw new Error("invalid scope must fail before bootstrap"); };
      await assert.rejects(runYuE2EvaluationCli([...args, "--submit"], {
        YUE2_EVALUATION_URL: "http://127.0.0.1:8787", YUE2_EVALUATION_TOKEN: token,
      }));
      assert.equal(networkCalls, 0);
    });
    await test("execution-policy CLI validation freezes exact terms without credentials, network or GPU", async () => {
      const arrangementPath = join(directory, "policy-arrangement.json");
      const policyPath = join(directory, "execution-policy.json");
      await writeFile(arrangementPath, JSON.stringify(arrangement));
      const args = ["--arrangement", arrangementPath, "--seed", "42", "--personal-creator", "--durable-r2", "--execution-policy", policyPath];
      globalThis.fetch = async () => { assert.fail("policy validation must not access any network"); };
      const noSecrets = new Proxy({}, { get() { assert.fail("validation must precede credential reads"); } });
      for (const policy of [executionPolicy, { ...executionPolicy, hourly_rate_usd_micros: 7200000, reserved_allocation_usd_micros: 12000 }]) {
        await writeFile(policyPath, JSON.stringify(policy));
        const logs: string[] = [];
        const log = console.log;
        console.log = (value: string) => { logs.push(value); };
        try { await runYuE2EvaluationCli(args, noSecrets); } finally { console.log = log; }
        const result = JSON.parse(logs[0]);
        assert.deepEqual(result.expectedExecutionPolicy, policy, "never silently substitute an earlier rate");
        assert.deepEqual(result.request, arrangementRequest);
        assert.equal(result.costBasis, "operator_configured_allocation_estimate");
        assert.equal(result.providerBilling, "unknown");
        assert.equal(result.costStatus, "not_measured");
        assert.equal(result.networkRequests, 0);
        assert.equal(result.mode, "validate_only");
        assert.equal(result.qualification.production_approved, false);
      }
      const cli = await execute(process.execPath, ["--import", "tsx", "src/scripts/evaluate-yue2-music.ts", ...args]);
      assert.equal(JSON.parse(cli.stdout).expectedExecutionPolicy.hourly_rate_usd_micros, 7200000);
      assert.equal(JSON.parse(cli.stdout).networkRequests, 0);
    });
    await test("malformed or underreserved execution policies fail before secret or external IO even with submit", async () => {
      const policyPath = join(directory, "invalid-execution-policy.json");
      const args = ["--arrangement", "must-not-read-arrangement.json", "--seed", "42", "--personal-creator", "--durable-r2", "--execution-policy", policyPath];
      let secrets = 0;
      let network = 0;
      const noSecrets = new Proxy({}, { get() { secrets++; throw new Error("unexpected secret read"); } });
      globalThis.fetch = async () => { network++; throw new Error("unexpected network IO"); };
      const missingRate = { ...executionPolicy } as Record<string, unknown>;
      delete missingRate.hourly_rate_usd_micros;
      const invalidPolicies = ["{", "null", "[]", JSON.stringify(missingRate),
        JSON.stringify({ ...executionPolicy, hourly_rate_usd_micros: 7200000 }),
        JSON.stringify({ ...executionPolicy, hourly_rate_usd_micros: 1.5 }),
        JSON.stringify({ ...executionPolicy, max_execution_seconds: 0 }),
        JSON.stringify({ ...executionPolicy, extra: true }),
        JSON.stringify({ ...executionPolicy, rate_reference: "x".repeat(65536) }),
        Buffer.from([0xff, 0xfe])];
      for (const contents of invalidPolicies) {
        await writeFile(policyPath, contents);
        for (const extra of [[], ["--submit"], ["--submit", "--recover-only"]]) {
          await assert.rejects(runYuE2EvaluationCli([...args, ...extra], noSecrets), (error: unknown) => {
            assert.notEqual((error as NodeJS.ErrnoException).code, "ENOENT", "reject policy before reading arrangement");
            return true;
          });
        }
      }
      assert.equal(secrets, 0);
      assert.equal(network, 0);
      for (const extra of [["--execution-policy"], ["--execution-policy", "missing.json", "--execution-policy", "duplicate.json"]]) {
        await assert.rejects(runYuE2EvaluationCli(["--durable-r2", ...extra], noSecrets));
      }
      await assert.rejects(runYuE2EvaluationCli(["--arrangement", "unused.json", "--seed", "42", "--personal-creator", "--execution-policy", policyPath], noSecrets), /requires --durable-r2/);
      await assert.rejects(runYuE2EvaluationCli(["--program", "unused.json", "--style-file", "unused.txt", "--seed", "42", "--personal-creator", "--execution-policy", policyPath, "--submit"], noSecrets), /requires --durable-r2/);
    });
    await test("actual CLI forwards validated expected policy through pure validation before bootstrap and durable execution", async () => {
      const policyPath = join(directory, "forward-execution-policy.json");
      await writeFile(policyPath, JSON.stringify(executionPolicy));
      const args = ["--arrangement", join(directory, "policy-arrangement.json"), "--seed", "42", "--personal-creator", "--durable-r2", "--execution-policy", policyPath, "--submit"];
      // Intercept only external boundaries in a fresh process; execute the real CLI parser and policy validator.
      const harness = `
        const assert = require("node:assert/strict");
        const Module = require("node:module");
        const events = [];
        const policy = ${JSON.stringify(executionPolicy)};
        globalThis.fetch = async () => { throw new Error("No live IO allowed"); };
        globalThis.cliTestBoundaries = {
            bootstrapSecrets: async () => { events.push("bootstrap"); },
            validateDurableYuE2Evaluation(input) { assert.deepEqual(input.expectedExecutionPolicy, policy); events.push("validate"); },
            async executeDurableYuE2Evaluation(input) {
              assert.deepEqual(input.expectedExecutionPolicy, policy);
              assert.equal(input.recoverOnly, false);
              await input.authorizeSubmission();
              events.push("execute");
              return { status: "pending", jobId: input.request.job.job_id, reused: false, bindingKey: "fixture", workerStatus: "accepted" };
            }
        };
        Module.registerHooks({ resolve(id, context, next) {
          let names;
          if (/\\/bootstrap(?:\\.ts)?$/.test(id)) names = ["bootstrapSecrets"];
          if (/\\/yue2DurableEvaluation(?:\\.ts)?$/.test(id)) names = ["validateDurableYuE2Evaluation", "executeDurableYuE2Evaluation"];
          if (names) return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(
            names.map(name => "export const " + name + " = globalThis.cliTestBoundaries." + name + ";").join("\\n")) };
          return next(id, context);
        } });
        require("./src/scripts/evaluate-yue2-music.ts").runYuE2EvaluationCli(${JSON.stringify(args)}, {
          YUE2_EVALUATION_URL: "http://127.0.0.1:8787", YUE2_EVALUATION_TOKEN: ${JSON.stringify(token)}
        }).then(() => { assert.deepEqual(events, ["validate", "bootstrap", "execute"]); }, error => { console.error(error); process.exitCode = 1; });
      `;
      const result = await execute(process.execPath, ["--import", "tsx", "--eval", harness], {
        env: { NODE_ENV: "test", PATH: process.env.PATH, HOME: process.env.HOME },
      });
      assert.equal(JSON.parse(result.stdout).status, "pending");
      assert.ok(!result.stdout.includes(token));
    });
    await test("arrangement CLI candidate retains artifact and native FLOAT audio; verified cache is GET-free and remains unqualified", async () => {
      const arrangementWire = completed(audio, arrangementRequest);
      const fixture = stub((path) => path.endsWith("/health") ? Response.json(health()) : path.endsWith(".wav") ? new Response(audio) : Response.json(arrangementWire));
      globalThis.fetch = fixture.fetcher;
      const outputRoot = join(directory, "arrangement-candidate");
      const args = ["--arrangement", join(directory, "arrangement.json"), "--seed", "42", "--personal-creator", "--out", outputRoot, "--submit"];
      const environment = { YUE2_EVALUATION_URL: "http://127.0.0.1:8787", YUE2_EVALUATION_TOKEN: token };
      const log = console.log;
      console.log = () => undefined;
      try {
        await runYuE2EvaluationCli(args, environment);
        globalThis.fetch = async () => { assert.fail("accepted-arrangement cache must not use HTTP"); };
        await runYuE2EvaluationCli(args, environment);
      } finally { console.log = log; }
      const candidatePath = join(outputRoot, arrangementRequest.job.job_id, "candidate.json");
      const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
      assert.deepEqual(candidate.acceptedArrangement, arrangement);
      assert.equal(candidate.programFingerprint, arrangement.fingerprint);
      assert.equal(candidate.qualified, false);
      assert.equal(candidate.productionApproved, false);
      assert.equal(candidate.manualAudition, "pending");
      assert.equal(candidate.nativeFormatVerified, true);
      assert.equal(candidate.audioSha256, yue2Sha256(audio));
      assert.deepEqual(JSON.parse(await readFile(join(outputRoot, arrangementRequest.job.job_id, "request.json"), "utf8")), arrangementRequest);
      await chmod(candidatePath, 0o600);
      delete candidate.acceptedArrangement;
      await writeFile(candidatePath, JSON.stringify(candidate));
      await assert.rejects(executeYuE2Evaluation({ request: arrangementRequest, outputRoot, endpoint: environment.YUE2_EVALUATION_URL, bearerToken: token }), /accepted arrangement mismatch/);
      assert.equal(fixture.calls.filter(call => call.method === "POST").length, 0);
    });
    await test("arrangement single-purchase worker body is unchanged and durable ambiguous recovery is GET-only", async () => {
      const fixture = stub((path, init) => {
        if (path.endsWith("/health")) return Response.json(health());
        if (init.method === "POST") throw new Error("simulated lost acceptance");
        return absent();
      });
      globalThis.fetch = fixture.fetcher;
      const input = { request: arrangementRequest, outputRoot: join(directory, "arrangement-ambiguous"), endpoint: "http://127.0.0.1:8787", bearerToken: token };
      await rejected(executeYuE2Evaluation(input), arrangementRequest.job.job_id);
      await rejected(executeYuE2Evaluation({ ...input, recoverOnly: true }), arrangementRequest.job.job_id);
      await rejected(executeYuE2Evaluation(input), arrangementRequest.job.job_id);
      const posts = fixture.calls.filter(call => call.method === "POST");
      assert.equal(posts.length, 1);
      assert.deepEqual(posts[0].body, arrangementRequest.job);
      assert.equal(Object.hasOwn(posts[0].body as object, "acceptedArrangement"), false);
    });
    console.log(`YUE2 EVALUATION PASS: ${passed} checks; synthetic audio and stubbed HTTP only; no GPU or quality qualification`);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
