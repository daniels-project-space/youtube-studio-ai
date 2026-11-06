import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readBytes, writeBytes } from "@/lib/files";
import { rasterImageDimensions } from "@/lib/imageDimensions";

/** Embed all 1024-square source pixels unchanged on a 2048×1152 canvas. */
export async function composeHyperYoutubeStill16x9(source:Uint8Array, inputPath:string, outputPath:string) {
  const dimensions=rasterImageDimensions(source);
  if (dimensions.contentType !== "image/png" || dimensions.width !== 1024 || dimensions.height !== 1024)
    throw new Error("ERNIE still does not match its 1024-square profile");
  await writeBytes(inputPath,source);
  await promisify(execFile)(process.env.FFMPEG_BIN ?? "ffmpeg",["-y","-i",inputPath,"-filter_complex",
    "[0:v]split=2[bg][fg];[bg]scale=2048:1152:force_original_aspect_ratio=increase,crop=2048:1152,boxblur=40:10,format=rgba[back];[fg]format=rgba[front];[back][front]overlay=(W-w)/2:(H-h)/2:format=rgb,format=rgb24",
    "-frames:v","1",outputPath],{timeout:120_000});
  const bytes=await readBytes(outputPath), output=rasterImageDimensions(bytes);
  if (output.contentType !== "image/png" || output.width !== 2048 || output.height !== 1152)
    throw new Error("16:9 composition dimensions are invalid");
  return bytes;
}
