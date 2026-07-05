// Overlay a GoT-style location title card (EB Garamond small-caps, gold, fades in/out
// over the first ~5s) onto the graded multiplane video, then re-mux narration + publish.
// Reuses the existing visual3d.mp4 — no frame re-capture.
import { spawn } from "node:child_process";
import { readFile, copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const RUN = join(process.cwd(), "output", "lorecraft", "moria");
const WEB = "/var/www/html/lorecraft";
const rd = (f) => join(RUN, f);
const sh = (c, a) => new Promise((res, rej) => { const p = spawn(c, a, { stdio: ["ignore", "inherit", "inherit"] }); p.on("close", (x) => (x === 0 ? res() : rej(new Error(c + " " + x)))); });

const plan = JSON.parse(await readFile(rd("plan.json"), "utf8"));
const title = String(plan.title || "").replace(/[':]/g, "");
const kicker = String(plan.kicker || "").replace(/[':]/g, "");
const F_SC = "/usr/share/fonts/opentype/ebgaramond/EBGaramondSC08-Regular.otf";
const F_IT = [
  "/usr/share/fonts/truetype/ebgaramond/EBGaramond12-Italic.ttf",
  "/usr/share/fonts/truetype/ebgaramond/EBGaramond08-Italic.ttf",
  "/usr/share/fonts/truetype/ebgaramond/EBGaramond12-Regular.ttf",
].find((f) => existsSync(f)) || F_SC;

// fade: hold black 0.7s, in over 1.0s, hold to 4.0s, out over 1.0s
const A = "alpha='if(lt(t,0.7),0,if(lt(t,1.7),(t-0.7),if(lt(t,4.0),1,if(lt(t,5.0),1-(t-4.0),0))))'";
const vf = [
  `drawtext=fontfile=${F_SC}:text='${title}':fontcolor=0xEAD08A:fontsize=108:x=(w-text_w)/2:y=h*0.40:borderw=3:bordercolor=0x000000D0:shadowx=0:shadowy=2:${A}`,
  `drawtext=fontfile=${F_IT}:text='${kicker}':fontcolor=0xD9C8A2:fontsize=42:x=(w-text_w)/2:y=h*0.40+134:borderw=2:bordercolor=0x000000C0:${A}`,
].join(",");

await sh("ffmpeg", ["-y", "-i", rd("visual3d.mp4"), "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", rd("titled3d.mp4")]);
await sh("ffmpeg", ["-y", "-i", rd("titled3d.mp4"), "-i", rd("narr.mp3"), "-filter_complex", "[1:a]adelay=200|200,apad[a]", "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", rd("moria3d.mp4")]);
await mkdir(WEB, { recursive: true });
await copyFile(rd("moria3d.mp4"), join(WEB, "moria3d.mp4"));
console.log("DONE titled " + join(WEB, "moria3d.mp4"));
