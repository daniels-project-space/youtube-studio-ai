import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { sha256BytesHex } from "./sha256";
import { assertStudioEngineH3Media, type StudioEngineH3Media } from "@/engine/studioEngineH3Media";

const execute = promisify(execFile);

/** Count decoded frames, not just container metadata, on the hash-verified bytes. */
export async function inspectStudioEngineH3Media(bytes: Uint8Array): Promise<StudioEngineH3Media> {
  const directory = await mkdtemp(join(tmpdir(), "studio-engine-h3-media-"));
  try {
    const path = join(directory, "input.mp4");
    await writeFile(path, bytes, { mode: 0o600 });
    const { stdout, stderr } = await execute(process.env.FFPROBE_BIN ?? "ffprobe", [
      "-v", "error", "-count_frames", "-show_entries",
      "format=format_name:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,nb_read_frames,duration",
      "-of", "json", path,
    ], { timeout: 90_000, maxBuffer: 1024 * 1024 });
    if (stderr.trim()) throw new Error("Engine H3 physical media has decode errors");
    const result = JSON.parse(stdout) as { format?: { format_name?: string }; streams?: Array<{
      codec_type?: string; codec_name?: string; width?: number; height?: number;
      avg_frame_rate?: string; r_frame_rate?: string; nb_read_frames?: string; duration?: string;
    }> };
    const videos = result.streams?.filter(stream => stream.codec_type === "video") ?? [];
    const video = videos[0];
    const rate = (text: string | undefined) => {
      const match = text?.match(/^(\d+)\/(\d+)$/);
      return match && Number(match[2]) > 0 ? Number(match[1]) / Number(match[2]) : Number.NaN;
    };
    const frames = Number(video?.nb_read_frames);
    const durationSec = frames / 24;
    if (!result.format?.format_name?.split(",").includes("mp4") || videos.length !== 1 ||
        video?.width !== 1280 || video.height !== 736 || video.codec_name !== "h264" ||
        rate(video.avg_frame_rate) !== 24 || rate(video.r_frame_rate) !== 24 ||
        !Number.isFinite(Number(video.duration)) || Math.abs(Number(video.duration) - durationSec) > 1 / 24) {
      throw new Error("Engine H3 physical media does not match its admitted video contract");
    }
    const media: StudioEngineH3Media = {
      version: "studio-engine-h3-media/v1", sha256: sha256BytesHex(bytes),
      width: 1280, height: 736, codec: "h264", fps: 24, frames, durationSec,
    };
    assertStudioEngineH3Media(media, media.sha256, durationSec);
    return media;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
