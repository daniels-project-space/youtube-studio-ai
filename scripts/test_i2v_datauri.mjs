import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(() => {}, { required: ["REPLICATE_API_TOKEN"] });
const RT = process.env.REPLICATE_API_TOKEN;
spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", "output/loreshort/lotr/scene_0.png", "-vf", "scale=1280:-2", "-q:v", "3", "/tmp/i2vtest.jpg"]);
const img = "data:image/jpeg;base64," + (await readFile("/tmp/i2vtest.jpg")).toString("base64");
console.log("img datauri chars:", img.length);
const sub = await fetch("https://api.replicate.com/v1/predictions", { method: "POST", headers: { Authorization: `Bearer ${RT}`, "Content-Type": "application/json" }, body: JSON.stringify({ version: "e7f2778ec419047c564a6620b2d9bf7d6c64673411bf2ae13e628ee2b2c0b5b1", input: { image: img, prompt: "slow cinematic push-in, the blacksmith swings the hammer down, sparks fly", resolution: 720, aspect_ratio: "16:9", num_frames: 97, negative_prompt: "static, still" } }) });
let p = await sub.json(); console.error("submit", sub.status, p.status, p.error || "");
const g = p.urls?.get; const t0 = Date.now();
while (g && (p.status === "starting" || p.status === "processing")) { await new Promise((r) => setTimeout(r, 5000)); p = await (await fetch(g, { headers: { Authorization: `Bearer ${RT}` } })).json(); process.stderr.write("."); if (Date.now() - t0 > 240000) break; }
console.log("\nI2V data-uri:", p.status, "out?", !!(Array.isArray(p.output) ? p.output[0] : p.output));
