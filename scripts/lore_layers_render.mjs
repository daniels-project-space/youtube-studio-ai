// LORECRAFT LAYERS — full render, PER-SCENE (one scene's layers per capture so SwiftShader
// never holds all textures at once → no renderer crash), then crossfade-concat. Each beat =
// N depth-bands of the clean bg plate + figure cutout = many clean parallax layers.
import { writeFile, readFile, copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const RUN = join(ROOT, "output", "lorecraft", "moria");
const REF = join(ROOT, "output", "lorecraft", "ref", "ref2min.mkv");
const WEB = "/var/www/html/lorecraft";
const rd = (f) => join(RUN, f);
const sh = (c, a, env) => new Promise((res, rej) => { const p = spawn(c, a, { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, ...env } }); p.on("close", (x) => (x === 0 ? res() : rej(new Error(c + " " + x)))); });
const probe = (f) => new Promise((res) => { let o = ""; const c = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", f]); c.stdout.on("data", (d) => (o += d)); c.on("close", () => res(parseFloat(o.trim()) || 0)); });

const W = 1920, H = 1080, FPS = 30, XF = 0.8;
const scenes = JSON.parse(await readFile(rd("lore3d_scenes.json"), "utf8")).map((_, i) => ({ bg: `bg_${i}.png`, bgDepth: `bgdepth_${i}.png`, fg: `fg_${i}.png` }));
const narrSec = Math.max(20, await probe(rd("narr.mp3")));
const per = (narrSec + 1.0 + (scenes.length - 1) * XF) / scenes.length;
const BASE = { fov: 36, layers: 4, bgBack: 15, bgStep: 2.6, fgZ: 2.8, oversize: 1.3, camStart: -0.7, camEnd: 0.35, camStartY: 0.10, camEndY: -0.07, converge: 0.16, haze: 0.4, fog: "#1b130c", cross: 0.0 };
console.error(`[layers] ${scenes.length} scenes, per=${per.toFixed(2)}s, ${BASE.layers}+1 layers/scene, per-scene capture`);
await copyFile(join(ROOT, "src/motion/lore_layers.tpl.html"), rd("lore_layers.html"));

// 1. render each scene independently (one scene's textures per page → no crash)
for (let i = 0; i < scenes.length; i++) {
  const camAmpX = (i % 2 === 0 ? 1 : -1) * 0.5;             // alternate sweep direction
  const meta = { total: per, ...BASE, camAmpX, scenes: [{ ...scenes[i], dur: per }] };
  await writeFile(rd("lore_layers_meta.json"), JSON.stringify(meta));
  console.error(`[layers] scene ${i} capture (camAmpX ${camAmpX})`);
  await sh("node", ["scripts/motion-capture-par.mjs"], { PAGE: rd("lore_layers.html"), OUTDIR: rd(`fr_${i}`), FPS: String(FPS), WIDTH: String(W), HEIGHT: String(H), WORKERS: "3" });
  await sh("ffmpeg", ["-y", "-framerate", String(FPS), "-i", rd(`fr_${i}/f_%04d.png`), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "fast", rd(`seg_${i}.mp4`)]);
}

// 2. crossfade-concat
let fc = "", prev = "0:v";
for (let i = 1; i < scenes.length; i++) {
  const off = (i * (per - XF)).toFixed(3);
  const lbl = i === scenes.length - 1 ? "vx" : `x${i}`;
  fc += `[${prev}][${i}:v]xfade=transition=fade:duration=${XF}:offset=${off}[${lbl}];`;
  prev = lbl;
}
const GRADE = "eq=contrast=1.06:saturation=0.93:brightness=-0.006,colorbalance=rm=0.03:bm=-0.03,vignette=PI/4.6,noise=alls=6:allf=t";
fc += `[${prev}]${GRADE}[v]`;
const inputs = scenes.flatMap((_, i) => ["-i", rd(`seg_${i}.mp4`)]);
await sh("ffmpeg", ["-y", ...inputs, "-filter_complex", fc, "-map", "[v]", "-r", String(FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", rd("visual_lyr.mp4")]);

// 3. title + narration
const plan = JSON.parse(await readFile(rd("plan.json"), "utf8"));
const title = String(plan.title || "").replace(/[':]/g, ""), kicker = String(plan.kicker || "").replace(/[':]/g, "");
const F_SC = "/usr/share/fonts/opentype/ebgaramond/EBGaramondSC08-Regular.otf";
const F_IT = ["/usr/share/fonts/truetype/ebgaramond/EBGaramond12-Italic.ttf"].find(existsSync) || F_SC;
const A = "alpha='if(lt(t,0.7),0,if(lt(t,1.7),(t-0.7),if(lt(t,4.0),1,if(lt(t,5.0),1-(t-4.0),0))))'";
const vf = [
  `drawtext=fontfile=${F_SC}:text='${title}':fontcolor=0xEAD08A:fontsize=108:x=(w-text_w)/2:y=h*0.40:borderw=3:bordercolor=0x000000D0:shadowx=0:shadowy=2:${A}`,
  `drawtext=fontfile=${F_IT}:text='${kicker}':fontcolor=0xD9C8A2:fontsize=42:x=(w-text_w)/2:y=h*0.40+134:borderw=2:bordercolor=0x000000C0:${A}`,
].join(",");
await sh("ffmpeg", ["-y", "-i", rd("visual_lyr.mp4"), "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", rd("titled_lyr.mp4")]);
await sh("ffmpeg", ["-y", "-i", rd("titled_lyr.mp4"), "-i", rd("narr.mp3"), "-filter_complex", "[1:a]adelay=200|200,apad[a]", "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", rd("moria3d.mp4")]);
await mkdir(WEB, { recursive: true });
await copyFile(rd("moria3d.mp4"), join(WEB, "moria3d.mp4"));
if (existsSync(REF)) {
  await sh("ffmpeg", ["-y", "-t", "15", "-i", REF, "-t", "15", "-i", rd("moria3d.mp4"),
    "-filter_complex", "[0:v]scale=-2:540,setsar=1,fps=30[a];[1:v]scale=-2:540,setsar=1,fps=30[b];[a][b]hstack=inputs=2,drawtext=text='REFERENCE':x=20:y=20:fontcolor=white:fontsize=22:box=1:boxcolor=0x000000A0,drawtext=text='MINE (layers)':x=w/2+20:y=20:fontcolor=white:fontsize=22:box=1:boxcolor=0x000000A0[o]",
    "-map", "[o]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "fast", rd("compare.mp4")]);
  await copyFile(rd("compare.mp4"), join(WEB, "compare.mp4"));
}
console.log("DONE " + join(WEB, "moria3d.mp4"));
