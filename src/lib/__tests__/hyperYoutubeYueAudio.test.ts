import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeHyperYueFlac } from "@/lib/hyperYoutubeYueAudio";

async function main() {
  const dir=await mkdtemp(join(tmpdir(),"hrs-yue-test-"));
  try {
    const source=join(dir,"source.flac"),wav=join(dir,"decoded.wav");
    execFileSync("ffmpeg",["-loglevel","error","-f","lavfi","-i","sine=frequency=440:sample_rate=48000:duration=1",
      "-ac","2","-c:a","flac",source]);
    const flac=await readFile(source),decoded=await decodeHyperYueFlac(flac);
    assert.equal(decoded.frames,48000);assert.equal(decoded.signal.nonFiniteSamples,0);
    await writeFile(wav,decoded.wav);
    const pcm=(file:string)=>execFileSync("ffmpeg",["-loglevel","error","-i",file,"-map","0:a:0","-c:a","pcm_f32le","-f","f32le","-"]);
    assert.deepEqual(pcm(wav),pcm(source),"the WAV adapter must preserve every FLAC-decoded sample");
    await assert.rejects(decodeHyperYueFlac(Buffer.from("not audio")));
  } finally { await rm(dir,{recursive:true,force:true}); }
  console.log("HRS YuE lossless audio adapter: ok");
}
void main();
