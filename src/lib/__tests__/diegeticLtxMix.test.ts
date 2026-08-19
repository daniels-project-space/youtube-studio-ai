import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  assembleAuthoredBody,
  assembleBeatBody,
  assembleStructuredBody,
  composeWithIntro,
  probe,
} from "@/lib/ffmpeg";

const execFile = promisify(execFileCallback);

async function ffmpeg(args: string[]): Promise<string> {
  const { stderr = "" } = await execFile("ffmpeg", ["-hide_banner", "-nostats", "-y", ...args], { maxBuffer: 1 << 20 });
  return stderr;
}

async function bandMeanDb(path: string, startSec: number): Promise<number> {
  const stderr = await ffmpeg([
    "-ss", startSec.toFixed(3), "-t", "0.55", "-i", path,
    "-map", "a:0", "-af", "bandpass=f=440:width_type=h:width=90,volumedetect", "-f", "null", "-",
  ]);
  const value = stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/)?.[1];
  assert.ok(value, "the final master must expose measurable diegetic audio");
  return Number(value);
}

async function makeTake(path: string, frequency: number): Promise<void> {
  await ffmpeg([
    "-f", "lavfi", "-i", "color=c=0x444444:s=160x90:r=30:d=2",
    "-f", "lavfi", "-i", `sine=frequency=${frequency}:duration=2`,
    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", path,
  ]);
}

async function makePhaseTake(path: string, polarity: 1 | -1): Promise<void> {
  await ffmpeg([
    "-f", "lavfi", "-i", "color=c=0x444444:s=160x90:r=30:d=2",
    "-f", "lavfi", "-i", `aevalsrc=${polarity}*0.9*sin(2*PI*440*t):d=2:s=44100`,
    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", path,
  ]);
}

async function boundaryPeak(path: string, startSec: number): Promise<number> {
  const { stdout } = await execFile(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", path, "-ss", startSec.toFixed(3), "-t", "0.006", "-map", "a:0", "-ac", "1", "-ar", "44100", "-f", "f32le", "pipe:1"],
    { encoding: "buffer", maxBuffer: 1 << 20 },
  );
  const bytes = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  let peak = 0;
  for (let offset = 0; offset + 4 <= bytes.length; offset += 4) peak = Math.max(peak, Math.abs(bytes.readFloatLE(offset)));
  return peak;
}

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "youtube-ltx-diegetic-mix-"));
  try {
    const takeA = join(dir, "ltx-a.mp4");
    const takeB = join(dir, "ltx-b.mp4");
    const videoOnlyTake = join(dir, "video-only.mp4");
    const body = join(dir, "body.mp4");
    const beatBody = join(dir, "beat-body.mp4");
    const structuredBody = join(dir, "structured-body.mp4");
    const seamA = join(dir, "seam-a.mp4");
    const seamB = join(dir, "seam-b.mp4");
    const seamBody = join(dir, "seam-body.mp4");
    const narration = join(dir, "narration.wav");
    const music = join(dir, "silence.m4a");
    const master = join(dir, "master.mp4");
    await makeTake(takeA, 440);
    await makeTake(takeB, 660);
    await makePhaseTake(seamA, 1);
    await makePhaseTake(seamB, -1);
    await ffmpeg([
      "-f", "lavfi", "-i", "color=c=0x444444:s=160x90:r=30:d=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", videoOnlyTake,
    ]);
    // DC is deliberately outside the 440Hz inspection band: it supplies a
    // strong sidechain key without being mistaken for the diegetic test tone.
    await ffmpeg(["-f", "lavfi", "-i", "aevalsrc=0.9:d=1.3:s=44100", "-c:a", "pcm_s16le", narration]);
    await ffmpeg(["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100", "-t", "4", "-c:a", "aac", music]);

    await assert.rejects(
      () => assembleAuthoredBody({
        clipPaths: [videoOnlyTake], segDurationsSec: [2], outPath: join(dir, "invalid-body.mp4"), tmpDir: dir,
        width: 160, height: 90, fps: 30, bodyAudioMode: "required",
      }),
      /required diegetic audio missing/,
      "a video-only LTX take must fail before cinematic assembly",
    );

    await assembleAuthoredBody({
      clipPaths: [takeA, takeB],
      segDurationsSec: [2, 2],
      outPath: body,
      tmpDir: dir,
      width: 160,
      height: 90,
      fps: 30,
      bodyAudioMode: "required",
    });
    assert.equal((await probe(body)).hasAudio, true, "the authored LTX body must retain its source audio stream");

    await assembleBeatBody({
      clipPaths: [takeA, takeB], outPath: beatBody, targetSec: 4, tmpDir: dir,
      width: 160, height: 90, fps: 30, maxSegSec: 2, bodyAudioMode: "available",
    });
    assert.equal((await probe(beatBody)).hasAudio, true, "the generic beat route must retain available LTX audio");
    await assembleStructuredBody({
      windows: [{ kind: "footage", durSec: 2 }, { kind: "footage", durSec: 2 }],
      clipPaths: [takeA, takeB], outPath: structuredBody, tmpDir: dir,
      width: 160, height: 90, fps: 30, maxSegSec: 2, bodyAudioMode: "available",
    });
    assert.equal((await probe(structuredBody)).hasAudio, true, "the chapter/structured route must retain available LTX audio");

    await assembleAuthoredBody({
      clipPaths: [seamA, seamB], segDurationsSec: [1.93, 1.93], outPath: seamBody, tmpDir: dir,
      width: 160, height: 90, fps: 30, bodyAudioMode: "required",
    });
    const seamPeak = await boundaryPeak(seamBody, 1.928);
    assert.ok(seamPeak < 0.45, `the 20ms audio edge fades must suppress a phase-jump click at the visual cut, got ${seamPeak}`);

    await composeWithIntro({
      loopBodyPath: body,
      musicPath: music,
      narrationPath: narration,
      outPath: master,
      introSec: 0,
      bodySec: 4,
      tailSec: 0,
      width: 160,
      height: 90,
      introMusicVol: 0,
      bodyMusicVol: 0,
      bodyAudioMode: "required",
      diegeticBodyAudioVol: 0.3,
    });
    assert.equal((await probe(master)).hasAudio, true, "the final master must retain the mixed diegetic layer");

    const underNarration = await bandMeanDb(master, 0.25);
    // This stays inside the first 440Hz take but past the 450ms compressor
    // release window, avoiding the next take's deliberately different tone.
    const afterNarration = await bandMeanDb(master, 1.55);
    assert.ok(afterNarration > -50, `the original 440Hz LTX sound must survive into the final master, got ${afterNarration}dB`);
    assert.ok(
      afterNarration > underNarration + 1,
      `the 440Hz diegetic tone must recover after narration (during ${underNarration}dB, after ${afterNarration}dB)`,
    );
    console.log("LTX diegetic audio survives assembly and ducks beneath narration");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
