import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import ts from "typescript";
import {
  MOTION_COMIC_SCORE_MAX_DURATION_SEC, MotionComicExternalScoreSchema, muxMotionComicExternalScore, validateMotionComicExternalScore,
  type MotionComicExternalScore,
} from "../motionComicScore";

const exec = promisify(execFile);
const ffmpeg = (args: string[]) => exec("ffmpeg", ["-v", "error", "-y", ...args], { timeout: 60_000 });

async function decodedDurationLimitTest() {
  // Execute the actual decoder-counting function with synthetic process events.
  // Only chunk lengths are needed: no multi-hour PCM allocation or decoding.
  const text = await readFile(join(process.cwd(), "src/lib/motionComicScore.ts"), "utf8");
  const ast = ts.createSourceFile("motionComicScore.ts", text, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "scoreDuration");
  assert.ok(declaration);
  const compiled = ts.transpileModule(declaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const sampleRate = 8000;
  for (const excessSamples of [0, 1]) {
    let killed = false;
    const spawn = () => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(), stderr: new EventEmitter(),
        kill(signal: string) {
          assert.equal(signal, "SIGKILL"); killed = true;
          queueMicrotask(() => child.emit("close", null));
          return true;
        },
      });
      queueMicrotask(() => {
        child.stdout.emit("data", { length: (sampleRate * MOTION_COMIC_SCORE_MAX_DURATION_SEC + excessSamples) * 4 });
        if (!killed) child.emit("close", 0);
      });
      return child;
    };
    const probe = async () => ({ streams: [{ codec_type: "audio", sample_rate: String(sampleRate) }], format: { format_name: "wav" } });
    const count = new Function("probe", "spawn", "MOTION_COMIC_SCORE_MAX_DURATION_SEC", `${compiled}; return scoreDuration;`)(probe, spawn, MOTION_COMIC_SCORE_MAX_DURATION_SEC) as (path: string) => Promise<number>;
    if (excessSamples === 0) assert.equal(await count("synthetic-decoder-events"), 7200);
    else await assert.rejects(() => count("synthetic-decoder-events"), /decoded duration exceeds 7200s/);
    assert.equal(killed, excessSamples > 0);
  }
}
async function source(path: string): Promise<MotionComicExternalScore> {
  const bytes = await readFile(path);
  return { path, contentSha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length, playback: "once", gain: 0.5, targetLufs: -14 };
}
async function videoEvidence(path: string) {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_packets", "-show_data_hash", "sha256",
    "-show_entries", "stream=start_time,duration,nb_frames:packet=pts,dts,duration,data_hash", "-of", "json", path]);
  return JSON.parse(stdout);
}
async function tone(path: string, start: number, frequency: number) {
  const { stdout } = await exec("ffmpeg", ["-v", "error", "-i", path, "-ss", String(start), "-t", "0.4", "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"],
    { encoding: "buffer", maxBuffer: 2 * 1024 * 1024 });
  let real = 0, imaginary = 0;
  const count = stdout.length / 4;
  assert.ok(count >= 19_000, "audio must cover the requested tail window");
  for (let i = 0; i < count; i++) {
    const sample = stdout.readFloatLE(i * 4), phase = 2 * Math.PI * frequency * i / 48000;
    real += sample * Math.cos(phase); imaginary += sample * Math.sin(phase);
  }
  return 2 * Math.hypot(real, imaginary) / count;
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "motion-score-real-"));
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network forbidden in score tests"); };
  try {
    await decodedDurationLimitTest();
    const videoPath = join(root, "video.mp4"), narrationPath = join(root, "voice.wav"), scorePath = join(root, "score.wav");
    await ffmpeg(["-f", "lavfi", "-i", "color=c=red:s=160x90:r=25:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath]);
    await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=6", "-c:a", "pcm_f32le", narrationPath]);
    await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=1", "-c:a", "pcm_f32le", scorePath]);
    const score = await source(scorePath);
    const evidence = await validateMotionComicExternalScore(score);
    assert.equal(evidence.durationSec, 1);
    assert.equal(evidence.contentSha256, score.contentSha256);
    assert.ok(!("path" in evidence));
    for (const patch of [{ gain: undefined }, { targetLufs: undefined }, { gain: NaN }, { gain: -1 }, { gain: 2.01 }, { targetLufs: -24 }, { targetLufs: -11 }, { targetLufs: Infinity },
      { targetLufs: 0 }, { path: "relative.wav" }, { playback: "auto" }, { byteLength: 0 }, { extra: true }]) {
      assert.equal(MotionComicExternalScoreSchema.safeParse({ ...score, ...patch }).success, false);
    }
    const outputs: Record<string, string> = {};
    for (const [name, playback, gain] of [["once", "once", 0.5], ["repeat", "repeat", 0.5], ["zero", "repeat", 0]] as const) {
      outputs[name] = join(root, `${name}.mp4`);
      const receipt = await muxMotionComicExternalScore({ externalScore: { ...score, playback, gain }, videoPath, narrationPath, narrationStartSec: 0.1, outPath: outputs[name] });
      assert.equal(receipt.gain, gain);
      assert.equal(receipt.playback, playback);
      assert.deepEqual(await videoEvidence(outputs[name]), await videoEvidence(videoPath), "all video packets and presentation timing are preserved");
    }
    assert.ok(await tone(outputs.once, 0.3, 1000) > 0.01, "once source is actually audible");
    assert.ok(await tone(outputs.once, 0.55, 1000) > 0.01, "once source is not faded out");
    assert.ok(await tone(outputs.once, 2.5, 1000) < 0.0001, "once has no repeated score in the tail");
    assert.ok(await tone(outputs.repeat, 2.5, 1000) > 0.01, "explicit repeat contains the score in the tail");
    assert.ok(await tone(outputs.zero, 0.3, 1000) < 0.0001, "zero gain is not defaulted");
    assert.ok(await tone(outputs.zero, 2.5, 440) > 0.01, "muted score does not mute narration");
    // A unique terminal signal must survive once playback through the final mux.
    const ending = join(root, "ending.wav"), endingMaster = join(root, "ending.mp4");
    await ffmpeg(["-f", "lavfi", "-i", "aevalsrc=if(gte(t\\,2.4)\\,0.15*sin(2*PI*1700*t)\\,0):s=48000:d=3", "-c:a", "pcm_f32le", ending]);
    await muxMotionComicExternalScore({ externalScore: await source(ending), videoPath, narrationPath, narrationStartSec: 0, outPath: endingMaster });
    assert.ok(await tone(endingMaster, 2.55, 1700) > 0.01, "terminal signal survives without fade or truncation");
    assert.ok(await tone(endingMaster, 3.3, 1700) < 0.0001, "terminal signal is not looped");
    assert.deepEqual(await videoEvidence(endingMaster), await videoEvidence(videoPath));
    // Corrupt only the Xing/Info frame-count hint. The actual MP3 packets still
    // decode to six seconds, but ffprobe's reported duration is under one second.
    const understated = join(root, "understated.mp3");
    await ffmpeg(["-i", narrationPath, "-c:a", "libmp3lame", "-write_xing", "1", understated]);
    const mp3 = await readFile(understated);
    const info = Math.max(mp3.indexOf(Buffer.from("Info")), mp3.indexOf(Buffer.from("Xing")));
    assert.ok(info >= 0 && (mp3.readUInt32BE(info + 4) & 1) === 1, "fixture has an explicit Xing frame-count hint");
    mp3.writeUInt32BE(20, info + 8); await writeFile(understated, mp3);
    const { stdout: duration } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", understated]);
    assert.ok(Number(duration) < 1, "fixture really understates duration");
    const understatedScore = await source(understated);
    assert.ok((await validateMotionComicExternalScore(understatedScore)).durationSec > 5.9, "duration authority is actual decoded samples");
    await assert.rejects(() => muxMotionComicExternalScore({ externalScore: understatedScore, videoPath, narrationPath, narrationStartSec: 0, outPath: join(root, "understated.mp4") }), /truncated/);
    const sharedScorePath = join(root, "finished-shared-score.wav");
    await ffmpeg(["-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono", "-t", "300.1", "-c:a", "pcm_u8", sharedScorePath]);
    const sharedScore = await source(sharedScorePath);
    assert.equal((await validateMotionComicExternalScore(sharedScore)).durationSec, 300.1,
      "finished shared scores are not limited to a single accepted YuE source piece");
    // Short narration must be padded, not shorten the video or once-score tail.
    const shortVoice = join(root, "short.wav"), padded = join(root, "padded.mp4");
    await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=0.5", shortVoice]);
    await muxMotionComicExternalScore({ externalScore: score, videoPath, narrationPath: shortVoice, narrationStartSec: 0, outPath: padded });
    assert.deepEqual(await videoEvidence(padded), await videoEvidence(videoPath));
    assert.ok(await tone(padded, 2.5, 1000) < 0.0001);
    const long = await source(narrationPath);
    await assert.rejects(() => muxMotionComicExternalScore({ externalScore: long, videoPath, narrationPath, narrationStartSec: 0, outPath: join(root, "truncated.mp4") }), /truncated/);
    await assert.rejects(() => validateMotionComicExternalScore({ ...score, path: join(root, "missing.wav") }), /ENOENT/);
    await assert.rejects(() => validateMotionComicExternalScore({ ...score, byteLength: score.byteLength + 1 }), /byte length/);
    const mutated = join(root, "mutated.wav");
    await copyFile(scorePath, mutated);
    const frozen = { ...score, path: mutated };
    await validateMotionComicExternalScore(frozen);
    const bytes = await readFile(mutated); bytes[bytes.length - 1] ^= 1; await writeFile(mutated, bytes);
    await assert.rejects(() => muxMotionComicExternalScore({ externalScore: frozen, videoPath, narrationPath, narrationStartSec: 0, outPath: join(root, "mutated.mp4") }), /hash mismatch/);
    const bad = join(root, "bad.wav"); await writeFile(bad, "not audio");
    const badScore = await source(bad);
    await assert.rejects(() => validateMotionComicExternalScore(badScore));
    // Silence has no finite measured loudness: strict normalization must fail.
    const silence = join(root, "silence.wav");
    await ffmpeg(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "4", silence]);
    await assert.rejects(() => muxMotionComicExternalScore({ externalScore: { ...score, gain: 0 }, videoPath, narrationPath: silence, narrationStartSec: 0, outPath: join(root, "silent-master.mp4") }), /loudnorm measurement/);
    console.log("motionComicScore: real FFmpeg playback, audio oracle, video packet identity, integrity and strict normalization passed");
  } finally { globalThis.fetch = previousFetch; await rm(root, { recursive: true, force: true }); }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
