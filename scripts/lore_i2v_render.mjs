// LORECRAFT v4 — GENERATED CAMERA MOVES. Each beat's engraving is fed to Kling (via the
// Higgsfield CLI) with a cinematic camera-move prompt → a GENUINE 3D camera shot (real
// perspective, parallax, the model generates the revealed space). Concat + narration + title.
import { writeFile, readFile, copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
const ROOT = process.cwd();
const RUN = join(ROOT, "output", "lorecraft", "moria2");
const NARR = join(ROOT, "output", "lorecraft", "moria", "narr.mp3");
const WEB = "/var/www/html/lorecraft";
const rd = (f) => join(RUN, f);
const sh = (c, a, opts = {}) => new Promise((res, rej) => { const p = spawn(c, a, { stdio: ["ignore", "pipe", "pipe"], ...opts }); let o = "", e = ""; p.stdout.on("data", d => o += d); p.stderr.on("data", d => e += d); p.on("close", (x) => (x === 0 ? res(o) : rej(new Error(c + " " + x + " " + e.slice(-400))))); });
const shv = (c, a) => new Promise((res, rej) => { const p = spawn(c, a, { stdio: ["ignore", "inherit", "inherit"] }); p.on("close", (x) => (x === 0 ? res() : rej(new Error(c + " " + x)))); });

const STYLE = " Keep the hand-drawn pen-and-ink ENGRAVING / cross-hatch art style throughout, sepia ivory tones. Slow, smooth, majestic, cinematic, no cuts, no sudden moves.";
const MOVES = [
  "The CAMERA slowly glides forward and cranes upward through the vast pillared dwarven hall, the great carved stone columns passing by on both sides with deep 3D parallax, revealing the endless colonnade receding into glowing haze." + STYLE,
  "The CAMERA descends and pushes deeper into the dwarven mithril mine, gliding past jagged rock and timber supports toward the brilliant glowing silver vein, strong 3D depth, sparks drifting." + STYLE,
  "The CAMERA slowly pulls back and tilts upward to reveal the colossal towering Balrog of shadow and flame in full, the foreground runestone and shield sinking away, embers and smoke swirling in 3D." + STYLE,
  "The CAMERA cranes slowly back and upward over the ruined hall of Moria, the armoured dwarf king in the foreground, revealing the fallen columns and silent tombs receding into mist and faint embers." + STYLE,
];
const N = 4, FPS = 24;

// 1. generate a camera-move clip per scene via Higgsfield/Kling (skip if already downloaded)
for (let i = 0; i < N; i++) {
  if (existsSync(rd(`i2v_${i}.mp4`))) { console.error(`[i2v] scene ${i} cached`); continue; }
  console.error(`[i2v] scene ${i} → kling camera move...`);
  const out = await sh("higgsfield", ["generate", "create", "kling2_6", "--image", rd(`scene_${i}c.png`), "--prompt", MOVES[i], "--duration", "10", "--wait", "--wait-timeout", "14m", "--wait-interval", "6s", "--json"]);
  const m = out.match(/"result_url"\s*:\s*"([^"]+)"/);
  if (!m) throw new Error(`scene ${i}: no result_url in ${out.slice(-300)}`);
  await shv("bash", ["-c", `curl -s -o ${rd(`i2v_${i}.mp4`)} "${m[1]}"`]);
  console.error(`[i2v] scene ${i} downloaded`);
}

// 2. normalize each clip (1080p/24fps, strip audio) and concat
for (let i = 0; i < N; i++)
  await shv("ffmpeg", ["-y", "-loglevel", "error", "-i", rd(`i2v_${i}.mp4`), "-vf", "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=24", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", rd(`n_${i}.mp4`)]);
await writeFile(rd("concat.txt"), Array.from({ length: N }, (_, i) => `file '${rd(`n_${i}.mp4`)}'`).join("\n"));
await shv("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", rd("concat.txt"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", rd("visual_i2v.mp4")]);

// 3. title + narration
const F_SC = "/usr/share/fonts/opentype/ebgaramond/EBGaramondSC08-Regular.otf";
const F_IT = ["/usr/share/fonts/truetype/ebgaramond/EBGaramond12-Italic.ttf"].find(existsSync) || F_SC;
const A = "alpha='if(lt(t,0.7),0,if(lt(t,1.7),(t-0.7),if(lt(t,4.0),1,if(lt(t,5.0),1-(t-4.0),0))))'";
const vf = [`drawtext=fontfile=${F_SC}:text='KHAZAD-DÛM':fontcolor=0xEAD9B0:fontsize=120:x=(w-text_w)/2:y=h*0.40:borderw=3:bordercolor=0x000000C0:shadowx=0:shadowy=2:${A}`, `drawtext=fontfile=${F_IT}:text='the kingdom under the mountain':fontcolor=0xD9C8A2:fontsize=46:x=(w-text_w)/2:y=h*0.40+150:borderw=2:bordercolor=0x000000B0:${A}`].join(",");
await shv("ffmpeg", ["-y", "-loglevel", "error", "-i", rd("visual_i2v.mp4"), "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", rd("titled_i2v.mp4")]);
await shv("ffmpeg", ["-y", "-loglevel", "error", "-i", rd("titled_i2v.mp4"), "-i", NARR, "-filter_complex", "[1:a]adelay=200|200,apad[a]", "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", rd("moria_i2v.mp4")]);
await mkdir(WEB, { recursive: true });
await copyFile(rd("moria_i2v.mp4"), join(WEB, "moria3d.mp4"));
console.log("DONE " + join(WEB, "moria3d.mp4"));
