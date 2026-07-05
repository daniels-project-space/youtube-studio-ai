// LORECRAFT MULTIPLANE v2 — 4 WHOLE layers per beat (thresholds at depth GAPS so objects don't
// tear) + clean fresh back, driven by a ZOOM-OUT (each layer recedes as one rigid piece, nearer
// = recedes more). Crossfade-concat, engraving grade, title, narration.
import { writeFile, readFile, copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
const ROOT = process.cwd();
const RUN = join(ROOT, "output", "lorecraft", "moria2");
const NARR = join(ROOT, "output", "lorecraft", "moria", "narr.mp3");
const REF = join(ROOT, "output", "lorecraft", "ref", "ref2min.mkv");
const WEB = "/var/www/html/lorecraft";
const PY = "/home/ubuntu/dfvenv/bin/python";
const rd = (f) => join(RUN, f);
const sh = (c, a, env) => new Promise((res, rej) => { const p = spawn(c, a, { stdio: ["ignore", "inherit", "inherit"], env: env ? { ...process.env, ...env } : process.env }); p.on("close", (x) => (x === 0 ? res() : rej(new Error(c + " " + x)))); });
const probe = (f) => new Promise((res) => { let o = ""; const c = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", f]); c.stdout.on("data", (d) => (o += d)); c.on("close", () => res(parseFloat(o.trim()) || 0)); });
const N = 4, FPS = 24, XF = 0.8;
// per-scene [thresholds high->low, xmax]
const TH = [["0.70,0.45,0.25", 1.0], ["0.62,0.40,0.22", 1.0], ["0.70,0.45,0.25", 0.5], ["0.62,0.40,0.22", 1.0]];
const narrSec = Math.max(20, await probe(NARR));
const per = (narrSec + 1.0 + (N - 1) * XF) / N;
console.error(`[mp4] ${N} scenes, per=${per.toFixed(2)}s`);
for (let i = 0; i < N; i++) {
  const dir = rd(`s${i}lay`); await mkdir(dir, { recursive: true });
  const [ths, xmax] = TH[i];
  await sh(PY, [join(ROOT, "scripts/make_layers4.py"), rd(`scene_${i}c.png`), rd(`depth_${i}.png`), dir, ths, String(xmax)]);
  const meta = { total: per, fps: FPS, oversize: 1.12, globalZoom: 0.95, zoom: 1.25,
    layers: [{ img: "back.png", near: 0.0 }, { img: "L1.png", near: 0.35 }, { img: "L2.png", near: 0.65 }, { img: "L3.png", near: 1.0 }] };
  await writeFile(join(dir, "multiplane_meta.json"), JSON.stringify(meta));
  await copyFile(join(ROOT, "src/motion/multiplane.tpl.html"), join(dir, "multiplane.html"));
  console.error(`[mp4] scene ${i} composite`);
  await sh("node", ["scripts/motion-capture-par.mjs"], { PAGE: join(dir, "multiplane.html"), OUTDIR: join(dir, "frames"), FPS: String(FPS), WIDTH: "1280", HEIGHT: "720", WORKERS: "3" });
  await sh("ffmpeg", ["-y", "-framerate", String(FPS), "-i", join(dir, "frames/f_%04d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "fast", rd(`seg_mp_${i}.mp4`)]);
}
let fc = "", prev = "0:v";
for (let i = 1; i < N; i++) { const off = (i * (per - XF)).toFixed(3); const lbl = i === N - 1 ? "vx" : `x${i}`; fc += `[${prev}][${i}:v]xfade=transition=fade:duration=${XF}:offset=${off}[${lbl}];`; prev = lbl; }
const GRADE = "eq=contrast=1.05:brightness=0.012:saturation=1.0,colorbalance=rm=0.02:bm=-0.02,vignette=PI/7,noise=alls=4:allf=t";
fc += `[${prev}]${GRADE}[v]`;
const inputs = Array.from({ length: N }, (_, i) => ["-i", rd(`seg_mp_${i}.mp4`)]).flat();
await sh("ffmpeg", ["-y", ...inputs, "-filter_complex", fc, "-map", "[v]", "-r", String(FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", rd("visual_mp.mp4")]);
const F_SC = "/usr/share/fonts/opentype/ebgaramond/EBGaramondSC08-Regular.otf";
const F_IT = ["/usr/share/fonts/truetype/ebgaramond/EBGaramond12-Italic.ttf"].find(existsSync) || F_SC;
const A = "alpha='if(lt(t,0.7),0,if(lt(t,1.7),(t-0.7),if(lt(t,4.0),1,if(lt(t,5.0),1-(t-4.0),0))))'";
const vf = [`drawtext=fontfile=${F_SC}:text='KHAZAD-DÛM':fontcolor=0x3a2a14:fontsize=110:x=(w-text_w)/2:y=h*0.40:borderw=3:bordercolor=0xEDE3C8C0:shadowx=0:shadowy=2:${A}`, `drawtext=fontfile=${F_IT}:text='the kingdom under the mountain':fontcolor=0x4a3a22:fontsize=42:x=(w-text_w)/2:y=h*0.40+138:borderw=2:bordercolor=0xEDE3C8B0:${A}`].join(",");
await sh("ffmpeg", ["-y", "-i", rd("visual_mp.mp4"), "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", rd("titled_mp.mp4")]);
await sh("ffmpeg", ["-y", "-i", rd("titled_mp.mp4"), "-i", NARR, "-filter_complex", "[1:a]adelay=200|200,apad[a]", "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", rd("moria_mp.mp4")]);
await mkdir(WEB, { recursive: true });
await copyFile(rd("moria_mp.mp4"), join(WEB, "moria3d.mp4"));
console.log("DONE " + join(WEB, "moria3d.mp4"));
