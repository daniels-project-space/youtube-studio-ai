import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { createAcceptedMusicArrangement } from "../src/engine/acceptedMusicArrangement";
import { createYuE2AcceptedArrangementRequest, YUE2_WORKER_CONTRACT } from "../src/lib/yue2Evaluation";

const execute = promisify(execFile);
const repo = resolve(import.meta.dirname, "..");
const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
}

// A deliberately local S3 wire fixture: real SDK signing, body transfer and
// atomic If-None-Match semantics, not a replacement for the storage module.
function memoryS3() {
  const objects = new Map<string, Buffer>();
  const requests: Array<{ method: string; key: string }> = [];
  let collisions = 0;
  const errors: unknown[] = [];
  let initialReaders = 0;
  let releaseInitialReaders: (() => void) | undefined;
  const initialReads = new Promise<void>((done) => { releaseInitialReaders = done; });
  const server = createServer((request, response) => {
    void (async () => {
      assert.match(request.headers.authorization ?? "", /Credential=testaccess\//);
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      assert.ok(path.startsWith("/test/"), "only the synthetic bucket is accessible");
      const key = decodeURIComponent(path.slice("/test/".length));
      const method = request.method ?? "";
      requests.push({ method, key });
      const reject = (status: number, code: string) => {
        response.writeHead(status, { "content-type": "application/xml", "x-amz-request-id": "synthetic" });
        response.end(`<Error><Code>${code}</Code><Message>synthetic fixture refusal</Message></Error>`);
      };
      if (method === "PUT") {
        assert.equal(request.headers["if-none-match"], "*", "every durable write must be create-only");
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const bytes = Buffer.concat(chunks);
        assert.ok(bytes.length <= 4 * 1024 * 1024, "CPU fixture must stay small");
        if (objects.has(key)) { collisions++; reject(412, "PreconditionFailed"); return; }
        objects.set(key, bytes);
        response.writeHead(200, { etag: `"${createHash("md5").update(bytes).digest("hex")}"` });
        response.end();
        return;
      }
      assert.ok(method === "GET" || method === "HEAD", "no list/delete or other storage operations");
      const bytes = objects.get(key);
      if (!bytes && method === "GET" && key === "owner/durable-owner/runs/durable-run/music/yue2-evaluation/binding.json") {
        initialReaders++;
        if (initialReaders === 2) releaseInitialReaders!();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([initialReads, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("concurrent binding reader did not arrive")), 10_000);
          })]);
        } finally { if (timer) clearTimeout(timer); }
      }
      if (!bytes) { reject(404, "NoSuchKey"); return; }
      response.writeHead(200, {
        "content-length": bytes.length,
        "content-type": key.endsWith(".wav") ? "audio/wav" : "application/json",
        etag: `"${createHash("md5").update(bytes).digest("hex")}"`,
      });
      response.end(method === "HEAD" ? undefined : bytes);
    })().catch((error: unknown) => {
      errors.push(error);
      response.writeHead(500); response.end("fixture failed");
    });
  });
  return { server, objects, requests, errors, collisions: () => collisions };
}

