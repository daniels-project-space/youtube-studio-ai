import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { createChannelMusicProgram } from "../src/engine/channelMusicProgram";

const execute = promisify(execFile);

// Deliberately opt-in: this exercises the sibling runtime, not a stub HTTP server.
// Only heavy inference is faked. No credentials or GPU models are loaded.
async function main(): Promise<void> {
  const runtime = process.env.YUE2_TEST_RUNTIME;
  if (!runtime) throw new Error("Set YUE2_TEST_RUNTIME to the isolated runtime checkout");
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
    const cli = async (flags: string[]) => {
      const { stdout } = await execute(resolve("node_modules/.bin/tsx"), [...args, ...flags], {
        env, timeout: 30000, maxBuffer: 1024 * 1024,
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
    worker.stdin.end("\n");
    const [code] = await closed;
    assert.equal(code, 0, stderr);
    assert.equal(messages.at(-1)?.calls, 1, "Recovery or reuse must not repeat inference");
    console.log("YUE2 CROSS-LANGUAGE PASS: real Python HTTP worker, real Studio CLI, native ffprobe, Python receipt hashes, GET recovery, reuse, tamper rejection; exactly one fake inference; no GPU/audio-quality qualification");
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
