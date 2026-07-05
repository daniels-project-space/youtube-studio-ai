import { readFile } from "node:fs/promises";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(() => {}, { required: ["REPLICATE_API_TOKEN"] });
const RT = process.env.REPLICATE_API_TOKEN;
const path = process.argv[2] || "output/loreshort/lotr/clip_0.mp4";
const buf = await readFile(path);
const form = new FormData();
form.append("content", new Blob([buf], { type: "video/mp4" }), "clip.mp4");
const r = await fetch("https://api.replicate.com/v1/files", { method: "POST", headers: { Authorization: `Bearer ${RT}` }, body: form });
const j = await r.json();
const url = j?.urls?.get;
console.log("upload:", r.status, url || JSON.stringify(j).slice(0, 300));
if (!url) process.exit(1);
// now upscale using that replicate-hosted URL (NO nginx involved)
const sub = await fetch("https://api.replicate.com/v1/predictions", { method: "POST", headers: { Authorization: `Bearer ${RT}`, "Content-Type": "application/json" }, body: JSON.stringify({ version: "3e56ce4b57863bd03048b42bc09bdd4db20d427cca5fde9d8ae4dc60e1bb4775", input: { video_path: url, model: "RealESRGAN_x4plus", resolution: "2k" } }) });
let p = await sub.json(); console.log("predict submit:", sub.status, p.status);
const get = p.urls?.get; const t0 = Date.now();
while (get && (p.status === "starting" || p.status === "processing")) { await new Promise((r) => setTimeout(r, 5000)); p = await (await fetch(get, { headers: { Authorization: `Bearer ${RT}` } })).json(); process.stderr.write("."); if (Date.now() - t0 > 300000) break; }
console.log("\nupscale via Files API:", p.status, "out?", !!(Array.isArray(p.output) ? p.output[0] : p.output));
