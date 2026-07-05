// FAST 15s PREVIEW for tuning reference-matched parallax. Renders the first 2 scenes
// at low res in parallel, grades, and builds a side-by-side with the reference clip so
// the multi-rate parallax can be compared directly. Tune CFG, re-run, repeat.
import { writeFile, readFile, copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const RUN = join(ROOT, "output", "lorecraft", "moria");
const REF = join(ROOT, "output", "lorecraft", "ref", "ref_hd.mkv");
const WEB = "/var/www/html/lorecraft";
const rd = (f) => join(RUN, f);
const sh = (c, a, env) => new Promise((res, rej) => { const p = spawn(c, a, { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, ...env } }); p.on("close", (x) => (x === 0 ? res() : rej(new Error(c + " " + x)))); });

// ───────── TUNABLES (reference-matched multi-level parallax) ─────────
const CFG = {
  fov: 33, layers: 6, back: 14, step: 2.2, oversize: 1.30,
  camStart: -0.95, camEnd: 0.35, camStartY: 0.32, camEndY: -0.05, camAmpX: 0.80, converge: 0.22,
  disp: 0.4, haze: 0.42, fog: "#1b130c", dof: 0.005, dofMax: 0.003, focus: 0.72, cross: 0.9,
};
const PREV_SEC = 15, FPS = 20, WIDTH = 960, HEIGHT = 540, WORKERS = 3;
// ─────────────────────────────────────────────────────────────────────

const allScenes = JSON.parse(await readFile(rd("lore3d_scenes.json"), "utf8"));
const scenes = allScenes.slice(0, 2);
const per = PREV_SEC / scenes.length;
const meta = { fps: FPS, total: PREV_SEC, ...CFG, scenes: scenes.map((s) => ({ ...s, dur: per })) };
await writeFile(rd("lore3d_meta.json"), JSON.stringify(meta));
await copyFile(join(ROOT, "src/motion/lore3d.tpl.html"), rd("lore3d.html"));
console.error(`[preview] ${PREV_SEC}s, ${scenes.length} scenes, ${CFG.layers} planes, ${WIDTH}x${HEIGHT}@${FPS} x${WORKERS}`);

await sh("node", ["scripts/motion-capture-par.mjs"], { PAGE: rd("lore3d.html"), OUTDIR: rd("frames_pv"), FPS: String(FPS), WIDTH: String(WIDTH), HEIGHT: String(HEIGHT), WORKERS: String(WORKERS) });
const GRADE = "eq=contrast=1.06:saturation=0.92:brightness=-0.006,colorbalance=rm=0.03:bm=-0.03,vignette=PI/4.5,noise=alls=6:allf=t";
await sh("ffmpeg", ["-y", "-framerate", String(FPS), "-i", rd("frames_pv/f_%04d.png"), "-vf", GRADE, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "fast", rd("preview3d.mp4")]);

// side-by-side: reference (left) | mine (right), both 540h, first 15s
await sh("ffmpeg", ["-y", "-t", String(PREV_SEC), "-i", REF, "-i", rd("preview3d.mp4"),
  "-filter_complex", "[0:v]scale=-2:540,setsar=1,fps=20[a];[1:v]scale=-2:540,setsar=1,fps=20[b];[a][b]hstack=inputs=2,drawtext=text='REFERENCE':x=20:y=20:fontcolor=white:fontsize=22:box=1:boxcolor=0x000000A0,drawtext=text='MINE':x=w/2+20:y=20:fontcolor=white:fontsize=22:box=1:boxcolor=0x000000A0[o]",
  "-map", "[o]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "fast", rd("compare.mp4")]);
await mkdir(WEB, { recursive: true });
await copyFile(rd("preview3d.mp4"), join(WEB, "moria3d_preview.mp4"));
await copyFile(rd("compare.mp4"), join(WEB, "compare.mp4"));
console.log("DONE preview+compare");
