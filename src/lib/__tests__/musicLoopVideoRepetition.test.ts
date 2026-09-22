import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { composeMusicLoopDeblur } from "../ffmpeg";
import { assertStableLoopBodyNal, MusicLoopPacketVerifier, parseLoopPacket, verifyMusicLoopVideoRepetition } from "../musicLoopVideoRepetition";

function packet(index: number) {
  return { pts: index * 512, dts: index * 512 - 1024, duration: 512, pos: index * 100, size: 100,
    flags: index % 900 === 0 ? "K__" as const : "___" as const,
    data_hash: `SHA256:${createHash("sha256").update(String(index % 900)).digest("hex")}` };
}

test("packet oracle checks every later payload and both clocks without weakening unique-frame review", () => {
  for (const type of [1, 5, 9, 12]) assert.doesNotThrow(() => assertStableLoopBodyNal(Buffer.from([type, 0x80])));
  for (const type of [7, 8, 13, 15]) assert.throws(() => assertStableLoopBodyNal(Buffer.from([type, 0x80])), /stateful NAL/);
  assert.doesNotThrow(() => assertStableLoopBodyNal(Buffer.from([6, 5, 16, ...Array(16).fill(1), 0x80])));
  assert.throws(() => assertStableLoopBodyNal(Buffer.from([6, 1, 16, ...Array(16).fill(1), 0x80])), /persistent/);
  assert.throws(() => assertStableLoopBodyNal(Buffer.from([6, 5, 16, 0x80])), /malformed/);
  const run = (mutate?: (p: ReturnType<typeof packet>, index: number) => void, count = 2700) => {
    const verifier = new MusicLoopPacketVerifier(90, 512);
    for (let i = 0; i < count; i++) { const p = packet(i); mutate?.(p, i); verifier.accept(p); }
    return verifier.finish();
  };
  const valid = run();
  assert.equal(valid.packetCount, 2700); assert.equal(valid.comparedBodyPackets, 900);
  assert.equal(valid.bodyUnitCount, 2); assert.equal(valid.uniqueVideoSeconds, 60);
  assert.throws(() => run(p => { if (p.pts === 2500 * 512) p.data_hash = `SHA256:${"0".repeat(64)}`; }), /payload or presentation mismatch/);
  assert.throws(() => run((p, i) => { if (i === 2699) p.dts++; }), /decode clock/);
  assert.throws(() => run((p, i) => { if (i === 2600) p.pts += 512; }), /presentation/);
  assert.throws(() => run((p, i) => { if (i === 1800) p.flags = "___"; }), /keyframe/);
  assert.throws(() => run((p, i) => { if (i === 2100) p.duration++; }), /decode clock/);
  assert.throws(() => run(undefined, 2699), /incomplete/);
  assert.throws(() => run(undefined, 2701), /extra packets/);
  for (const seconds of [0, 60, 91, 28830, NaN]) assert.throws(() => new MusicLoopPacketVerifier(seconds, 512));
  const record = "pts=0|dts=-1024|duration=512|size=100|pos=0|flags=K__|data_hash=SHA256:" + "a".repeat(64);
  assert.equal(parseLoopPacket(record).dts, -1024);
  for (const bad of [record + "|pts=0", record.replace("pts=0", "pts=NaN"), record.replace("size=100", "size=0"), record + "|unknown=1", "x".repeat(1025)]) {
    assert.throws(() => parseLoopPacket(bad));
  }
});

test("real production loop qualifies and a changed late packet fails the same scanner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "music-loop-packet-proof-"));
  const ffmpeg = process.env.FFMPEG_BIN ?? "ffmpeg", ffprobe = process.env.FFPROBE_BIN ?? "ffprobe";
  const video = join(directory, "source.mp4"), audio = join(directory, "source.wav");
  const master = join(directory, "master.mp4"), corrupt = join(directory, "corrupt.mp4");
  try {
    execFileSync(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=160x96:r=30:d=1",
      "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", video], { timeout: 30000 });
    execFileSync(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=233:sample_rate=48000:duration=1",
      "-ac", "2", "-c:a", "pcm_f32le", audio], { timeout: 30000 });
    await composeMusicLoopDeblur({ loopUnitPath: video, musicPath: audio, outPath: master,
      durationSec: 90, width: 160, height: 96, fps: 30, timeoutMs: 120000 });
    const valid = await verifyMusicLoopVideoRepetition(master, 90);
    assert.equal(valid.packetCount, 2700); assert.equal(valid.independentIdrBoundariesVerified, true);
    assert.equal(valid.durationSec, 90); assert.match(valid.masterSha256, /^[a-f0-9]{64}$/u);
    assert.match(valid.scope, /not decoded visual quality/);
    await copyFile(master, corrupt);
    const inspected = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-read_intervals", "60%+#3",
      "-show_packets", "-show_entries", "packet=pos,size", "-of", "json", corrupt], { encoding: "utf8", timeout: 30000 }));
    const target = inspected.packets[1];
    const handle = await open(corrupt, "r+");
    try {
      const packetStart = Number(target.pos), packetSize = Number(target.size);
      assert.ok(Number.isSafeInteger(packetStart) && packetStart >= 0, "packet offset must be a nonnegative safe integer");
      assert.ok(Number.isSafeInteger(packetSize) && packetSize >= 2, "packet must contain a valid corruption target");
      const packetEnd = packetStart + packetSize;
      assert.ok(Number.isSafeInteger(packetEnd) && packetEnd <= (await handle.stat()).size,
        "the whole target packet must be inside the fixture");
      const position = packetStart + Math.floor(packetSize / 2);
      const byte = Buffer.alloc(1);
      assert.equal((await handle.read(byte, 0, 1, position)).bytesRead, 1);
      byte[0] ^= 1;
      assert.equal((await handle.write(byte, 0, 1, position)).bytesWritten, 1);
    } finally { await handle.close(); }
    await assert.rejects(verifyMusicLoopVideoRepetition(corrupt, 90), /payload or presentation mismatch/);
    await assert.rejects(verifyMusicLoopVideoRepetition("/does-not-exist", 60), /repetition qualification/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
