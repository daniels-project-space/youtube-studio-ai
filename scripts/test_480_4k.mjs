import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(() => {}, { required: ["REPLICATE_API_TOKEN"] });
const RT = process.env.REPLICATE_API_TOKEN;
const SEEDANCE = "6e47dd83529ee0599c68f274f225635080e4fd218360a85e2a3a78396d388b73";
const ESRGAN = "3e56ce4b57863bd03048b42bc09bdd4db20d427cca5fde9d8ae4dc60e1bb4775";
const poll = async (p) => { const g = p.urls?.get; const t0 = Date.now(); while (g && (p.status === "starting" || p.status === "processing")) { await new Promise((r) => setTimeout(r, 5000)); p = await (await fetch(g, { headers: { Authorization: `Bearer ${RT}` } })).json(); if (Date.now() - t0 > 420000) break; } return p; };
const dims = (f) => spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", f]).stdout.toString().trim();

// 1) Seedance 480p, 5s
spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", "output/loreshort/lotr/scene_0.png", "-vf", "scale=1280:-2", "-q:v", "3", "/tmp/t.jpg"]);
const img = "data:image/jpeg;base64," + (await readFile("/tmp/t.jpg")).toString("base64");
const PROMPT = "The blacksmith swings his hammer down onto the glowing ring on the anvil, his arm and body driving the blow; sparks fly, fire flickers; slow cinematic push-in revealing parallax depth. Keep the watercolour and pencil art style; only natural motion and the camera move.";
let s = await (await fetch("https://api.replicate.com/v1/predictions", { method: "POST", headers: { Authorization: `Bearer ${RT}`, "Content-Type": "application/json" }, body: JSON.stringify({ version: SEEDANCE, input: { image: img, prompt: PROMPT, duration: 5, resolution: "480p", aspect_ratio: "16:9" } }) })).json();
s = await poll(s);
const sUrl = Array.isArray(s.output) ? s.output[0] : s.output;
if (!sUrl) { console.log("SEEDANCE FAIL", s.status, JSON.stringify(s.error || "").slice(0, 120)); process.exit(1); }
await writeFile("/var/www/html/loreshort/t480.mp4", Buffer.from(await (await fetch(sUrl)).arrayBuffer()));
console.log(`SEEDANCE 480p: predict=${(s.metrics || {}).predict_time}s dims=${dims("/var/www/html/loreshort/t480.mp4")}`);

// 2) Real-ESRGAN -> 4K (data-uri, no nginx)
const vid = "data:video/mp4;base64," + (await readFile("/var/www/html/loreshort/t480.mp4")).toString("base64");
let u = await (await fetch("https://api.replicate.com/v1/predictions", { method: "POST", headers: { Authorization: `Bearer ${RT}`, "Content-Type": "application/json" }, body: JSON.stringify({ version: ESRGAN, input: { video_path: vid, model: "RealESRGAN_x4plus", resolution: "4k" } }) })).json();
u = await poll(u);
const uUrl = Array.isArray(u.output) ? u.output[0] : u.output;
if (!uUrl) { console.log("ESRGAN FAIL", u.status, JSON.stringify(u.error || "").slice(0, 120)); process.exit(1); }
await writeFile("/var/www/html/loreshort/t480_4k.mp4", Buffer.from(await (await fetch(uUrl)).arrayBuffer()));
console.log(`ESRGAN 4k: predict=${(u.metrics || {}).predict_time}s dims=${dims("/var/www/html/loreshort/t480_4k.mp4")}`);
spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "2.5", "-i", "/var/www/html/loreshort/t480_4k.mp4", "-frames:v", "1", "/tmp/t4k.jpg"]);
console.log("DONE");
