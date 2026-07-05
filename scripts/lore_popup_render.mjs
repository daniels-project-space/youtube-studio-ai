// LORECRAFT POP-UP — full render. Each beat = clean bg plate (far) + figure cutout (near)
// in a 3D camera (elegant truck + push + crane) → large CLEAN parallax. Crossfade-concat,
// painterly grade, EB-Garamond title, narration. The GoT pop-up diorama, no streaks.
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

const W = 1920, H = 1080, FPS = 30;
const scenes = JSON.parse(await readFile(rd("lore3d_scenes.json"), "utf8")).map((_, i) => ({ bg: `bg_${i}.png`, fg: `fg_${i}.png` }));
const narrSec = Math.max(20, await probe(rd("narr.mp3")));
const totalSec = narrSec + 1.2;
const per = totalSec / scenes.length;
const meta = {
  total: totalSec, cross: 0.95, fov: 36, bgZ: 14, fgZ: 3, oversize: 1.28,
  camStart: -0.8, camEnd: 0.3, camStartY: 0.10, camEndY: -0.08, camAmpX: 0.55, converge: 0.15,
  scenes: scenes.map((s) => ({ ...s, dur: per })),
};
await writeFile(rd("lore_popup_meta.json"), JSON.stringify(meta));
await copyFile(join(ROOT, "src/motion/lore_popup.tpl.html"), rd("lore_popup.html"));
console.error(`[popup] ${scenes.length} scenes, ${totalSec.toFixed(1)}s, 2-card pop-up (bg plate + figure cutout), parallel HD`);

// capture HD frames in parallel
await sh("node", ["scripts/motion-capture-par.mjs"], { PAGE: rd("lore_popup.html"), OUTDIR: rd("frames_pop"), FPS: String(FPS), WIDTH: String(W), HEIGHT: String(H), WORKERS: "3" });
// encode with painterly grade
const GRADE = "eq=contrast=1.06:saturation=0.93:brightness=-0.006,colorbalance=rm=0.03:bm=-0.03,vignette=PI/4.6,noise=alls=6:allf=t";
await sh("ffmpeg", ["-y", "-framerate", String(FPS), "-i", rd("frames_pop/f_%04d.png"), "-vf", GRADE, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", rd("visual_pop.mp4")]);

// title card
const plan = JSON.parse(await readFile(rd("plan.json"), "utf8"));
const title = String(plan.title || "").replace(/[':]/g, ""), kicker = String(plan.kicker || "").replace(/[':]/g, "");
const F_SC = "/usr/share/fonts/opentype/ebgaramond/EBGaramondSC08-Regular.otf";
const F_IT = ["/usr/share/fonts/truetype/ebgaramond/EBGaramond12-Italic.ttf"].find(existsSync) || F_SC;
const A = "alpha='if(lt(t,0.7),0,if(lt(t,1.7),(t-0.7),if(lt(t,4.0),1,if(lt(t,5.0),1-(t-4.0),0))))'";
const vf = [
  `drawtext=fontfile=${F_SC}:text='${title}':fontcolor=0xEAD08A:fontsize=108:x=(w-text_w)/2:y=h*0.40:borderw=3:bordercolor=0x000000D0:shadowx=0:shadowy=2:${A}`,
  `drawtext=fontfile=${F_IT}:text='${kicker}':fontcolor=0xD9C8A2:fontsize=42:x=(w-text_w)/2:y=h*0.40+134:borderw=2:bordercolor=0x000000C0:${A}`,
].join(",");
await sh("ffmpeg", ["-y", "-i", rd("visual_pop.mp4"), "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", rd("titled_pop.mp4")]);

// mux narration
await sh("ffmpeg", ["-y", "-i", rd("titled_pop.mp4"), "-i", rd("narr.mp3"), "-filter_complex", "[1:a]adelay=200|200,apad[a]", "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", rd("moria3d.mp4")]);
await mkdir(WEB, { recursive: true });
await copyFile(rd("moria3d.mp4"), join(WEB, "moria3d.mp4"));

// side-by-side compare (first 15s)
if (existsSync(REF)) {
  await sh("ffmpeg", ["-y", "-t", "15", "-i", REF, "-t", "15", "-i", rd("moria3d.mp4"),
    "-filter_complex", "[0:v]scale=-2:540,setsar=1,fps=30[a];[1:v]scale=-2:540,setsar=1,fps=30[b];[a][b]hstack=inputs=2,drawtext=text='REFERENCE':x=20:y=20:fontcolor=white:fontsize=22:box=1:boxcolor=0x000000A0,drawtext=text='MINE (pop-up)':x=w/2+20:y=20:fontcolor=white:fontsize=22:box=1:boxcolor=0x000000A0[o]",
    "-map", "[o]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "fast", rd("compare.mp4")]);
  await copyFile(rd("compare.mp4"), join(WEB, "compare.mp4"));
}
console.log("DONE " + join(WEB, "moria3d.mp4"));