async function main(): Promise<void> {
  const runtime = process.env.YUE2_TEST_RUNTIME;
  if (!runtime) throw new Error("Set YUE2_TEST_RUNTIME to the isolated runtime checkout");
  const root = await mkdtemp(join(tmpdir(), "studio-yue2-durable-"));
  const s3 = memoryS3();
  const worker = spawn(join(runtime, ".venv-test/bin/python"), [
    join(runtime, "tests/serve_cpu_fixture.py"), "--root", join(root, "worker"),
  ], { cwd: runtime, env: { NODE_ENV: "test" as const, PATH: process.env.PATH, PYTHONPATH: join(runtime, "src") }, stdio: ["pipe", "pipe", "pipe"] });
  const closed = once(worker, "close");
  const lines = createInterface({ input: worker.stdout });
  const messages: Array<Record<string, unknown>> = [];
  let workerError = "";
  worker.stderr.on("data", (bytes: Buffer) => { workerError = (workerError + bytes.toString()).slice(-4096); });
  lines.on("line", (line) => { messages.push(JSON.parse(line)); });
  const workerRequests: Array<{ method: string; path: string }> = [];
  const observedOnce = new Map<string, Record<string, unknown>>();
  let workerEndpoint = "";
  let losePost = true;
  const proxyErrors: unknown[] = [];
  const proxy = createServer((request, response) => {
    void (async () => {
      const method = request.method ?? "GET";
      const path = request.url ?? "/";
      workerRequests.push({ method, path });
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const observed = method === "GET" ? observedOnce.get(path) : undefined;
      if (observed) {
        observedOnce.delete(path);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(observed));
        return;
      }
      if (method === "POST") await delay(250);
      const upstream = await fetch(`${workerEndpoint}${path}`, {
        method, redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { authorization: request.headers.authorization ?? "", "content-type": "application/json" },
        ...(method === "POST" ? { body: Buffer.concat(chunks) } : {}),
      });
      const bytes = Buffer.from(await upstream.arrayBuffer());
      if (method === "POST" && losePost) {
        assert.equal(upstream.ok, true, "drop only a successfully accepted POST response");
        losePost = false;
        response.destroy();
        return;
      }
      response.writeHead(upstream.status, {
        "content-type": upstream.headers.get("content-type") ?? "application/json", "content-length": bytes.length,
      });
      response.end(bytes);
    })().catch((error: unknown) => { proxyErrors.push(error); response.destroy(); });
  });
  let cliProcesses = 0;
  try {
    const deadline = Date.now() + 15_000;
    while (!messages.length && worker.exitCode === null && Date.now() < deadline) await delay(20);
    assert.ok(messages.length, `CPU fixture failed to start: ${workerError}`);
    const { endpoint, token } = messages[0];
    assert.equal(typeof endpoint, "string"); assert.equal(typeof token, "string");
    workerEndpoint = endpoint as string;
    const endpointUrl = new URL(workerEndpoint);
    assert.equal(endpointUrl.hostname, "127.0.0.1");
    const storageEndpoint = await listen(s3.server);
    const evaluationEndpoint = await listen(proxy);
    const arrangement = createAcceptedMusicArrangement({
      ownerId: "durable-owner", channelId: "durable-channel", runId: "durable-run",
      topic: "Synthetic transport fixture", sourceBrief: { fixture: "CPU only; not quality evidence" },
      arrangement: {
        role: "narration_bed", direction: "Synthetic CPU fixture only, not musical qualification.",
        requestedDurationSec: 10, form: "sectional", ending: "natural_cadence", playback: "once",
        sections: ["opening", "development", "resolution", "ending"].map((id, index) => ({
          id, label: id, startFraction: index / 4, endFraction: (index + 1) / 4,
          energy: 0.25, instruction: "Explicit synthetic section for transport testing.",
        })),
      },
    });
    const arrangementPath = join(root, "arrangement.json");
    await writeFile(arrangementPath, JSON.stringify(arrangement));
    const request = createYuE2AcceptedArrangementRequest({ arrangement, seed: 42, personalCreatorAcknowledged: true });
    const args = ["--arrangement", arrangementPath, "--seed", "42", "--personal-creator", "--durable-r2"];
    const env = {
      NODE_ENV: "test" as const,
      PATH: process.env.PATH, HOME: root, TMPDIR: root, AWS_EC2_METADATA_DISABLED: "true",
      R2_ENDPOINT: storageEndpoint, R2_BUCKET: "test", R2_ACCESS_KEY_ID: "testaccess", R2_SECRET_ACCESS_KEY: "testsecret",
      YUE2_EVALUATION_URL: evaluationEndpoint, YUE2_EVALUATION_TOKEN: token as string,
    };
    const cli = async (flags: string[], input = args, overrides: Record<string, string> = {}) => {
      const cwd = join(root, `client-${++cliProcesses}`);
      await mkdir(cwd);
      const { stdout, stderr } = await execute(join(repo, "node_modules/.bin/tsx"), [
        "--tsconfig", join(repo, "tsconfig.json"), join(repo, "src/scripts/evaluate-yue2-music.ts"), ...input, ...flags,
      ], { cwd, env: { ...env, ...overrides }, timeout: 30_000, maxBuffer: 1024 * 1024 });
      assert.ok(!stdout.includes(token as string) && !stderr.includes(token as string), "no worker token in CLI output");
      return JSON.parse(stdout) as Record<string, unknown>;
    };
    const refusal = async (operation: Promise<unknown>) => {
      await assert.rejects(operation, (error: unknown) => {
        const output = error as { stdout?: string; stderr?: string };
        assert.ok(!(output.stdout ?? "").includes(token as string));
        assert.ok(!(output.stderr ?? "").includes(token as string));
        assert.ok(!(output.stdout ?? "").includes("testsecret"));
        assert.ok(!(output.stderr ?? "").includes("testsecret"));
        assert.ok(!(output.stderr ?? "").includes("retained-content-secret-fixture"));
        return true;
      });
    };
    const dry = await cli([]);
    assert.equal(dry.mode, "validate_only"); assert.equal(dry.networkRequests, 0);
    assert.equal(s3.requests.length, 0); assert.equal(workerRequests.length, 0);
    for (const conflict of [["--out", join(root, "forbidden")], ["--program", arrangementPath], ["--style-file", arrangementPath]]) {
      await refusal(cli(["--submit", ...conflict]));
    }
    assert.equal(s3.requests.length, 0); assert.equal(workerRequests.length, 0);

    const firstClients = await Promise.allSettled([cli(["--submit"]), cli(["--submit"])]);
    assert.ok(firstClients.some((result) => result.status === "rejected"), "the deliberately lost POST response must fail");
    assert.equal(losePost, false, firstClients.map((result) => result.status === "rejected"
      ? String((result.reason as { stderr?: string }).stderr ?? "client failed without stderr").replaceAll(token as string, "[redacted]")
      : JSON.stringify(result.value)).join("\n"));
    assert.equal(workerRequests.filter((call) => call.method === "POST").length, 1, "concurrent processes buy at most once");
    let recovered = await cli(["--submit", "--recover-only"]);
    for (let attempt = 0; recovered.status === "pending" && attempt < 10; attempt++) {
      await delay(50); recovered = await cli(["--submit", "--recover-only"]);
    }
    assert.equal(recovered.status, "completed"); assert.equal(recovered.jobId, request.job.job_id);
    assert.equal(recovered.qualified, false); assert.equal(recovered.costStatus, "not_measured");
    const candidate = recovered.candidate as Record<string, unknown>;
    assert.equal(candidate.ownerId, arrangement.ownerId);
    assert.equal(candidate.channelId, arrangement.channelId);
    assert.equal(candidate.runId, arrangement.runId);
    assert.equal(candidate.programFingerprint, arrangement.fingerprint);
    assert.equal(candidate.nativeFormatVerified, true);
    assert.equal(candidate.productionApproved, false);
    assert.equal(candidate.manualAudition, "pending");
    assert.equal(candidate.costStatus, "not_measured");
    assert.deepEqual(candidate.nativeOutput, {
      sampleRateHz: 48000, channels: 2, codec: "pcm_f32le", frames: 48000, durationSec: 1,
    });
    const beforeReuse = workerRequests.length;
    const reused = await cli(["--submit", "--recover-only"]);
    assert.equal(reused.reused, true);
    assert.equal(workerRequests.length, beforeReuse, "R2 candidate reuse must not contact the worker");
    assert.ok(s3.collisions() > 0, "real SDK exercised If-None-Match collision handling");

    const changedSeed = args.map((value, index) => args[index - 1] === "--seed" ? "43" : value);
    await refusal(cli(["--submit"], changedSeed));
    assert.equal(workerRequests.length, beforeReuse, "same-run seed mutation must fail before worker HTTP");
    await refusal(cli(["--submit", "--recover-only"], args, { YUE2_EVALUATION_URL: workerEndpoint }));
    assert.equal(workerRequests.length, beforeReuse, "endpoint identity cannot silently change");

    const candidateKey = recovered.candidateKey as string;
    const retainedCandidate = s3.objects.get(candidateKey)!;
    assert.ok(retainedCandidate);
    for (const identity of ["ownerId", "channelId", "runId"]) {
      s3.objects.set(candidateKey, Buffer.from(JSON.stringify({ ...candidate, [identity]: "different-identity" })));
      await refusal(cli(["--submit", "--recover-only"]));
    }
    s3.objects.set(candidateKey, Buffer.from("retained-content-secret-fixture: invalid JSON"));
    await refusal(cli(["--submit", "--recover-only"]));
    s3.objects.set(candidateKey, retainedCandidate);
    assert.equal(workerRequests.length, beforeReuse, "malformed or cross-owner/run candidates never trigger worker HTTP");

    const audioEntries = [...s3.objects].filter(([, bytes]) => bytes.subarray(0, 4).toString() === "RIFF");
    assert.equal(audioEntries.length, 1);
    const [audioKey, audio] = audioEntries[0];
    const corrupt = Buffer.from(audio); corrupt[corrupt.length - 1] ^= 1;
    s3.objects.set(audioKey, corrupt);
    await refusal(cli(["--submit", "--recover-only"]));
    assert.equal(workerRequests.length, beforeReuse, "tampered retained bytes must not trigger regeneration");

    // A previously observed job owns the purchase even if it disappears from
    // the worker ledger before the next independent CLI process starts.
    for (const state of ["running", "failed", "completed"]) {
      const observedArrangement = createAcceptedMusicArrangement({
        ownerId: arrangement.ownerId, channelId: arrangement.channelId, runId: `observed-${state}`,
        topic: arrangement.topic, sourceBrief: { fixture: "previously observed job" }, arrangement: arrangement.arrangement,
      });
      const observedRequest = createYuE2AcceptedArrangementRequest({
        arrangement: observedArrangement, seed: 42, personalCreatorAcknowledged: true,
      });
      const path = join(root, `observed-${state}.json`);
      await writeFile(path, JSON.stringify(observedArrangement));
      const input = args.map((value, index) => args[index - 1] === "--arrangement" ? path : value);
      observedOnce.set(`/v1/jobs/${observedRequest.job.job_id}`, {
        contract: YUE2_WORKER_CONTRACT, job_id: observedRequest.job.job_id, job: observedRequest.job, state,
      });
      if (state === "running") assert.equal((await cli(["--submit"], input)).status, "pending");
      else await refusal(cli(["--submit"], input));
      await refusal(cli(["--submit"], input));
      assert.equal(workerRequests.filter((call) => call.method === "POST").length, 1,
        `observed ${state} then worker 404 must never buy a replacement`);
    }
    assert.equal(workerRequests.filter((call) => call.method === "POST").length, 1);
    assert.deepEqual(s3.errors, []); assert.deepEqual(proxyErrors, []);
    worker.stdin.end("\n");
    const [code] = await closed;
    assert.equal(code, 0, workerError);
    assert.equal(messages.at(-1)?.calls, 1, "exactly one synthetic CPU inference, including recovery and replay");
    console.log(JSON.stringify({
      result: "YUE2 DURABLE INTEGRATION PASS", cliProcesses,
      workerPosts: 1, fakeInferences: messages.at(-1)?.calls,
      s3Requests: s3.requests.length, immutableCollisions: s3.collisions(), durableObjects: s3.objects.size,
      qualified: false, productionApproved: false, costStatus: "not_measured",
    }));
  } finally {
    await close(proxy); await close(s3.server);
    lines.close();
    if (worker.exitCode === null && worker.signalCode === null) { worker.kill("SIGTERM"); await closed; }
    await rm(root, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
