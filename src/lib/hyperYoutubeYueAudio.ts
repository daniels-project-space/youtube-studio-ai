import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { measureNativeAudioSignal } from "@/lib/nativeAudioSignal";
import { probeYuE2NativeWav } from "@/lib/yue2NativeAudio";

const execute=promisify(execFile);
const stream=z.object({codec_name:z.string(),sample_rate:z.literal("48000"),channels:z.literal(2),
  bits_per_raw_sample:z.union([z.string(),z.number()]).optional(),duration_ts:z.number().int().positive(),time_base:z.literal("1/48000")});

/** Recheck retained WAV bytes for audition without relying on stored measurements. */
export async function inspectHyperYueWav(wav:Uint8Array,frames:number) {
  if (!wav.length || wav.length>256*1024*1024 || !Number.isSafeInteger(frames) || frames<1)
    throw new Error("Invalid retained HRS YuE audio");
  const dir=await mkdtemp(join(tmpdir(),"youtube-hrs-yue-review-"));
  try {
    const path=join(dir,"source.wav");await writeFile(path,wav,{mode:0o600});
    await probeYuE2NativeWav(path,{frames},wav.length);
    return await measureNativeAudioSignal({path,sampleRateHz:48000,channels:2,expectedFrames:frames,measureTruePeak:true});
  } finally { await rm(dir,{recursive:true,force:true}); }
}

/** Convert the verified HRS FLAC for the existing float-WAV audition pipeline. */
export async function decodeHyperYueFlac(flac:Uint8Array) {
  if (!flac.length || flac.length>100_000_000) throw new Error("HRS YuE FLAC exceeds its input bound");
  const dir=await mkdtemp(join(tmpdir(),"youtube-hrs-yue-"));
  try {
    const input=join(dir,"source.flac"),output=join(dir,"source.wav");
    await writeFile(input,flac,{mode:0o600});
    const result=await execute(process.env.FFPROBE_BIN ?? "ffprobe",["-v","error","-select_streams","a:0",
      "-show_entries","stream=codec_name,sample_rate,channels,bits_per_raw_sample,duration_ts,time_base","-of","json",input],
    {timeout:30_000,maxBuffer:65_536,encoding:"utf8"});
    const source=z.object({streams:z.array(stream).length(1)}).parse(JSON.parse(result.stdout)).streams[0];
    const depth=Number(source.bits_per_raw_sample);
    if (source.codec_name!=="flac" || !Number.isInteger(depth) || depth<1 || depth>24)
      throw new Error("HRS YuE source cannot be decoded losslessly to float WAV");
    await execute(process.env.FFMPEG_BIN ?? "ffmpeg",["-hide_banner","-nostdin","-v","error","-n","-i",input,
      "-map","0:a:0","-c:a","pcm_f32le",output],{timeout:120_000,maxBuffer:65_536});
    const wav=await readFile(output);
    if (wav.length>256*1024*1024) throw new Error("HRS YuE WAV exceeds its output bound");
    await probeYuE2NativeWav(output,{frames:source.duration_ts},wav.length);
    const signal=await measureNativeAudioSignal({path:output,sampleRateHz:48000,channels:2,
      expectedFrames:source.duration_ts,measureTruePeak:true});
    return {wav,frames:source.duration_ts,signal};
  } finally { await rm(dir,{recursive:true,force:true}); }
}
