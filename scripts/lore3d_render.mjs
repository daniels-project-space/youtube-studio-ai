// FULL render: reference-matched MULTIPLANE (wide Z-separation + craning camera + DOF).
// Writes meta, stamps the Three.js template, captures HD frames IN PARALLEL (≈2×),
// grades, muxes narration, publishes. Title card added by scripts/lore3d_title.mjs after.
import { writeFile, readFile, copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const RUN = join(ROOT, "output", "lorecraft", "moria");
const WEB = "/var/www/html/lorecraft";
const rd = (f) => join(RUN, f);
const sh = (c, a, env) => new Promise((res, rej) => { const p = spawn(c, a, { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, ...env } }); p.on("close", (x) => (x === 0 ? res() : rej(new Error(c + " " + x)))); });
const probe = (f) => new Promise((res) => { let o = ""; const c = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", f]); c.stdout.on("data", (d) => (o += d)); c.on("close", () => res(parseFloat(o.trim()) || 0)); });

// Tuned to the GoT "Histories & Lore" reference (multi-rate parallax, readable depth, gentle crane).
const CFG = {
  fov: 33, layers: 6, back: 14, step: 2.2, oversize: 1.30,
  camStart: -0.95, camEnd: 0.35, camStartY: 0.32, camEndY: -0.05, camAmpX: 0.80, converge: 0.22,
  disp: 0.4, haze: 0.42, fog: "#1b130c", dof: 0.005, dofMax: 0.003, focus: 0.72, cross: 0.95,
};

const scenes = JSON.parse(await readFile(rd("lore3d_scenes.json"), "utf8"));
const narrSec = Math.max(20, await probe(rd("narr.mp3")));
const totalSec = narrSec + 1.2;
const per = totalSec / scenes.length;
const meta = { fps: 30, total: totalSec, ...CFG, scenes: scenes.map((s) => ({ ...s, dur: per })) };
await writeFile(rd("lore3d_meta.json"), JSON.stringify(meta));
await copyFile(join(ROOT, "src/motion/lore3d.tpl.html"), rd("lore3d.html"));
console.error(`[lore3d] ${scenes.length} scenes, ${totalSec.toFixed(1)}s, reference-matched multiplane (${meta.layers} planes, parallel HD)`);

// capture HD frames in parallel (3 workers ≈ 2× on SwiftShader)
await sh("node", ["scripts/motion-capture-par.mjs"], { PAGE: rd("lore3d.html"), OUTDIR: rd("frames3d"), FPS: "30", WIDTH: "1920", HEIGHT: "1080", WORKERS: "3" });
const GRADE = "eq=contrast=1.06:saturation=0.92:brightness=-0.006,colorbalance=rm=0.03:bm=-0.03,vignette=PI/4.5,noise=alls=6:allf=t";
await sh("ffmpeg", ["-y", "-framerate", "30", "-i", rd("frames3d/f_%04d.png"), "-vf", GRADE, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", rd("visual3d.mp4")]);
await sh("ffmpeg", ["-y", "-i", rd("visual3d.mp4"), "-i", rd("narr.mp3"), "-filter_complex", "[1:a]adelay=200|200,apad[a]", "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", rd("moria3d.mp4")]);
await mkdir(WEB, { recursive: true });
await copyFile(rd("moria3d.mp4"), join(WEB, "moria3d.mp4"));
console.log("DONE " + join(WEB, "moria3d.mp4"));
