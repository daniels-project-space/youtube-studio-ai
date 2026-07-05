import { writeFile } from "node:fs/promises";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
await bootstrapSecrets(() => {}, { required: ["REPLICATE_API_TOKEN"] });
const RT = process.env.REPLICATE_API_TOKEN;
const VER = "3e56ce4b57863bd03048b42bc09bdd4db20d427cca5fde9d8ae4dc60e1bb4775";
const sub = await fetch("https://api.replicate.com/v1/predictions", { method: "POST", headers: { Authorization: `Bearer ${RT}`, "Content-Type": "application/json" }, body: JSON.stringify({ version: VER, input: { video_path: "http://87.106.233.113/loreshort/ltx0.mp4", model: "RealESRGAN_x4plus", resolution: "2k" } }) });
let j = await sub.json(); console.error("submit", sub.status, j.status || JSON.stringify(j).slice(0, 200));
const getUrl = j.urls?.get; const t0 = Date.now();
while (getUrl && (j.status === "starting" || j.status === "processing")) { await new Promise((r) => setTimeout(r, 5000)); j = await (await fetch(getUrl, { headers: { Authorization: `Bearer ${RT}` } })).json(); process.stderr.write("."); if (Date.now() - t0 > 600000) break; }
console.error("\nfinal", j.status, "predict_time", (j.metrics || {}).predict_time);
const url = Array.isArray(j.output) ? j.output[0] : j.output;
if (!url) { console.error("NO OUTPUT", JSON.stringify(j).slice(0, 400)); process.exit(1); }
await writeFile("/var/www/html/loreshort/ltx0_2k.mp4", Buffer.from(await (await fetch(url)).arrayBuffer()));
console.log("DONE", url);
