import { readFile } from "node:fs/promises";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(() => {}, { required: ["REPLICATE_API_TOKEN"] });
const RT = process.env.REPLICATE_API_TOKEN;
const buf = await readFile(process.argv[2] || "output/loreshort/lotr/clip_0.mp4");
const dataUri = `data:video/mp4;base64,${buf.toString("base64")}`;
console.log("clip bytes:", buf.length, "datauri chars:", dataUri.length);
const sub = await fetch("https://api.replicate.com/v1/predictions", { method: "POST", headers: { Authorization: `Bearer ${RT}`, "Content-Type": "application/json" }, body: JSON.stringify({ version: "3e56ce4b57863bd03048b42bc09bdd4db20d427cca5fde9d8ae4dc60e1bb4775", input: { video_path: dataUri, model: "RealESRGAN_x4plus", resolution: "2k" } }) });
let p = await sub.json(); console.log("submit:", sub.status, p.status, p.error || "");
const get = p.urls?.get; const t0 = Date.now();
while (get && (p.status === "starting" || p.status === "processing")) { await new Promise((r) => setTimeout(r, 5000)); p = await (await fetch(get, { headers: { Authorization: `Bearer ${RT}` } })).json(); process.stderr.write("."); if (Date.now() - t0 > 300000) break; }
const out = Array.isArray(p.output) ? p.output[0] : p.output;
console.log("\nDATA-URI upscale:", p.status, "out?", !!out, p.error ? "ERR:" + p.error : "");
