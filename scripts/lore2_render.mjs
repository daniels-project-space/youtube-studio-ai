// LORECRAFT v3 — full engraving video. Each of the 4 beats = DepthFlow zoom-out reveal
// (foreground element parallaxing IN FRONT), crossfade-concat, light engraving grade,
// EB-Garamond title, Khazad-dûm narration. Render each scene as its own clip in tmux-safe steps.
import { readFile, copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const RUN = join(ROOT, "output", "lorecraft", "moria2");
const NARR = join(ROOT, "output", "lorecraft", "moria", "narr.mp3");
const REF = join(ROOT, "output", "lorecraft", "ref", "ref2min.mkv");
const WEB = "/var/www/html/lorecraft";
const rd = (f) => join(RUN, f);
const sh = (c, a) => new Promise((res, rej) => { const p = spawn(c, a, { stdio: ["ignore", "inherit", "inherit"] }); p.on("close", (x) => (x === 0 ? res() : rej(new Error(c + " " + x)))); });
const probe = (f) => new Promise((res) => { let o = ""; const c = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", f]); c.stdout.on("data", (d) => (o += d)); c.on("close", () => res(parseFloat(o.trim()) || 0)); });

const N = 4, FPS = 24, XF = 0.8, PY = "/home/ubuntu/dfvenv/bin/python";
const narrSec = Math.max(20, await probe(NARR));
const per = (narrSec + 1.0 + (N - 1) * XF) / N;
console.error(`[lore2] ${N} scenes, per=${per.toFixed(2)}s, total≈${(N * per - (N - 1) * XF).toFixed(1)}s`);

// 1. DepthFlow zoom-out per scene (skip clips already rendered so re-runs only redo fixed scenes)
for (let i = 0; i < N; i++) {
  if (existsSync(rd(`seg_${i}.mp4`))) { console.error(`[lore2] scene ${i} clip cached`); continue; }
  const dir = i % 2 === 0 ? 1 : -1;
  console.error(`[lore2] scene ${i} DepthFlow zoom-out (dir ${dir})`);
  await sh(PY, [join(ROOT, "scripts/df_zoom.py"), rd(`scene_${i}c.png`), rd(`depth_${i}.png`), rd(`seg_${i}.mp4`), String(per), String(dir), "1280", "720", String(FPS)]);
}

// 2. crossfade concat + light engraving grade
let fc = "", prev = "0:v";
for (let i = 1; i < N; i++) {
  const off = (i * (per - XF)).toFixed(3);
  const lbl = i === N - 1 ? "vx" : `x${i}`;
  fc += `[${prev}][${i}:v]xfade=transition=fade:duration=${XF}:offset=${off}[${lbl}];`;
  prev = lbl;
}
const GRADE = "eq=contrast=1.05:brightness=0.015:saturation=1.0,colorbalance=rm=0.02:bm=-0.02,vignette=PI/7,noise=alls=4:allf=t";
fc += `[${prev}]${GRADE}[v]`;
const inputs = Array.from({ length: N }, (_, i) => ["-i", rd(`seg_${i}.mp4`)]).flat();
await sh("ffmpeg", ["-y", ...inputs, "-filter_complex", fc, "-map", "[v]", "-r", String(FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", rd("visual.mp4")]);

// 3. title + narration
const F_SC = "/usr/share/fonts/opentype/ebgaramond/EBGaramondSC08-Regular.otf";
const F_IT = ["/usr/share/fonts/truetype/ebgaramond/EBGaramond12-Italic.ttf"].find(existsSync) || F_SC;
const A = "alpha='if(lt(t,0.7),0,if(lt(t,1.7),(t-0.7),if(lt(t,4.0),1,if(lt(t,5.0),1-(t-4.0),0))))'";
const vf = [
  `drawtext=fontfile=${F_SC}:text='KHAZAD-DÛM':fontcolor=0x3a2a14:fontsize=110:x=(w-text_w)/2:y=h*0.40:borderw=3:bordercolor=0xEDE3C8C0:shadowx=0:shadowy=2:${A}`,
  `drawtext=fontfile=${F_IT}:text='the kingdom under the mountain':fontcolor=0x4a3a22:fontsize=42:x=(w-text_w)/2:y=h*0.40+138:borderw=2:bordercolor=0xEDE3C8B0:${A}`,
].join(",");
await sh("ffmpeg", ["-y", "-i", rd("visual.mp4"), "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", rd("titled.mp4")]);
await sh("ffmpeg", ["-y", "-i", rd("titled.mp4"), "-i", NARR, "-filter_complex", "[1:a]adelay=200|200,apad[a]", "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", rd("moria_engraving.mp4")]);
await mkdir(WEB, { recursive: true });
await copyFile(rd("moria_engraving.mp4"), join(WEB, "moria3d.mp4"));
await copyFile(rd("moria_engraving.mp4"), join(WEB, "moria_engraving.mp4"));

// 4. side-by-side compare with reference (full)
if (existsSync(REF)) {
  await sh("ffmpeg", ["-y", "-t", "40", "-i", REF, "-t", "40", "-i", rd("moria_engraving.mp4"),
    "-filter_complex", "[0:v]scale=-2:540,setsar=1,fps=24[a];[1:v]scale=-2:540,setsar=1,fps=24[b];[a][b]hstack=inputs=2,drawtext=text='REFERENCE':x=20:y=20:fontcolor=white:fontsize=22:box=1:boxcolor=0x000000A0,drawtext=text='MINE':x=w/2+20:y=20:fontcolor=white:fontsize=22:box=1:boxcolor=0x000000A0[o]",
    "-map", "[o]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "fast", rd("compare.mp4")]);
  await copyFile(rd("compare.mp4"), join(WEB, "compare.mp4"));
}
console.log("DONE " + join(WEB, "moria3d.mp4"));
