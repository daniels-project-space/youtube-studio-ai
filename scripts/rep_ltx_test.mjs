import { writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(() => {}, { required: ["REPLICATE_API_TOKEN"] });
const RT = process.env.REPLICATE_API_TOKEN;
const VERSION = "e7f2778ec419047c564a6620b2d9bf7d6c64673411bf2ae13e628ee2b2c0b5b1"; // ltx-video-0.9.7-distilled
// use a real scene image (prefer a fresh v2 one, else the earlier published test image)
const src = existsSync("output/loreshort/starwars/scene_0.png") ? "output/loreshort/starwars/scene_0.png" : "/var/www/html/loreshort/ltx0.png";
await copyFile(src, "/var/www/html/loreshort/ltx0.png");
const prompt = "Slow cinematic dolly push-in past the foreground, revealing strong parallax depth between the foreground, midground and deep background. Keep the same art style; only the camera moves smoothly through 3D space, no morphing.";
const sub = await fetch("https://api.replicate.com/v1/predictions", {
  method: "POST", headers: { Authorization: `Bearer ${RT}`, "Content-Type": "application/json" },
  body: JSON.stringify({ version: VERSION, input: { image: "http://87.106.233.113/loreshort/ltx0.png", prompt, resolution: 720, aspect_ratio: "16:9", num_frames: 97 } }),
});
let j = await sub.json();
console.error("submit", sub.status, j.status || JSON.stringify(j).slice(0, 300));
const getUrl = j.urls?.get; const t0 = Date.now();
while (getUrl && (j.status === "starting" || j.status === "processing")) { await new Promise((r) => setTimeout(r, 4000)); j = await (await fetch(getUrl, { headers: { Authorization: `Bearer ${RT}` } })).json(); process.stderr.write("."); if (Date.now() - t0 > 300000) break; }
console.error("\nfinal", j.status, "metrics", JSON.stringify(j.metrics || {}));
const out = Array.isArray(j.output) ? j.output[0] : j.output;
if (!out) { console.error("NO OUTPUT", JSON.stringify(j).slice(0, 500)); process.exit(1); }
await writeFile("/var/www/html/loreshort/ltx0.mp4", Buffer.from(await (await fetch(out)).arrayBuffer()));
console.log("DONE", out, "predict_time", (j.metrics || {}).predict_time);
