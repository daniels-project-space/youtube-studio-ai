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
import { validateYuE2ExecutionPolicy, verifyYuE2ExecutionAccounting, verifyYuE2ExecutionPolicy } from "../src/lib/yue2ExecutionAccounting";

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
function memoryS3(runId: string) {
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
      assert.ok(path.startsWith("/test-private/"), "all evidence must use the private bucket, never the public default");
      const key = decodeURIComponent(path.slice("/test-private/".length));
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
      if (!bytes && method === "GET" && key === `owner/durable-owner/runs/${runId}/music/yue2-evaluation/binding.json`) {
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

async function runIntegration(supervised: boolean, failInference = false): Promise<void> {
  const runtime = process.env.YUE2_TEST_RUNTIME;
  if (!runtime) throw new Error("Set YUE2_TEST_RUNTIME to the isolated runtime checkout");
  const root = await mkdtemp(join(tmpdir(), "studio-yue2-durable-"));
  const runId = failInference ? "durable-failure-run" : "durable-run";
  const durableRoot = `owner/durable-owner/runs/${runId}/music/yue2-evaluation/`;
  const s3 = memoryS3(runId);
  const worker = spawn(join(runtime, ".venv-test/bin/python"), [
    join(runtime, supervised ? "tests/serve_supervised_cpu_fixture.py" : "tests/serve_cpu_fixture.py"), "--root", join(root, "worker"),
    ...(failInference ? ["--fail-inference"] : []),
  ], { cwd: runtime, env: { NODE_ENV: "test" as const, PATH: process.env.PATH, PYTHONPATH: join(runtime, "src") }, stdio: ["pipe", "pipe", "pipe"] });
  const closed = once(worker, "close");
  const lines = createInterface({ input: worker.stdout });
  const messages: Array<Record<string, unknown>> = [];
  let workerError = "";
  worker.stderr.on("data", (bytes: Buffer) => { workerError = (workerError + bytes.toString()).slice(-4096); });
  lines.on("line", (line) => { messages.push(JSON.parse(line)); });
  const workerRequests: Array<{ method: string; path: string; policySha256?: string }> = [];
  let policyWire: unknown;
  const observedOnce = new Map<string, Record<string, unknown>>();
  let workerEndpoint = "";
  let losePost = true;
  const proxyErrors: unknown[] = [];
  const proxy = createServer((request, response) => {
    void (async () => {
      const method = request.method ?? "GET";
      const path = request.url ?? "/";
      const policySha256 = request.headers["x-yue2-execution-policy-sha256"];
      assert.ok(policySha256 === undefined || typeof policySha256 === "string");
      workerRequests.push({ method, path, policySha256 });
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
        headers: { authorization: request.headers.authorization ?? "", "content-type": "application/json",
          ...(policySha256 === undefined ? {} : { "X-YuE2-Execution-Policy-SHA256": policySha256 }) },
        ...(method === "POST" ? { body: Buffer.concat(chunks) } : {}),
      });
      const bytes = Buffer.from(await upstream.arrayBuffer());
      if (path === "/v1/execution-policy" && upstream.ok) policyWire = JSON.parse(bytes.toString());
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
  const finish = async () => {
    assert.equal(workerRequests.filter((call) => call.method === "POST").length, 1);
    assert.deepEqual(s3.errors, []); assert.deepEqual(proxyErrors, []);
    worker.stdin.end("\n");
    const [code] = await closed;
    assert.equal(code, 0, workerError);
    assert.equal(messages.at(-1)?.calls, 1, "exactly one synthetic CPU inference, including recovery and replay");
    console.log(JSON.stringify({
      result: "YUE2 DURABLE INTEGRATION PASS", mode: failInference ? "supervised-failure" : supervised ? "supervised" : "legacy", cliProcesses,
      workerPosts: 1, fakeInferences: messages.at(-1)?.calls,
      s3Requests: s3.requests.length, immutableCollisions: s3.collisions(), durableObjects: s3.objects.size,
      qualified: false, productionApproved: false, costStatus: "not_measured",
    }));
  };
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
      ownerId: "durable-owner", channelId: "durable-channel", runId,
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
    const policy = supervised ? validateYuE2ExecutionPolicy(messages[0].policy) : undefined;
    const policyPath = join(root, "execution-policy.json");
    if (policy) {
      await writeFile(policyPath, JSON.stringify(policy));
      args.push("--execution-policy", policyPath);
    }
    const env = {
      NODE_ENV: "test" as const,
      PATH: process.env.PATH, HOME: root, TMPDIR: root, AWS_EC2_METADATA_DISABLED: "true",
      R2_ENDPOINT: storageEndpoint, R2_BUCKET: "test-public", R2_PRIVATE_BUCKET: "test-private",
      R2_ACCESS_KEY_ID: "testaccess", R2_SECRET_ACCESS_KEY: "testsecret",
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

    if (policy) {
      assert.deepEqual(dry.expectedExecutionPolicy, policy);
      assert.equal(dry.providerBilling, "unknown");
      const invalidPolicy = join(root, "invalid-policy.json");
      await writeFile(invalidPolicy, JSON.stringify({ ...policy, reserved_allocation_usd_micros: 1 }));
      const invalidArgs = args.map((value, index) => args[index - 1] === "--execution-policy" ? invalidPolicy : value);
      await refusal(cli(["--submit"], invalidArgs));
      await refusal(cli(["--submit"], args.filter((value) => value !== "--durable-r2")));
      assert.equal(s3.requests.length, 0, "invalid policy is refused before storage access");
      assert.equal(workerRequests.length, 0, "invalid policy is refused before worker access");

      // A different run avoids contaminating the main run's immutable binding.
      const wrongPolicy = join(root, "wrong-policy.json");
      await writeFile(wrongPolicy, JSON.stringify({ ...policy, rate_reference: "different-operator-terms" }));
      const wrongArrangement = createAcceptedMusicArrangement({
        ownerId: arrangement.ownerId, channelId: arrangement.channelId, runId: "policy-mismatch",
        topic: arrangement.topic, sourceBrief: { fixture: "policy mismatch only" }, arrangement: arrangement.arrangement,
      });
      const wrongArrangementPath = join(root, "policy-mismatch.json");
      await writeFile(wrongArrangementPath, JSON.stringify(wrongArrangement));
      const wrongArgs = args.map((value, index) => args[index - 1] === "--execution-policy" ? wrongPolicy
        : args[index - 1] === "--arrangement" ? wrongArrangementPath : value);
      await refusal(cli(["--submit"], wrongArgs));
      assert.ok(policyWire, "mismatched policy was checked against the real Python endpoint");
      assert.equal(workerRequests.filter((call) => call.method === "POST").length, 0,
        "valid but different operator terms must refuse before POST");
      assert.ok(!s3.objects.has("owner/durable-owner/runs/policy-mismatch/music/yue2-evaluation/submission-attempt.json"));
    }

    const firstClients = await Promise.allSettled([cli(["--submit"]), cli(["--submit"])]);
    assert.ok(firstClients.some((result) => result.status === "rejected" ||
      (failInference && result.value.status === "held")), "a lost POST cannot return a successful candidate");
    assert.equal(losePost, false, firstClients.map((result) => result.status === "rejected"
      ? String((result.reason as { stderr?: string }).stderr ?? "client failed without stderr").replaceAll(token as string, "[redacted]")
      : JSON.stringify(result.value)).join("\n"));
    assert.equal(workerRequests.filter((call) => call.method === "POST").length, 1, "concurrent processes buy at most once");
    const beforeRecovery = workerRequests.length;
    let recovered = await cli(["--submit", "--recover-only"]);
    for (let attempt = 0; recovered.status === "pending" && attempt < 10; attempt++) {
      await delay(50); recovered = await cli(["--submit", "--recover-only"]);
    }
    if (failInference) {
      assert.ok(policy);
      assert.equal(recovered.status, "held");
      assert.equal(recovered.reason, "supervised_execution_requires_review");
      assert.equal(recovered.jobId, request.job.job_id);
      assert.equal(recovered.candidate, undefined);
      assert.equal(recovered.qualified, false);
      assert.equal(recovered.costStatus, "not_measured");
      assert.equal(recovered.manualAudition, "pending");
      const verifiedPolicy = verifyYuE2ExecutionPolicy(policy, policyWire);
      assert.equal(workerRequests.find((call) => call.method === "POST")?.policySha256, verifiedPolicy.submissionPolicySha256);
      const accounting = recovered.executionAccounting as Record<string, unknown>;
      assert.equal(accounting.key, `${durableRoot}execution-accounting.json`);
      const retained = s3.objects.get(accounting.key as string);
      assert.ok(retained);
      assert.equal(accounting.sha256, createHash("sha256").update(retained).digest("hex"));
      const saved = JSON.parse(retained.toString());
      assert.equal(saved.version, "studio-yue2-durable-accounting/v1");
      const binding = s3.objects.get(`${durableRoot}binding.json`)!;
      assert.equal(saved.bindingSha256, createHash("sha256").update(binding).digest("hex"));
      assert.deepEqual(JSON.parse(binding.toString()).expectedExecutionPolicy, policy);
      const verified = verifyYuE2ExecutionAccounting({ request, expectedPolicy: policy,
        statusResponse: saved.statusResponse, accountingResponse: saved.accountingResponse });
      assert.deepEqual(accounting, {
        key: accounting.key, sha256: accounting.sha256, policySha256: verifiedPolicy.submissionPolicySha256,
        status: "measured_allocation_estimate", supervisorStatus: "failed", elapsedNs: verified.elapsedNs,
        allocatedCostUsdMicros: verified.allocatedCostUsdMicros, providerBilledCostUsdMicros: null,
      });
      assert.ok(verified.elapsedNs !== null && verified.elapsedNs > 0);
      assert.ok(verified.allocatedCostUsdMicros !== null && verified.allocatedCostUsdMicros > 0);
      assert.equal(verified.terminationVerified, true);
      assert.equal(verified.slotReleasable, true);
      assert.ok(workerRequests.some((call) => call.method === "GET" &&
        call.path === `/v1/jobs/${request.job.job_id}/accounting`));
      const beforeReuse = workerRequests.length;
      for (const flags of [["--submit", "--recover-only"], ["--submit"]]) {
        const held = await cli(flags);
        assert.equal(held.status, "held");
        assert.equal(held.reused, true);
        assert.deepEqual(held.executionAccounting, accounting);
        assert.equal(held.candidate, undefined);
      }
      assert.equal(workerRequests.length, beforeReuse, "retained failed accounting is reused without worker GET or POST");
      assert.ok(!s3.objects.has(`${durableRoot}candidate.json`));
      assert.ok(!s3.objects.has(`${durableRoot}provenance.json`));
      assert.ok(![...s3.objects.keys()].some((key) => key.endsWith(".wav")));
      await finish();
      return;
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
    assert.equal(candidate.version, supervised ? "studio-yue2-durable-candidate/v2" : "studio-yue2-durable-candidate/v1");
    assert.deepEqual(candidate.nativeOutput, {
      sampleRateHz: 48000, channels: 2, codec: "pcm_f32le", frames: 48000, durationSec: 1,
    });
    if (policy) {
      const verifiedPolicy = verifyYuE2ExecutionPolicy(policy, policyWire);
      const post = workerRequests.filter((call) => call.method === "POST");
      assert.equal(post[0].policySha256, verifiedPolicy.submissionPolicySha256,
        "the real accepted POST atomically binds the exact policy hash");
      assert.ok(workerRequests.slice(beforeRecovery).some((call) => call.method === "GET" &&
        call.path === `/v1/jobs/${request.job.job_id}`), "a separate recovery process GETs the existing job");
      assert.ok(workerRequests.some((call) => call.method === "GET" &&
        call.path === `/v1/jobs/${request.job.job_id}/accounting`), "accounting is recovered over actual HTTP");
      const accounting = candidate.executionAccounting as Record<string, unknown>;
      assert.equal(accounting.key, `${durableRoot}execution-accounting.json`);
      const retained = s3.objects.get(accounting.key as string);
      assert.ok(retained);
      assert.equal(accounting.sha256, createHash("sha256").update(retained).digest("hex"));
      const saved = JSON.parse(retained.toString());
      assert.equal(saved.version, "studio-yue2-durable-accounting/v1");
      assert.equal(saved.bindingSha256, candidate.bindingSha256);
      const verified = verifyYuE2ExecutionAccounting({ request, expectedPolicy: policy,
        statusResponse: saved.statusResponse, accountingResponse: saved.accountingResponse });
      assert.deepEqual(accounting, {
        key: accounting.key, sha256: accounting.sha256, policySha256: verifiedPolicy.submissionPolicySha256,
        status: "measured_allocation_estimate", supervisorStatus: "completed",
        elapsedNs: verified.elapsedNs, allocatedCostUsdMicros: verified.allocatedCostUsdMicros,
        providerBilledCostUsdMicros: null,
      });
      assert.ok(verified.elapsedNs !== null && verified.elapsedNs > 0);
      assert.ok(verified.allocatedCostUsdMicros !== null && verified.allocatedCostUsdMicros > 0);
      const denominator = BigInt(3600) * BigInt(1_000_000_000);
      assert.equal(BigInt(verified.allocatedCostUsdMicros),
        (BigInt(policy.hourly_rate_usd_micros) * BigInt(verified.elapsedNs) + denominator - BigInt(1)) / denominator);
      assert.equal(verified.slotReleasable, true);
      assert.equal(verified.terminationVerified, true);
      const binding = JSON.parse(s3.objects.get(candidate.bindingKey as string)!.toString());
      assert.equal(binding.version, "studio-yue2-durable-evaluation/v2");
      assert.deepEqual(binding.expectedExecutionPolicy, policy);
      assert.equal(createHash("sha256").update(s3.objects.get(candidate.bindingKey as string)!).digest("hex"), candidate.bindingSha256);
      const marker = JSON.parse(s3.objects.get(`${durableRoot}submission-attempt.json`)!.toString());
      assert.equal(marker.version, "studio-yue2-durable-evaluation/v2");
      assert.equal(marker.bindingSha256, candidate.bindingSha256);
    } else {
      assert.equal(candidate.executionAccounting, undefined);
      assert.ok(workerRequests.every((call) => call.policySha256 === undefined));
      assert.ok(!workerRequests.some((call) => call.path === "/v1/execution-policy" || call.path.endsWith("/accounting")));
    }
    const beforeReuse = workerRequests.length;
    const reused = await cli(["--submit", "--recover-only"]);
    assert.equal(reused.reused, true);
    assert.deepEqual(reused.candidate, candidate);
    assert.equal(workerRequests.length, beforeReuse, "R2 candidate reuse must not contact the worker");
    assert.ok(s3.collisions() > 0, "real SDK exercised If-None-Match collision handling");

    const changedSeed = args.map((value, index) => args[index - 1] === "--seed" ? "43" : value);
    await refusal(cli(["--submit"], changedSeed));
    assert.equal(workerRequests.length, beforeReuse, "same-run seed mutation must fail before worker HTTP");
    await refusal(cli(["--submit", "--recover-only"], args, { YUE2_EVALUATION_URL: workerEndpoint }));
    assert.equal(workerRequests.length, beforeReuse, "endpoint identity cannot silently change");

    if (policy) {
      await writeFile(policyPath, JSON.stringify({ ...policy, rate_reference: "changed-after-admission" }));
      await refusal(cli(["--submit"]));
      await writeFile(policyPath, JSON.stringify(policy));
      await refusal(cli(["--submit"], args.slice(0, -2)));
      assert.equal(workerRequests.length, beforeReuse, "changed or removed policy refuses before worker HTTP");
      const accounting = candidate.executionAccounting as Record<string, unknown>;
      const key = accounting.key as string;
      const retained = s3.objects.get(key)!;
      const saved = JSON.parse(retained.toString());
      for (const corrupt of [Buffer.from("invalid retained accounting"),
        Buffer.from(JSON.stringify({ ...saved, bindingSha256: "0".repeat(64) })),
        Buffer.from(JSON.stringify({ ...saved, accountingResponse: {
          ...saved.accountingResponse, accounting: { ...saved.accountingResponse.accounting,
            payload_json: saved.accountingResponse.accounting.payload_json + " " },
        } }))]) {
        s3.objects.set(key, corrupt);
        await refusal(cli(["--submit", "--recover-only"]));
      }
      s3.objects.set(key, retained);
      assert.equal(workerRequests.length, beforeReuse, "tampered accounting cannot refresh or regenerate a retained candidate");
    }

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
    assert.equal(audioEntries.length, 3, "native, pre-clamp and prepared audio retained separately");
    const prepared = candidate.headroom as Record<string, unknown>;
    assert.ok(prepared);
    assert.equal(prepared.audioSha256, createHash("sha256").update(s3.objects.get(String(prepared.audioKey))!).digest("hex"));
    assert.equal(prepared.receiptSha256, createHash("sha256").update(s3.objects.get(String(prepared.receiptKey))!).digest("hex"));
    const source = candidate.preClampSource as Record<string, unknown>;
    assert.ok(source);
    assert.equal(source.audioSha256, createHash("sha256").update(s3.objects.get(String(source.audioKey))!).digest("hex"));
    assert.equal(source.receiptSha256, createHash("sha256").update(s3.objects.get(String(source.receiptKey))!).digest("hex"));
    for (const [audioKey, audio] of audioEntries) {
      const corrupt = Buffer.from(audio); corrupt[corrupt.length - 1] ^= 1;
      s3.objects.set(audioKey, corrupt);
      await refusal(cli(["--submit", "--recover-only"]));
      assert.equal(workerRequests.length, beforeReuse, "tampered retained bytes must not trigger regeneration");
      s3.objects.set(audioKey, audio);
    }
    const receiptKey = String(source.receiptKey);
    const receipt = s3.objects.get(receiptKey)!;
    s3.objects.set(receiptKey, Buffer.from("corrupt headroom receipt"));
    await refusal(cli(["--submit", "--recover-only"]));
    assert.equal(workerRequests.length, beforeReuse);
    s3.objects.set(receiptKey, receipt);

    // A previously observed job owns the purchase even if it disappears from
    // the worker ledger before the next independent CLI process starts.
    for (const state of supervised ? [] : ["running", "failed", "completed"]) {
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
    await finish();
  } finally {
    await close(proxy); await close(s3.server);
    lines.close();
    if (worker.exitCode === null && worker.signalCode === null) { worker.kill("SIGTERM"); await closed; }
    await rm(root, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  await runIntegration(false);
  await runIntegration(true);
  await runIntegration(true, true);
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
