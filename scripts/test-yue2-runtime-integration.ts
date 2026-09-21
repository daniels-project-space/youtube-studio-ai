import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { createChannelMusicProgram } from "../src/engine/channelMusicProgram";
import { canonicalJson } from "../src/lib/canonicalJson";
import { sha256Hex } from "../src/lib/sha256";
import { createYuE2AcceptedArrangementRequest, yue2Sha256, YUE2_ARRANGEMENT_EVALUATION_VERSION } from "../src/lib/yue2Evaluation";
import { runAcceptedMusicArrangementHandoffTests } from "../src/trigger/blocks/__tests__/acceptedMusicArrangementHandoff.test";

const execute = promisify(execFile);

// Deliberately opt-in: this exercises the sibling runtime, not a stub HTTP server.
// Only heavy inference is faked. No credentials or GPU models are loaded.
async function main(): Promise<void> {
  const runtime = process.env.YUE2_TEST_RUNTIME;
  if (!runtime) throw new Error("Set YUE2_TEST_RUNTIME to the isolated runtime checkout");
  const arrangements = await runAcceptedMusicArrangementHandoffTests();
  const root = await mkdtemp(join(tmpdir(), "studio-yue2-cross-language-"));
  const worker = spawn(join(runtime, ".venv-test/bin/python"), [
    join(runtime, "tests/serve_cpu_fixture.py"), "--root", join(root, "worker"),
  ], { cwd: runtime, env: { ...process.env, PYTHONPATH: join(runtime, "src") }, stdio: ["pipe", "pipe", "pipe"] });
  const closed = once(worker, "close");
  const lines = createInterface({ input: worker.stdout });
  const messages: Array<Record<string, unknown>> = [];
  let stderr = "";
  worker.stderr.on("data", (bytes: Buffer) => { stderr += bytes.toString(); });
  lines.on("line", (line) => { messages.push(JSON.parse(line)); });
  const deadline = Date.now() + 15000;
  try {
    while (!messages.length && worker.exitCode === null && Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 20));
    }
    assert.ok(messages.length, `Fixture did not start: ${stderr}`);
    const { endpoint, token } = messages[0];
    assert.equal(typeof endpoint, "string");
    assert.equal(typeof token, "string");
    const program = createChannelMusicProgram({
      channelId: "cross-language-fixture", channelIdentityFingerprint: "a".repeat(64),
      family: "music_loop", contentLaneKey: "lofi", topic: "Synthetic transport test",
      genre: "ambient", instrumentation: ["piano"],
    });
    const programPath = join(root, "program.json");
    const stylePath = join(root, "style.txt");
    await writeFile(programPath, JSON.stringify(program));
    await writeFile(stylePath, "Explicit synthetic transport fixture, not music quality evidence.");
    const args = [resolve("src/scripts/evaluate-yue2-music.ts"), "--program", programPath,
      "--style-file", stylePath, "--seed", "42", "--personal-creator", "--out", join(root, "candidates")];
    const env = { ...process.env, YUE2_EVALUATION_URL: endpoint as string, YUE2_EVALUATION_TOKEN: token as string };
    const cli = async (flags: string[], inputArgs = args, environment = env) => {
      const { stdout } = await execute(resolve("node_modules/.bin/tsx"), [...inputArgs, ...flags], {
        env: environment, timeout: 30000, maxBuffer: 1024 * 1024,
      });
      return JSON.parse(stdout) as Record<string, unknown>;
    };
    const dry = await cli([]);
    assert.equal(dry.mode, "validate_only");
    assert.equal(dry.networkRequests, 0);
    let result = await cli(["--submit"]);
    const submittedId = result.jobId;
    for (let attempt = 0; result.status === "pending" && attempt < 10; attempt += 1) {
      await new Promise((done) => setTimeout(done, 50));
      result = await cli(["--submit", "--recover-only"]);
    }
    assert.equal(result.status, "completed");
    assert.equal(result.jobId, submittedId);
    assert.equal(result.qualified, false);
    const directory = result.directory as string;
    const candidate = JSON.parse(await readFile(join(directory, "candidate.json"), "utf8"));
    assert.equal(candidate.productionApproved, false);
    assert.equal(candidate.nativeFormatVerified, true);
    assert.equal(candidate.preClampSourceRetained, true);
    const sourceBytes = await readFile(join(directory, "audio-unclipped.wav"));
    const headroom = JSON.parse(await readFile(join(directory, "headroom-status.json"), "utf8"));
    assert.equal(headroom.payload.source_sha256, yue2Sha256(sourceBytes));
    assert.equal(headroom.payload.production_approved, false);
    const provenance = JSON.parse(await readFile(join(directory, "provenance.json"), "utf8"));
    assert.ok(provenance.statusResponse.receipt_payloads.terminal.payload_json.includes("1.0"));
    const repeated = await cli(["--submit", "--recover-only"]);
    assert.equal(repeated.reused, true);
    const audioPath = join(directory, "audio-native.wav");
    const audio = await readFile(audioPath);
    audio[audio.length - 1] ^= 1;
    await chmod(audioPath, 0o600);
    await writeFile(audioPath, audio);
    await assert.rejects(cli(["--submit", "--recover-only"]));

    const jobIds = new Set([submittedId]);
    for (const [index, arrangement] of arrangements.entries()) {
      const arrangementPath = join(root, `arrangement-${index}.json`);
      await writeFile(arrangementPath, JSON.stringify(arrangement));
      const arrangementArgs = [resolve("src/scripts/evaluate-yue2-music.ts"), "--arrangement", arrangementPath,
        "--seed", "42", "--personal-creator", "--out", join(root, "arrangement-candidates")];
      const expected = createYuE2AcceptedArrangementRequest({ arrangement, seed: 42, personalCreatorAcknowledged: true });
      const validation = await cli([], arrangementArgs);
      assert.equal(validation.mode, "validate_only");
      assert.equal(validation.networkRequests, 0);
      assert.deepEqual(validation.request, expected, "CLI uses the actual accepted-arrangement request projection");
      let output = await cli(["--submit"], arrangementArgs);
      const jobId = output.jobId;
      assert.equal(jobId, expected.job.job_id);
      assert.equal(jobIds.has(jobId), false, "each authored purpose has its own stable worker job");
      jobIds.add(jobId);
      for (let attempt = 0; output.status === "pending" && attempt < 10; attempt++) {
        await new Promise((done) => setTimeout(done, 50));
        output = await cli(["--submit", "--recover-only"], arrangementArgs);
      }
      assert.equal(output.status, "completed");
      assert.equal(output.jobId, jobId);
      assert.equal(output.qualified, false);
      const saved = output.directory as string;
      const savedRequest = JSON.parse(await readFile(join(saved, "request.json"), "utf8"));
      assert.equal(savedRequest.version, YUE2_ARRANGEMENT_EVALUATION_VERSION);
      assert.deepEqual(savedRequest, expected);
      const savedCandidate = JSON.parse(await readFile(join(saved, "candidate.json"), "utf8"));
      assert.deepEqual(savedCandidate.acceptedArrangement, arrangement);
      assert.equal(savedCandidate.programFingerprint, arrangement.fingerprint);
      assert.equal(savedCandidate.nativeFormatVerified, true);
      assert.equal(savedCandidate.preClampSourceRetained, true);
      assert.equal(savedCandidate.productionApproved, false);
      assert.equal(savedCandidate.qualification.exact_duration, "unqualified");
      assert.equal(savedCandidate.qualification.instrumental_only, "unqualified");
      const savedProvenance = JSON.parse(await readFile(join(saved, "provenance.json"), "utf8"));
      assert.deepEqual(savedProvenance.request, expected);
      const jobReceipt = JSON.parse(savedProvenance.statusResponse.receipt_payloads.job.payload_json);
      assert.deepEqual(jobReceipt, expected.job, "Python receipt binds the exact projected sections, with empty lyrics");
      assert.ok(savedProvenance.statusResponse.receipt_payloads.terminal.payload_json.includes("1.0"));
      assert.equal((await cli(["--submit", "--recover-only"], arrangementArgs)).reused, true);
    }

    // Invalid CLI inputs must fail before even health/status HTTP, not merely before POST.
    let rejectedInputRequests = 0;
    const sentinel = createServer((_request, response) => {
      rejectedInputRequests++;
      response.writeHead(500); response.end("invalid arrangement must not reach HTTP");
    });
    sentinel.listen(0, "127.0.0.1");
    await once(sentinel, "listening");
    try {
      const address = sentinel.address();
      assert.ok(address && typeof address !== "string");
      const invalidEnv = { ...env, YUE2_EVALUATION_URL: `http://127.0.0.1:${address.port}` };
      const tampered = structuredClone(arrangements[0]);
      tampered.arrangement.sections[0].energy = 0.9;
      const unknownField = structuredClone(arrangements[0]);
      Object.assign(unknownField.arrangement.sections[0], { inventedTempo: 90 });
      const { fingerprint: ignored, ...unknownBody } = unknownField;
      void ignored;
      unknownField.fingerprint = sha256Hex(canonicalJson(unknownBody));
      for (const [index, invalid] of [null, { ...arrangements[0], arrangement: undefined }, tampered, unknownField].entries()) {
        const input = join(root, `invalid-arrangement-${index}.json`);
        await writeFile(input, JSON.stringify(invalid));
        await assert.rejects(cli(["--submit"], [resolve("src/scripts/evaluate-yue2-music.ts"), "--arrangement", input,
          "--seed", "42", "--personal-creator", "--out", join(root, "invalid-candidates")], invalidEnv));
      }
      await assert.rejects(cli(["--submit"], [...args, "--arrangement", join(root, "arrangement-0.json")], invalidEnv));
      assert.equal(rejectedInputRequests, 0, "missing/tampered/unknown-field/conflicting inputs fail before worker HTTP");
    } finally {
      await new Promise<void>((done, reject) => sentinel.close((error) => error ? reject(error) : done()));
    }
    worker.stdin.end("\n");
    const [code] = await closed;
    assert.equal(code, 0, stderr);
    assert.equal(jobIds.size, 6);
    assert.equal(messages.at(-1)?.calls, jobIds.size, "One fake inference per distinct purpose; recovery/reuse never repeat it");
    console.log("YUE2 CROSS-LANGUAGE PASS: v1 retained plus five real composer/planner arrangement CLI jobs; Python HTTP, native ffprobe, receipts, GET recovery, reuse, tamper and pre-HTTP refusal; exactly six fake inferences; no GPU/audio-quality qualification");
  } finally {
    lines.close();
    if (worker.exitCode === null && worker.signalCode === null) {
      worker.kill("SIGTERM");
      await closed;
    }
    await rm(root, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
