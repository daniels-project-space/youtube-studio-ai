import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { YuE2CompletedResult } from "@/lib/yue2Evaluation";

const execute = promisify(execFile);

/** Inspect the retained native container, not just the worker's claimed format. */
export async function probeYuE2NativeWav(path: string, result: Pick<YuE2CompletedResult, "frames">, expectedBytes: number): Promise<void> {
  let stdout: string;
  try {
    ({ stdout } = await execute("ffprobe", [
      "-v", "error", "-show_entries",
      "stream=codec_type,codec_name,sample_fmt,sample_rate,channels,bits_per_sample,duration_ts,time_base:format=format_name,size",
      "-of", "json", path,
    ], { timeout: 30000, maxBuffer: 65536, encoding: "utf8" }));
  } catch { throw new Error("Native WAV inspection failed; candidate remains unqualified"); }
  const parsed = z.object({
    streams: z.array(z.object({
      codec_type: z.literal("audio"), codec_name: z.literal("pcm_f32le"), sample_fmt: z.literal("flt"),
      sample_rate: z.literal("48000"), channels: z.literal(2), bits_per_sample: z.literal(32),
      duration_ts: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), time_base: z.literal("1/48000"),
    })).length(1),
    format: z.object({ format_name: z.literal("wav"), size: z.string().regex(/^\d+$/u) }),
  }).parse(JSON.parse(stdout));
  if (parsed.streams[0].duration_ts !== result.frames || Number(parsed.format.size) !== expectedBytes) {
    throw new Error("Native WAV frame count or container length disagrees with receipt");
  }
}
