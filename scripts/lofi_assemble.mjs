// video_builder port: stream_loop the 30s seamless unit + 20-step deblur + title overlay + music. NO upscale.
import { spawnSync } from "node:child_process";
const UNIT = process.argv[2] || "/tmp/lofiport/unit30.mp4";
const MUSIC = process.argv[3] || "/var/www/html/lofi/oceancafe_music.mp3";
const OUT = process.argv[4] || "/var/www/html/lofi/lofi_v1port.mp4";
const CH = process.argv[5] || "Seaside Cafe";
const TITLE = process.argv[6] || "lofi to relax & study";
const aud = spawnSync("ffprobe", ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", MUSIC], { encoding: "utf8" }).stdout.trim() || "180";
const wdt = 1920, hgt = 1080;
const fsBig = Math.round(wdt * 0.042), fsSmall = Math.round(wdt * 0.021), yName = Math.round(hgt * 0.46), yTitle = Math.round(hgt * 0.545);
const deblur = Array.from({ length: 20 }, (_, i) => `gblur=sigma=${20 - i}:enable='between(t\\,${(i * 0.4).toFixed(1)}\\,${((i + 1) * 0.4).toFixed(1)})'`).join(",");
const aN = `if(lt(t\\,0.5)\\,0\\,if(lt(t\\,2.0)\\,(t-0.5)/1.5\\,if(lt(t\\,5.0)\\,1\\,if(lt(t\\,7.5)\\,(7.5-t)/2.5\\,0))))`;
const aT = `if(lt(t\\,1.5)\\,0\\,if(lt(t\\,3.0)\\,(t-1.5)/1.5\\,if(lt(t\\,5.0)\\,1\\,if(lt(t\\,7.5)\\,(7.5-t)/2.5\\,0))))`;
const FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", FR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const vf = [
  `scale=${wdt}:${hgt}:force_original_aspect_ratio=increase:flags=lanczos`, `crop=${wdt}:${hgt}`, `unsharp=9:9:1.5:5:5:0.6`, deblur, "fade=t=in:st=0:d=2.0",
  `drawtext=fontfile='${FB}':text='${CH}':fontsize=${fsBig}:fontcolor=white:alpha='${aN}':x=(w-text_w)/2:y=${yName}`,
  `drawtext=fontfile='${FR}':text='${TITLE}':fontsize=${fsSmall}:fontcolor=C8C8D2:alpha='${aT}':x=(w-text_w)/2:y=${yTitle}`,
].join(",");
const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-stream_loop", "-1", "-i", UNIT, "-i", MUSIC, "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "320k", "-pix_fmt", "yuv420p", "-vf", vf, "-t", aud, "-shortest", "-movflags", "+faststart", OUT], { encoding: "utf8" });
if (r.status !== 0) { console.error(r.stderr.slice(-600)); process.exit(1); }
console.log("DONE", OUT);
